import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Lock,
  Pencil,
  RefreshCw,
  Repeat2,
  ShieldAlert,
  Trash2,
  Unlock
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DefinitionList, SectionCard } from "@/components/ui/Cards";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast-context";
import { api, ApiError } from "@/lib/api";
import { downloadWorkbook } from "@/lib/excel";
import { formatDate, formatDateTime, statusTone, tatLabel, tatTone } from "@/lib/format";
import type { PdfCapa, PdfComplaint } from "@/lib/pdf";
import {
  issuesFrom,
  useApiMutation,
  useComplaintDetail,
  useMasterBootstrap,
  usePermissions,
  type ApiIssue,
  type ComplaintDetail
} from "@/services/queries";
import { AttachmentsTab } from "./AttachmentsTab";
import { ComplaintPhoto } from "./ComplaintPhoto";
import { AuditTab } from "./AuditTab";
import { CapaTab } from "./CapaTab";
import { EditComplaintModal } from "./EditComplaintModal";
import { EffectivenessTab } from "./EffectivenessTab";
import { EightDTab } from "./EightDTab";
import { InternalTab } from "./InternalTab";
import { NotesTab } from "./NotesTab";
import { BlockedReasons, TabPanel } from "./shared";
import { TimelineTab } from "./TimelineTab";
import { WorkflowPanel } from "./WorkflowPanel";

type TabKey =
  | "overview"
  | "investigation"
  | "capa"
  | "effectiveness"
  | "attachments"
  | "notes"
  | "timeline"
  | "audit";

export function ComplaintDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const permissions = usePermissions();
  const master = useMasterBootstrap();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  // Close modal state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closureRemarks, setClosureRemarks] = useState("");
  const [noRepeatConfirmed, setNoRepeatConfirmed] = useState(false);
  const [forceClose, setForceClose] = useState(false);
  const [closeIssues, setCloseIssues] = useState<ApiIssue[]>([]);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Reopen modal state
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  // Delete modal state (Master Admin)
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Force close modal state (Master Admin)
  const [showForceCloseModal, setShowForceCloseModal] = useState(false);
  const [forceRemarks, setForceRemarks] = useState("");
  const [forceError, setForceError] = useState<string | null>(null);

  // Edit modal state (Master Admin)
  const [showEditModal, setShowEditModal] = useState(false);

  const detailQuery = useComplaintDetail(id);
  const data = detailQuery.data;
  const complaint = data?.complaint;
  const capas = data?.capas ?? [];
  const tat = data?.tat ?? [];
  const canEdit = Boolean(data?.permissions?.canEdit);
  const canClose = Boolean(data?.permissions?.canClose);
  const canDelete = Boolean(data?.permissions?.canDelete && permissions.isMasterAdmin);

  const invalidate = [["complaint", id], ["complaints"], ["analytics"]];

  const closeMutation = useApiMutation<
    { complaint: ComplaintDetail },
    { closureRemarks: string; noRepeatConfirmed: boolean; force: boolean; forceCloseAll?: boolean }
  >("POST", `/api/complaints/${id}/close`, invalidate);

  const reopenMutation = useApiMutation<{ complaint: ComplaintDetail }, { reason: string }>(
    "POST",
    `/api/complaints/${id}/reopen`,
    invalidate
  );

  const deleteMutation = useApiMutation<{ deleted: boolean }, { confirmation: string }>(
    "DELETE",
    `/api/complaints/${id}`,
    [["complaints"], ["analytics"]]
  );

  const overallTatHealth = useMemo(() => {
    if (!tat || tat.length === 0) return "on-time";
    if (tat.some((s) => s.overdue && !s.completedAt)) return "overdue";
    if (tat.some((s) => s.health === "due-soon" && !s.completedAt)) return "due-soon";
    return "on-time";
  }, [tat]);

  const targetDates = useMemo(() => {
    return {
      d3: tat.find((t) => t.stage === "cont")?.dueAt ?? "",
      d5: tat.find((t) => t.stage === "capa")?.dueAt ?? "",
      d6: ""
    };
  }, [tat]);

  const companyObj = useMemo(() => {
    if (!complaint?.company) return null;
    return master.data?.companies.find((c) => c._id === complaint.company);
  }, [complaint?.company, master.data?.companies]);

  const deptObj = useMemo(() => {
    if (!complaint?.responsibleDept) return null;
    return master.data?.departments.find((d) => d._id === complaint.responsibleDept);
  }, [complaint?.responsibleDept, master.data?.departments]);

  if (detailQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-3">
        <RefreshCw className="h-6 w-6 animate-spin text-brand-red" />
        <p className="text-sm font-semibold text-slate-600">Loading complaint details...</p>
      </div>
    );
  }

  if (detailQuery.isError || !complaint) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-600" />
          <h3 className="mt-2 text-base font-bold text-red-900">Complaint Not Found</h3>
          <p className="mt-1 text-xs text-red-700">
            The requested complaint record does not exist or you do not have permission to view it.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => navigate("/complaints")}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Complaints List
          </Button>
        </div>
      </div>
    );
  }

  const isClosed = complaint.status === "Closed";

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      const response = await api<{ complaint: PdfComplaint; capas: PdfCapa[] }>(
        `/api/reports/complaint/${complaint?._id}/8d`
      );
      // jsPDF is ~350 kB and only ever runs behind this button, so it loads on demand.
      const { generateComplaintPdf } = await import("@/lib/pdf");
      generateComplaintPdf(response.complaint, response.capas);
      toast.success("PDF generated and download started");
    } catch (error) {
      toast.failure(error, "Failed to generate 8D PDF");
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleDownloadExcel() {
    setDownloadingExcel(true);
    try {
      const response = await api<{ sheets: { name: string; rows: Record<string, string | number>[] }[] }>(
        `/api/reports/complaint/${complaint?._id}/8d`
      );
      downloadWorkbook(
        `${complaint?.number}-${complaint?.type === "External" ? "8D" : "Internal"}`,
        response.sheets
      );
      toast.success("8D Excel workbook exported");
    } catch (error) {
      toast.failure(error, "Failed to export 8D Excel");
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleCloseSubmit() {
    if (closureRemarks.trim().length < 5) {
      setCloseError("Closure remarks must be at least 5 characters.");
      return;
    }
    setCloseIssues([]);
    setCloseError(null);

    try {
      await closeMutation.mutateAsync({
        closureRemarks: closureRemarks.trim(),
        noRepeatConfirmed,
        force: forceClose
      });
      toast.success(`Complaint ${complaint?.number} formally closed`);
      setShowCloseModal(false);
      setClosureRemarks("");
      setNoRepeatConfirmed(false);
      setForceClose(false);
    } catch (error) {
      const fieldIssues = issuesFrom(error);
      if (fieldIssues.length > 0) {
        setCloseIssues(fieldIssues);
      } else if (error instanceof ApiError) {
        setCloseError(error.message);
      } else {
        setCloseError("Failed to close complaint due to validation requirements.");
      }
      toast.failure(error, "Complaint closure blocked by audit rules");
    }
  }

  async function handleForceCloseSubmit() {
    if (forceRemarks.trim().length < 5) {
      setForceError("Closure remarks must be at least 5 characters.");
      return;
    }
    setForceError(null);
    try {
      await closeMutation.mutateAsync({ closureRemarks: forceRemarks.trim(), noRepeatConfirmed: false, force: true, forceCloseAll: true });
      toast.success(`Complaint ${complaint?.number} force closed`);
      setShowForceCloseModal(false);
      setForceRemarks("");
    } catch (error) {
      setForceError(error instanceof ApiError ? error.message : "The complaint could not be force closed.");
      toast.failure(error, "Force close failed");
    }
  }

  async function handleReopenSubmit() {
    if (reopenReason.trim().length < 5) {
      toast.error("A reopen reason of at least 5 characters is required");
      return;
    }
    try {
      await reopenMutation.mutateAsync({ reason: reopenReason.trim() });
      toast.success(`Complaint ${complaint?.number} reopened`);
      setShowReopenModal(false);
      setReopenReason("");
    } catch (error) {
      toast.failure(error, "Failed to reopen complaint");
    }
  }

  async function handleDeleteConfirm() {
    try {
      await deleteMutation.mutateAsync({ confirmation: complaint?.number ?? "" });
      toast.success(`Complaint ${complaint?.number} permanently deleted`);
      navigate("/complaints");
    } catch (error) {
      toast.failure(error, "Failed to delete complaint");
    }
  }

  const tabs: { id: TabKey; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    {
      id: "investigation",
      label: complaint.type === "External" ? "8D Investigation" : "Internal Investigation"
    },
    { id: "capa", label: "CAPA Actions", count: capas.length },
    { id: "effectiveness", label: "Effectiveness" },
    { id: "attachments", label: "Attachments" },
    { id: "notes", label: "Notes & MOM" },
    { id: "timeline", label: "Workflow Timeline" },
    ...(permissions.can("audit.view") ? [{ id: "audit" as TabKey, label: "Audit Trail" }] : [])
  ];

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions Bar */}
      <PageHeader
        title={complaint.number}
        description={`Registered on ${formatDate(complaint.receivedAt)} • ${complaint.type} Complaint • Company: ${companyObj?.name ?? complaint.company ?? "—"}`}
        breadcrumb={
          <div className="flex items-center gap-1.5">
            <Link to="/complaints" className="hover:text-brand-red hover:underline">
              Complaints
            </Link>
            <span>/</span>
            <span className="text-slate-700">{complaint.number}</span>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {permissions.isMasterAdmin && (
              <Button type="button" variant="secondary" className="text-xs" onClick={() => setShowEditModal(true)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            )}

            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {downloadingPdf ? "Generating..." : "Download 8D PDF"}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              disabled={downloadingExcel}
              onClick={handleDownloadExcel}
            >
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
              {downloadingExcel ? "Exporting..." : "Export 8D Excel"}
            </Button>

            {!isClosed && canClose && (
              <Button
                type="button"
                variant="primary"
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => {
                  setCloseIssues([]);
                  setCloseError(null);
                  setShowCloseModal(true);
                }}
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                Close Complaint
              </Button>
            )}

            {!isClosed && permissions.isMasterAdmin && (
              <Button
                type="button"
                variant="danger"
                className="text-xs"
                onClick={() => {
                  setForceError(null);
                  setShowForceCloseModal(true);
                }}
              >
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                Force Close
              </Button>
            )}

            {isClosed && (canClose || permissions.can("8d.approve") || permissions.isMasterAdmin) && (
              <Button
                type="button"
                variant="secondary"
                className="text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                onClick={() => setShowReopenModal(true)}
              >
                <Unlock className="mr-1.5 h-3.5 w-3.5" />
                Reopen Complaint
              </Button>
            )}

            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                className="text-xs text-brand-red hover:bg-red-50"
                onClick={() => setShowDeleteModal(true)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
        }
      />

      {/* Badges & Status Strip */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={statusTone(complaint.status)}>{complaint.status}</StatusBadge>
        <StatusBadge tone={tatTone(overallTatHealth)}>
          {`TAT: ${tatLabel(overallTatHealth)}`}
        </StatusBadge>
        {complaint.isRepeat && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700">
            <Repeat2 className="h-3.5 w-3.5" />
            Repeat Issue
          </span>
        )}
      </div>

      {/* Identity Summary Bar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-xs">
        <div>
          <span className="text-slate-400 block font-medium">Type / Priority</span>
          <span className="font-bold text-slate-800 text-sm mt-0.5 block">
            {complaint.type} • {complaint.priorityName ?? "Normal"}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Customer / Raising Dept</span>
          <span className="font-semibold text-slate-800 text-sm mt-0.5 block truncate">
            {complaint.customer || complaint.internalDeptName || "Internal"}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Product / Batch</span>
          <span className="font-semibold text-slate-800 text-sm mt-0.5 block truncate">
            {complaint.product || "—"} {complaint.batch ? `(${complaint.batch})` : ""}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Responsible Dept</span>
          <span className="font-semibold text-slate-800 text-sm mt-0.5 block truncate">
            {complaint.responsibleDeptName ?? deptObj?.name ?? complaint.againstDeptName ?? "—"}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Owner</span>
          <span className="font-semibold text-slate-800 text-sm mt-0.5 block truncate">
            {complaint.ownerEmployeeName ?? complaint.ownerName ?? "Unassigned"}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block font-medium">Closed Date</span>
          <span className="font-semibold text-slate-800 text-sm mt-0.5 block">
            {complaint.closedAt ? formatDate(complaint.closedAt) : "Open"}
          </span>
        </div>
      </div>

      {/* Reopen notice if complaint was previously reopened */}
      {complaint.reopenReason && !isClosed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-bold">This complaint was reopened for re-investigation:</p>
            <p className="mt-1 italic">&ldquo;{complaint.reopenReason}&rdquo;</p>
          </div>
        </div>
      )}

      {/* Tabs Header */}
      <div className="border-b border-slate-200 overflow-x-auto">
        <nav className="flex space-x-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition flex items-center gap-2 ${
                  isActive
                    ? "border-brand-red text-brand-red font-bold"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      isActive ? "bg-red-100 text-brand-red" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Panels */}
      {activeTab === "overview" && (
        <TabPanel>
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 space-y-6">
              {/* Problem Description Card */}
              <SectionCard title="Problem Description & Customer Voice">
                <div className="grid gap-4 text-xs md:grid-cols-[minmax(0,1fr)_14rem]">
                  <div>
                    <span className="text-slate-400 font-medium">Detailed Description:</span>
                    <p className="mt-1 text-slate-800 text-sm whitespace-pre-wrap leading-relaxed">
                      {complaint.description}
                    </p>
                  </div>
                  <ComplaintPhoto complaint={complaint} canEdit={canEdit && !isClosed} />

                  {complaint.containmentNotes && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 md:col-span-2">
                      <span className="text-slate-500 font-semibold block">Immediate Containment Action:</span>
                      <p className="mt-1 text-slate-800">{complaint.containmentNotes}</p>
                    </div>
                  )}

                  {isClosed && complaint.closureRemarks && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-900 md:col-span-2">
                      <span className="font-bold block">Closure Remarks:</span>
                      <p className="mt-1">{complaint.closureRemarks}</p>
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* Repeat Linkage Card */}
              {complaint.isRepeat && (
                <SectionCard
                  title="Repeat Occurrence Linkage"
                  description="This complaint was flagged as a repeat defect based on matching category and customer/product inside the repeat window."
                >
                  <div className="space-y-3 text-xs">
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
                      <p className="font-semibold">Matching Basis: {complaint.repeatBasis || "Category & Customer Match"}</p>
                    </div>

                    {complaint.repeatOf && complaint.repeatOf.length > 0 && (
                      <div className="space-y-2">
                        <p className="font-bold text-slate-700">Linked Prior Complaints:</p>
                        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                          {complaint.repeatOf.map((orig, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-3 hover:bg-slate-50"
                            >
                              <div className="flex items-center gap-2">
                                <Repeat2 className="h-4 w-4 text-brand-red" />
                                <Link
                                  to={`/complaints/${orig.complaint}`}
                                  className="font-mono font-bold text-brand-red hover:underline"
                                >
                                  {orig.number || orig.complaint}
                                </Link>
                              </div>
                              <span className="text-slate-500 text-[11px]">
                                {orig.basis?.join(", ") || "Repeat match"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* Workflow Panel */}
              <WorkflowPanel complaint={complaint} tat={tat} canEdit={canEdit && !isClosed} />
            </div>

            <div className="lg:col-span-4 space-y-6">
              {/* Metadata Details */}
              <SectionCard title="Registration Details">
                <DefinitionList
                  items={[
                    { label: "Complaint Number", value: complaint.number },
                    { label: "Classification", value: complaint.type },
                    { label: "Status", value: complaint.status },
                    { label: "Priority", value: complaint.priorityName ?? "Normal" },
                    { label: "Category", value: complaint.category ?? "—" },
                    { label: "Sub Category", value: complaint.subCategory ?? "—" },
                    { label: "Source", value: complaint.source ?? "Customer" },
                    { label: "Reported By", value: complaint.reportedBy ?? "—" },
                    { label: "Customer PO", value: complaint.customerPO ?? "—" },
                    { label: "Project", value: complaint.project ?? "—" },
                    { label: "Customer Location", value: complaint.customerLocation ?? "—" },
                    { label: "Registered At", value: formatDateTime(complaint.receivedAt) }
                  ]}
                />
              </SectionCard>

              {/* Quick Summaries */}
              <SectionCard title="Quick Summaries">
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                    <span className="text-slate-500">CAPA Items</span>
                    <span className="font-bold text-slate-800">{capas.length}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                    <span className="text-slate-500">Overall TAT Status</span>
                    <StatusBadge tone={tatTone(overallTatHealth)}>
                      {tatLabel(overallTatHealth)}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                    <span className="text-slate-500">Signatures Completed</span>
                    <span className="font-bold text-slate-800">
                      {[
                        complaint.signatures?.prepared,
                        complaint.signatures?.reviewed,
                        complaint.signatures?.approved
                      ].filter(Boolean).length}
                      /3
                    </span>
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>
        </TabPanel>
      )}

      {activeTab === "investigation" && (
        complaint.type === "External" ? (
          <EightDTab complaint={complaint} canEdit={canEdit && !isClosed} targetDates={targetDates} />
        ) : (
          <InternalTab complaint={complaint} canEdit={canEdit && !isClosed} />
        )
      )}

      {activeTab === "capa" && (
        <CapaTab complaint={complaint} capas={capas} canEdit={canEdit && !isClosed} />
      )}

      {activeTab === "effectiveness" && (
        <EffectivenessTab complaint={complaint} capas={capas} canEdit={canEdit} />
      )}

      {activeTab === "attachments" && (
        <AttachmentsTab complaint={complaint} canEdit={canEdit && !isClosed} />
      )}

      {activeTab === "notes" && (
        <NotesTab complaint={complaint} canEdit={canEdit && !isClosed} />
      )}

      {activeTab === "timeline" && (
        <TimelineTab complaint={complaint} />
      )}

      {activeTab === "audit" && permissions.can("audit.view") && (
        <AuditTab complaint={complaint} />
      )}

      {/* Formal Closure Modal */}
      <Modal
        open={showCloseModal}
        onOpenChange={setShowCloseModal}
        title={`Formal Closure: ${complaint.number}`}
      >
        <div className="space-y-4 text-sm">
          <p className="text-xs text-slate-600">
            Closing a complaint validates that all required workflow stages, 8D investigation sections, digital signatures, and CAPAs have been fulfilled according to ISO/IATF standards.
          </p>

          {closeError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <span>{closeError}</span>
            </div>
          )}

          {closeIssues.length > 0 && (
            <BlockedReasons
              title="Closure requirements not satisfied:"
              issues={closeIssues}
            />
          )}

          {capas.some((c) => c.status !== "Completed" && c.status !== "Closed") && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Open CAPA Items Exist</span>
              </div>
              <p>
                There are still open or pending verification CAPA items attached to this complaint. Closing requires explicit acknowledgement.
              </p>
              <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={forceClose}
                  onChange={(e) => setForceClose(e.target.checked)}
                  className="rounded border-slate-300 text-brand-red focus:ring-brand-red"
                />
                <span>I acknowledge open CAPAs and authorize force closure</span>
              </label>
            </div>
          )}

          <Field label="Formal Closure Remarks" required>
            <Textarea
              rows={3}
              placeholder="Comprehensive summary of investigation outcome, corrective verification, and customer consensus (minimum 5 characters)..."
              value={closureRemarks}
              onChange={(e) => setClosureRemarks(e.target.value)}
            />
          </Field>

          <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={noRepeatConfirmed}
              onChange={(e) => setNoRepeatConfirmed(e.target.checked)}
              className="rounded border-slate-300 text-brand-red focus:ring-brand-red mt-0.5"
            />
            <span>
              I confirm that corrective and containment actions have eliminated the root cause and no repeat defect has been observed during the verification window.
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={() => setShowCloseModal(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={closeMutation.isPending || closureRemarks.trim().length < 5}
              onClick={handleCloseSubmit}
            >
              {closeMutation.isPending ? "Validating & Closing..." : "Confirm Closure"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Force Close Modal (Master Admin) */}
      <Modal open={showForceCloseModal} onOpenChange={setShowForceCloseModal} title={`Force Close: ${complaint.number}`}>
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>
              This closes the complaint even if mandatory stages, 8D sections, signatures or CAPAs are incomplete. The closure is recorded in the
              workflow timeline and audit trail as a Master Admin force close.
            </span>
          </div>
          {forceError ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{forceError}</p> : null}
          <Field label="Reason for force closing" required>
            <Textarea rows={3} value={forceRemarks} onChange={(event) => setForceRemarks(event.target.value)} placeholder="Why is this complaint being closed without full completion? (minimum 5 characters)" />
          </Field>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button type="button" variant="secondary" onClick={() => setShowForceCloseModal(false)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" disabled={closeMutation.isPending || forceRemarks.trim().length < 5} onClick={handleForceCloseSubmit}>
              {closeMutation.isPending ? "Closing..." : "Force Close Complaint"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reopen Modal */}
      <Modal
        open={showReopenModal}
        onOpenChange={setShowReopenModal}
        title={`Reopen Complaint: ${complaint.number}`}
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <span>
              Reopening this complaint will return it to Under Verification / Investigation status, append a REOPEN event to the immutable audit trail, and notify the Complaint Owner and Quality Head.
            </span>
          </div>

          <Field label="Reopen Reason & Justification" required>
            <Textarea
              rows={3}
              placeholder="Specify why this complaint is being reopened (recurrence observed, inadequate containment, customer rejection, etc.)..."
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={() => setShowReopenModal(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={reopenMutation.isPending || reopenReason.trim().length < 5}
              onClick={handleReopenSubmit}
            >
              {reopenMutation.isPending ? "Reopening..." : "Confirm Reopen"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Master Admin edit: mounted only while open so the form always starts from the saved values */}
      {showEditModal && <EditComplaintModal complaint={complaint} open onClose={() => setShowEditModal(false)} />}

      {/* Master Admin Delete Confirmation with typed confirmation phrase */}
      <ConfirmDialog
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        title={`Permanently Delete ${complaint.number}`}
        description={`This action will permanently delete complaint ${complaint.number}, all associated CAPAs, notes, timeline entries, and attachments. This operation is strictly irreversible.`}
        confirmLabel="Delete Permanently"
        destructive
        confirmationPhrase={complaint.number}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
export default ComplaintDetailPage;
