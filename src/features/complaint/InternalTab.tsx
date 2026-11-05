import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { SectionCard } from "@/components/ui/Cards";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast-context";
import { ApiError } from "@/lib/api";
import { useApiMutation, useConfiguration, type ActionRow, type ComplaintDetail } from "@/services/queries";
import { ActionRowsEditor, BlockedReasons, TabPanel, WhyChainEditor } from "./shared";
import { SignatureBlock } from "./SignatureBlock";

type Draft = {
  d0: string;
  d3Actions: ActionRow[];
  problem: string;
  singleChain: string[];
  rootCause: string;
  rootCauseCategory: string;
  summary: string;
  /** No longer edited in the portal; the stored value is passed through unchanged so old data is not lost. */
  findings: string;
  correctiveAction: string;
  evidence: string;
};

function toDraft(complaint: ComplaintDetail): Draft {
  return {
    d0: complaint.d0 ?? "",
    d3Actions: complaint.d3Actions ?? [],
    problem: complaint.d2?.what ?? "",
    singleChain: complaint.fiveWhy?.singleChain ?? [],
    rootCause: complaint.d4Occurrence ?? "",
    rootCauseCategory: complaint.rootCauseCategory ?? "",
    summary: complaint.internalInvestigation?.summary ?? "",
    findings: complaint.internalInvestigation?.findings ?? "",
    correctiveAction: complaint.internalInvestigation?.correctiveAction ?? "",
    evidence: complaint.internalInvestigation?.evidence ?? ""
  };
}

/** Internal complaints use this reduced investigation, never the full external 8D. */
export function InternalTab({ complaint, canEdit }: { complaint: ComplaintDetail; canEdit: boolean }) {
  const toast = useToast();
  const configuration = useConfiguration(complaint.company);
  const [draft, setDraft] = useState<Draft>(() => toDraft(complaint));
  const [issues, setIssues] = useState<{ field: string; message: string; section?: string }[]>([]);

  useEffect(() => {
    setDraft(toDraft(complaint));
  }, [complaint]);

  const save = useApiMutation<{ complaint: ComplaintDetail }, Record<string, unknown>>("PATCH", `/api/complaints/${complaint._id}/internal`, [
    ["complaint", complaint._id]
  ]);

  const readOnly = !canEdit;
  const filled = draft.singleChain.filter((entry) => entry.trim()).length;

  async function onSave() {
    setIssues([]);
    try {
      await save.mutateAsync({
        d0: draft.d0,
        d3Actions: draft.d3Actions,
        d2: { what: draft.problem },
        fiveWhy: { singleChain: draft.singleChain },
        d4Occurrence: draft.rootCause,
        rootCauseCategory: draft.rootCauseCategory,
        internalInvestigation: {
          summary: draft.summary,
          findings: draft.findings,
          correctiveAction: draft.correctiveAction,
          evidence: draft.evidence
        }
      });
      toast.success("Investigation saved", "Every change is recorded in the audit trail.");
    } catch (error) {
      if (error instanceof ApiError) setIssues(error.issues);
      toast.failure(error, "The investigation could not be saved");
    }
  }

  return (
    <TabPanel>
      {readOnly ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          You have read-only access to this investigation.
        </div>
      ) : null}

      <BlockedReasons title="The server rejected this save" issues={issues} />

      <SectionCard
        title="Immediate response and containment"
        description="The response text is required to acknowledge the complaint; at least one complete containment action (what, who, target date) is required to complete containment."
      >
        <div className="space-y-4">
          <Field label="Immediate response taken" required hint="Required before the Acknowledgement stage can be completed.">
            <Textarea rows={3} value={draft.d0} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d0: event.target.value })} />
          </Field>
          <Field label="Interim containment actions" required hint="Required before the Containment stage can be completed.">
            <ActionRowsEditor company={complaint.company} rows={draft.d3Actions} onChange={(rows) => setDraft({ ...draft, d3Actions: rows })} readOnly={readOnly} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={draft.d0.trim() ? "green" : "amber"}>Immediate response {draft.d0.trim() ? "recorded" : "missing"}</StatusBadge>
            <StatusBadge tone={draft.d3Actions.length > 0 ? "green" : "amber"}>Containment actions {draft.d3Actions.length}</StatusBadge>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Internal investigation"
        description="A department-to-department complaint uses a single-chain 5-Why and a shared root cause classification."
      >
        <div className="space-y-4">
          <Field label="Problem statement" required hint="Required before the RCA stage can be completed and before closure.">
            <Textarea rows={3} value={draft.problem} disabled={readOnly} onChange={(event) => setDraft({ ...draft, problem: event.target.value })} />
          </Field>

          <Field label="Investigation summary">
            <Textarea rows={4} value={draft.summary} disabled={readOnly} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          </Field>

          <WhyChainEditor
            title="5-Why analysis"
            description="A single chain is enough for an internal complaint."
            entries={draft.singleChain}
            readOnly={readOnly}
            onChange={(entries) => setDraft({ ...draft, singleChain: entries })}
          />

          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Root cause" required>
              <Textarea rows={3} value={draft.rootCause} disabled={readOnly} onChange={(event) => setDraft({ ...draft, rootCause: event.target.value })} />
            </Field>
            <Field label="Root cause category" hint="Same 6M plus Management and Supplier list used by external complaints.">
              <Select
                value={draft.rootCauseCategory}
                disabled={readOnly}
                onChange={(event) => setDraft({ ...draft, rootCauseCategory: event.target.value })}
              >
                <option value="">Not classified</option>
                {(configuration.data?.rootCauseCategories ?? []).map((entry) => (
                  <option key={entry._id} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Corrective action taken" hint="Formal CAPA items are managed in the CAPA tab.">
              <Textarea
                rows={3}
                value={draft.correctiveAction}
                disabled={readOnly}
                onChange={(event) => setDraft({ ...draft, correctiveAction: event.target.value })}
              />
            </Field>
            <Field label="Evidence reference">
              <Textarea rows={3} value={draft.evidence} disabled={readOnly} onChange={(event) => setDraft({ ...draft, evidence: event.target.value })} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={draft.problem ? "green" : "amber"}>Problem statement {draft.problem ? "recorded" : "missing"}</StatusBadge>
            <StatusBadge tone={filled >= 3 ? "green" : "amber"}>5-Why chain {filled}/3</StatusBadge>
            <StatusBadge tone={draft.rootCause ? "green" : "amber"}>Root cause {draft.rootCause ? "recorded" : "missing"}</StatusBadge>
          </div>
        </div>
      </SectionCard>

      {!readOnly ? (
        <div className="flex justify-end">
          <Button onClick={onSave} disabled={save.isPending}>
            <Save className="h-4 w-4" />
            {save.isPending ? "Saving" : "Save investigation"}
          </Button>
        </div>
      ) : null}

      <SignatureBlock complaint={complaint} canEdit={canEdit} />
    </TabPanel>
  );
}

