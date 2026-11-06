import { Types } from "mongoose";
import type { ApiUser } from "@shared/types/api";
import { WORKFLOW_STAGE_LABELS, WORKFLOW_STAGE_STATUS, type SignatureRole, type WorkflowStage } from "@shared/constants/domain";
import type { ComplaintCreateInput, ComplaintListQuery, ComplaintUpdateInput, StageCompleteInput } from "@shared/schemas/complaint";
import { openCapaWarnings, shouldAutoReopenOnLongTerm, validateForClosure } from "../domain/closure";
import { canCloseComplaint, canEditComplaint, canSeeCompany, canViewComplaint, hasPermission, isMasterAdmin } from "../domain/rbac";
import { nextReviewDue } from "../domain/effectiveness-review";
import { describeRepeatBasis, findRepeatMatches, repeatCutoff } from "../domain/repeat";
import { buildSignatureRecord, rolesInvalidatedBy, validateRevocation, validateSignature } from "../domain/signature";
import { buildTatPlan, isStageOverdueNow } from "../domain/tat";
import type { DomainActor, DomainComplaint } from "../domain/types";
import { delayGaps, stageGaps, stageSequenceGaps, type Gap } from "../domain/workflow";
import { Capa } from "../models/Capa";
import { Complaint, type ComplaintHydrated } from "../models/Complaint";
import { Department } from "../models/Department";
import { ComplaintNote } from "../models/ComplaintNote";
import { EffectivenessCheck } from "../models/EffectivenessCheck";
import { Notification } from "../models/Notification";
import { Employee } from "../models/Employee";
import { Priority } from "../models/masters";
import { User } from "../models/User";
import { activeDelayReasons, resolveTatConfig } from "./config.service";
import { toDomainActor, toDomainCapa, toDomainComplaint } from "./mappers";
import { notify, usersWithRole } from "./notification.service";
import { sendTemplatedEmail } from "./email.service";
import { purgeAttachmentsFor } from "./attachment.service";
import { getEmailRouting } from "./email-routing.service";
import { resolveRecipients } from "./email-recipient.service";
import { nextComplaintNumber } from "./numbering.service";
import { writeAudit } from "./audit.service";
import { businessRuleError, httpError, type FieldIssue } from "../utils/http";


function gapsToIssues(gaps: Gap[]): FieldIssue[] {
  return gaps.map((gap) => ({ field: gap.field, section: gap.section, message: gap.hint ? `${gap.field} — ${gap.hint}` : gap.field }));
}

async function priorityMultiplier(priorityId: unknown): Promise<number> {
  if (!priorityId) return 1;
  const priority = await Priority.findById(priorityId).lean();
  return priority?.tatMultiplier ?? 1;
}

export type ComplaintContext = {
  doc: ComplaintHydrated;
  domain: DomainComplaint;
  actor: DomainActor;
};

export async function requireActor(user: ApiUser | undefined): Promise<DomainActor> {
  if (!user) throw httpError(401, "Unauthorized");
  const employee = user.employee ? await Employee.findById(user.employee).lean() : null;
  const actor = toDomainActor(user, employee?.department ? String(employee.department) : undefined);
  if (!actor) throw httpError(401, "Unauthorized");
  return actor;
}

export async function loadComplaintContext(complaintId: string, user: ApiUser | undefined): Promise<ComplaintContext> {
  if (!Types.ObjectId.isValid(complaintId)) throw httpError(400, "Invalid complaint id");
  // The user's profile and the complaint are independent reads, so they run together.
  const [actor, doc] = await Promise.all([requireActor(user), Complaint.findById(complaintId)]);
  if (!doc) throw httpError(404, "Complaint not found");
  const domain = toDomainComplaint(doc, await priorityMultiplier(doc.priority));
  if (!canViewComplaint(actor, domain)) throw httpError(403, "You do not have access to this complaint");
  return { doc, domain, actor };
}

function assertEditable(context: ComplaintContext) {
  if (!canEditComplaint(context.actor, context.domain)) {
    throw httpError(403, "You do not have permission to edit this complaint");
  }
  if (context.doc.closedAt && !isMasterAdmin(context.actor)) {
    throw httpError(409, "This complaint is closed. Reopen it before making further changes.");
  }
}

async function loadDomainCapas(complaintId: string) {
  const capas = await Capa.find({ complaint: complaintId });
  return capas.map(toDomainCapa);
}

function pushWorkflowLog(doc: ComplaintHydrated, stage: string, actor: DomainActor, notes: string) {
  doc.workflowLog.push({ stage, at: new Date(), by: new Types.ObjectId(actor.id), byName: actor.name, notes });
}

/* ------------------------------------------------------------------ creation */

export async function createComplaint(input: ComplaintCreateInput, user: ApiUser | undefined) {
  const actor = await requireActor(user);
  if (!hasPermission(actor, "complaint.create")) throw httpError(403, "You do not have permission to register complaints");
  if (!canSeeCompany(actor, input.company)) throw httpError(403, "You cannot register complaints for this company");

  const number = await nextComplaintNumber(input.company, input.receivedAt);
  const tatConfig = await resolveTatConfig(input.company);

  const responsibleDept = input.type === "External" ? input.responsibleDept : input.againstDept;

  // A directory employee without a portal login can be named as owner; the creator stays accountable.
  const ownerEmployee = input.ownerEmployee && !input.owner
    ? await Employee.findOne({ _id: input.ownerEmployee, company: input.company, active: true }).select("name email").lean()
    : null;
  if (input.ownerEmployee && !input.owner && !ownerEmployee) throw httpError(400, "The selected employee is not active in this company");

  const doc = await Complaint.create({
    number,
    company: input.company,
    type: input.type,
    status: "Open",
    receivedAt: input.receivedAt,
    source: input.source,
    reportedBy: input.reportedBy,
    priority: input.priority,
    customer: input.type === "External" ? input.customer : "",
    customerContact: input.customerContact,
    customerLocation: input.customerLocation,
    project: input.project,
    customerPO: input.customerPO,
    product: input.product,
    batch: input.batch,
    internalDept: input.type === "Internal" ? input.internalDept : undefined,
    againstDept: input.type === "Internal" ? input.againstDept : undefined,
    responsibleDept,
    category: input.category,
    subCategory: input.subCategory,
    description: input.description,
    owner: input.owner ?? actor.id,
    ownerEmployee: ownerEmployee?._id,
    createdBy: actor.id,
    workflowLog: [{ stage: "Registered", at: new Date(), by: actor.id, byName: actor.name, notes: "Complaint registered" }]
  });

  // Repeat detection runs on the server against the configured window.
  const cutoff = repeatCutoff(tatConfig.repeatWindowDays);
  const population = await Complaint.find({
    _id: { $ne: doc._id },
    company: input.company,
    category: input.category,
    receivedAt: { $gte: cutoff }
  })
    .select("_id number company customer product category receivedAt")
    .lean();

  const matches = findRepeatMatches(
    {
      id: String(doc._id),
      companyId: String(input.company),
      customer: input.customer,
      product: input.product,
      category: input.category,
      receivedAt: input.receivedAt.toISOString()
    },
    population.map((entry) => ({
      id: String(entry._id),
      companyId: String(entry.company),
      customer: entry.customer ?? undefined,
      product: entry.product ?? undefined,
      category: entry.category ?? undefined,
      receivedAt: (entry.receivedAt as Date).toISOString()
    })),
    tatConfig.repeatWindowDays
  );

  if (matches.length > 0) {
    doc.isRepeat = true;
    doc.set(
      "repeatOf",
      matches.map((match) => {
        const source = population.find((entry) => String(entry._id) === match.complaintId);
        return { complaint: new Types.ObjectId(match.complaintId), number: source?.number ?? "", basis: match.basis };
      })
    );
    doc.repeatBasis = describeRepeatBasis(matches);
    await doc.save();
  }

  await writeAudit({
    actor: user,
    action: "CREATE",
    entity: "Complaint",
    entityId: String(doc._id),
    after: { number: doc.number, type: doc.type, category: doc.category, isRepeat: doc.isRepeat }
  });

  const qualityHeads = await usersWithRole("Quality Head", input.company);
  await notify({
    recipients: [doc.owner, ...qualityHeads].filter(Boolean) as (string | Types.ObjectId)[],
    message: `New ${doc.type.toLowerCase()} complaint ${doc.number} registered`,
    category: "complaint",
    entityType: "Complaint",
    entityId: doc._id,
    link: `/complaints/${doc._id}`
  });

  const emailRecipients = await resolveRecipients({
    complaintId: doc._id,
    targetRoles: ["Complaint Owner"],
    explicitEmails: ownerEmployee?.email ? [ownerEmployee.email] : undefined
  });
  const emailCc = await resolveRecipients({
    complaintId: doc._id,
    targetRoles: ["Manager", "Department Head"],
    explicitEmails: (await getEmailRouting()).commonCc
  });
  if (emailRecipients.length > 0) {
    const [ownerUser, responsibleDepartment] = await Promise.all([
      doc.owner ? User.findById(doc.owner).select("name email").lean() : null,
      doc.responsibleDept ? Department.findById(doc.responsibleDept).select("name").lean() : null
    ]);
    const cc = emailCc.filter((email) => !emailRecipients.includes(email));

    await sendTemplatedEmail({
      triggerEvent: "COMPLAINT_CREATED",
      recipients: emailRecipients,
      cc,
      dedupeKey: `COMPLAINT_CREATED_${doc._id}`,
      relatedComplaintId: doc._id,
      data: {
        recipientName: ownerEmployee?.name ?? ownerUser?.name ?? "Complaint Owner",
        complaintNumber: doc.number,
        complaintTitle: doc.description || doc.number,
        complaintType: doc.type,
        customerName: doc.customer || "Internal Issue",
        partName: doc.product || "Component",
        partNumber: "N/A",
        priority: String(doc.priority || "Standard"),
        departmentName: responsibleDepartment?.name ?? "",
        coordinatorName: actor.name,
        ackDueDate: "Within 24h",
        actionUrl: `/complaints/${doc._id}`
      }
    });
  }

  return doc;
}



/* ------------------------------------------------------------------ editing */

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? new Date(a as string).getTime() === new Date(b as string).getTime() : String(a ?? "") === String(b ?? "");

/**
 * A Master Admin correcting a complaint after the fact, mostly to hand an old complaint to a new
 * owner. The type, company and status are never changed here, and every change is recorded with
 * its old and new value. A change of owner notifies the new owner and sends the handover email.
 */
export async function updateComplaint(complaintId: string, input: ComplaintUpdateInput, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  const { doc, actor } = context;
  if (!isMasterAdmin(actor)) throw httpError(403, "Only a Master Admin can edit a complaint");

  // References must point at records that exist, so a bad id cannot leave a complaint half-edited.
  if (input.priority && !(await Priority.exists({ _id: input.priority }))) throw httpError(400, "The selected priority does not exist");
  const departmentIds = [input.internalDept, input.againstDept, input.responsibleDept].filter(Boolean);
  if (departmentIds.length > 0 && (await Department.countDocuments({ _id: { $in: departmentIds } })) !== new Set(departmentIds).size) {
    throw httpError(400, "A selected department does not exist");
  }
  if (input.owner && !(await User.exists({ _id: input.owner, active: true }))) throw httpError(400, "The selected owner is not an active user");
  const ownerEmployee =
    input.ownerEmployee && !input.owner
      ? await Employee.findOne({ _id: input.ownerEmployee, company: doc.company, active: true }).select("name email").lean()
      : null;
  if (input.ownerEmployee && !input.owner && !ownerEmployee) throw httpError(400, "The selected employee is not active in this company");

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const apply = (key: string, value: unknown) => {
    if (value === undefined) return;
    const current = doc.get(key);
    if (sameValue(current, value)) return;
    changes[key] = { from: current ?? null, to: value };
    doc.set(key, value);
  };

  for (const key of ["source", "reportedBy", "customerContact", "customerLocation", "project", "customerPO", "product", "batch", "category", "subCategory", "description"] as const) {
    apply(key, input[key]);
  }
  apply("priority", input.priority);
  apply("receivedAt", input.receivedAt);
  if (doc.type === "External") {
    apply("customer", input.customer);
    apply("responsibleDept", input.responsibleDept);
  } else {
    apply("internalDept", input.internalDept);
    apply("againstDept", input.againstDept);
    // An internal complaint is answerable to the department it was raised against.
    if (input.againstDept) apply("responsibleDept", input.againstDept);
  }

  // `owner` is the accountable portal user; `ownerEmployee` names a directory person who has no login.
  if (input.owner) {
    apply("owner", input.owner);
    if (doc.ownerEmployee) {
      changes.ownerEmployee = { from: doc.ownerEmployee, to: null };
      doc.set("ownerEmployee", undefined);
    }
  } else if (ownerEmployee) {
    apply("ownerEmployee", ownerEmployee._id);
  }

  const changed = Object.keys(changes);
  if (changed.length === 0) return doc;

  pushWorkflowLog(doc, "Edited", actor, `Master Admin updated: ${changed.join(", ")}`);
  await doc.save();

  await writeAudit({
    actor: user,
    action: "UPDATE",
    entity: "Complaint",
    entityId: complaintId,
    before: Object.fromEntries(changed.map((key) => [key, changes[key].from])),
    after: Object.fromEntries(changed.map((key) => [key, changes[key].to])),
    metadata: { editedBy: "Master Admin", number: doc.number }
  });

  if (changes.owner || changes.ownerEmployee) {
    const [newOwner, department] = await Promise.all([
      doc.owner ? User.findById(doc.owner).select("name").lean() : null,
      doc.responsibleDept ? Department.findById(doc.responsibleDept).select("name").lean() : null
    ]);
    const ownerName = ownerEmployee?.name ?? newOwner?.name ?? "the new owner";
    if (changes.owner && doc.owner) {
      await notify({
        recipients: [doc.owner],
        message: `Complaint ${doc.number} was assigned to you`,
        category: "complaint",
        priority: "high",
        entityType: "Complaint",
        entityId: doc._id,
        link: `/complaints/${complaintId}`
      });
    }
    const recipients = await resolveRecipients({
      complaintId: doc._id,
      targetRoles: ["Complaint Owner"],
      explicitEmails: ownerEmployee?.email ? [ownerEmployee.email] : undefined
    });
    if (recipients.length > 0) {
      const stage = (["ack", "cont", "rca", "capa"] as const).find((code) => !doc.get({ ack: "acknowledgedAt", cont: "containmentAt", rca: "rcaAt", capa: "capaAssignedAt" }[code]));
      await sendTemplatedEmail({
        triggerEvent: "COMPLAINT_REASSIGNED",
        recipients,
        relatedComplaintId: doc._id,
        data: {
          recipientName: ownerName,
          ownerName,
          complaintNumber: doc.number,
          departmentName: department?.name ?? "",
          stage: stage ? WORKFLOW_STAGE_LABELS[stage] : "All stages complete",
          actionUrl: `/complaints/${complaintId}`
        }
      });
    }
  }

  return doc;
}

/* ------------------------------------------------------------------ querying */

/**
 * The list and its exports read these fields and nothing else. Returning whole documents
 * also shipped every 8D investigation field (the five-why chains, fishbone, D3/D5/D6 action
 * tables, workflow log), which is around 90% of a closed complaint and is never displayed
 * here. The detail endpoint still returns the complete document.
 */
const COMPLAINT_LIST_FIELDS = [
  "number",
  "type",
  "status",
  "company",
  "priority",
  "category",
  "subCategory",
  "customer",
  "product",
  "receivedAt",
  "closedAt",
  "isRepeat",
  "owner",
  "ownerEmployee",
  "responsibleDept",
  "description"
].join(" ");

export async function listComplaints(query: ComplaintListQuery, user: ApiUser | undefined) {
  const actor = await requireActor(user);
  if (!hasPermission(actor, "view.all") && !hasPermission(actor, "view.company")) {
    throw httpError(403, "You do not have permission to view complaints");
  }

  const filter: Record<string, unknown> = {};
  if (!hasPermission(actor, "view.all")) filter.company = { $in: actor.companyIds.map((id) => new Types.ObjectId(id)) };
  if (query.company) {
    if (!canSeeCompany(actor, query.company)) throw httpError(403, "You do not have access to this company");
    filter.company = new Types.ObjectId(query.company);
  }
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = new Types.ObjectId(query.priority);
  if (query.category) filter.category = query.category;
  if (query.responsibleDept) filter.responsibleDept = new Types.ObjectId(query.responsibleDept);
  if (query.owner) filter.owner = new Types.ObjectId(query.owner);
  if (typeof query.isRepeat === "boolean") filter.isRepeat = query.isRepeat;
  if (query.receivedFrom || query.receivedTo) {
    const receivedTo = query.receivedTo ? new Date(query.receivedTo) : undefined;
    receivedTo?.setHours(23, 59, 59, 999);
    filter.receivedAt = {
      ...(query.receivedFrom ? { $gte: query.receivedFrom } : {}),
      ...(receivedTo ? { $lte: receivedTo } : {})
    };
  }
  if (query.search) {
    const term = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(term, "i");
    filter.$or = [{ number: regex }, { customer: regex }, { product: regex }, { project: regex }, { description: regex }];
  }

  const sortField = query.sort && /^[a-zA-Z]+$/.test(query.sort) ? query.sort : "receivedAt";
  const sort: Record<string, 1 | -1> = { [sortField]: query.order === "asc" ? 1 : -1 };

  const [rows, total] = await Promise.all([
    Complaint.find(filter)
      .select(COMPLAINT_LIST_FIELDS)
      .sort(sort)
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .populate("company", "name code")
      .populate("priority", "name color tatMultiplier")
      .populate("owner", "name username")
      .populate("ownerEmployee", "name")
      .populate("responsibleDept", "name")
      .lean(),
    Complaint.countDocuments(filter)
  ]);

  return { rows, total };
}

export async function getComplaintDetail(complaintId: string, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  const { priority, internalDept, againstDept, responsibleDept } = context.doc;
  const closedAt = context.doc.closedAt;
  // Everything the page needs is read in one round trip instead of one after another.
  const [tatConfig, capas, ownerUser, ownerEmployee, priorityDoc, departments, checksDone] = await Promise.all([
    resolveTatConfig(context.doc.company),
    Capa.find({ complaint: context.doc._id }).populate("owner", "name").populate("ownerEmployee", "name").sort({ sequence: 1 }).lean(),
    context.doc.owner ? User.findById(context.doc.owner).select("name").lean() : null,
    context.doc.ownerEmployee ? Employee.findById(context.doc.ownerEmployee).select("name").lean() : null,
    priority ? Priority.findById(priority).select("name").lean() : null,
    Department.find({ _id: { $in: [internalDept, againstDept, responsibleDept].filter(Boolean) } }).select("name").lean(),
    // A closed complaint is re-checked every six months; the next check follows the ones already recorded.
    closedAt ? EffectivenessCheck.countDocuments({ complaint: context.doc._id, closedAt }) : 0
  ]);
  const departmentName = (id: unknown) => (id ? departments.find((entry) => String(entry._id) === String(id))?.name : undefined);
  return {
    complaint: {
      ...context.doc.toObject(),
      // The stored references are ids; the page shows these resolved names instead of raw ids.
      priorityName: priorityDoc?.name,
      internalDeptName: departmentName(internalDept),
      againstDeptName: departmentName(againstDept),
      responsibleDeptName: departmentName(responsibleDept),
      ownerName: ownerUser?.name,
      ownerEmployeeName: ownerEmployee?.name,
      effectivenessNextDue: closedAt ? nextReviewDue(closedAt, checksDone) : null
    },
    capas,
    tat: buildTatPlan(context.domain, tatConfig),
    tatConfig,
    permissions: {
      canEdit: canEditComplaint(context.actor, context.domain),
      canClose: canCloseComplaint(context.actor, context.domain),
      canDelete: isMasterAdmin(context.actor)
    }
  };
}

/* ------------------------------------------------------------------ workflow */

export async function completeStage(complaintId: string, input: StageCompleteInput, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  assertEditable(context);

  const stage: WorkflowStage = input.stage;
  const capas = await loadDomainCapas(complaintId);
  const tatConfig = await resolveTatConfig(context.doc.company);

  // The dialog may carry the D0 response, so the gate must see it before the stage is checked.
  const submittedD0 = stage === "ack" ? input.d0?.trim() : undefined;
  const domain = submittedD0 ? { ...context.domain, d0: submittedD0 } : context.domain;
  const sequenceIssues = stageSequenceGaps(domain, stage);
  const contentIssues = stageGaps(domain, capas, stage);
  const overdue = isStageOverdueNow(domain, stage, tatConfig);
  const reasons = await activeDelayReasons();
  const delayIssues = delayGaps(overdue, input.delay, reasons);

  const gaps = [...sequenceIssues, ...contentIssues, ...delayIssues];
  if (gaps.length > 0) {
    throw businessRuleError(`This stage cannot be completed yet (${gaps.length} requirement(s) outstanding)`, gapsToIssues(gaps));
  }

  const now = new Date();
  const fieldByStage: Record<WorkflowStage, "acknowledgedAt" | "containmentAt" | "rcaAt" | "capaAssignedAt"> = {
    ack: "acknowledgedAt",
    cont: "containmentAt",
    rca: "rcaAt",
    capa: "capaAssignedAt"
  };
  const delayFieldByStage: Record<WorkflowStage, "ackDelayReason" | "contDelayReason" | "rcaDelayReason" | "capaDelayReason"> = {
    ack: "ackDelayReason",
    cont: "contDelayReason",
    rca: "rcaDelayReason",
    capa: "capaDelayReason"
  };

  context.doc.set(fieldByStage[stage], now);
  if (submittedD0) context.doc.d0 = submittedD0;
  if (stage === "cont" && input.containmentNotes) context.doc.containmentNotes = input.containmentNotes;
  if (overdue && input.delay) {
    context.doc.set(delayFieldByStage[stage], {
      category: input.delay.category,
      explanation: input.delay.explanation,
      recovery: input.delay.recovery,
      recordedAt: now,
      recordedBy: context.actor.id
    });
  }
  context.doc.status = WORKFLOW_STAGE_STATUS[stage];
  pushWorkflowLog(
    context.doc,
    WORKFLOW_STAGE_STATUS[stage],
    context.actor,
    input.notes || (overdue ? `Delay: ${input.delay?.category}` : "")
  );
  await context.doc.save();

  await writeAudit({
    actor: user,
    action: stage === "ack" ? "ACKNOWLEDGE" : "STAGE_COMPLETE",
    entity: "Complaint",
    entityId: complaintId,
    after: { stage, at: now.toISOString(), overdue }
  });

  if (context.doc.owner) {
    await notify({
      recipients: [context.doc.owner],
      message: `${context.doc.number} moved to ${WORKFLOW_STAGE_STATUS[stage]}`,
      category: "workflow",
      entityType: "Complaint",
      entityId: context.doc._id,
      link: `/complaints/${complaintId}`
    });
  }

  const stageTriggerMap: Record<string, string> = {
    ack: "COMPLAINT_ACKNOWLEDGED",
    cont: "COMPLAINT_CONTAINMENT_COMPLETED",
    rca: "COMPLAINT_RCA_COMPLETED",
    capa: "COMPLAINT_CAPA_ASSIGNED"
  };

  const trigger = stageTriggerMap[stage];
  if (trigger) {
    const stageRecipients = await resolveRecipients({
      complaintId: context.doc._id,
      targetRoles: ["Complaint Owner", "Coordinator", "Department Head"]
    });
    if (stageRecipients.length > 0) {
      await sendTemplatedEmail({
        triggerEvent: trigger,
        recipients: stageRecipients,
        relatedComplaintId: context.doc._id,
        data: {
          complaintNumber: context.doc.number,
          acknowledgedBy: context.actor.name,
          ownerName: context.actor.name,
          stage: WORKFLOW_STAGE_STATUS[stage],
          containmentDueDate: "Scheduled",
          rcaDueDate: "Scheduled",
          capaDueDate: "Scheduled",
          rootCauseCategory: context.doc.rootCauseCategory || "Investigated",
          rootCauseSummary: context.doc.d4Occurrence || "Root cause identified.",
          capaCount: "1",
          assignedTo: context.actor.name,
          actionUrl: `/complaints/${complaintId}`
        }
      });
    }
  }

  return context.doc;
}



/* ------------------------------------------------------------------ 8D and internal investigation */

export async function saveInvestigation(complaintId: string, patch: Record<string, unknown>, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  assertEditable(context);

  const before = context.doc.toObject();
  context.doc.set(patch);
  await context.doc.save();

  await writeAudit({
    actor: user,
    action: "UPDATE",
    entity: "Complaint",
    entityId: complaintId,
    before: { keys: Object.keys(patch) },
    after: { keys: Object.keys(patch) },
    metadata: { type: before.type }
  });

  if (shouldAutoReopenOnLongTerm(toDomainComplaint(context.doc, 1))) {
    await reopenComplaint(complaintId, "D7 long-term effectiveness marked Not Sustained", user, { system: true });
  }

  return Complaint.findById(complaintId);
}

/* ------------------------------------------------------------------ signatures */

export async function signComplaint(complaintId: string, role: SignatureRole, notes: string, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  const issues = validateSignature(role, context.actor, context.domain);
  if (issues.length > 0) throw businessRuleError("This signature cannot be applied", issues);

  const employee = user?.employee ? await Employee.findById(user.employee).lean() : null;
  const record = buildSignatureRecord(
    context.actor,
    { designation: employee?.designation ?? undefined, department: context.actor.department },
    notes
  );

  context.doc.set(`signatures.${role}`, {
    user: new Types.ObjectId(record.userId),
    name: record.name,
    designation: record.designation,
    department: record.department,
    email: record.email,
    at: new Date(record.at),
    notes: record.notes
  });
  pushWorkflowLog(context.doc, `Signed (${role})`, context.actor, record.notes || `${role} signature applied`);
  await context.doc.save();

  await writeAudit({ actor: user, action: "SIGN", entity: "Complaint", entityId: complaintId, after: { role, by: context.actor.name } });

  const signatureTriggerMap: Record<SignatureRole, string> = {
    prepared: "COMPLAINT_PREPARED",
    reviewed: "COMPLAINT_REVIEWED",
    approved: "COMPLAINT_APPROVED"
  };
  const sigTrigger = signatureTriggerMap[role];
  if (sigTrigger) {
    const sigRecipients = await resolveRecipients({
      complaintId: context.doc._id,
      targetRoles: ["Complaint Owner", "Coordinator", "Quality Head", "Department Head"]
    });
    if (sigRecipients.length > 0) {
      await sendTemplatedEmail({
        triggerEvent: sigTrigger,
        recipients: sigRecipients,
        relatedComplaintId: context.doc._id,
        data: {
          complaintNumber: context.doc.number,
          signerName: context.actor.name,
          actionUrl: `/complaints/${complaintId}`
        }
      });
    }
  }

  return context.doc;
}

export async function revokeSignature(complaintId: string, role: SignatureRole, reason: string, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  const issues = validateRevocation(role, context.actor, context.domain, reason);
  if (issues.length > 0) throw businessRuleError("This signature cannot be revoked", issues);

  // Revoking a stage also invalidates every later stage.
  rolesInvalidatedBy(role).forEach((invalidated) => context.doc.set(`signatures.${invalidated}`, null));
  pushWorkflowLog(context.doc, `Signature revoked (${role})`, context.actor, reason);
  await context.doc.save();

  await writeAudit({
    actor: user,
    action: "UNSIGN",
    entity: "Complaint",
    entityId: complaintId,
    after: { role, reason, invalidated: rolesInvalidatedBy(role) }
  });

  const revokeRecipients = await resolveRecipients({
    complaintId: context.doc._id,
    targetRoles: ["Complaint Owner", "Coordinator", "Quality Head"]
  });
  if (revokeRecipients.length > 0) {
    await sendTemplatedEmail({
      triggerEvent: "SIGNATURE_REVOKED",
      recipients: revokeRecipients,
      relatedComplaintId: context.doc._id,
      data: {
        complaintNumber: context.doc.number,
        revokedBy: context.actor.name,
        signatureRole: role.toUpperCase(),
        revocationReason: reason,
        actionUrl: `/complaints/${complaintId}`
      }
    });
  }

  return context.doc;
}


/* ------------------------------------------------------------------ closure */

export async function closeComplaint(
  complaintId: string,
  input: { closureRemarks: string; noRepeatConfirmed: boolean; force: boolean; forceCloseAll?: boolean },
  user: ApiUser | undefined
) {
  const context = await loadComplaintContext(complaintId, user);
  if (!canCloseComplaint(context.actor, context.domain)) throw httpError(403, "You do not have permission to close complaints");
  if (context.doc.closedAt) throw httpError(409, "This complaint is already closed");

  // Force Close: only a Master Admin may close a complaint that is incompletely filled or has open CAPAs.
  const forceCloseAll = Boolean(input.forceCloseAll);
  if (forceCloseAll && !isMasterAdmin(context.actor)) throw httpError(403, "Only a Master Admin can force close a complaint");

  const capas = await loadDomainCapas(complaintId);
  const gaps = validateForClosure(context.domain, capas);
  if (gaps.length > 0 && !forceCloseAll) {
    throw businessRuleError(`This complaint cannot be closed yet (${gaps.length} mandatory item(s) missing)`, gapsToIssues(gaps));
  }

  const openCapas = openCapaWarnings(capas);
  if (openCapas.length > 0 && !input.force && !forceCloseAll) {
    throw businessRuleError("Some CAPAs are still open", [
      { field: "capas", section: "CAPA", message: `Still open: ${openCapas.join(", ")}. Resend with force to close anyway.` }
    ]);
  }

  const now = new Date();
  context.doc.closedAt = now;
  context.doc.closedBy = new Types.ObjectId(context.actor.id);
  context.doc.closureRemarks = input.closureRemarks;
  context.doc.d7NoRepeatConfirmed = input.noRepeatConfirmed;
  context.doc.status = "Closed";
  pushWorkflowLog(
    context.doc,
    "Closed",
    context.actor,
    forceCloseAll ? `Force closed by Master Admin${gaps.length ? ` with ${gaps.length} mandatory item(s) incomplete` : ""}. ${input.closureRemarks}` : input.closureRemarks
  );
  await context.doc.save();

  await writeAudit({
    actor: user,
    action: "CLOSE",
    entity: "Complaint",
    entityId: complaintId,
    after: {
      closedAt: now.toISOString(),
      remarks: input.closureRemarks,
      forcedOverOpenCapas: openCapas,
      ...(forceCloseAll ? { forceClosed: true, skippedRequirements: gaps.map((gap) => `${gap.section}: ${gap.field}`) } : {})
    }
  });

  await notify({
    recipients: [context.doc.owner].filter(Boolean) as Types.ObjectId[],
    message: `Complaint ${context.doc.number} was closed by ${context.actor.name}`,
    category: "complaint",
    entityType: "Complaint",
    entityId: context.doc._id,
    link: `/complaints/${complaintId}`
  });

  const closeRecipients = await resolveRecipients({
    complaintId: context.doc._id,
    targetRoles: ["Complaint Owner", "Coordinator", "Quality Head", "Department Head"]
  });
  if (closeRecipients.length > 0) {
    await sendTemplatedEmail({
      triggerEvent: "COMPLAINT_CLOSED",
      recipients: closeRecipients,
      relatedComplaintId: context.doc._id,
      data: {
        complaintNumber: context.doc.number,
        customerName: context.doc.customer || "Internal",
        partName: context.doc.product || "Component",
        closedBy: context.actor.name,
        actionUrl: `/complaints/${complaintId}`
      }
    });
  }

  return context.doc;
}


export async function reopenComplaint(complaintId: string, reason: string, user: ApiUser | undefined, options: { system?: boolean } = {}) {
  const context = await loadComplaintContext(complaintId, user);
  if (!options.system && !canCloseComplaint(context.actor, context.domain) && !hasPermission(context.actor, "8d.approve")) {
    throw httpError(403, "You do not have permission to reopen complaints");
  }

  context.doc.status = "Reopened";
  context.doc.closedAt = null;
  context.doc.reopenedAt = new Date();
  context.doc.reopenReason = reason;
  pushWorkflowLog(context.doc, "Reopened", context.actor, reason);
  await context.doc.save();

  await writeAudit({ actor: user, action: "REOPEN", entity: "Complaint", entityId: complaintId, after: { reason } });
  await notify({
    recipients: [context.doc.owner].filter(Boolean) as Types.ObjectId[],
    message: `Complaint ${context.doc.number} was reopened: ${reason}`,
    category: "complaint",
    priority: "high",
    entityType: "Complaint",
    entityId: context.doc._id,
    link: `/complaints/${complaintId}`
  });

  const reopenRecipients = await resolveRecipients({
    complaintId: context.doc._id,
    targetRoles: ["Complaint Owner", "Coordinator", "Quality Head", "Department Head"]
  });
  if (reopenRecipients.length > 0) {
    await sendTemplatedEmail({
      triggerEvent: "COMPLAINT_REOPENED",
      recipients: reopenRecipients,
      relatedComplaintId: context.doc._id,
      data: {
        complaintNumber: context.doc.number,
        reopenedBy: context.actor.name,
        departmentName: "Quality & Operations",
        reopenReason: reason,
        actionUrl: `/complaints/${complaintId}`
      }
    });
  }

  return context.doc;
}


/* ------------------------------------------------------------------ repeat review */

export async function reviewRepeatLinkage(complaintId: string, input: { isRepeat: boolean; remarks: string }, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  if (!canEditComplaint(context.actor, context.domain) && !hasPermission(context.actor, "complaint.assign")) {
    throw httpError(403, "You do not have permission to review repeat linkage");
  }

  const before = { isRepeat: context.doc.isRepeat };
  context.doc.isRepeat = input.isRepeat;
  context.doc.repeatReviewedBy = new Types.ObjectId(context.actor.id);
  context.doc.repeatReviewedAt = new Date();
  context.doc.repeatReviewRemarks = input.remarks;
  await context.doc.save();

  await writeAudit({
    actor: user,
    action: "UPDATE",
    entity: "Complaint",
    entityId: complaintId,
    before,
    after: { isRepeat: input.isRepeat }
  });
  return context.doc;
}

/* ------------------------------------------------------------------ overall effectiveness */

export async function saveOverallEffectiveness(
  complaintId: string,
  input: { result: "Effective" | "Not Effective"; at?: Date; comments: string },
  user: ApiUser | undefined
) {
  const context = await loadComplaintContext(complaintId, user);
  if (!hasPermission(context.actor, "capa.verify") && !hasPermission(context.actor, "8d.approve") && !isMasterAdmin(context.actor)) {
    throw httpError(403, "You do not have permission to record overall effectiveness");
  }

  context.doc.overallEffectiveness = {
    result: input.result,
    at: input.at ?? new Date(),
    by: new Types.ObjectId(context.actor.id),
    comments: input.comments
  };
  await context.doc.save();

  await writeAudit({
    actor: user,
    action: "CAPA_EFFECTIVENESS",
    entity: "Complaint",
    entityId: complaintId,
    after: { result: input.result }
  });

  if (input.result === "Not Effective") {
    await reopenComplaint(complaintId, "Overall effectiveness recorded as Not Effective", user, { system: true });
  }

  return Complaint.findById(complaintId);
}

/* ------------------------------------------------------------------ deletion */

export async function deleteComplaint(complaintId: string, confirmation: string, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  if (!isMasterAdmin(context.actor)) throw httpError(403, "Only a Master Admin can delete a complaint");
  if (confirmation !== context.doc.number) {
    throw businessRuleError("Deletion was not confirmed", [
      { field: "confirmation", message: "Type the exact complaint number to confirm deletion" }
    ]);
  }

  const snapshot = context.doc.toObject();
  // Remove everything that belongs to the complaint so no orphaned records are left behind.
  const capaIds = (await Capa.find({ complaint: context.doc._id }).select("_id").lean()).map((capa) => capa._id);
  await purgeAttachmentsFor("Capa", capaIds);
  await purgeAttachmentsFor("Complaint", [context.doc._id]);
  await Promise.all([
    Capa.deleteMany({ complaint: context.doc._id }),
    ComplaintNote.deleteMany({ complaint: context.doc._id }),
    EffectivenessCheck.deleteMany({ complaint: context.doc._id }),
    Notification.deleteMany({ entityId: { $in: [context.doc._id, ...capaIds] } })
  ]);
  await Complaint.deleteOne({ _id: context.doc._id });

  // The audit trail intentionally survives the deletion.
  await writeAudit({ actor: user, action: "DELETE", entity: "Complaint", entityId: complaintId, before: { number: snapshot.number } });
  return { deleted: true, number: snapshot.number };
}
