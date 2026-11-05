import { useState } from "react";
import { CheckCircle2, FileText, Plus, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { CAPA_STATUSES, CAPA_TYPES } from "@shared/constants/domain";
import { SectionCard } from "@/components/ui/Cards";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast-context";
import { ApiError } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime, statusTone } from "@/lib/format";
import {
  capaOwnerName,
  useApiMutation,
  useAssignableUsers,
  useAttachments,
  useMasterBootstrap,
  usePermissions,
  type CapaItem,
  type ComplaintDetail
} from "@/services/queries";
import { AttachmentThumb, BlockedReasons, TabPanel, UploadButton, useCloudinaryUpload } from "./shared";

type CapaFormState = {
  type: string;
  action: string;
  owner: string;
  department: string;
  dueDate: string;
  status: string;
  evidence: string;
};

const EMPTY_FORM: CapaFormState = { type: "Corrective", action: "", owner: "", department: "", dueDate: "", status: "Open", evidence: "" };

function idOf(value: CapaItem["owner"]): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id;
}

function nameOf(value: CapaItem["department"]): string {
  if (!value) return "—";
  return typeof value === "string" ? "—" : (value.name ?? "—");
}

/** The owner picker value: a portal user id, or `emp:<id>` for a directory employee without a login. */
function ownerValueOf(capa: CapaItem): string {
  const employee = idOf(capa.ownerEmployee);
  return employee ? `emp:${employee}` : idOf(capa.owner);
}

export function CapaTab({ complaint, capas, canEdit }: { complaint: ComplaintDetail; capas: CapaItem[]; canEdit: boolean }) {
  const toast = useToast();
  const permissions = usePermissions();
  const master = useMasterBootstrap();
  const assignable = useAssignableUsers(complaint.company);
  const [editing, setEditing] = useState<CapaItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CapaFormState>(EMPTY_FORM);
  const [issues, setIssues] = useState<{ field: string; message: string; section?: string }[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<CapaItem | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<CapaItem | null>(null);

  const invalidate: unknown[][] = [["complaint", complaint._id], ["capas"], ["analytics"]];
  const createCapa = useApiMutation<{ capa: CapaItem }, Record<string, unknown>>("POST", `/api/capas/complaint/${complaint._id}`, invalidate);
  const updateCapa = useApiMutation<{ capa: CapaItem }, Record<string, unknown> & { id: string }>(
    "PATCH",
    (input) => `/api/capas/${input.id}`,
    invalidate
  );
  const removeCapa = useApiMutation<{ deleted: boolean }, { id: string }>("DELETE", (input) => `/api/capas/${input.id}`, invalidate);

  function openCreate() {
    setForm({ ...EMPTY_FORM, dueDate: "" });
    setIssues([]);
    setCreating(true);
  }

  function openEdit(capa: CapaItem) {
    setForm({
      type: capa.type,
      action: capa.action,
      owner: ownerValueOf(capa),
      department: idOf(capa.department),
      dueDate: capa.dueDate ? capa.dueDate.slice(0, 10) : "",
      status: capa.status,
      evidence: capa.evidence ?? ""
    });
    setIssues([]);
    setEditing(capa);
  }

  async function submit() {
    setIssues([]);
    const payload = {
      type: form.type,
      action: form.action,
      owner: form.owner && !form.owner.startsWith("emp:") ? form.owner : undefined,
      ownerEmployee: form.owner.startsWith("emp:") ? form.owner.slice(4) : undefined,
      department: form.department || undefined,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      status: form.status,
      evidence: form.evidence
    };
    try {
      if (editing) {
        await updateCapa.mutateAsync({ id: editing._id, ...payload });
        toast.success("CAPA updated", `${editing.number} was saved.`);
        setEditing(null);
      } else {
        const result = await createCapa.mutateAsync(payload);
        toast.success("CAPA added", `${result.capa.number} was assigned.`);
        setCreating(false);
      }
    } catch (error) {
      if (error instanceof ApiError) setIssues(error.issues);
      toast.failure(error, "The CAPA could not be saved");
    }
  }

  const open = creating || Boolean(editing);

  return (
    <TabPanel>
      <SectionCard
        title={`CAPA items (${capas.length})`}
        description="At least one complete CAPA is required before the CAPA assignment stage and before closure."
        actions={
          canEdit ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add CAPA
            </Button>
          ) : undefined
        }
      >
        {capas.length === 0 ? (
          <p className="text-sm text-slate-500">No CAPA items have been added yet.</p>
        ) : (
          <ul className="space-y-3">
            {capas.map((capa) => {
              const review = capa.evidenceReview?.status ?? "Pending";
              return (
                <li key={capa._id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-brand-charcoal">{capa.number}</p>
                      <p className="mt-1 text-sm text-slate-700">{capa.action}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone={statusTone(capa.status)}>{capa.status}</StatusBadge>
                      <StatusBadge tone={statusTone(review)}>Evidence {review}</StatusBadge>
                      {capa.effectiveness ? <StatusBadge tone={statusTone(capa.effectiveness)}>{capa.effectiveness}</StatusBadge> : null}
                    </div>
                  </div>

                  <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { label: "Type", value: capa.type },
                      { label: "Owner", value: capaOwnerName(capa) },
                      { label: "Department", value: nameOf(capa.department) },
                      { label: "Due", value: formatDate(capa.dueDate) },
                      { label: "Assigned", value: formatDate(capa.assignedAt) },
                      { label: "Completed", value: formatDate(capa.completedAt) },
                      { label: "Evidence files", value: String(capa.evidenceFiles?.length ?? 0) },
                      { label: "Verification method", value: capa.verificationMethod || "—" }
                    ].map((entry) => (
                      <div key={entry.label}>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{entry.label}</dt>
                        <dd className="text-xs text-slate-700">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {capa.evidence ? (
                    <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
                      <span className="font-semibold">Evidence note: </span>
                      {capa.evidence}
                    </p>
                  ) : null}

                  {capa.evidenceReview?.status === "Rejected" ? (
                    <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                      <p className="font-bold">Evidence rejected by {capa.evidenceReview.byName || "Quality"}</p>
                      <p className="mt-0.5">{capa.evidenceReview.remarks}</p>
                      <p className="mt-1 text-[11px]">Upload corrected evidence to return this CAPA to Pending review.</p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" className="h-9" onClick={() => setEvidenceTarget(capa)}>
                      <FileText className="h-4 w-4" />
                      Evidence
                    </Button>
                    {canEdit ? (
                      <Button variant="secondary" className="h-9" onClick={() => openEdit(capa)}>
                        Edit
                      </Button>
                    ) : null}
                    {permissions.isMasterAdmin || permissions.can("complaint.assign") ? (
                      <Button variant="ghost" className="h-9 text-brand-red hover:bg-red-50" onClick={() => setDeleteTarget(capa)}>
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <Modal open={open} onOpenChange={(value) => (value ? undefined : (setCreating(false), setEditing(null)))} title={editing ? `Edit ${editing.number}` : "Add a CAPA"}>
        <div className="space-y-3">
          <BlockedReasons title="This CAPA could not be saved" issues={issues} />
          <Field label="Type" required>
            <Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              {CAPA_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action" required>
            <Textarea rows={3} value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })} />
          </Field>
          <Field label="Owner" required>
            <Select value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })}>
              <option value="">Select an owner</option>
              {(assignable.data?.users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} {user.role ? `— ${user.role}` : ""}
                </option>
              ))}
              {(assignable.data?.employees ?? []).length > 0 ? (
                <optgroup label="Employee Directory (no portal login)">
                  {(assignable.data?.employees ?? []).map((employee) => (
                    <option key={employee.id} value={`emp:${employee.id}`}>
                      {employee.name} {employee.designation ? `— ${employee.designation}` : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })}>
              <option value="">Inherit from the complaint</option>
              {(master.data?.departments ?? []).map((department) => (
                <option key={department._id} value={department._id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" required>
            <Input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
          </Field>
          <Field label="Status" hint="A CAPA cannot be closed without evidence.">
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {CAPA_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Evidence note">
            <Textarea rows={2} value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={createCapa.isPending || updateCapa.isPending}>
              {createCapa.isPending || updateCapa.isPending ? "Saving" : "Save CAPA"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(value) => (value ? undefined : setDeleteTarget(null))}
        title={`Delete ${deleteTarget?.number ?? "CAPA"}`}
        destructive
        confirmLabel="Delete CAPA"
        description="The CAPA record is removed. The audit trail keeps a permanent record of the deletion."
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await removeCapa.mutateAsync({ id: deleteTarget._id });
            toast.success("CAPA deleted", `${deleteTarget.number} was removed.`);
          } catch (error) {
            toast.failure(error, "The CAPA could not be deleted");
          } finally {
            setDeleteTarget(null);
          }
        }}
      />

      {evidenceTarget ? (
        <EvidencePanel capa={capas.find((entry) => entry._id === evidenceTarget._id) ?? evidenceTarget} complaint={complaint} onClose={() => setEvidenceTarget(null)} />
      ) : null}
    </TabPanel>
  );
}

function EvidencePanel({ capa, complaint, onClose }: { capa: CapaItem; complaint: ComplaintDetail; onClose: () => void }) {
  const toast = useToast();
  const permissions = usePermissions();
  const attachments = useAttachments("Capa", capa._id);
  const [remarks, setRemarks] = useState("");
  const [issues, setIssues] = useState<{ field: string; message: string; section?: string }[]>([]);
  const { upload, uploading } = useCloudinaryUpload({
    entityType: "Capa",
    entityId: capa._id,
    purpose: "capa.evidence",
    company: complaint.company
  });

  const invalidate: unknown[][] = [["complaint", complaint._id], ["attachments", "Capa", capa._id], ["capas"], ["analytics"]];
  const linkEvidence = useApiMutation<{ capa: CapaItem }, { attachment: string; description: string }>(
    "POST",
    `/api/capas/${capa._id}/evidence`,
    invalidate
  );
  const review = useApiMutation<{ capa: CapaItem }, { decision: string; remarks: string }>("POST", `/api/capas/${capa._id}/evidence/review`, invalidate);
  const removeFile = useApiMutation<{ deleted: boolean }, { id: string }>("DELETE", (input) => `/api/attachments/${input.id}`, invalidate);

  const canReview = permissions.can("capa.evidence.review") || permissions.isMasterAdmin;

  async function handleFiles(files: FileList) {
    for (const file of Array.from(files)) {
      try {
        const result = await upload(file);
        await linkEvidence.mutateAsync({ attachment: result.attachment._id, description: "" });
        toast.success("Evidence uploaded", `${file.name} was attached to ${capa.number}.`);
      } catch (error) {
        toast.failure(error, "Upload failed");
      }
    }
  }

  async function decide(decision: "Accepted" | "Rejected") {
    setIssues([]);
    try {
      await review.mutateAsync({ decision, remarks });
      toast.success(`Evidence ${decision.toLowerCase()}`, decision === "Rejected" ? "The owner has been notified." : "The CAPA evidence is accepted.");
      setRemarks("");
    } catch (error) {
      if (error instanceof ApiError) setIssues(error.issues);
      toast.failure(error, "The review could not be recorded");
    }
  }

  return (
    <Modal open onOpenChange={(value) => (value ? undefined : onClose())} title={`Evidence — ${capa.number}`}>
      <div className="space-y-4">
        <BlockedReasons title="This review is incomplete" issues={issues} />

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-brand-charcoal">Uploaded files</p>
            <UploadButton label="Upload evidence" uploading={uploading} onFiles={handleFiles} />
          </div>
          {(attachments.data?.attachments ?? []).length === 0 ? (
            <p className="text-xs text-slate-500">No evidence files uploaded yet.</p>
          ) : (
            <ul className="space-y-2">
              {(attachments.data?.attachments ?? []).map((file) => (
                <li key={file._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <AttachmentThumb file={file} />
                    <div className="min-w-0">
                    <a
                      href={file.secureUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-sm font-semibold text-brand-red hover:underline"
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate">{file.originalFilename}</span>
                    </a>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {file.mimeType} · {formatBytes(file.bytes)} · {file.uploadedBy?.name ?? "Unknown"} · {formatDateTime(file.uploadedAt)}
                    </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-9 text-brand-red hover:bg-red-50"
                    onClick={async () => {
                      try {
                        await removeFile.mutateAsync({ id: file._id });
                        toast.success("File removed", `${file.originalFilename} was deleted.`);
                      } catch (error) {
                        toast.failure(error, "The file could not be removed");
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-bold text-brand-charcoal">Quality review</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Current decision
            <StatusBadge tone={statusTone(capa.evidenceReview?.status ?? "Pending")}>{capa.evidenceReview?.status ?? "Pending"}</StatusBadge>
            {capa.evidenceReview?.at ? <span>on {formatDateTime(capa.evidenceReview.at)}</span> : null}
          </p>
          {capa.evidenceReview?.remarks ? <p className="mt-2 text-xs text-slate-600">{capa.evidenceReview.remarks}</p> : null}

          {(capa.evidenceReviewHistory ?? []).length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">Review history</summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {(capa.evidenceReviewHistory ?? []).map((entry, index) => (
                  <li key={index} className="rounded border border-slate-200 p-2">
                    <span className="font-semibold">{entry.status}</span> by {entry.byName || "—"} on {formatDateTime(entry.at)}
                    {entry.remarks ? <span className="block text-slate-500">{entry.remarks}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {canReview ? (
            <div className="mt-3 space-y-2">
              <Field label="Review remarks" hint="Remarks are mandatory when rejecting.">
                <Textarea rows={2} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => decide("Accepted")} disabled={review.isPending}>
                  <CheckCircle2 className="h-4 w-4" />
                  Accept evidence
                </Button>
                <Button variant="danger" onClick={() => decide("Rejected")} disabled={review.isPending}>
                  <XCircle className="h-4 w-4" />
                  Reject evidence
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <ShieldAlert className="h-3.5 w-3.5" />
              Only a Quality Head or Master Admin can accept or reject evidence.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
