import { Types } from "mongoose";
import type { ApiUser } from "@shared/types/api";
import type { CapaCreateInput, CapaListQuery, EffectivenessInput } from "@shared/schemas/capa";
import {
  capaStatusAfterEffectiveness,
  reviewStateAfterReupload,
  shouldReopenComplaint,
  validateCapaStatusChange,
  validateEffectivenessVerification,
  validateEvidenceReview
} from "../domain/capa-rules";
import { canEditCapa, canReviewCapaEvidence, canSeeCompany, canVerifyEffectiveness, hasPermission, isMasterAdmin } from "../domain/rbac";
import { startOfTodayIST } from "../domain/due-day";
import { Capa, type CapaHydrated } from "../models/Capa";
import { Complaint } from "../models/Complaint";
import { Employee } from "../models/Employee";
import { loadComplaintContext, reopenComplaint, requireActor } from "./complaint.service";
import { toDomainCapa } from "./mappers";
import { notify } from "./notification.service";
import { sendTemplatedEmail } from "./email.service";
import { resolveRecipients } from "./email-recipient.service";
import { nextCapaNumber } from "./numbering.service";
import { writeAudit } from "./audit.service";
import { businessRuleError, httpError } from "../utils/http";

async function loadCapa(capaId: string): Promise<CapaHydrated> {
  if (!Types.ObjectId.isValid(capaId)) throw httpError(400, "Invalid CAPA id");
  const capa = await Capa.findById(capaId);
  if (!capa) throw httpError(404, "CAPA not found");
  return capa;
}

async function complaintContextForCapa(capa: CapaHydrated, user: ApiUser | undefined) {
  return loadComplaintContext(String(capa.complaint), user);
}

export async function listCapas(query: CapaListQuery, user: ApiUser | undefined) {
  const actor = await requireActor(user);
  if (!hasPermission(actor, "view.all") && !hasPermission(actor, "view.company")) {
    throw httpError(403, "You do not have permission to view CAPAs");
  }

  const filter: Record<string, unknown> = {};
  if (!hasPermission(actor, "view.all")) filter.company = { $in: actor.companyIds.map((id) => new Types.ObjectId(id)) };
  if (query.company) {
    if (!canSeeCompany(actor, query.company)) throw httpError(403, "You do not have access to this company");
    filter.company = new Types.ObjectId(query.company);
  }
  if (query.complaint) filter.complaint = new Types.ObjectId(query.complaint);
  if (query.owner) filter.owner = new Types.ObjectId(query.owner);
  if (query.department) filter.department = new Types.ObjectId(query.department);
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.effectiveness) filter.effectiveness = query.effectiveness;
  if (query.evidenceReview) filter["evidenceReview.status"] = query.evidenceReview;
  if (query.overdue) {
    filter.dueDate = { $lt: startOfTodayIST() };
    filter.status = { $nin: ["Closed", "Completed"] };
  }
  if (query.dueFrom || query.dueTo) {
    const dueTo = query.dueTo ? new Date(query.dueTo) : undefined;
    dueTo?.setHours(23, 59, 59, 999);
    filter.dueDate = {
      ...(query.dueFrom ? { $gte: query.dueFrom } : {}),
      ...(dueTo ? { $lte: dueTo } : {})
    };
  }
  if (query.search) {
    const term = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(term, "i");
    filter.$or = [{ number: regex }, { action: regex }];
  }

  const sortField = query.sort && /^[a-zA-Z]+$/.test(query.sort) ? query.sort : "dueDate";
  const sort: Record<string, 1 | -1> = { [sortField]: query.order === "asc" ? 1 : -1 };

  const [rows, total] = await Promise.all([
    Capa.find(filter)
      .sort(sort)
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .populate("owner", "name username")
      .populate("ownerEmployee", "name")
      .populate("complaint", "number type status")
      .populate("company", "name code")
      .populate("department", "name")
      .lean(),
    Capa.countDocuments(filter)
  ]);

  return { rows, total };
}

/**
 * Resolves who owns a CAPA action. A Master Data employee without a login can be named as owner (the
 * acting portal user stays the accountable `owner`); a portal user is stored as `owner` alone.
 */
async function resolveCapaOwner(
  input: { owner?: unknown; ownerEmployee?: unknown },
  companyId: Types.ObjectId,
  actorId: string | undefined
): Promise<{ owner?: unknown; ownerEmployee?: unknown } | null> {
  if (input.owner) return { owner: input.owner, ownerEmployee: undefined };
  if (!input.ownerEmployee) return null;
  const employee = await Employee.findOne({ _id: input.ownerEmployee, company: companyId, active: true }).select("_id").lean();
  if (!employee) throw httpError(400, "The selected employee is not active in this company");
  return { owner: actorId, ownerEmployee: employee._id };
}

export async function createCapa(complaintId: string, input: CapaCreateInput, user: ApiUser | undefined) {
  const context = await loadComplaintContext(complaintId, user);
  if (
    !hasPermission(context.actor, "complaint.assign") &&
    !hasPermission(context.actor, "capa.edit.own") &&
    !hasPermission(context.actor, "complaint.edit") &&
    !isMasterAdmin(context.actor)
  ) {
    throw httpError(403, "You do not have permission to add CAPAs");
  }

  const resolvedOwner = await resolveCapaOwner(input, context.doc.company, user?.id);
  if (!resolvedOwner) throw httpError(400, "Select an owner");

  const sequence = (await Capa.countDocuments({ complaint: context.doc._id })) + 1;
  const number = await nextCapaNumber(context.doc.company, context.doc.number, sequence);

  const capa = await Capa.create({
    number,
    complaint: context.doc._id,
    company: context.doc.company,
    sequence,
    type: input.type,
    action: input.action,
    owner: resolvedOwner.owner,
    ownerEmployee: resolvedOwner.ownerEmployee,
    department: input.department ?? context.doc.responsibleDept,
    priority: input.priority ?? context.doc.priority,
    dueDate: input.dueDate,
    status: input.status,
    evidence: input.evidence
  });

  await writeAudit({
    actor: user,
    action: "ASSIGN",
    entity: "Capa",
    entityId: String(capa._id),
    after: { number: capa.number, owner: String(capa.owner), dueDate: capa.dueDate }
  });

  await notify({
    // An employee owner has no portal login; they are reached by email below.
    recipients: (capa.ownerEmployee ? [] : [capa.owner]).filter(Boolean) as Types.ObjectId[],
    message: `CAPA ${capa.number} assigned to you (due ${new Date(capa.dueDate).toISOString().slice(0, 10)})`,
    category: "capa",
    entityType: "Capa",
    entityId: capa._id,
    link: `/complaints/${complaintId}`
  });

  const capaRecipients = await resolveRecipients({
    capaId: capa._id,
    targetRoles: ["CAPA Owner", "Department Head"]
  });
  if (capaRecipients.length > 0) {
    await sendTemplatedEmail({
      triggerEvent: "CAPA_ASSIGNED",
      recipients: capaRecipients,
      relatedCapaId: capa._id,
      relatedComplaintId: complaintId,
      data: {
        capaNumber: capa.number,
        capaType: capa.type,
        targetDate: new Date(capa.dueDate).toLocaleDateString("en-IN"),
        complaintNumber: context.doc.number,
        departmentName: context.doc.responsibleDept ? String(context.doc.responsibleDept) : "Production",
        capaTitle: capa.action,
        actionUrl: `/complaints/${complaintId}`
      }

    });
  }

  return capa;
}


export async function updateCapa(
  capaId: string,
  input: Partial<CapaCreateInput> & { completedAt?: Date; delayReason?: string },
  user: ApiUser | undefined
) {
  const capa = await loadCapa(capaId);
  const context = await complaintContextForCapa(capa, user);
  if (!canEditCapa(context.actor, toDomainCapa(capa), context.domain)) {
    throw httpError(403, "You do not have permission to edit this CAPA");
  }

  if (input.status && input.status !== capa.status) {
    const issues = validateCapaStatusChange(toDomainCapa(capa), input.status, input.evidence);
    if (issues.length > 0) throw businessRuleError("This CAPA status change is not allowed", issues);
  }

  const before = { status: capa.status, owner: String(capa.owner), ownerEmployee: capa.ownerEmployee ? String(capa.ownerEmployee) : null, dueDate: capa.dueDate };
  const resolvedOwner = await resolveCapaOwner(input, capa.company, capa.owner ? String(capa.owner) : user?.id);
  capa.set({
    ...(input.type ? { type: input.type } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(resolvedOwner ? { owner: resolvedOwner.owner, ownerEmployee: resolvedOwner.ownerEmployee ?? null } : {}),
    ...(input.department ? { department: input.department } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.delayReason !== undefined ? { delayReason: input.delayReason } : {})
  });

  if (input.status === "Completed" || input.status === "Closed") {
    capa.completedAt = input.completedAt ?? capa.completedAt ?? new Date();
  }
  await capa.save();

  await writeAudit({ actor: user, action: "UPDATE", entity: "Capa", entityId: capaId, before, after: { status: capa.status } });
  return capa;
}

export async function deleteCapa(capaId: string, user: ApiUser | undefined) {
  const capa = await loadCapa(capaId);
  const context = await complaintContextForCapa(capa, user);
  if (!isMasterAdmin(context.actor) && !hasPermission(context.actor, "complaint.assign")) {
    throw httpError(403, "You do not have permission to delete this CAPA");
  }
  const snapshot = { number: capa.number, action: capa.action, status: capa.status };
  await Capa.deleteOne({ _id: capa._id });
  await writeAudit({ actor: user, action: "DELETE", entity: "Capa", entityId: capaId, before: snapshot });
  return { deleted: true };
}

/* ------------------------------------------------------------------ evidence */

export async function attachEvidence(capaId: string, attachmentId: Types.ObjectId, description: string, user: ApiUser | undefined) {
  const capa = await loadCapa(capaId);
  const context = await complaintContextForCapa(capa, user);
  if (!canEditCapa(context.actor, toDomainCapa(capa), context.domain)) {
    throw httpError(403, "You do not have permission to add evidence to this CAPA");
  }

  capa.evidenceFiles.push({
    attachment: attachmentId,
    description,
    uploadedBy: new Types.ObjectId(context.actor.id),
    uploadedAt: new Date()
  });

  // A re-upload after a rejection returns the CAPA to Pending while keeping the rejection history.
  const reset = reviewStateAfterReupload(toDomainCapa(capa).evidenceReview);
  if (reset) {
    capa.evidenceReview = { status: reset.status, by: undefined, byName: "", at: null, remarks: reset.remarks };
  }
  await capa.save();

  await writeAudit({ actor: user, action: "UPLOAD", entity: "Capa", entityId: capaId, after: { attachment: String(attachmentId) } });

  const qualityRecipients = await resolveRecipients({
    capaId: capa._id,
    targetRoles: ["Quality Head", "Master Admin"]
  });
  if (qualityRecipients.length > 0) {
    await sendTemplatedEmail({
      triggerEvent: "CAPA_EVIDENCE_UPLOADED",
      recipients: qualityRecipients,
      relatedCapaId: capa._id,
      data: {
        capaNumber: capa.number,
        assignedTo: context.actor.name,
        evidenceFileName: description || "Evidence document attached",
        actionUrl: `/complaints/${String(capa.complaint)}`
      }
    });
  }

  return capa;
}

export async function reviewEvidence(capaId: string, decision: "Accepted" | "Rejected", remarks: string, user: ApiUser | undefined) {
  const capa = await loadCapa(capaId);
  const context = await complaintContextForCapa(capa, user);
  if (!canReviewCapaEvidence(context.actor, toDomainCapa(capa))) {
    throw httpError(403, "Only a Quality Head or Master Admin can review CAPA evidence");
  }

  const issues = validateEvidenceReview(decision, remarks);
  if (issues.length > 0) throw businessRuleError("This review decision is incomplete", issues);

  const entry = { status: decision, by: new Types.ObjectId(context.actor.id), byName: context.actor.name, at: new Date(), remarks };
  capa.evidenceReview = entry;
  capa.evidenceReviewHistory.push(entry);
  await capa.save();

  await writeAudit({
    actor: user,
    action: decision === "Accepted" ? "EVIDENCE_ACCEPT" : "EVIDENCE_REJECT",
    entity: "Capa",
    entityId: capaId,
    after: { decision, remarks }
  });

  await notify({
    recipients: [capa.owner].filter(Boolean) as Types.ObjectId[],
    message: `Evidence for CAPA ${capa.number} was ${decision.toLowerCase()}${remarks ? `: ${remarks}` : ""}`,
    category: "evidence",
    priority: decision === "Rejected" ? "high" : "normal",
    entityType: "Capa",
    entityId: capa._id,
    link: `/complaints/${String(capa.complaint)}`
  });

  const ownerRecipients = await resolveRecipients({
    capaId: capa._id,
    targetRoles: ["CAPA Owner"]
  });
  if (ownerRecipients.length > 0) {
    await sendTemplatedEmail({
      triggerEvent: decision === "Accepted" ? "CAPA_EVIDENCE_ACCEPTED" : "CAPA_EVIDENCE_REJECTED",
      recipients: ownerRecipients,
      relatedCapaId: capa._id,
      data: {
        capaNumber: capa.number,
        reviewedBy: context.actor.name,
        rejectionRemarks: remarks || "Evidence does not satisfy acceptance criteria.",
        actionUrl: `/complaints/${String(capa.complaint)}`
      }
    });
  }

  return capa;
}

/* ------------------------------------------------------------------ effectiveness */

export async function verifyEffectiveness(capaId: string, input: EffectivenessInput, user: ApiUser | undefined) {
  const capa = await loadCapa(capaId);
  const context = await complaintContextForCapa(capa, user);
  if (!canVerifyEffectiveness(context.actor, toDomainCapa(capa))) {
    throw httpError(403, "You do not have permission to verify CAPA effectiveness");
  }

  const issues = validateEffectivenessVerification(toDomainCapa(capa), input.result, {
    method: input.verificationMethod,
    evidence: input.effectivenessEvidence
  });
  if (issues.length > 0) throw businessRuleError("Effectiveness verification is incomplete", issues);

  capa.effectiveness = input.result;
  capa.effectivenessVerifiedAt = input.verifiedAt ?? new Date();
  capa.effectivenessVerifiedBy = new Types.ObjectId(context.actor.id);
  capa.verificationMethod = input.verificationMethod;
  capa.effectivenessEvidence = input.effectivenessEvidence;
  capa.effectivenessRemarks = input.remarks;
  capa.status = capaStatusAfterEffectiveness(input.result);
  await capa.save();

  await writeAudit({
    actor: user,
    action: "CAPA_EFFECTIVENESS",
    entity: "Capa",
    entityId: capaId,
    after: { result: input.result, method: input.verificationMethod }
  });

  if (shouldReopenComplaint(input.result)) {
    // A CAPA that did not work reopens its complaint, logs it and notifies the owner.
    await reopenComplaint(String(capa.complaint), `CAPA ${capa.number} verified as Not Effective`, user, { system: true });
    await notify({
      recipients: [capa.owner].filter(Boolean) as Types.ObjectId[],
      message: `CAPA ${capa.number} was marked Not Effective. Add a supplementary corrective action.`,
      category: "effectiveness",
      priority: "high",
      entityType: "Capa",
      entityId: capa._id,
      link: `/complaints/${String(capa.complaint)}`
    });

    const notEffectiveRecipients = await resolveRecipients({
      capaId: capa._id,
      complaintId: capa.complaint,
      targetRoles: ["Complaint Owner", "CAPA Owner", "Quality Head"]
    });
    const mgmtCc = await resolveRecipients({
      capaId: capa._id,
      targetRoles: ["Department Head", "Management"]
    });

    if (notEffectiveRecipients.length > 0) {
      await sendTemplatedEmail({
        triggerEvent: "CAPA_NOT_EFFECTIVE",
        recipients: notEffectiveRecipients,
        cc: mgmtCc,
        relatedCapaId: capa._id,
        relatedComplaintId: capa.complaint,
        data: {
          capaNumber: capa.number,
          complaintNumber: context.doc.number,
          verifiedBy: context.actor.name,
          verificationRemarks: input.remarks || "Action did not prevent defect recurrence.",
          actionUrl: `/complaints/${String(capa.complaint)}`
        }
      });
    }
  } else {
    const effectiveRecipients = await resolveRecipients({
      capaId: capa._id,
      complaintId: capa.complaint,
      targetRoles: ["Complaint Owner", "CAPA Owner", "Quality Head"]
    });
    if (effectiveRecipients.length > 0) {
      await sendTemplatedEmail({
        triggerEvent: "CAPA_EFFECTIVENESS_VERIFIED",
        recipients: effectiveRecipients,
        relatedCapaId: capa._id,
        relatedComplaintId: capa.complaint,
        data: {
          capaNumber: capa.number,
          verifiedBy: context.actor.name,
          actionUrl: `/complaints/${String(capa.complaint)}`
        }
      });
    }
  }

  return capa;
}


export async function capaSummaryForComplaint(complaintId: string) {
  const complaint = await Complaint.findById(complaintId).select("_id").lean();
  if (!complaint) throw httpError(404, "Complaint not found");
  const capas = await Capa.find({ complaint: complaintId }).lean();
  return capas.map((capa) => ({ id: String(capa._id), number: capa.number, status: capa.status, effectiveness: capa.effectiveness }));
}
