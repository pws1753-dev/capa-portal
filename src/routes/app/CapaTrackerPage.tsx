import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CAPA_STATUSES, CAPA_TYPES } from "@shared/constants/domain";
import {
  CheckCircle,
  Download,
  ExternalLink,
  FilterX,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/Cards";
import { DataTable, Pagination, type Column } from "@/components/ui/DataTable";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast-context";
import { downloadSheet } from "@/lib/excel";
import { errorText } from "@/lib/errors";
import { isPastDueDay } from "@/lib/due-day";
import { formatDate, statusTone } from "@/lib/format";
import {
  capaOwnerName,
  useApiMutation,
  useCapas,
  useMasterBootstrap,
  usePermissions,
  type CapaItem
} from "@/services/queries";

const EVIDENCE_STATUSES = ["Pending", "Accepted", "Rejected"];
const EFFECTIVENESS_STATUSES = ["Effective", "Not Effective"];

export function CapaTrackerPage() {
  const toast = useToast();
  const permissions = usePermissions();
  const master = useMasterBootstrap();
  const [params, setParams] = useSearchParams();

  // Review Modal state
  const [reviewTarget, setReviewTarget] = useState<CapaItem | null>(null);
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);

  const query = useMemo(() => {
    const entries: Record<string, string | number> = {
      page: Number(params.get("page") ?? 1),
      pageSize: Number(params.get("pageSize") ?? 20),
      sort: params.get("sort") ?? "dueDate",
      order: params.get("order") ?? "asc"
    };
    ["status", "type", "company", "evidenceReview", "effectiveness", "search", "dueFrom", "dueTo"].forEach((k) => {
      const v = params.get(k);
      if (v) entries[k] = v;
    });
    return entries;
  }, [params]);

  const { data, isLoading, error } = useCapas(query);
  const capas = data?.items ?? [];

  const companies = master.data?.companies ?? [];
  const canReview = permissions.isMasterAdmin || permissions.can("capa.evidence.review");

  const reviewMutation = useApiMutation<{ capa: CapaItem }, { decision: "Accepted" | "Rejected"; remarks?: string }>(
    "POST",
    () => `/api/capas/${reviewTarget?._id}/evidence/review`,
    [["capas"], ["analytics"]]
  );

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.set("page", "1");
    setParams(next);
  }

  function clearFilters() {
    setParams(new URLSearchParams({ page: "1", pageSize: "20" }));
  }

  async function handleReviewSubmit(decision: "Accepted" | "Rejected") {
    if (!reviewTarget) return;
    if (decision === "Rejected" && reviewRemarks.trim().length < 5) {
      setReviewError("Rejection remarks must be at least 5 characters explaining why evidence is insufficient.");
      return;
    }

    setReviewError(null);
    try {
      await reviewMutation.mutateAsync({
        decision,
        remarks: reviewRemarks.trim() || undefined
      });
      toast.success(`CAPA evidence ${decision.toLowerCase()} successfully`);
      setReviewTarget(null);
      setReviewRemarks("");
    } catch (err) {
      setReviewError(errorText(err, "Failed to record evidence review"));
      toast.failure(err, "Failed to record evidence review");
    }
  }

  function handleExport() {
    if (capas.length === 0) {
      toast.error("No CAPAs to export");
      return;
    }
    const rows = capas.map((c) => ({
      "CAPA Number": c.number,
      "Complaint Number": typeof c.complaint === "object" ? c.complaint?.number : c.complaint,
      Type: c.type,
      Action: c.action,
      Owner: capaOwnerName(c),
      Department: typeof c.department === "object" ? c.department?.name : c.department ?? "—",
      Status: c.status,
      "Due Date": formatDate(c.dueDate),
      "Completed Date": formatDate(c.completedAt),
      "Evidence Review": c.evidenceReview?.status ?? "None",
      Effectiveness: c.effectiveness ?? "Pending",
      "Verified Date": formatDate(c.effectivenessVerifiedAt)
    }));
    downloadSheet("CAPA-Tracker-Export", "CAPAs", rows);
    toast.success("Exported current CAPA view to Excel");
  }

  const columns: Column<CapaItem>[] = [
    {
      key: "number",
      header: "CAPA #",
      primary: true,
      render: (row) => (
        <div>
          <span className="font-mono font-bold text-brand-charcoal text-xs block">{row.number}</span>
          <span className="text-[11px] text-slate-400 font-medium">{row.type}</span>
        </div>
      )
    },
    {
      key: "complaint",
      header: "Complaint",
      render: (row) => {
        const cId = typeof row.complaint === "object" ? row.complaint?._id : row.complaint;
        const cNum = typeof row.complaint === "object" ? row.complaint?.number : row.complaint;
        return (
          <Link
            to={`/complaints/${cId}`}
            className="font-mono font-semibold text-brand-red hover:underline inline-flex items-center gap-1 text-xs"
          >
            <span>{cNum}</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        );
      }
    },
    {
      key: "action",
      header: "Action Summary",
      render: (row) => (
        <div className="max-w-xs sm:max-w-sm">
          <p className="text-xs text-slate-800 line-clamp-2 font-medium">{row.action}</p>
        </div>
      )
    },
    {
      key: "owner",
      header: "Owner / Dept",
      render: (row) => {
        const ownerName = capaOwnerName(row);
        const deptName = typeof row.department === "object" ? row.department?.name : row.department ?? "—";
        return (
          <div className="text-xs">
            <span className="font-semibold text-slate-800 block truncate">{ownerName}</span>
            <span className="text-[11px] text-slate-400 block truncate">{deptName}</span>
          </div>
        );
      }
    },
    {
      key: "dueDate",
      header: "Target SLA",
      render: (row) => {
        const isPastDue =
          !row.completedAt && row.dueDate && isPastDueDay(row.dueDate);
        return (
          <div className="text-xs">
            <span className={isPastDue ? "font-bold text-brand-red" : "text-slate-700"}>
              {formatDate(row.dueDate)}
            </span>
            {isPastDue && (
              <span className="block text-[10px] font-bold uppercase text-brand-red">Overdue</span>
            )}
          </div>
        );
      }
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
    },
    {
      key: "evidence",
      header: "Evidence Review",
      render: (row) => {
        const review = row.evidenceReview;
        if (!review || !review.status) {
          return row.evidence ? (
            <StatusBadge tone="amber">Evidence Uploaded</StatusBadge>
          ) : (
            <span className="text-xs text-slate-400">No evidence</span>
          );
        }
        return (
          <StatusBadge
            tone={
              review.status === "Accepted"
                ? "green"
                : review.status === "Rejected"
                  ? "red"
                  : "amber"
            }
          >
            {review.status}
          </StatusBadge>
        );
      }
    },
    {
      key: "effectiveness",
      header: "Effectiveness",
      render: (row) => {
        if (!row.effectiveness) {
          return <span className="text-xs text-slate-400">Pending</span>;
        }
        return (
          <StatusBadge tone={row.effectiveness === "Effective" ? "green" : "red"}>
            {row.effectiveness}
          </StatusBadge>
        );
      }
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => {
        const hasEvidence = Boolean(row.evidence) || (row.evidenceFiles && row.evidenceFiles.length > 0);
        return (
          <div className="flex items-center justify-end gap-1.5">
            {canReview && hasEvidence && row.evidenceReview?.status !== "Accepted" && (
              <Button
                type="button"
                variant="secondary"
                className="h-7 text-[11px] px-2"
                onClick={() => {
                  setReviewTarget(row);
                  setReviewRemarks(row.evidenceReview?.remarks ?? "");
                  setReviewError(null);
                }}
              >
                <ShieldCheck className="mr-1 h-3 w-3" />
                Review
              </Button>
            )}
            <Link
              to={`/complaints/${typeof row.complaint === "object" ? row.complaint?._id : row.complaint}`}
              className="inline-flex h-7 items-center rounded border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              View
            </Link>
          </div>
        );
      }
    }
  ];

  return (
    <main className="space-y-6 pb-12">
      <PageHeader
        title="CAPA Tracker & Evidence Review"
        description="Monitor individual corrective and preventive action items, review uploaded completion evidence, and verify sustained effectiveness."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={handleExport}
              disabled={capas.length === 0}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export Excel
            </Button>
            <Link
              to="/capa"
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Analytics Dashboard
            </Link>
          </div>
        }
      />

      <div className="space-y-4 px-4 sm:px-6">
        {/* Filter Controls Card */}
        <SectionCard>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <Field label="Search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-8 text-xs"
                  placeholder="CAPA #, action, owner..."
                  value={params.get("search") ?? ""}
                  onChange={(e) => updateFilter("search", e.target.value)}
                />
              </div>
            </Field>

            <Field label="Status">
              <Select
                className="text-xs"
                value={params.get("status") ?? ""}
                onChange={(e) => updateFilter("status", e.target.value)}
              >
                <option value="">All Statuses</option>
                {CAPA_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Action Type">
              <Select
                className="text-xs"
                value={params.get("type") ?? ""}
                onChange={(e) => updateFilter("type", e.target.value)}
              >
                <option value="">All Types</option>
                {CAPA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Evidence Review">
              <Select
                className="text-xs"
                value={params.get("evidenceReview") ?? ""}
                onChange={(e) => updateFilter("evidenceReview", e.target.value)}
              >
                <option value="">All Evidence</option>
                {EVIDENCE_STATUSES.map((es) => (
                  <option key={es} value={es}>
                    {es}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Effectiveness">
              <Select
                className="text-xs"
                value={params.get("effectiveness") ?? ""}
                onChange={(e) => updateFilter("effectiveness", e.target.value)}
              >
                <option value="">All Results</option>
                {EFFECTIVENESS_STATUSES.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef}
                  </option>
                ))}
              </Select>
            </Field>

            {companies.length > 1 && (
              <Field label="Company">
                <Select
                  className="text-xs"
                  value={params.get("company") ?? ""}
                  onChange={(e) => updateFilter("company", e.target.value)}
                >
                  <option value="">All Companies</option>
                  {companies.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Start Date">
              <Input
                className="text-xs"
                type="date"
                value={params.get("dueFrom") ?? ""}
                onChange={(e) => updateFilter("dueFrom", e.target.value)}
              />
            </Field>

            <Field label="End Date">
              <Input
                className="text-xs"
                type="date"
                value={params.get("dueTo") ?? ""}
                onChange={(e) => updateFilter("dueTo", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">
              Showing {capas.length} of {data?.total ?? 0} CAPAs
            </span>
            <Button
              type="button"
              variant="ghost"
              className="text-xs text-slate-600"
              onClick={clearFilters}
            >
              <FilterX className="mr-1.5 h-3.5 w-3.5" />
              Reset Filters
            </Button>
          </div>
        </SectionCard>

        {/* Data Table */}
        <SectionCard>
          <DataTable<CapaItem>
            rows={capas}
            rowKey={(item) => item._id}
            columns={columns}
            isLoading={isLoading}
            error={error}
            emptyTitle="No CAPAs found"
            emptyDescription="Try clearing or adjusting the search and status filters above."
          />

          {data && data.totalPages > 1 && (
            <div className="pt-4">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                pageSize={data.pageSize}
                onPageChange={(p) => updateFilter("page", String(p))}
              />
            </div>
          )}
        </SectionCard>
      </div>

      {/* Evidence Review Modal */}
      <Modal
        open={Boolean(reviewTarget)}
        onOpenChange={(open) => !open && setReviewTarget(null)}
        title={`Review Evidence: ${reviewTarget?.number ?? ""}`}
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5 text-slate-700">
            <p className="font-semibold text-slate-900">Action: {reviewTarget?.action}</p>
            <p>
              Owner: <strong>{reviewTarget ? capaOwnerName(reviewTarget) : ""}</strong>
            </p>
            <p>
              Completed Date: <strong>{formatDate(reviewTarget?.completedAt)}</strong>
            </p>
            {reviewTarget?.evidence && (
              <div className="mt-2 rounded bg-white p-2 border border-slate-200">
                <span className="font-semibold text-slate-600 block">Submitted Evidence Notes:</span>
                <p className="mt-0.5 whitespace-pre-wrap">{reviewTarget.evidence}</p>
              </div>
            )}
          </div>

          {reviewError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <span>{reviewError}</span>
            </div>
          )}

          <Field label="Reviewer Feedback / Rejection Remarks (Mandatory if Rejecting)">
            <Textarea
              rows={3}
              placeholder="State approval notes or specific deficiencies that must be remediated before acceptance..."
              value={reviewRemarks}
              onChange={(e) => setReviewRemarks(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={() => setReviewTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={reviewMutation.isPending}
              onClick={() => handleReviewSubmit("Rejected")}
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              {reviewMutation.isPending ? "Submitting..." : "Reject Evidence"}
            </Button>
            <Button
              type="button"
              variant="primary"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={reviewMutation.isPending}
              onClick={() => handleReviewSubmit("Accepted")}
            >
              <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
              {reviewMutation.isPending ? "Submitting..." : "Accept Evidence"}
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
export default CapaTrackerPage;
