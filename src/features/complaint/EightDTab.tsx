import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { D6_DOCUMENT_STATUSES } from "@shared/constants/domain";
import { SectionCard } from "@/components/ui/Cards";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/toast-context";
import { ApiError } from "@/lib/api";
import {
  useApiMutation,
  useAttachments,
  useConfiguration,
  useMasterBootstrap,
  type ActionRow,
  type ComplaintDetail,
  type D6Document
} from "@/services/queries";
import { ActionRowsEditor, BlockedReasons, FishbonePanels, TabPanel, WhyChainEditor } from "./shared";
import { SignatureBlock } from "./SignatureBlock";

type Draft = {
  d0: string;
  d1Team: NonNullable<ComplaintDetail["d1Team"]>;
  d2: Record<string, string>;
  d3Actions: ActionRow[];
  d4QcTools: string[];
  d4Occurrence: string;
  d4Escape: string;
  d4Systemic: string;
  rootCauseCategory: string;
  fiveWhy: { occurrence: string[]; escape: string[]; systemic: string[] };
  fishbone: Record<string, string[]>;
  d5Occurrence: ActionRow[];
  d5Escape: ActionRow[];
  d5Systemic: ActionRow[];
  d5Safety: string;
  d6Verify: ActionRow[];
  d6DocsList: D6Document[];
  d6Horizontal: string;
  d7ShortTermDate: string;
  d7RepeatObserved: boolean;
  d7Regulatory: string;
  d7Actions: ActionRow[];
  d7LongTermDate: string;
  d7LongTermRepeatObserved: boolean;
  d7LongTermResult: string;
  d7LongTermNotes: string;
  d8Recognition: string;
  d8ReviewedBy: string;
  d8ClosedDate: string;
};

function toDraft(complaint: ComplaintDetail): Draft {
  return {
    d0: complaint.d0 ?? "",
    d1Team: complaint.d1Team ?? [],
    d2: { what: "", where: "", when: "", who: "", involved: "", howMany: "", how: "", ...(complaint.d2 ?? {}) },
    d3Actions: complaint.d3Actions ?? [],
    d4QcTools: complaint.d4QcTools ?? [],
    d4Occurrence: complaint.d4Occurrence ?? "",
    d4Escape: complaint.d4Escape ?? "",
    d4Systemic: complaint.d4Systemic ?? "",
    rootCauseCategory: complaint.rootCauseCategory ?? "",
    fiveWhy: {
      occurrence: complaint.fiveWhy?.occurrence ?? [],
      escape: complaint.fiveWhy?.escape ?? [],
      systemic: complaint.fiveWhy?.systemic ?? []
    },
    fishbone: complaint.fishbone ?? {},
    d5Occurrence: complaint.d5Occurrence ?? [],
    d5Escape: complaint.d5Escape ?? [],
    d5Systemic: complaint.d5Systemic ?? [],
    d5Safety: complaint.d5Safety ?? "",
    d6Verify: complaint.d6Verify ?? [],
    d6DocsList: complaint.d6DocsList ?? [],
    d6Horizontal: complaint.d6Horizontal ?? "",
    d7ShortTermDate: complaint.d7ShortTermDate ?? "",
    d7RepeatObserved: Boolean(complaint.d7RepeatObserved),
    d7Regulatory: complaint.d7Regulatory ?? "",
    d7Actions: [],
    d7LongTermDate: complaint.d7LongTermDate ?? "",
    d7LongTermRepeatObserved: Boolean(complaint.d7LongTermRepeatObserved),
    d7LongTermResult: complaint.d7LongTermResult ?? "",
    d7LongTermNotes: complaint.d7LongTermNotes ?? "",
    d8Recognition: complaint.d8Recognition ?? "",
    d8ReviewedBy: complaint.d8ReviewedBy ?? "",
    d8ClosedDate: complaint.d8ClosedDate ?? ""
  };
}

const D_SECTION_TITLES: Record<string, string> = {
  D0: "Emergency response and immediate action",
  D1: "Cross-functional team",
  D2: "Problem description (5W2H)",
  D3: "Interim containment actions",
  D4: "Root cause analysis",
  D5: "Permanent corrective actions",
  D6: "Verification and horizontal deployment",
  D7: "Prevent recurrence and effectiveness",
  D8: "Closure and team recognition"
};

function DBanner({ code }: { code: keyof typeof D_SECTION_TITLES }) {
  return (
    <span className="flex items-center gap-2">
      <span className="rounded bg-brand-red px-2 py-0.5 text-xs font-bold text-white">{code}</span>
      <span>{D_SECTION_TITLES[code]}</span>
    </span>
  );
}

export function EightDTab({
  complaint,
  canEdit,
  targetDates
}: {
  complaint: ComplaintDetail;
  canEdit: boolean;
  targetDates: { d3: string; d5: string; d6: string };
}) {
  const toast = useToast();
  const configuration = useConfiguration(complaint.company);
  const master = useMasterBootstrap();
  const attachments = useAttachments("Complaint", complaint._id);
  const [draft, setDraft] = useState<Draft>(() => toDraft(complaint));
  const [issues, setIssues] = useState<{ field: string; message: string; section?: string }[]>([]);

  useEffect(() => {
    setDraft(toDraft(complaint));
  }, [complaint]);

  const save = useApiMutation<{ complaint: ComplaintDetail }, Partial<Draft>>("PATCH", `/api/complaints/${complaint._id}/8d`, [
    ["complaint", complaint._id]
  ]);

  const readOnly = !canEdit;
  const fishboneCategories = configuration.data?.fishboneCategories ?? [];
  const qcTools = configuration.data?.qcTools ?? [];
  const rootCauseCategories = configuration.data?.rootCauseCategories ?? [];
  const employees = master.data?.employees ?? [];

  const chainState = useMemo(
    () => ({
      occurrence: draft.fiveWhy.occurrence.filter((entry) => entry.trim()).length,
      escape: draft.fiveWhy.escape.filter((entry) => entry.trim()).length,
      systemic: draft.fiveWhy.systemic.filter((entry) => entry.trim()).length
    }),
    [draft.fiveWhy]
  );

  async function onSave() {
    setIssues([]);
    try {
      await save.mutateAsync({
        ...draft,
        d7LongTermResult: draft.d7LongTermResult === "" ? "" : draft.d7LongTermResult
      });
      toast.success("8D report saved", "Every change is recorded in the audit trail.");
    } catch (error) {
      if (error instanceof ApiError) setIssues(error.issues);
      toast.failure(error, "The 8D report could not be saved");
    }
  }

  return (
    <TabPanel>
      {readOnly ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          You have read-only access to this 8D report. Editing needs a complaint edit permission and an open complaint.
        </div>
      ) : null}

      <BlockedReasons title="The server rejected this save" issues={issues} />

      <SectionCard title={<DBanner code="D0" />}>
        <Field label="Emergency response taken to contain the immediate risk">
          <Textarea rows={3} value={draft.d0} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d0: event.target.value })} />
        </Field>
      </SectionCard>

      <SectionCard
        title={<DBanner code="D1" />}
        description="Pick people from the employee master so the name, department and designation stay consistent."
      >
        <div className="space-y-2">
          {draft.d1Team.map((member, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <Field label="Employee">
                  <Select
                    value={member.employee ?? ""}
                    disabled={readOnly}
                    onChange={(event) => {
                      const employee = employees.find((entry) => entry._id === event.target.value);
                      setDraft({
                        ...draft,
                        d1Team: draft.d1Team.map((row, position) =>
                          position === index
                            ? {
                                ...row,
                                employee: event.target.value || undefined,
                                name: employee?.name ?? row.name,
                                designation: employee?.designation ?? row.designation,
                                email: employee?.email ?? row.email
                              }
                            : row
                        )
                      });
                    }}
                  >
                    <option value="">Enter manually</option>
                    {employees.map((employee) => (
                      <option key={employee._id} value={employee._id}>
                        {employee.name} ({employee.employeeCode})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="lg:col-span-2">
                <Field label="Name">
                  <Input
                    value={member.name ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        d1Team: draft.d1Team.map((row, position) => (position === index ? { ...row, name: event.target.value } : row))
                      })
                    }
                  />
                </Field>
              </div>
              <div className="lg:col-span-2">
                <Field label="Department">
                  <Input
                    value={member.dept ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        d1Team: draft.d1Team.map((row, position) => (position === index ? { ...row, dept: event.target.value } : row))
                      })
                    }
                  />
                </Field>
              </div>
              <div className="lg:col-span-2">
                <Field label="Designation">
                  <Input
                    value={member.designation ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        d1Team: draft.d1Team.map((row, position) => (position === index ? { ...row, designation: event.target.value } : row))
                      })
                    }
                  />
                </Field>
              </div>
              <div className="lg:col-span-3">
                <Field label="Responsibility">
                  <div className="flex gap-2">
                    <Input
                      value={member.role ?? ""}
                      disabled={readOnly}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          d1Team: draft.d1Team.map((row, position) => (position === index ? { ...row, role: event.target.value } : row))
                        })
                      }
                    />
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10 w-10 shrink-0 px-0 text-brand-red hover:bg-red-50"
                        aria-label={`Remove team member ${index + 1}`}
                        onClick={() => setDraft({ ...draft, d1Team: draft.d1Team.filter((_, position) => position !== index) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </Field>
              </div>
            </div>
          ))}
          {draft.d1Team.length === 0 ? <p className="text-xs text-slate-500">No team members recorded yet.</p> : null}
          {!readOnly ? (
            <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, d1Team: [...draft.d1Team, {}] })}>
              <Plus className="h-4 w-4" />
              Add team member
            </Button>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title={<DBanner code="D2" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { key: "what", label: "What is the problem", required: true },
            { key: "where", label: "Where was it detected" },
            { key: "when", label: "When did it occur" },
            { key: "who", label: "Who detected it" },
            { key: "involved", label: "Who is involved" },
            { key: "howMany", label: "How many are affected" },
            { key: "how", label: "How was it detected" }
          ].map((entry) => (
            <Field key={entry.key} label={entry.label} required={entry.required}>
              <Textarea
                rows={2}
                value={draft.d2[entry.key] ?? ""}
                disabled={readOnly}
                onChange={(event) => setDraft({ ...draft, d2: { ...draft.d2, [entry.key]: event.target.value } })}
              />
            </Field>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={<DBanner code="D3" />}
        description={`Target dates default to ${targetDates.d3} from the configured containment window and the complaint priority.`}
      >
        <ActionRowsEditor
          company={complaint.company}
          rows={draft.d3Actions}
          onChange={(rows) => setDraft({ ...draft, d3Actions: rows })}
          readOnly={readOnly}
          defaultTarget={targetDates.d3}
        />
      </SectionCard>

      <SectionCard title={<DBanner code="D4" />}>
        <div className="space-y-4">
          <Field label="QC tools used" hint="At least one tool is required before the RCA stage can be completed.">
            <div className="flex flex-wrap gap-2">
              {qcTools.map((tool) => {
                const checked = draft.d4QcTools.includes(tool);
                return (
                  <label
                    key={tool}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                      checked ? "border-brand-red bg-red-50 text-brand-red" : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-red"
                      checked={checked}
                      disabled={readOnly}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          d4QcTools: checked ? draft.d4QcTools.filter((entry) => entry !== tool) : [...draft.d4QcTools, tool]
                        })
                      }
                    />
                    {tool}
                  </label>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-3 lg:grid-cols-3">
            <Field label="Occurrence root cause" required>
              <Textarea rows={3} value={draft.d4Occurrence} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d4Occurrence: event.target.value })} />
            </Field>
            <Field label="Escape root cause" required>
              <Textarea rows={3} value={draft.d4Escape} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d4Escape: event.target.value })} />
            </Field>
            <Field label="Systemic root cause" required>
              <Textarea rows={3} value={draft.d4Systemic} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d4Systemic: event.target.value })} />
            </Field>
          </div>

          <Field label="Root cause category (6M plus Management and Supplier)" hint="Drives the systemic breakdown on the dashboard.">
            <Select value={draft.rootCauseCategory} disabled={readOnly} onChange={(event) => setDraft({ ...draft, rootCauseCategory: event.target.value })}>
              <option value="">Not classified</option>
              {rootCauseCategories.map((entry) => (
                <option key={entry._id} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-3 xl:grid-cols-3">
            <WhyChainEditor
              title="5-Why: occurrence"
              description="Why the defect was produced."
              entries={draft.fiveWhy.occurrence}
              readOnly={readOnly}
              onChange={(entries) => setDraft({ ...draft, fiveWhy: { ...draft.fiveWhy, occurrence: entries } })}
            />
            <WhyChainEditor
              title="5-Why: escape"
              description="Why it was not detected before it reached the customer."
              entries={draft.fiveWhy.escape}
              readOnly={readOnly}
              onChange={(entries) => setDraft({ ...draft, fiveWhy: { ...draft.fiveWhy, escape: entries } })}
            />
            <WhyChainEditor
              title="5-Why: systemic"
              description="Why the management system allowed it."
              entries={draft.fiveWhy.systemic}
              readOnly={readOnly}
              onChange={(entries) => setDraft({ ...draft, fiveWhy: { ...draft.fiveWhy, systemic: entries } })}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-brand-charcoal">Fishbone analysis</p>
            <FishbonePanels
              categories={fishboneCategories}
              values={draft.fishbone}
              readOnly={readOnly}
              onChange={(values) => setDraft({ ...draft, fishbone: values })}
            />
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <StatusBadge tone={chainState.occurrence >= 3 ? "green" : "amber"}>Occurrence chain {chainState.occurrence}/3</StatusBadge>
            <StatusBadge tone={chainState.escape >= 3 ? "green" : "amber"}>Escape chain {chainState.escape}/3</StatusBadge>
            <StatusBadge tone={chainState.systemic >= 3 ? "green" : "amber"}>Systemic chain {chainState.systemic}/3</StatusBadge>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={<DBanner code="D5" />} description={`Suggested target ${targetDates.d5}.`}>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-bold text-brand-charcoal">Occurrence corrective actions</p>
            <ActionRowsEditor
          company={complaint.company}
              rows={draft.d5Occurrence}
              onChange={(rows) => setDraft({ ...draft, d5Occurrence: rows })}
              readOnly={readOnly}
              defaultTarget={targetDates.d5}
              showCustomerApproval
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-brand-charcoal">Escape corrective actions</p>
            <ActionRowsEditor
          company={complaint.company}
              rows={draft.d5Escape}
              onChange={(rows) => setDraft({ ...draft, d5Escape: rows })}
              readOnly={readOnly}
              defaultTarget={targetDates.d5}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-bold text-brand-charcoal">Systemic corrective actions</p>
            <ActionRowsEditor
          company={complaint.company}
              rows={draft.d5Systemic}
              onChange={(rows) => setDraft({ ...draft, d5Systemic: rows })}
              readOnly={readOnly}
              defaultTarget={targetDates.d5}
            />
          </div>
          <Field label="Safety concerns">
            <Textarea rows={2} value={draft.d5Safety} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d5Safety: event.target.value })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title={<DBanner code="D6" />} description={`Suggested verification target ${targetDates.d6}.`}>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-bold text-brand-charcoal">Verification actions</p>
            <ActionRowsEditor
          company={complaint.company}
              rows={draft.d6Verify}
              onChange={(rows) => setDraft({ ...draft, d6Verify: rows })}
              readOnly={readOnly}
              defaultTarget={targetDates.d6}
              showCtq
            />
          </div>

          <div>
            <p className="mb-1 text-sm font-bold text-brand-charcoal">Document update checklist</p>
            <p className="mb-2 text-xs text-slate-500">
              Each document must be marked Attached with a revision, date, approver and linked file, or NA with a justification of at least ten
              characters. Closure is blocked until every row is resolved.
            </p>
            <div className="space-y-2">
              {draft.d6DocsList.map((document, index) => (
                <div key={document.docType} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="grid gap-2 lg:grid-cols-12">
                    <div className="lg:col-span-3">
                      <Field label="Document">
                        <Input value={document.docType} disabled readOnly />
                      </Field>
                    </div>
                    <div className="lg:col-span-2">
                      <Field label="Status">
                        <Select
                          value={document.status}
                          disabled={readOnly}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              d6DocsList: draft.d6DocsList.map((row, position) =>
                                position === index ? { ...row, status: event.target.value as D6Document["status"] } : row
                              )
                            })
                          }
                        >
                          {D6_DOCUMENT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    {document.status === "Attached" ? (
                      <>
                        <div className="lg:col-span-2">
                          <Field label="Revision">
                            <Input
                              value={document.revision ?? ""}
                              disabled={readOnly}
                              placeholder="Rev 04"
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  d6DocsList: draft.d6DocsList.map((row, position) =>
                                    position === index ? { ...row, revision: event.target.value } : row
                                  )
                                })
                              }
                            />
                          </Field>
                        </div>
                        <div className="lg:col-span-2">
                          <Field label="Revision date">
                            <Input
                              type="date"
                              value={document.revDate ?? ""}
                              disabled={readOnly}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  d6DocsList: draft.d6DocsList.map((row, position) =>
                                    position === index ? { ...row, revDate: event.target.value } : row
                                  )
                                })
                              }
                            />
                          </Field>
                        </div>
                        <div className="lg:col-span-2">
                          <Field label="Approver">
                            <Input
                              value={document.approver ?? ""}
                              disabled={readOnly}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  d6DocsList: draft.d6DocsList.map((row, position) =>
                                    position === index ? { ...row, approver: event.target.value } : row
                                  )
                                })
                              }
                            />
                          </Field>
                        </div>
                        <div className="lg:col-span-12">
                          <Field label="Linked attachment" hint="Upload the file in the Attachments tab first.">
                            <Select
                              value={document.attachment ?? ""}
                              disabled={readOnly}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  d6DocsList: draft.d6DocsList.map((row, position) =>
                                    position === index ? { ...row, attachment: event.target.value || null } : row
                                  )
                                })
                              }
                            >
                              <option value="">Not linked</option>
                              {(attachments.data?.attachments ?? []).map((entry) => (
                                <option key={entry._id} value={entry._id}>
                                  {entry.originalFilename}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                      </>
                    ) : null}
                    {document.status === "NA" ? (
                      <div className="lg:col-span-7">
                        <Field label="Why is this document not applicable" hint="Minimum ten characters.">
                          <Input
                            value={document.naJustification ?? ""}
                            disabled={readOnly}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                d6DocsList: draft.d6DocsList.map((row, position) =>
                                  position === index ? { ...row, naJustification: event.target.value } : row
                                )
                              })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Field label="Horizontal deployment and lessons learnt">
            <Textarea rows={3} value={draft.d6Horizontal} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d6Horizontal: event.target.value })} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title={<DBanner code="D7" />}>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-bold text-brand-charcoal">Short term review</p>
            <Field label="Effectivity date or serial">
              <Input value={draft.d7ShortTermDate} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d7ShortTermDate: event.target.value })} />
            </Field>
            <Field label="Repeat observed in the short term window">
              <Select
                value={draft.d7RepeatObserved ? "Yes" : "No"}
                disabled={readOnly}
                onChange={(event) => setDraft({ ...draft, d7RepeatObserved: event.target.value === "Yes" })}
              >
                <option>No</option>
                <option>Yes</option>
              </Select>
            </Field>
            <Field label="Regulatory or safety notification">
              <Textarea rows={2} value={draft.d7Regulatory} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d7Regulatory: event.target.value })} />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-bold text-brand-charcoal">Long term review</p>
            <Field label="Long term verification date">
              <Input type="date" value={draft.d7LongTermDate} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d7LongTermDate: event.target.value })} />
            </Field>
            <Field label="Repeat observed in the long term window">
              <Select
                value={draft.d7LongTermRepeatObserved ? "Yes" : "No"}
                disabled={readOnly}
                onChange={(event) => setDraft({ ...draft, d7LongTermRepeatObserved: event.target.value === "Yes" })}
              >
                <option>No</option>
                <option>Yes</option>
              </Select>
            </Field>
            <Field
              label="Long term result"
              hint="Recording Not Sustained on a closed complaint reopens it automatically and notifies the owner."
            >
              <Select value={draft.d7LongTermResult} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d7LongTermResult: event.target.value })}>
                <option value="">Pending</option>
                <option value="Sustained">Sustained</option>
                <option value="Not Sustained">Not Sustained</option>
              </Select>
            </Field>
            <Field label="Long term notes">
              <Textarea rows={2} value={draft.d7LongTermNotes} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d7LongTermNotes: event.target.value })} />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={<DBanner code="D8" />}>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Field label="Recognition and closing remarks">
              <Textarea rows={3} value={draft.d8Recognition} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d8Recognition: event.target.value })} />
            </Field>
          </div>
          <div className="space-y-3">
            <Field label="Reviewed by">
              <Input value={draft.d8ReviewedBy} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d8ReviewedBy: event.target.value })} />
            </Field>
            <Field label="Closed date">
              <Input type="date" value={draft.d8ClosedDate} disabled={readOnly} onChange={(event) => setDraft({ ...draft, d8ClosedDate: event.target.value })} />
            </Field>
          </div>
        </div>
      </SectionCard>

      {!readOnly ? (
        <div className="sticky bottom-0 -mx-3 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:-mx-5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Saving records an audit entry and keeps the workflow gates up to date.</p>
            <Button onClick={onSave} disabled={save.isPending}>
              <Save className="h-4 w-4" />
              {save.isPending ? "Saving" : "Save 8D report"}
            </Button>
          </div>
        </div>
      ) : null}

      <SignatureBlock complaint={complaint} canEdit={canEdit} />
    </TabPanel>
  );
}

