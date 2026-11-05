import { Types } from "mongoose";
import type { ApiUser } from "@shared/types/api";
import { WORKFLOW_STAGE_LABELS } from "@shared/constants/domain";
import { Capa } from "../models/Capa";
import { Complaint } from "../models/Complaint";
import { Employee } from "../models/Employee";
import { capaAnalytics, dashboardAnalytics, repeatAnalytics, resolveScope, tatAnalytics } from "./analytics.service";
import { httpError } from "../utils/http";

export type ReportRow = Record<string, string | number>;

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  group: "Complaints" | "TAT" | "CAPA" | "Quality" | "Management" | "Master";
  permission: string;
  build: (context: ReportContext) => Promise<ReportRow[]>;
};

export type ReportContext = {
  user: ApiUser | undefined;
  companyId?: string;
  from?: Date;
  to?: Date;
};

function date(value: unknown): string {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function dateTime(value: unknown): string {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().replace("T", " ").slice(0, 16);
}

function name(value: unknown): string {
  return (value as { name?: string } | null)?.name ?? "";
}

function daysBetween(from: unknown, to: unknown): number | "" {
  if (!from) return "";
  const start = new Date(from as Date).getTime();
  const end = to ? new Date(to as Date).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 86400000));
}

async function complaintQuery(context: ReportContext, extra: Record<string, unknown> = {}) {
  const scope = await resolveScope(context.user, context.companyId);
  const filter: Record<string, unknown> = { ...scope.filter, ...extra };
  if (context.from || context.to) {
    filter.receivedAt = { ...(context.from ? { $gte: context.from } : {}), ...(context.to ? { $lte: context.to } : {}) };
  }
  return Complaint.find(filter)
    .populate("company", "name code")
    .populate("priority", "name")
    .populate("owner", "name")
    .populate("responsibleDept", "name")
    .populate("internalDept", "name")
    .populate("againstDept", "name")
    .sort({ receivedAt: -1 })
    .lean();
}

async function capaQuery(context: ReportContext, extra: Record<string, unknown> = {}) {
  const scope = await resolveScope(context.user, context.companyId);
  const filter: Record<string, unknown> = { ...scope.filter, ...extra };
  if (context.from || context.to) {
    filter.dueDate = { ...(context.from ? { $gte: context.from } : {}), ...(context.to ? { $lte: context.to } : {}) };
  }
  return Capa.find(filter)
    .populate("company", "name code")
    .populate("complaint", "number type customer status")
    .populate("owner", "name")
    .populate("ownerEmployee", "name")
    .populate("department", "name")
    .populate("priority", "name")
    .sort({ dueDate: 1 })
    .lean();
}

function complaintBaseRow(complaint: Record<string, unknown>): ReportRow {
  return {
    "Complaint No": String(complaint.number ?? ""),
    Company: name(complaint.company),
    Type: String(complaint.type ?? ""),
    Received: date(complaint.receivedAt),
    Priority: name(complaint.priority),
    Category: String(complaint.category ?? ""),
    "Sub Category": String(complaint.subCategory ?? ""),
    Customer: String(complaint.customer ?? ""),
    Product: String(complaint.product ?? ""),
    Project: String(complaint.project ?? ""),
    "Customer PO": String(complaint.customerPO ?? ""),
    Department: name(complaint.responsibleDept),
    Owner: name(complaint.owner),
    Status: String(complaint.status ?? ""),
    Repeat: complaint.isRepeat ? "Yes" : "No"
  };
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: "complaint-register",
    title: "Complaint Register",
    description: "Every complaint in scope with registration, workflow and closure dates. The consolidated master record.",
    group: "Complaints",
    permission: "report.all",
    build: async (context) => {
      const rows = await complaintQuery(context);
      return rows.map((complaint) => ({
        ...complaintBaseRow(complaint as unknown as Record<string, unknown>),
        Acknowledged: date(complaint.acknowledgedAt),
        Contained: date(complaint.containmentAt),
        "RCA Done": date(complaint.rcaAt),
        "CAPA Assigned": date(complaint.capaAssignedAt),
        Closed: date(complaint.closedAt),
        "Days Open": daysBetween(complaint.receivedAt, complaint.closedAt),
        "Root Cause Category": String(complaint.rootCauseCategory ?? "")
      }));
    }
  },
  {
    id: "open-complaints",
    title: "Open Complaints",
    description: "Complaints that have not been closed, with their current stage and age in days. Use it for the daily review.",
    group: "Complaints",
    permission: "report.all",
    build: async (context) => {
      const rows = await complaintQuery(context, { status: { $ne: "Closed" } });
      return rows.map((complaint) => ({
        ...complaintBaseRow(complaint as unknown as Record<string, unknown>),
        "Age (days)": daysBetween(complaint.receivedAt, null),
        "Last Stage": complaint.capaAssignedAt
          ? WORKFLOW_STAGE_LABELS.capa
          : complaint.rcaAt
            ? WORKFLOW_STAGE_LABELS.rca
            : complaint.containmentAt
              ? WORKFLOW_STAGE_LABELS.cont
              : complaint.acknowledgedAt
                ? WORKFLOW_STAGE_LABELS.ack
                : "Registered"
      }));
    }
  },
  {
    id: "overdue-complaints",
    title: "Overdue Complaints",
    description: "Open complaints that have breached a TAT target at any stage, with the recorded delay reasons.",
    group: "TAT",
    permission: "report.all",
    build: async (context) => {
      const analytics = await tatAnalytics(context.user, context.companyId);
      const overdueIds = new Set(analytics.drilldown.map((entry) => entry.complaintId));
      const rows = await complaintQuery(context, { status: { $ne: "Closed" } });
      return rows
        .filter((complaint) => overdueIds.has(String(complaint._id)))
        .map((complaint) => ({
          ...complaintBaseRow(complaint as unknown as Record<string, unknown>),
          "Delay Reasons": analytics.drilldown
            .filter((entry) => entry.complaintId === String(complaint._id))
            .map((entry) => `${entry.stageLabel}: ${entry.category}`)
            .join("; "),
          "Age (days)": daysBetween(complaint.receivedAt, null)
        }));
    }
  },
  {
    id: "tat-compliance",
    title: "TAT Compliance Report",
    description: "Stage-wise turnaround performance: completed, on time, late, still overdue and the compliance percentage.",
    group: "TAT",
    permission: "report.all",
    build: async (context) => {
      const analytics = await tatAnalytics(context.user, context.companyId);
      return analytics.stages.map((stage) => ({
        Stage: stage.label,
        Complaints: stage.total,
        Completed: stage.completed,
        "On Time": stage.onTime,
        Late: stage.late,
        "Overdue Open": stage.overdueOpen,
        "Due Soon": stage.dueSoon,
        "Compliance %": stage.compliancePercent
      }));
    }
  },
  {
    id: "delay-pareto",
    title: "Delay Pareto Analysis",
    description: "Recorded delay reasons ranked by frequency with a cumulative percentage, so the vital few are obvious.",
    group: "TAT",
    permission: "report.all",
    build: async (context) => {
      const analytics = await tatAnalytics(context.user, context.companyId);
      return analytics.pareto.map((entry) => ({
        "Delay Reason": entry.name,
        Occurrences: entry.value,
        "Cumulative %": entry.cumulativePercent
      }));
    }
  },
  {
    id: "capa-register",
    title: "CAPA Register",
    description: "All CAPA items with owner, dates, status, evidence review and effectiveness outcome.",
    group: "CAPA",
    permission: "report.all",
    build: async (context) => {
      const rows = await capaQuery(context);
      return rows.map((capa) => ({
        "CAPA No": String(capa.number ?? ""),
        "Complaint No": (capa.complaint as unknown as { number?: string } | null)?.number ?? "",
        Company: name(capa.company),
        Type: String(capa.type ?? ""),
        Action: String(capa.action ?? ""),
        Owner: name(capa.ownerEmployee) || name(capa.owner),
        Department: name(capa.department),
        Assigned: date(capa.assignedAt),
        Due: date(capa.dueDate),
        Completed: date(capa.completedAt),
        Status: String(capa.status ?? ""),
        "Evidence Review": (capa.evidenceReview as { status?: string } | null)?.status ?? "Pending",
        Effectiveness: String(capa.effectiveness ?? "Pending"),
        "Verification Method": String(capa.verificationMethod ?? ""),
        "Days Late": capa.dueDate && capa.completedAt ? daysBetween(capa.dueDate, capa.completedAt) : ""
      }));
    }
  },
  {
    id: "capa-master-list",
    title: "CAPA Master List",
    description: "The advanced CAPA master view including evidence file counts and effectiveness verification details.",
    group: "CAPA",
    permission: "report.all",
    build: async (context) => {
      const rows = await capaQuery(context);
      return rows.map((capa) => ({
        "CAPA No": String(capa.number ?? ""),
        "Complaint No": (capa.complaint as unknown as { number?: string } | null)?.number ?? "",
        "Complaint Type": (capa.complaint as unknown as { type?: string } | null)?.type ?? "",
        Customer: (capa.complaint as unknown as { customer?: string } | null)?.customer ?? "",
        Company: name(capa.company),
        Type: String(capa.type ?? ""),
        Action: String(capa.action ?? ""),
        Owner: name(capa.ownerEmployee) || name(capa.owner),
        Department: name(capa.department),
        Due: date(capa.dueDate),
        Status: String(capa.status ?? ""),
        "Evidence Files": (capa.evidenceFiles ?? []).length,
        "Evidence Review": (capa.evidenceReview as { status?: string } | null)?.status ?? "Pending",
        "Review Remarks": (capa.evidenceReview as { remarks?: string } | null)?.remarks ?? "",
        Effectiveness: String(capa.effectiveness ?? "Pending"),
        "Verified On": date(capa.effectivenessVerifiedAt)
      }));
    }
  },
  {
    id: "person-wise-capa",
    title: "Person-wise CAPA Performance",
    description: "CAPA load and completion per owner, with overdue counts and closure percentage.",
    group: "CAPA",
    permission: "report.all",
    build: async (context) => {
      const analytics = await capaAnalytics(context.user, context.companyId);
      return analytics.personWise.map((entry) => ({
        Owner: entry.owner,
        Assigned: entry.assigned,
        Open: entry.open,
        "Closed / Completed": entry.closed,
        Overdue: entry.overdue,
        Effective: entry.effective,
        "Not Effective": entry.notEffective,
        "Closure %": entry.closurePercent
      }));
    }
  },
  {
    id: "customer-summary",
    title: "Customer Complaint Summary",
    description: "Complaint volume per customer with open, closed and repeat counts to expose problem accounts.",
    group: "Management",
    permission: "report.all",
    build: async (context) => {
      const rows = await complaintQuery(context, { type: "External" });
      const map = new Map<string, { total: number; open: number; closed: number; repeat: number }>();
      rows.forEach((complaint) => {
        const key = complaint.customer || "Not specified";
        const entry = map.get(key) ?? { total: 0, open: 0, closed: 0, repeat: 0 };
        entry.total += 1;
        if (complaint.status === "Closed") entry.closed += 1;
        else entry.open += 1;
        if (complaint.isRepeat) entry.repeat += 1;
        map.set(key, entry);
      });
      return [...map.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([customer, entry]) => ({
          Customer: customer,
          Complaints: entry.total,
          Open: entry.open,
          Closed: entry.closed,
          Repeat: entry.repeat,
          "Repeat %": entry.total === 0 ? 0 : Math.round((entry.repeat / entry.total) * 1000) / 10
        }));
    }
  },
  {
    id: "repeat-complaints",
    title: "Repeat Complaints Report",
    description: "Complaints auto-flagged as repeats inside the configured window, with the prior complaints they repeat.",
    group: "Quality",
    permission: "report.all",
    build: async (context) => {
      const analytics = await repeatAnalytics(context.user, context.companyId);
      return analytics.items.map((item) => ({
        "Complaint No": item.number,
        Company: item.companyCode,
        Received: date(item.receivedAt),
        Customer: item.customer,
        Product: item.product,
        Category: item.category,
        "Repeats Of": item.originals.map((entry) => entry.number).join(", "),
        "Shortest Interval (days)": item.shortestIntervalDays ?? "",
        "Matching Basis": item.basis,
        "Root Cause": item.rootCause,
        Department: item.responsibleDept,
        Owner: item.owner,
        Status: item.status
      }));
    }
  },
  {
    id: "root-cause-register",
    title: "Root Cause Analysis Register",
    description: "Occurrence, escape and systemic root causes per complaint with the QC tools that were used.",
    group: "Quality",
    permission: "report.all",
    build: async (context) => {
      const rows = await complaintQuery(context);
      return rows
        .filter((complaint) => complaint.d4Occurrence || complaint.rootCauseCategory)
        .map((complaint) => ({
          "Complaint No": String(complaint.number ?? ""),
          Type: String(complaint.type ?? ""),
          Received: date(complaint.receivedAt),
          Customer: String(complaint.customer ?? ""),
          Category: String(complaint.category ?? ""),
          "Root Cause Category": String(complaint.rootCauseCategory ?? ""),
          "Occurrence Root Cause": String(complaint.d4Occurrence ?? ""),
          "Escape Root Cause": String(complaint.d4Escape ?? ""),
          "Systemic Root Cause": String(complaint.d4Systemic ?? ""),
          "QC Tools": (complaint.d4QcTools ?? []).join(", "),
          Status: String(complaint.status ?? "")
        }));
    }
  },
  {
    id: "root-cause-category",
    title: "Root Cause Category Analysis",
    description: "Complaint counts per 6M plus Management and Supplier category, the systemic view for management review.",
    group: "Quality",
    permission: "report.all",
    build: async (context) => {
      const analytics = await dashboardAnalytics(context.user, context.companyId);
      const total = analytics.rootCauseCategories.reduce((sum, entry) => sum + entry.value, 0);
      return analytics.rootCauseCategories.map((entry) => ({
        "Root Cause Category": entry.name,
        Complaints: entry.value,
        "Share %": total === 0 ? 0 : Math.round((entry.value / total) * 1000) / 10
      }));
    }
  },
  {
    id: "long-term-effectiveness",
    title: "Long-Term Effectiveness",
    description: "D7 short-term and long-term effectiveness review status for closed external complaints.",
    group: "Quality",
    permission: "report.all",
    build: async (context) => {
      const rows = await complaintQuery(context, { type: "External" });
      return rows.map((complaint) => ({
        "Complaint No": String(complaint.number ?? ""),
        Company: name(complaint.company),
        Customer: String(complaint.customer ?? ""),
        Closed: date(complaint.closedAt),
        "ST Date": String(complaint.d7ShortTermDate ?? ""),
        "ST Repeat Observed": complaint.d7RepeatObserved ? "Yes" : "No",
        "No Repeat Confirmed": complaint.d7NoRepeatConfirmed ? "Yes" : "No",
        "LT Date": String(complaint.d7LongTermDate ?? ""),
        "LT Repeat Observed": complaint.d7LongTermRepeatObserved ? "Yes" : "No",
        "LT Result": String(complaint.d7LongTermResult || "Pending"),
        Status: String(complaint.status ?? "")
      }));
    }
  },
  {
    id: "management-review",
    title: "Monthly Management Review",
    description: "Twelve-month summary of complaints received and closed with the headline quality indicators.",
    group: "Management",
    permission: "report.all",
    build: async (context) => {
      const analytics = await dashboardAnalytics(context.user, context.companyId);
      return analytics.trend.map((entry) => ({
        Month: entry.month,
        Received: entry.received,
        Closed: entry.closed,
        "Net Open Change": entry.received - entry.closed
      }));
    }
  },
  {
    id: "employee-master",
    title: "Employee Master",
    description: "Employee directory with department, designation, manager and HOD contacts used by 8D and escalation.",
    group: "Master",
    permission: "report.all",
    build: async (context) => {
      const scope = await resolveScope(context.user, context.companyId);
      const filter: Record<string, unknown> = {};
      if (scope.filter.company) filter.company = scope.filter.company;
      const employees = await Employee.find(filter).populate("company", "name code").populate("department", "name").sort({ name: 1 }).lean();
      return employees.map((employee) => ({
        "Employee Code": String(employee.employeeCode ?? ""),
        Name: String(employee.name ?? ""),
        Email: String(employee.email ?? ""),
        Designation: String(employee.designation ?? ""),
        Department: name(employee.department),
        Company: name(employee.company),
        "Manager Name": String(employee.managerName ?? ""),
        "Manager Email": String(employee.managerEmail ?? ""),
        "HOD Name": String(employee.hodName ?? ""),
        "HOD Email": String(employee.hodEmail ?? ""),
        Active: employee.active ? "Yes" : "No"
      }));
    }
  }
];

export function reportCatalog() {
  return REPORT_DEFINITIONS.map(({ id, title, description, group, permission }) => ({ id, title, description, group, permission }));
}

export async function buildReport(reportId: string, context: ReportContext): Promise<ReportRow[]> {
  const definition = REPORT_DEFINITIONS.find((entry) => entry.id === reportId);
  if (!definition) throw httpError(404, "Unknown report");
  return definition.build(context);
}

/** Everything a single 8D document needs, resolved in one call for the PDF and Excel exports. */
export async function eightDReportData(complaintId: string, user: ApiUser | undefined) {
  if (!Types.ObjectId.isValid(complaintId)) throw httpError(400, "Invalid complaint id");
  const scope = await resolveScope(user);
  const complaint = await Complaint.findOne({ _id: complaintId, ...scope.filter })
    .populate("company", "name code documentNumber revision effectiveDate logo")
    .populate("priority", "name")
    .populate("owner", "name email")
    .populate("responsibleDept", "name")
    .populate("internalDept", "name")
    .populate("againstDept", "name")
    .lean();
  if (!complaint) throw httpError(404, "Complaint not found");

  const capas = await Capa.find({ complaint: complaintId }).populate("owner", "name").populate("ownerEmployee", "name").populate("department", "name").sort({ sequence: 1 }).lean();

  return { complaint, capas };
}

export function eightDExcelSheets(data: Awaited<ReturnType<typeof eightDReportData>>) {
  const { complaint, capas } = data;
  const summary: ReportRow[] = [
    { Field: "Complaint No", Value: String(complaint.number ?? "") },
    { Field: "Company", Value: name(complaint.company) },
    { Field: "Type", Value: String(complaint.type ?? "") },
    { Field: "Received", Value: dateTime(complaint.receivedAt) },
    { Field: "Priority", Value: name(complaint.priority) },
    { Field: "Customer", Value: String(complaint.customer ?? "") },
    { Field: "Product", Value: String(complaint.product ?? "") },
    { Field: "Category", Value: String(complaint.category ?? "") },
    { Field: "Owner", Value: name(complaint.owner) },
    { Field: "Department", Value: name(complaint.responsibleDept) },
    { Field: "Status", Value: String(complaint.status ?? "") },
    { Field: "Description", Value: String(complaint.description ?? "") },
    { Field: "D0 Emergency Response", Value: String(complaint.d0 ?? "") },
    { Field: "D4 Occurrence Root Cause", Value: String(complaint.d4Occurrence ?? "") },
    { Field: "D4 Escape Root Cause", Value: String(complaint.d4Escape ?? "") },
    { Field: "D4 Systemic Root Cause", Value: String(complaint.d4Systemic ?? "") },
    { Field: "Root Cause Category", Value: String(complaint.rootCauseCategory ?? "") },
    { Field: "Closed", Value: dateTime(complaint.closedAt) },
    { Field: "Closure Remarks", Value: String(complaint.closureRemarks ?? "") }
  ];

  const team: ReportRow[] = (complaint.d1Team ?? []).map((member) => ({
    Name: String(member.name ?? ""),
    Department: String(member.dept ?? ""),
    Designation: String(member.designation ?? ""),
    Responsibility: String(member.role ?? "")
  }));

  const actions: ReportRow[] = [
    ...(complaint.d3Actions ?? []).map((row) => ({ Section: "D3 Containment", ...actionRow(row) })),
    ...(complaint.d5Occurrence ?? []).map((row) => ({ Section: "D5 Occurrence", ...actionRow(row) })),
    ...(complaint.d5Escape ?? []).map((row) => ({ Section: "D5 Escape", ...actionRow(row) })),
    ...(complaint.d5Systemic ?? []).map((row) => ({ Section: "D5 Systemic", ...actionRow(row) })),
    ...(complaint.d6Verify ?? []).map((row) => ({ Section: "D6 Verification", ...actionRow(row) }))
  ];

  const fiveWhy: ReportRow[] = (["occurrence", "escape", "systemic", "singleChain"] as const).flatMap((chain) =>
    ((complaint.fiveWhy?.[chain] ?? []) as string[])
      .filter(Boolean)
      .map((text, index) => ({ Chain: chain, Step: `Why ${index + 1}`, Statement: text }))
  );

  const documents: ReportRow[] = (complaint.d6DocsList ?? []).map((entry) => ({
    Document: String(entry.docType ?? ""),
    Status: String(entry.status ?? ""),
    Revision: String(entry.revision ?? ""),
    "Revision Date": String(entry.revDate ?? ""),
    Approver: String(entry.approver ?? ""),
    "NA Justification": String(entry.naJustification ?? "")
  }));

  const capaRows: ReportRow[] = capas.map((capa) => ({
    "CAPA No": String(capa.number ?? ""),
    Type: String(capa.type ?? ""),
    Action: String(capa.action ?? ""),
    Owner: name(capa.ownerEmployee) || name(capa.owner),
    Department: name(capa.department),
    Due: date(capa.dueDate),
    Completed: date(capa.completedAt),
    Status: String(capa.status ?? ""),
    "Evidence Review": (capa.evidenceReview as { status?: string } | null)?.status ?? "Pending",
    Effectiveness: String(capa.effectiveness ?? "Pending")
  }));

  const signatures: ReportRow[] = (["prepared", "reviewed", "approved"] as const).map((role) => {
    const signature = complaint.signatures?.[role] as { name?: string; designation?: string; department?: string; at?: Date } | null;
    return {
      Role: role === "prepared" ? "Prepared By" : role === "reviewed" ? "Reviewed By" : "Approved By",
      Name: signature?.name ?? "Not signed",
      Designation: signature?.designation ?? "",
      Department: signature?.department ?? "",
      "Signed At": dateTime(signature?.at)
    };
  });

  return { summary, team, actions, fiveWhy, documents, capaRows, signatures };
}

function actionRow(row: { action?: string | null; resp?: string | null; target?: string | null; status?: string | null }): ReportRow {
  return {
    Action: String(row.action ?? ""),
    Responsibility: String(row.resp ?? ""),
    Target: String(row.target ?? ""),
    Status: String(row.status ?? "")
  };
}
