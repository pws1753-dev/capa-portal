import { Types } from "mongoose";
import type { ApiUser } from "@shared/types/api";
import { startOfTodayIST } from "../domain/due-day";
import { WORKFLOW_STAGES, WORKFLOW_STAGE_LABELS, type ComplaintType, type WorkflowStage } from "@shared/constants/domain";
import { hasPermission, canSeeCompany } from "../domain/rbac";
import { buildTatPlan } from "../domain/tat";
import type { DomainComplaint, TatConfig } from "../domain/types";
import { Capa } from "../models/Capa";
import { Complaint } from "../models/Complaint";
import { Priority } from "../models/masters";
import { User } from "../models/User";
import { Employee } from "../models/Employee";
import { resolveTatConfig } from "./config.service";
import { requireActor } from "./complaint.service";
import { httpError } from "../utils/http";

/** Lean projection of everything the analytics calculations need. */
type ComplaintRow = {
  _id: Types.ObjectId;
  number: string;
  company: Types.ObjectId;
  type: "External" | "Internal";
  status: string;
  receivedAt: Date;
  closedAt?: Date | null;
  priority?: Types.ObjectId;
  owner?: Types.ObjectId;
  ownerEmployee?: Types.ObjectId;
  responsibleDept?: Types.ObjectId;
  customer?: string;
  product?: string;
  category?: string;
  rootCauseCategory?: string;
  d4Occurrence?: string;
  isRepeat?: boolean;
  repeatOf?: { complaint: Types.ObjectId; number?: string; basis?: string[] }[];
  acknowledgedAt?: Date | null;
  containmentAt?: Date | null;
  rcaAt?: Date | null;
  capaAssignedAt?: Date | null;
  ackDelayReason?: { category?: string; explanation?: string } | null;
  contDelayReason?: { category?: string; explanation?: string } | null;
  rcaDelayReason?: { category?: string; explanation?: string } | null;
  capaDelayReason?: { category?: string; explanation?: string } | null;
};

const COMPLAINT_PROJECTION =
  "number company type status receivedAt closedAt priority owner ownerEmployee responsibleDept customer product category rootCauseCategory d4Occurrence isRepeat repeatOf acknowledgedAt containmentAt rcaAt capaAssignedAt ackDelayReason contDelayReason rcaDelayReason capaDelayReason";

export type AnalyticsScope = { filter: Record<string, unknown>; companyId: string | null };
type DateRange = { startDate?: Date; endDate?: Date };

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function rangeFilter(range?: DateRange) {
  if (!range?.startDate && !range?.endDate) return {};
  return {
    ...(range.startDate ? { $gte: range.startDate } : {}),
    ...(range.endDate ? { $lte: endOfDay(range.endDate) } : {})
  };
}

/** Company scope is resolved from server-side permissions, never from a client flag. */
export async function resolveScope(user: ApiUser | undefined, companyId?: string): Promise<AnalyticsScope> {
  const actor = await requireActor(user);
  if (!hasPermission(actor, "view.all") && !hasPermission(actor, "view.company")) {
    throw httpError(403, "You do not have permission to view analytics");
  }
  const filter: Record<string, unknown> = {};
  if (!hasPermission(actor, "view.all")) {
    filter.company = { $in: actor.companyIds.map((id) => new Types.ObjectId(id)) };
  }
  if (companyId) {
    if (!canSeeCompany(actor, companyId)) throw httpError(403, "You do not have access to this company");
    filter.company = new Types.ObjectId(companyId);
  }
  return { filter, companyId: companyId ?? null };
}

async function priorityMultipliers() {
  const priorities = await Priority.find().select("name tatMultiplier color order").lean();
  const byId = new Map<string, { name: string; tatMultiplier: number; color: string }>();
  priorities.forEach((priority) =>
    byId.set(String(priority._id), { name: priority.name, tatMultiplier: priority.tatMultiplier ?? 1, color: priority.color })
  );
  return byId;
}

function toDomain(row: ComplaintRow, multiplier: number): DomainComplaint {
  return {
    id: String(row._id),
    number: row.number,
    companyId: String(row.company),
    type: row.type,
    status: row.status as DomainComplaint["status"],
    receivedAt: row.receivedAt.toISOString(),
    priorityMultiplier: multiplier,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    containmentAt: row.containmentAt ? row.containmentAt.toISOString() : null,
    rcaAt: row.rcaAt ? row.rcaAt.toISOString() : null,
    capaAssignedAt: row.capaAssignedAt ? row.capaAssignedAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null
  };
}

function percent(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function lastMonths(count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    keys.push(monthKey(date));
  }
  return keys;
}

function countBy<T>(items: T[], key: (item: T) => string | undefined) {
  const map = new Map<string, number>();
  items.forEach((item) => {
    const value = key(item);
    if (!value) return;
    map.set(value, (map.get(value) ?? 0) + 1);
  });
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

async function loadComplaints(scope: AnalyticsScope, extra: Record<string, unknown> = {}) {
  return Complaint.find({ ...scope.filter, ...extra })
    .select(COMPLAINT_PROJECTION)
    .lean<ComplaintRow[]>();
}

/** Per-stage TAT state for one complaint, used by both the dashboard and the TAT board. */
function stageStates(rows: ComplaintRow[], multipliers: Map<string, { tatMultiplier: number }>, config: TatConfig, now: Date) {
  return rows.map((row) => {
    const multiplier = multipliers.get(String(row.priority))?.tatMultiplier ?? 1;
    const plan = buildTatPlan(toDomain(row, multiplier), config, now);
    return { row, plan };
  });
}

/* ------------------------------------------------------------------ dashboard */

/** The complaints a dashboard shows: the date range, and optionally only Internal or only External ones. */
function complaintFilter(dateFilter: Record<string, unknown>, type?: ComplaintType) {
  return { ...(Object.keys(dateFilter).length ? { receivedAt: dateFilter } : {}), ...(type ? { type } : {}) };
}

/**
 * One row per responsible person (the complaint owner): how many complaints they own and where they
 * stand. "Delayed" uses the same rule as the Overdue card, so the column adds up to that number.
 */
async function ownerSummary(states: ReturnType<typeof stageStates>) {
  const ownerIds = [...new Set(states.map(({ row }) => row.owner).filter(Boolean).map(String))];
  const employeeIds = [...new Set(states.map(({ row }) => row.ownerEmployee).filter(Boolean).map(String))];
  const [users, employees] = await Promise.all([
    ownerIds.length ? User.find({ _id: { $in: ownerIds } }).select("name").lean() : [],
    employeeIds.length ? Employee.find({ _id: { $in: employeeIds } }).select("name").lean() : []
  ]);
  const names = new Map([...users, ...employees].map((entry) => [String(entry._id), entry.name as string]));

  const people = new Map<string, { owner: string; total: number; open: number; delayed: number; inProcess: number; closed: number }>();
  for (const { row, plan } of states) {
    // A directory employee named as owner is who the complaint is shown against, so they are the person here.
    const owner = (row.ownerEmployee && names.get(String(row.ownerEmployee))) || (row.owner && names.get(String(row.owner))) || "Unassigned";
    const entry = people.get(owner) ?? { owner, total: 0, open: 0, delayed: 0, inProcess: 0, closed: 0 };
    entry.total += 1;
    if (row.status === "Closed") {
      entry.closed += 1;
    } else {
      entry.open += 1;
      if (plan.some((stage) => stage.overdue)) entry.delayed += 1;
      if (row.acknowledgedAt) entry.inProcess += 1;
    }
    people.set(owner, entry);
  }

  return [...people.values()]
    .map((entry) => ({
      ...entry,
      closurePercent: percent(entry.closed, entry.total),
      status: entry.delayed === 0 ? ("Compliant" as const) : ("Non-Compliant" as const)
    }))
    .sort((a, b) => b.delayed - a.delayed || b.total - a.total || a.owner.localeCompare(b.owner));
}

export async function dashboardAnalytics(user: ApiUser | undefined, companyId?: string, range?: DateRange, type?: ComplaintType) {
  const scope = await resolveScope(user, companyId);
  const config = await resolveTatConfig(companyId ?? null);
  const dateFilter = rangeFilter(range);
  const [rows, multipliers] = await Promise.all([loadComplaints(scope, complaintFilter(dateFilter, type)), priorityMultipliers()]);
  const now = new Date();
  const states = stageStates(rows, multipliers, config, now);

  const total = rows.length;
  const closed = rows.filter((row) => row.status === "Closed").length;
  const open = total - closed;
  const external = rows.filter((row) => row.type === "External").length;
  const repeat = rows.filter((row) => row.isRepeat).length;

  const overdue = states.filter(({ row, plan }) => row.status !== "Closed" && plan.some((stage) => stage.overdue)).length;

  let stageTotal = 0;
  let stageOnTime = 0;
  states.forEach(({ plan }) =>
    plan.forEach((stage) => {
      if (!stage.completedAt) return;
      stageTotal += 1;
      if (stage.health === "on-time") stageOnTime += 1;
    })
  );

  const closureDurations = rows
    .filter((row) => row.closedAt)
    .map((row) => (new Date(row.closedAt as Date).getTime() - new Date(row.receivedAt).getTime()) / 86400000);
  const averageClosureDays =
    closureDurations.length === 0 ? 0 : Math.round((closureDurations.reduce((sum, days) => sum + days, 0) / closureDurations.length) * 10) / 10;

  // CAPAs belong to a complaint, so an Internal/External filter keeps only the CAPAs of those complaints.
  const typedComplaintIds = type ? (await Complaint.find({ ...scope.filter, type }).select("_id").lean()).map((entry) => entry._id) : null;
  const capaRows = await Capa.find({
    ...scope.filter,
    ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    ...(typedComplaintIds ? { complaint: { $in: typedComplaintIds } } : {})
  })
    .select("status dueDate effectiveness completedAt owner")
    .lean();
  const capaClosed = capaRows.filter((capa) => capa.status === "Closed" || capa.status === "Completed").length;
  const capaOverdue = capaRows.filter(
    (capa) => capa.status !== "Closed" && capa.status !== "Completed" && capa.dueDate && new Date(capa.dueDate) < startOfTodayIST(now)
  ).length;
  const effectivenessFailures = capaRows.filter((capa) => capa.effectiveness === "Not Effective").length;

  const months = lastMonths(12);
  const trend = months.map((key) => ({
    month: key,
    received: rows.filter((row) => monthKey(new Date(row.receivedAt)) === key).length,
    closed: rows.filter((row) => row.closedAt && monthKey(new Date(row.closedAt)) === key).length
  }));

  const agingBuckets = [
    { name: "0-7 days", min: 0, max: 7 },
    { name: "8-15 days", min: 8, max: 15 },
    { name: "16-30 days", min: 16, max: 30 },
    { name: "31-60 days", min: 31, max: 60 },
    { name: "60+ days", min: 61, max: Number.MAX_SAFE_INTEGER }
  ];
  const openRows = rows.filter((row) => row.status !== "Closed");
  const aging = agingBuckets.map((bucket) => ({
    name: bucket.name,
    value: openRows.filter((row) => {
      const days = Math.floor((now.getTime() - new Date(row.receivedAt).getTime()) / 86400000);
      return days >= bucket.min && days <= bucket.max;
    }).length
  }));

  const priorityNames = new Map([...multipliers.entries()].map(([id, value]) => [id, value]));
  const recent = [...rows]
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .slice(0, 8)
    .map((row) => ({
      id: String(row._id),
      number: row.number,
      type: row.type,
      status: row.status,
      customer: row.customer ?? "",
      category: row.category ?? "",
      receivedAt: row.receivedAt,
      isRepeat: Boolean(row.isRepeat)
    }));

  return {
    kpis: {
      total,
      open,
      closed,
      overdue,
      external,
      internal: total - external,
      repeat,
      repeatPercent: percent(repeat, total),
      closurePercent: percent(closed, total),
      tatCompliancePercent: percent(stageOnTime, stageTotal),
      averageClosureDays,
      capaTotal: capaRows.length,
      capaClosed,
      capaClosurePercent: percent(capaClosed, capaRows.length),
      capaOverdue,
      capaOverduePercent: percent(capaOverdue, capaRows.length),
      effectivenessFailures
    },
    statusDistribution: countBy(rows, (row) => row.status),
    priorityDistribution: countBy(rows, (row) => priorityNames.get(String(row.priority))?.name ?? "Unassigned"),
    typeDistribution: [
      { name: "External", value: external },
      { name: "Internal", value: total - external }
    ],
    trend,
    aging,
    rootCauseCategories: countBy(rows, (row) => row.rootCauseCategory),
    categories: countBy(rows, (row) => row.category).slice(0, 10),
    ownerSummary: await ownerSummary(states),
    recent
  };
}

/* ------------------------------------------------------------------ TAT board */

export async function tatAnalytics(user: ApiUser | undefined, companyId?: string, range?: DateRange, type?: ComplaintType) {
  const scope = await resolveScope(user, companyId);
  const config = await resolveTatConfig(companyId ?? null);
  const dateFilter = rangeFilter(range);
  const [rows, multipliers] = await Promise.all([loadComplaints(scope, complaintFilter(dateFilter, type)), priorityMultipliers()]);
  const now = new Date();
  const states = stageStates(rows, multipliers, config, now);

  const stages = WORKFLOW_STAGES.map((stage: WorkflowStage) => {
    const entries = states.map(({ row, plan }) => ({ row, entry: plan.find((item) => item.stage === stage)! }));
    const completed = entries.filter(({ entry }) => entry.completedAt);
    const onTime = completed.filter(({ entry }) => entry.health === "on-time").length;
    const late = completed.length - onTime;
    const overdueOpen = entries.filter(({ row, entry }) => !entry.completedAt && entry.overdue && row.status !== "Closed").length;
    const dueSoon = entries.filter(({ entry }) => !entry.completedAt && entry.health === "due-soon").length;
    return {
      stage,
      label: WORKFLOW_STAGE_LABELS[stage],
      total: entries.length,
      completed: completed.length,
      onTime,
      late,
      overdueOpen,
      dueSoon,
      compliancePercent: percent(onTime, completed.length)
    };
  });

  const months = lastMonths(12);
  const trend = months.map((key) => {
    const monthly = states.filter(({ row }) => monthKey(new Date(row.receivedAt)) === key);
    let completed = 0;
    let onTime = 0;
    monthly.forEach(({ plan }) =>
      plan.forEach((entry) => {
        if (!entry.completedAt) return;
        completed += 1;
        if (entry.health === "on-time") onTime += 1;
      })
    );
    return { month: key, completed, onTime, compliancePercent: percent(onTime, completed) };
  });

  const delayField: Record<WorkflowStage, keyof ComplaintRow> = {
    ack: "ackDelayReason",
    cont: "contDelayReason",
    rca: "rcaDelayReason",
    capa: "capaDelayReason"
  };

  const paretoMap = new Map<string, number>();
  const drilldown: {
    stage: WorkflowStage;
    stageLabel: string;
    complaintId: string;
    number: string;
    customer: string;
    category: string;
    explanation: string;
  }[] = [];

  rows.forEach((row) => {
    WORKFLOW_STAGES.forEach((stage) => {
      const delay = row[delayField[stage]] as { category?: string; explanation?: string } | null | undefined;
      if (!delay?.category) return;
      paretoMap.set(delay.category, (paretoMap.get(delay.category) ?? 0) + 1);
      drilldown.push({
        stage,
        stageLabel: WORKFLOW_STAGE_LABELS[stage],
        complaintId: String(row._id),
        number: row.number,
        customer: row.customer ?? "",
        category: delay.category,
        explanation: delay.explanation ?? ""
      });
    });
  });

  const paretoTotal = [...paretoMap.values()].reduce((sum, value) => sum + value, 0);
  let running = 0;
  const pareto = [...paretoMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => {
      running += value;
      return { name, value, cumulativePercent: percent(running, paretoTotal) };
    });

  return { stages, trend, pareto, drilldown, config };
}

/* ------------------------------------------------------------------ CAPA board */

export async function capaAnalytics(user: ApiUser | undefined, companyId?: string, range?: DateRange) {
  const scope = await resolveScope(user, companyId);
  const now = new Date();
  const dateFilter = rangeFilter(range);
  const capas = await Capa.find({ ...scope.filter, ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}) })
    .select("number status dueDate completedAt effectiveness owner ownerEmployee type evidenceReview createdAt")
    .populate("owner", "name")
    .populate("ownerEmployee", "name")
    .lean();

  const closed = capas.filter((capa) => capa.status === "Closed" || capa.status === "Completed");
  const overdue = capas.filter((capa) => capa.status !== "Closed" && capa.status !== "Completed" && capa.dueDate && new Date(capa.dueDate) < startOfTodayIST(now));

  const ownerMap = new Map<
    string,
    { owner: string; assigned: number; open: number; closed: number; overdue: number; effective: number; notEffective: number }
  >();
  capas.forEach((capa) => {
    const owner = capa.owner as unknown as { _id?: Types.ObjectId; name?: string } | null;
    const ownerEmployee = capa.ownerEmployee as unknown as { name?: string } | null;
    const key = ownerEmployee?.name || owner?.name || "Unassigned";
    const entry = ownerMap.get(key) ?? { owner: key, assigned: 0, open: 0, closed: 0, overdue: 0, effective: 0, notEffective: 0 };
    entry.assigned += 1;
    const isClosed = capa.status === "Closed" || capa.status === "Completed";
    if (isClosed) entry.closed += 1;
    else entry.open += 1;
    if (!isClosed && capa.dueDate && new Date(capa.dueDate) < startOfTodayIST(now)) entry.overdue += 1;
    if (capa.effectiveness === "Effective") entry.effective += 1;
    if (capa.effectiveness === "Not Effective") entry.notEffective += 1;
    ownerMap.set(key, entry);
  });

  const personWise = [...ownerMap.values()]
    .map((entry) => ({ ...entry, closurePercent: percent(entry.closed, entry.assigned) }))
    .sort((a, b) => b.assigned - a.assigned);

  const months = lastMonths(12);
  const trend = months.map((key) => ({
    month: key,
    assigned: capas.filter((capa) => capa.createdAt && monthKey(new Date(capa.createdAt as Date)) === key).length,
    closed: capas.filter((capa) => capa.completedAt && monthKey(new Date(capa.completedAt as Date)) === key).length
  }));

  return {
    kpis: {
      total: capas.length,
      open: capas.length - closed.length,
      closed: closed.length,
      overdue: overdue.length,
      closurePercent: percent(closed.length, capas.length),
      effective: capas.filter((capa) => capa.effectiveness === "Effective").length,
      notEffective: capas.filter((capa) => capa.effectiveness === "Not Effective").length,
      pendingVerification: capas.filter((capa) => !capa.effectiveness && (capa.status === "Completed" || capa.status === "Under Verification"))
        .length
    },
    statusDistribution: countBy(capas, (capa) => capa.status),
    typeDistribution: countBy(capas, (capa) => capa.type),
    effectivenessDistribution: countBy(capas, (capa) => capa.effectiveness ?? "Pending"),
    evidenceReviewDistribution: countBy(capas, (capa) => (capa.evidenceReview as { status?: string } | null)?.status ?? "Pending"),
    personWise,
    trend
  };
}

/* ------------------------------------------------------------------ repeat analysis */

export async function repeatAnalytics(user: ApiUser | undefined, companyId?: string) {
  const scope = await resolveScope(user, companyId);
  const config = await resolveTatConfig(companyId ?? null);
  const rows = await Complaint.find({ ...scope.filter, isRepeat: true })
    .select(`${COMPLAINT_PROJECTION} repeatBasis`)
    .populate("company", "name code")
    .populate("responsibleDept", "name")
    .populate("owner", "name")
    .sort({ receivedAt: -1 })
    .lean();

  const originalIds = rows.flatMap((row) => (row.repeatOf ?? []).map((link) => link.complaint));
  const originals = await Complaint.find({ _id: { $in: originalIds } })
    .select("number receivedAt customer product category d4Occurrence status")
    .lean();
  const originalById = new Map(originals.map((entry) => [String(entry._id), entry]));

  const items = rows.map((row) => {
    const links = (row.repeatOf ?? []).map((link) => {
      const source = originalById.get(String(link.complaint));
      const intervalDays = source
        ? Math.round((new Date(row.receivedAt).getTime() - new Date(source.receivedAt as Date).getTime()) / 86400000)
        : null;
      return {
        id: String(link.complaint),
        number: link.number || source?.number || "",
        receivedAt: source?.receivedAt ?? null,
        status: source?.status ?? "",
        basis: link.basis ?? [],
        intervalDays
      };
    });
    const company = row.company as unknown as { name?: string; code?: string };
    const dept = row.responsibleDept as unknown as { name?: string } | null;
    const owner = row.owner as unknown as { name?: string } | null;
    return {
      id: String(row._id),
      number: row.number,
      companyName: company?.name ?? "",
      companyCode: company?.code ?? "",
      type: row.type,
      status: row.status,
      receivedAt: row.receivedAt,
      customer: row.customer ?? "",
      product: row.product ?? "",
      category: row.category ?? "",
      rootCause: row.d4Occurrence ?? "",
      rootCauseCategory: row.rootCauseCategory ?? "",
      responsibleDept: dept?.name ?? "",
      owner: owner?.name ?? "",
      basis: (row as unknown as { repeatBasis?: string }).repeatBasis ?? "",
      originals: links,
      shortestIntervalDays: links.reduce<number | null>(
        (min, link) => (link.intervalDays === null ? min : min === null ? link.intervalDays : Math.min(min, link.intervalDays)),
        null
      )
    };
  });

  return {
    windowDays: config.repeatWindowDays,
    total: items.length,
    byCustomer: countBy(items, (item) => item.customer || undefined).slice(0, 10),
    byCategory: countBy(items, (item) => item.category || undefined).slice(0, 10),
    byProduct: countBy(items, (item) => item.product || undefined).slice(0, 10),
    items
  };
}

/** Active users for owner pickers, limited to the requester's company scope. */
export async function assignableUsers(user: ApiUser | undefined, companyId?: string) {
  const scope = await resolveScope(user, companyId);
  const filter: Record<string, unknown> = { active: true };
  const companyFilter = scope.filter.company;
  if (companyFilter) filter.companyIds = companyFilter;
  const users = await User.find(filter).select("name username email department employee").populate("role", "name").sort({ name: 1 }).limit(500).lean();
  return users.map((entry) => ({
    id: String(entry._id),
    name: entry.name,
    username: entry.username,
    email: entry.email ?? "",
    role: (entry.role as unknown as { name?: string } | null)?.name ?? ""
  }));
}

/**
 * Active Master Data employees who have no portal login yet. They can be named as a
 * complaint's owner (stored as `ownerEmployee`) but cannot act in the portal.
 */
export async function employeesWithoutLogin(user: ApiUser | undefined, companyId?: string) {
  const scope = await resolveScope(user, companyId);
  const filter: Record<string, unknown> = { active: true };
  if (scope.filter.company) filter.company = scope.filter.company;
  const userFilter: Record<string, unknown> = { active: true };
  if (scope.filter.company) userFilter.companyIds = scope.filter.company;
  const [employees, users] = await Promise.all([
    Employee.find(filter).select("name email designation linkedUser").sort({ name: 1 }).limit(1000).lean(),
    User.find(userFilter).select("email employee").lean()
  ]);
  const linkedEmployees = new Set(users.map((entry) => String(entry.employee ?? "")).filter(Boolean));
  const userEmails = new Set(users.map((entry) => (entry.email ?? "").toLowerCase()).filter(Boolean));
  return employees
    .filter((entry) => !entry.linkedUser && !linkedEmployees.has(String(entry._id)) && !(entry.email && userEmails.has(entry.email.toLowerCase())))
    .map((entry) => ({ id: String(entry._id), name: entry.name, designation: entry.designation ?? "" }));
}
