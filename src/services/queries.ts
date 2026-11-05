import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type { ApiUser } from "@shared/types/api";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useAuth";

export type QueryValue = string | number | boolean | undefined | null;

export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const serialised = search.toString();
  return serialised ? `?${serialised}` : "";
}

function useApiQuery<T>(key: unknown[], path: string, options?: Partial<UseQueryOptions<T, Error>>) {
  return useQuery<T, Error>({ queryKey: key, queryFn: () => api<T>(path), ...options });
}

/* ------------------------------------------------------------------ permissions */

export function usePermissions() {
  const { data } = useCurrentUser();
  const user = data?.user;
  const permissions = user?.role?.permissions ?? [];
  const can = (permission: string) => permissions.includes("*") || permissions.includes(permission as never);
  return {
    user,
    permissions,
    can,
    isMasterAdmin: user?.role?.name === "Master Admin" || permissions.includes("*"),
    roleName: user?.role?.name ?? ""
  };
}

export type Permissions = ReturnType<typeof usePermissions>;

/* ------------------------------------------------------------------ shared reference data */

export type ConfigurationResponse = {
  tat: Record<string, number>;
  escalation: { levels: { level: number; name: string; triggerHoursOverdue: number }[]; reminderPercentages: number[]; autoEmailEnabled?: boolean; frequencyDays?: number };
  delayReasons: string[];
  categories: { _id: string; name: string; complaintType: "External" | "Internal"; parent: string | null }[];
  priorities: { _id: string; name: string; color: string; tatMultiplier: number }[];
  rootCauseCategories: { _id: string; name: string }[];
  fishboneCategories: string[];
  qcTools: string[];
  complaintTypes: string[];
};

export function useConfiguration(company?: string) {
  return useApiQuery<ConfigurationResponse>(["configuration", company ?? "all"], `/api/configuration${buildQuery({ company })}`, {
    staleTime: 5 * 60 * 1000
  });
}

export type MasterBootstrap = {
  companies: { _id: string; name: string; code: string; complaintNumberingPrefix: string; active: boolean }[];
  departments: { _id: string; name: string; code?: string; managementEmails?: string; active: boolean }[];
  roles: { _id: string; name: string; permissions: string[]; active: boolean }[];
  permissions: { _id: string; key: string; label: string; group: string }[];
  employees: {
    _id: string;
    name: string;
    employeeCode: string;
    designation?: string;
    email?: string;
    department?: string;
    managerName?: string;
    managerEmail?: string;
    hodName?: string;
    hodEmail?: string;
    active: boolean;
  }[];
};

export function useMasterBootstrap() {
  return useApiQuery<MasterBootstrap>(["master", "bootstrap"], "/api/master/bootstrap", { staleTime: 5 * 60 * 1000 });
}

export function useSystemUsers(enabled = true) {
  return useApiQuery<{ users: ApiUser[] }>(["master", "users"], "/api/master/users", { enabled, staleTime: 60 * 1000 });
}

export type AssignableUser = { id: string; name: string; username: string; email: string; role: string };

export function useAssignableUsers(company?: string) {
  return useApiQuery<{ users: AssignableUser[]; employees?: { id: string; name: string; designation: string }[] }>(
    ["assignable-users", company ?? "all"],
    `/api/analytics/assignable-users${buildQuery({ company })}`,
    { staleTime: 5 * 60 * 1000 }
  );
}

/* ------------------------------------------------------------------ analytics */

export type DashboardResponse = {
  kpis: Record<string, number>;
  statusDistribution: { name: string; value: number }[];
  priorityDistribution: { name: string; value: number }[];
  typeDistribution: { name: string; value: number }[];
  trend: { month: string; received: number; closed: number }[];
  aging: { name: string; value: number }[];
  rootCauseCategories: { name: string; value: number }[];
  categories: { name: string; value: number }[];
  /** One row per responsible person (complaint owner). */
  ownerSummary: {
    owner: string;
    total: number;
    open: number;
    delayed: number;
    inProcess: number;
    closed: number;
    closurePercent: number;
    status: "Compliant" | "Non-Compliant";
  }[];
  recent: { id: string; number: string; type: string; status: string; customer: string; category: string; receivedAt: string; isRepeat: boolean }[];
};

export type DateRangeParams = { startDate?: string; endDate?: string };

/** "" means both Internal and External complaints. */
export type ComplaintTypeFilter = "" | "Internal" | "External";

export function useDashboard(company?: string, range: DateRangeParams = {}, type: ComplaintTypeFilter = "") {
  return useApiQuery<DashboardResponse>(
    ["analytics", "dashboard", company ?? "all", range.startDate ?? "", range.endDate ?? "", type],
    `/api/analytics/dashboard${buildQuery({ company, startDate: range.startDate, endDate: range.endDate, type })}`
  );
}

export type TatResponse = {
  stages: {
    stage: string;
    label: string;
    total: number;
    completed: number;
    onTime: number;
    late: number;
    overdueOpen: number;
    dueSoon: number;
    compliancePercent: number;
  }[];
  trend: { month: string; completed: number; onTime: number; compliancePercent: number }[];
  pareto: { name: string; value: number; cumulativePercent: number }[];
  drilldown: { stage: string; stageLabel: string; complaintId: string; number: string; customer: string; category: string; explanation: string }[];
  config: Record<string, number>;
};

export function useTatAnalytics(company?: string, range: DateRangeParams = {}, type: ComplaintTypeFilter = "") {
  return useApiQuery<TatResponse>(
    ["analytics", "tat", company ?? "all", range.startDate ?? "", range.endDate ?? "", type],
    `/api/analytics/tat${buildQuery({ company, startDate: range.startDate, endDate: range.endDate, type })}`
  );
}

export type CapaAnalyticsResponse = {
  kpis: Record<string, number>;
  statusDistribution: { name: string; value: number }[];
  typeDistribution: { name: string; value: number }[];
  effectivenessDistribution: { name: string; value: number }[];
  evidenceReviewDistribution: { name: string; value: number }[];
  personWise: {
    owner: string;
    assigned: number;
    open: number;
    closed: number;
    overdue: number;
    effective: number;
    notEffective: number;
    closurePercent: number;
  }[];
  trend: { month: string; assigned: number; closed: number }[];
};

export function useCapaAnalytics(company?: string, range: DateRangeParams = {}) {
  return useApiQuery<CapaAnalyticsResponse>(
    ["analytics", "capa", company ?? "all", range.startDate ?? "", range.endDate ?? ""],
    `/api/analytics/capa${buildQuery({ company, startDate: range.startDate, endDate: range.endDate })}`
  );
}

export type RepeatResponse = {
  windowDays: number;
  total: number;
  byCustomer: { name: string; value: number }[];
  byCategory: { name: string; value: number }[];
  byProduct: { name: string; value: number }[];
  items: {
    id: string;
    number: string;
    companyCode: string;
    type: string;
    status: string;
    receivedAt: string;
    customer: string;
    product: string;
    category: string;
    rootCause: string;
    rootCauseCategory: string;
    responsibleDept: string;
    owner: string;
    basis: string;
    shortestIntervalDays: number | null;
    originals: { id: string; number: string; receivedAt: string | null; status: string; basis: string[]; intervalDays: number | null }[];
  }[];
};

export function useRepeatAnalytics(company?: string) {
  return useApiQuery<RepeatResponse>(["analytics", "repeat", company ?? "all"], `/api/analytics/repeat${buildQuery({ company })}`);
}

/* ------------------------------------------------------------------ complaints */

export type Paginated<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

export type ComplaintListItem = {
  _id: string;
  number: string;
  type: "External" | "Internal";
  status: string;
  receivedAt: string;
  closedAt: string | null;
  customer?: string;
  product?: string;
  category?: string;
  isRepeat?: boolean;
  company?: { _id: string; name: string; code: string } | null;
  priority?: { _id: string; name: string; color: string } | null;
  owner?: { _id: string; name: string } | null;
  ownerEmployee?: { _id: string; name: string } | null;
  responsibleDept?: { _id: string; name: string } | null;
};

export function useComplaints(params: Record<string, QueryValue>) {
  return useApiQuery<Paginated<ComplaintListItem>>(["complaints", params], `/api/complaints${buildQuery(params)}`, { placeholderData: (previous) => previous });
}

export type SignatureSnapshot = {
  user?: string;
  name?: string;
  designation?: string;
  department?: string;
  email?: string;
  at?: string;
  notes?: string;
} | null;

export type ComplaintDetail = {
  _id: string;
  number: string;
  type: "External" | "Internal";
  status: string;
  receivedAt: string;
  closedAt: string | null;
  closureRemarks?: string;
  reopenReason?: string;
  description: string;
  source?: string;
  reportedBy?: string;
  customer?: string;
  customerContact?: string;
  customerLocation?: string;
  project?: string;
  customerPO?: string;
  product?: string;
  batch?: string;
  category?: string;
  subCategory?: string;
  isRepeat?: boolean;
  repeatBasis?: string;
  repeatOf?: { complaint: string; number?: string; basis?: string[] }[];
  company?: string;
  priority?: string;
  owner?: string;
  ownerEmployee?: string;
  priorityName?: string;
  internalDeptName?: string;
  againstDeptName?: string;
  responsibleDeptName?: string;
  ownerName?: string;
  ownerEmployeeName?: string;
  effectivenessNextDue?: string | null;
  responsibleDept?: string;
  internalDept?: string;
  againstDept?: string;
  containmentNotes?: string;
  acknowledgedAt?: string | null;
  containmentAt?: string | null;
  rcaAt?: string | null;
  capaAssignedAt?: string | null;
  ackDelayReason?: { category?: string; explanation?: string } | null;
  contDelayReason?: { category?: string; explanation?: string } | null;
  rcaDelayReason?: { category?: string; explanation?: string } | null;
  capaDelayReason?: { category?: string; explanation?: string } | null;
  d0?: string;
  d1Team?: { employee?: string; name?: string; dept?: string; designation?: string; email?: string; role?: string }[];
  d2?: Record<string, string>;
  d3Actions?: ActionRow[];
  d4QcTools?: string[];
  d4Occurrence?: string;
  d4Escape?: string;
  d4Systemic?: string;
  rootCauseCategory?: string;
  fiveWhy?: { occurrence?: string[]; escape?: string[]; systemic?: string[]; singleChain?: string[] };
  fishbone?: Record<string, string[]>;
  d5Occurrence?: ActionRow[];
  d5Escape?: ActionRow[];
  d5Systemic?: ActionRow[];
  d5Safety?: string;
  d6Verify?: ActionRow[];
  d6DocsList?: D6Document[];
  d6Horizontal?: string;
  d7ShortTermDate?: string;
  d7RepeatObserved?: boolean;
  d7Regulatory?: string;
  d7NoRepeatConfirmed?: boolean;
  d7LongTermDate?: string;
  d7LongTermRepeatObserved?: boolean;
  d7LongTermResult?: string;
  d7LongTermNotes?: string;
  d8Recognition?: string;
  d8ReviewedBy?: string;
  d8ClosedDate?: string;
  internalInvestigation?: { summary?: string; findings?: string; correctiveAction?: string; evidence?: string };
  overallEffectiveness?: { result?: string; at?: string | null; comments?: string };
  signatures?: { prepared?: SignatureSnapshot; reviewed?: SignatureSnapshot; approved?: SignatureSnapshot };
  workflowLog?: { stage: string; at: string; byName?: string; notes?: string }[];
};

export type ActionRow = {
  action?: string;
  resp?: string;
  target?: string;
  status?: string;
  remarks?: string;
  ctqImpact?: string;
  customerApproval?: string;
};

export type D6Document = {
  docType: string;
  status: "Pending" | "Attached" | "NA";
  attachment?: string | null;
  revision?: string;
  revDate?: string;
  approver?: string;
  naJustification?: string;
};

export type CapaItem = {
  _id: string;
  number: string;
  complaint: string | { _id: string; number: string; type?: string; status?: string; customer?: string };
  company?: string | { _id: string; name: string; code: string };
  type: string;
  action: string;
  owner?: string | { _id: string; name: string } | null;
  /** A directory employee without a login named as the owner (the accountable user stays in `owner`). */
  ownerEmployee?: string | { _id: string; name: string } | null;
  department?: string | { _id: string; name: string } | null;
  assignedAt?: string;
  dueDate: string;
  completedAt?: string | null;
  status: string;
  evidence?: string;
  evidenceFiles?: { attachment: string; description?: string; uploadedAt?: string }[];
  evidenceReview?: { status: string; remarks?: string; byName?: string; at?: string | null } | null;
  evidenceReviewHistory?: { status: string; remarks?: string; byName?: string; at?: string }[];
  effectiveness?: string | null;
  effectivenessVerifiedAt?: string | null;
  effectivenessEvidence?: string;
  verificationMethod?: string;
  effectivenessRemarks?: string;
  delayReason?: string;
};

/** The name shown as a CAPA's owner: the directory employee when one was chosen, otherwise the portal user. */
export function capaOwnerName(capa: Pick<CapaItem, "owner" | "ownerEmployee">): string {
  for (const value of [capa.ownerEmployee, capa.owner]) {
    if (value && typeof value === "object" && value.name) return value.name;
  }
  return "Unassigned";
}

export type StageTat = {
  stage: string;
  dueAt: string;
  completedAt: string | null;
  health: string;
  overdue: boolean;
  delayReason: string | null;
  delayExplanation: string | null;
};

export type ComplaintDetailResponse = {
  complaint: ComplaintDetail;
  capas: CapaItem[];
  tat: StageTat[];
  tatConfig: Record<string, number>;
  permissions: { canEdit: boolean; canClose: boolean; canDelete: boolean };
};

export function useComplaintDetail(id: string | undefined) {
  return useApiQuery<ComplaintDetailResponse>(["complaint", id], `/api/complaints/${id}`, { enabled: Boolean(id) });
}

export function useCapas(params: Record<string, QueryValue>) {
  return useApiQuery<Paginated<CapaItem>>(["capas", params], `/api/capas${buildQuery(params)}`, { placeholderData: (previous) => previous });
}

export type AttachmentRecord = {
  _id: string;
  originalFilename: string;
  mimeType: string;
  bytes: number;
  secureUrl: string;
  uploadedAt: string;
  uploadedBy?: { name?: string } | null;
  purpose: string;
};

export function useAttachments(entityType: string, entityId: string | undefined) {
  return useApiQuery<{ attachments: AttachmentRecord[] }>(
    ["attachments", entityType, entityId],
    `/api/attachments${buildQuery({ entityType, entityId })}`,
    { enabled: Boolean(entityId) }
  );
}

export type NoteRecord = {
  _id: string;
  kind: string;
  content: string;
  referenceDate?: string | null;
  createdAt: string;
  createdBy?: string;
  createdByName?: string;
};

export function useNotes(complaintId: string | undefined) {
  return useApiQuery<{ notes: NoteRecord[] }>(["notes", complaintId], `/api/complaints/${complaintId}/notes`, { enabled: Boolean(complaintId) });
}

/* ------------------------------------------------------------------ effectiveness tracker */

export type EffectivenessStatus = "Upcoming" | "Due Soon" | "Overdue";

export type EffectivenessCheckInfo = {
  cycle: number;
  result: "Sustained" | "Not Sustained";
  remarks: string;
  checkedAt: string;
  checkedByName: string;
};

export type EffectivenessRow = {
  _id: string;
  number: string;
  type: "External" | "Internal";
  company?: { _id: string; name: string; code: string } | null;
  customer: string;
  product: string;
  category: string;
  responsibleDept: string;
  owner: string;
  closedAt: string;
  checksDone: number;
  lastCheck: EffectivenessCheckInfo | null;
  nextDue: string;
  daysLeft: number;
  status: EffectivenessStatus;
};

export type EffectivenessTrackerResponse = Paginated<EffectivenessRow> & {
  summary: { total: number; overdue: number; dueSoon: number; upcoming: number };
  canRecord: boolean;
};

export function useEffectivenessTracker(params: Record<string, QueryValue>) {
  return useApiQuery<EffectivenessTrackerResponse>(["effectiveness", params], `/api/effectiveness${buildQuery(params)}`, {
    placeholderData: (previous) => previous
  });
}

export type EffectivenessCheckRecord = EffectivenessCheckInfo & { _id: string; dueAt: string };

export function useEffectivenessChecks(complaintId: string | undefined) {
  return useApiQuery<{ checks: EffectivenessCheckRecord[] }>(
    ["effectiveness", "checks", complaintId],
    `/api/effectiveness/${complaintId}/checks`,
    { enabled: Boolean(complaintId) }
  );
}

export type AuditEntry = {
  _id: string;
  action: string;
  entity: string;
  entityId?: string;
  actorName?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  createdAt: string;
};

export function useComplaintAudit(complaintId: string | undefined, enabled: boolean) {
  return useApiQuery<{ entries: AuditEntry[] }>(["complaint-audit", complaintId], `/api/complaints/${complaintId}/audit`, {
    enabled: Boolean(complaintId) && enabled
  });
}

export function useAuditTrail(params: Record<string, QueryValue>, enabled: boolean) {
  return useApiQuery<Paginated<AuditEntry>>(["audit", params], `/api/audit${buildQuery(params)}`, {
    enabled,
    placeholderData: (previous) => previous
  });
}

/* ------------------------------------------------------------------ notifications */

export type NotificationRecord = {
  _id: string;
  message: string;
  category: string;
  priority: string;
  link?: string;
  read: boolean;
  createdAt: string;
};

export function useNotifications(params: Record<string, QueryValue> = {}) {
  return useApiQuery<Paginated<NotificationRecord> & { unread: number }>(["notifications", params], `/api/notifications${buildQuery(params)}`, {
    refetchInterval: 60000
  });
}

/* ------------------------------------------------------------------ reports */

export type ReportSummary = { id: string; title: string; description: string; group: string; permission: string };

export function useReportCatalog() {
  return useApiQuery<{ reports: ReportSummary[] }>(["reports", "catalog"], "/api/reports", { staleTime: 10 * 60 * 1000 });
}

export type ReportRow = Record<string, string | number>;

export function useReport(id: string | undefined, params: Record<string, QueryValue>, enabled: boolean) {
  return useApiQuery<{ id: string; rows: ReportRow[]; generatedAt: string }>(
    ["report", id, params],
    `/api/reports/${id}${buildQuery(params)}`,
    { enabled: Boolean(id) && enabled }
  );
}

/* ------------------------------------------------------------------ mutations */

type MutationInput = Record<string, unknown> | undefined;

/** Shared mutation helper that invalidates the queries a write can affect. */
export function useApiMutation<TResult, TInput = MutationInput>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string | ((input: TInput) => string),
  invalidate: unknown[][] = []
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, Error, TInput>({
    mutationFn: (input) =>
      api<TResult>(typeof path === "function" ? path(input) : path, {
        method,
        body: input === undefined ? undefined : JSON.stringify(input)
      }),
    onSuccess: () => {
      invalidate.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    }
  });
}

export type ApiIssue = { field: string; message: string; section?: string };

/** Field level issues raised by a 422 business rule failure. */
export function issuesFrom(error: unknown): ApiIssue[] {
  const candidate = error as { issues?: ApiIssue[] } | null;
  return Array.isArray(candidate?.issues) ? candidate.issues : [];
}

export function currentUserName(user: ApiUser | undefined) {
  return user?.name ?? "";
}
