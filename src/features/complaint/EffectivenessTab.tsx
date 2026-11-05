import { useState } from "react";
import { SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/Cards";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast-context";
import { formatDate, formatDateTime, statusTone } from "@/lib/format";
import {
  useApiMutation,
  capaOwnerName,
  usePermissions,
  type CapaItem,
  type ComplaintDetail
} from "@/services/queries";
import { TabPanel } from "./shared";

const VERIFICATION_METHODS = [
  "Process Audit",
  "Product Inspection & Testing",
  "Customer Feedback / Monitoring Period",
  "Statistical Process Control (SPC)",
  "Documentation & Standard Work Review",
  "Poka-Yoke / Error Proofing Validation"
];

export function EffectivenessTab({
  complaint,
  capas,
  canEdit: _canEdit
}: {
  complaint: ComplaintDetail;
  capas: CapaItem[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const permissions = usePermissions();

  const canVerify =
    permissions.isMasterAdmin ||
    permissions.can("capa.verify") ||
    permissions.can("8d.approve");

  // State for CAPA verification
  const [selectedCapa, setSelectedCapa] = useState<CapaItem | null>(null);
  const [capaResult, setCapaResult] = useState<"Effective" | "Not Effective">("Effective");
  const [verificationMethod, setVerificationMethod] = useState(VERIFICATION_METHODS[0]);
  const [effectivenessEvidence, setEffectivenessEvidence] = useState("");
  const [effectivenessRemarks, setEffectivenessRemarks] = useState("");
  const [showCapaReopenWarning, setShowCapaReopenWarning] = useState(false);

  // State for Overall Complaint Effectiveness
  const [overallResult, setOverallResult] = useState<"Effective" | "Not Effective">(
    (complaint.overallEffectiveness?.result as "Effective" | "Not Effective") || "Effective"
  );
  const [overallDate, setOverallDate] = useState(
    complaint.overallEffectiveness?.at
      ? new Date(complaint.overallEffectiveness.at).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  );
  const [overallComments, setOverallComments] = useState(
    complaint.overallEffectiveness?.comments ?? ""
  );
  const [showOverallReopenWarning, setShowOverallReopenWarning] = useState(false);

  const invalidate = [
    ["complaint", complaint._id],
    ["capas"],
    ["complaints"],
    ["analytics"]
  ];

  const verifyCapaMutation = useApiMutation<
    { capa: CapaItem },
    {
      result: "Effective" | "Not Effective";
      verificationMethod: string;
      effectivenessEvidence: string;
      remarks?: string;
    }
  >(
    "POST",
    () => `/api/capas/${selectedCapa?._id}/effectiveness`,
    invalidate
  );

  const overallMutation = useApiMutation<
    { complaint: ComplaintDetail },
    { result: "Effective" | "Not Effective"; at?: string; comments: string }
  >("POST", `/api/complaints/${complaint._id}/effectiveness`, invalidate);

  function openCapaModal(capa: CapaItem) {
    setSelectedCapa(capa);
    setCapaResult("Effective");
    setVerificationMethod(capa.verificationMethod || VERIFICATION_METHODS[0]);
    setEffectivenessEvidence(capa.effectivenessEvidence || "");
    setEffectivenessRemarks(capa.effectivenessRemarks || "");
  }

  async function executeCapaVerification() {
    if (!selectedCapa) return;
    try {
      await verifyCapaMutation.mutateAsync({
        result: capaResult,
        verificationMethod,
        effectivenessEvidence: effectivenessEvidence.trim(),
        remarks: effectivenessRemarks.trim() || undefined
      });
      toast.success(
        capaResult === "Effective"
          ? `CAPA ${selectedCapa.number} verified as Effective`
          : `CAPA ${selectedCapa.number} marked Not Effective; complaint reopened`
      );
      setSelectedCapa(null);
      setShowCapaReopenWarning(false);
    } catch (error) {
      toast.failure(error, "Failed to verify CAPA");
    }
  }

  function handleCapaSubmit() {
    if (effectivenessEvidence.trim().length < 2) {
      toast.error("Evidence reference is required", "Enter the audit document, test report or inspection reference that supports the result.");
      return;
    }
    if (capaResult === "Not Effective") {
      setShowCapaReopenWarning(true);
    } else {
      executeCapaVerification();
    }
  }

  async function executeOverallSave() {
    try {
      await overallMutation.mutateAsync({
        result: overallResult,
        at: overallDate ? new Date(overallDate).toISOString() : undefined,
        comments: overallComments.trim()
      });
      toast.success(
        overallResult === "Effective"
          ? "Overall complaint effectiveness recorded"
          : "Overall effectiveness marked Not Effective; complaint reopened"
      );
      setShowOverallReopenWarning(false);
    } catch (error) {
      toast.failure(error, "Failed to record overall effectiveness");
    }
  }

  function handleOverallSubmit() {
    if (overallResult === "Not Effective") {
      setShowOverallReopenWarning(true);
    } else {
      executeOverallSave();
    }
  }

  return (
    <TabPanel>
      <SectionCard
        title="CAPA Effectiveness Verification"
        description="Verification of action sustained results and recurrence prevention per individual CAPA."
      >
        {capas.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            No CAPA items recorded for this complaint.
          </p>
        ) : (
          <div className="space-y-3">
            {capas.map((capa) => {
              const isCompleted = capa.status === "Completed" || Boolean(capa.completedAt);
              const isVerified = Boolean(capa.effectiveness);
              const ownerName = capaOwnerName(capa);

              return (
                <div
                  key={capa._id}
                  className="rounded-xl border border-slate-200 bg-white p-4 transition"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{capa.number}</span>
                        <StatusBadge tone={statusTone(capa.status)}>
                          {capa.status}
                        </StatusBadge>
                        <StatusBadge
                          tone={
                            capa.effectiveness === "Effective"
                              ? "green"
                              : capa.effectiveness === "Not Effective"
                                ? "red"
                                : "amber"
                          }
                        >
                          {capa.effectiveness ? `Eff: ${capa.effectiveness}` : "Eff: Pending"}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 font-medium">{capa.action}</p>
                      <div className="mt-1 flex flex-wrap gap-4 text-xs text-slate-400">
                        <span>Owner: <strong className="text-slate-700">{ownerName}</strong></span>
                        <span>Completed: {formatDate(capa.completedAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 sm:pt-0">
                      {canVerify && (
                        <Button
                          type="button"
                          variant="secondary"
                          className="text-xs"
                          disabled={!isCompleted}
                          onClick={() => openCapaModal(capa)}
                        >
                          <SearchCheck className="mr-1.5 h-3.5 w-3.5" />
                          {isVerified ? "Update Verification" : "Verify Effectiveness"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {isVerified && (
                    <div className="mt-3 grid gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <span className="text-slate-400">Result:</span>
                        <p className={`font-bold ${capa.effectiveness === "Effective" ? "text-emerald-700" : "text-red-700"}`}>
                          {capa.effectiveness}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Method:</span>
                        <p className="font-medium text-slate-800">{capa.verificationMethod || "—"}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Verified Date:</span>
                        <p className="font-medium text-slate-800">
                          {formatDateTime(capa.effectivenessVerifiedAt)}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Evidence / Remarks:</span>
                        <p className="text-slate-700 truncate">
                          {capa.effectivenessRemarks || capa.effectivenessEvidence || "—"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Overall Complaint Effectiveness Review"
        description={`Final holistic confirmation that the root causes have been eliminated and no repeat failure has occurred.${
          complaint.effectivenessNextDue
            ? ` Next periodic check due ${formatDate(complaint.effectivenessNextDue)} (every 6 months after closure); reminders are emailed automatically. Record it in the Effectiveness Tracker.`
            : ""
        }`}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Overall Verification Result" required>
              <Select
                value={overallResult}
                disabled={!canVerify}
                onChange={(e) => setOverallResult(e.target.value as "Effective" | "Not Effective")}
              >
                <option value="Effective">Effective — Sustained Solution</option>
                <option value="Not Effective">Not Effective — Recurrence / Ineffective</option>
              </Select>
            </Field>

            <Field label="Verification Date" required>
              <Input
                type="date"
                value={overallDate}
                disabled={!canVerify}
                onChange={(e) => setOverallDate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Effectiveness Comments & Evidence Summary">
            <Textarea
              rows={3}
              placeholder="Summary of monitoring period, customer feedback, test reports confirming sustained resolution..."
              value={overallComments}
              disabled={!canVerify}
              onChange={(e) => setOverallComments(e.target.value)}
            />
          </Field>

          {canVerify && (
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                variant="primary"
                disabled={overallMutation.isPending}
                onClick={handleOverallSubmit}
              >
                {overallMutation.isPending ? "Saving..." : "Save Overall Effectiveness"}
              </Button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* CAPA Verification Modal */}
      <Modal
        open={Boolean(selectedCapa)}
        onOpenChange={(open) => !open && setSelectedCapa(null)}
        title={`Effectiveness Verification: ${selectedCapa?.number ?? ""}`}
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-slate-900">Action: {selectedCapa?.action}</p>
            <p className="mt-1 text-slate-500">
              Completed on {formatDate(selectedCapa?.completedAt)}
            </p>
          </div>

          <Field label="Verification Result" required>
            <Select
              value={capaResult}
              onChange={(e) => setCapaResult(e.target.value as "Effective" | "Not Effective")}
            >
              <option value="Effective">Effective (Sustained & Validated)</option>
              <option value="Not Effective">Not Effective (Reopen Complaint)</option>
            </Select>
          </Field>

          <Field label="Verification Method" required>
            <Select
              value={verificationMethod}
              onChange={(e) => setVerificationMethod(e.target.value)}
            >
              {VERIFICATION_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Evidence Reference" required>
            <Input
              placeholder="Audit document #, test report ID, inspection lot..."
              value={effectivenessEvidence}
              onChange={(e) => setEffectivenessEvidence(e.target.value)}
            />
          </Field>

          <Field label="Verification Remarks / Observations">
            <Textarea
              rows={3}
              placeholder="Observations and data supporting the effectiveness determination..."
              value={effectivenessRemarks}
              onChange={(e) => setEffectivenessRemarks(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button type="button" variant="secondary" onClick={() => setSelectedCapa(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={verifyCapaMutation.isPending}
              onClick={handleCapaSubmit}
            >
              {verifyCapaMutation.isPending ? "Submitting..." : "Confirm Verification"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Warning Dialog when CAPA is Not Effective */}
      <ConfirmDialog
        open={showCapaReopenWarning}
        onOpenChange={setShowCapaReopenWarning}
        title="Warning: Not Effective Status Reopens Complaint"
        description={`Marking CAPA ${selectedCapa?.number} as "Not Effective" will set this CAPA to Rejected/Reopened and automatically REOPEN the entire complaint for re-investigation. A REOPEN audit event will be logged and notification sent to the owner. Do you want to proceed?`}
        confirmLabel="Confirm & Reopen Complaint"
        destructive
        onConfirm={executeCapaVerification}
      />

      {/* Warning Dialog when Overall Effectiveness is Not Effective */}
      <ConfirmDialog
        open={showOverallReopenWarning}
        onOpenChange={setShowOverallReopenWarning}
        title="Warning: Overall Not Effective Reopens Complaint"
        description='Marking the overall complaint effectiveness as "Not Effective" indicates recurrence or failure of corrective actions. This will automatically REOPEN the complaint and notify the Quality Head and Complaint Owner. Proceed?'
        confirmLabel="Confirm & Reopen Complaint"
        destructive
        onConfirm={executeOverallSave}
      />
    </TabPanel>
  );
}
