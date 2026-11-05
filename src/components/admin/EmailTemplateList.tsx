import { useState, useMemo, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Eye, Edit, Send, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Select } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { EMAIL_TRIGGER_EVENTS, EMAIL_TRIGGER_LABELS, type EmailTriggerEvent } from "@shared/constants/domain";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { EmailTemplateForm, type TemplateData } from "./EmailTemplateForm";
import { EmailRecipientRules } from "./EmailRecipientRules";
import { EMAIL_DEFAULT_RECIPIENTS } from "@shared/constants/email-recipients";

type PreviewResult = {
  subject: string;
  html: string;
  text: string;
  missingVariables: string[];
  sampleDataUsed: Record<string, string | number>;
};

export function EmailTemplateList() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("ALL");
  const [editingTemplate, setEditingTemplate] = useState<TemplateData | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Preview Modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Test Send Modal state
  const [testSendOpen, setTestSendOpen] = useState(false);
  const [testSendTemplate, setTestSendTemplate] = useState<TemplateData | null>(null);
  const [targetRecipient, setTargetRecipient] = useState("");
  const [testSendResult, setTestSendResult] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => api<TemplateData[]>("/api/email/templates")
  });

  const previewMutation = useMutation({
    mutationFn: (params: { id: string; htmlBody?: string; subject?: string }) =>
      api<PreviewResult>(`/api/email/templates/${params.id}/preview`, {
        method: "POST",
        body: JSON.stringify({
          htmlBody: params.htmlBody,
          subject: params.subject
        })
      }),
    onSuccess: (data: PreviewResult) => {
      setPreviewData(data);
      setPreviewOpen(true);
      setPreviewLoading(false);
    },
    onError: () => {
      setPreviewLoading(false);
    }
  });

  const testSendMutation = useMutation({
    mutationFn: (params: { id: string; to: string }) =>
      api(`/api/email/templates/${params.id}/test-send`, {
        method: "POST",
        body: JSON.stringify({ to: params.to })
      }),
    onSuccess: () => {
      setTestSendResult("Test email sent successfully! Check Email Logs.");
      queryClient.invalidateQueries({ queryKey: ["email-logs"] });
    },
    onError: (err: Error) => {
      setTestSendResult(`Failed to send test email: ${errorText(err, "Try again.")}`);
    }
  });

  const templates = templatesQuery.data || [];

  const filteredTemplates = useMemo(() => {
    return templates.filter((t: TemplateData) => {
      const matchSearch =
        !searchTerm ||
        t.templateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.templateKey.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.subject.toLowerCase().includes(searchTerm.toLowerCase());

      const matchTrigger = triggerFilter === "ALL" || t.triggerEvent === triggerFilter;
      return matchSearch && matchTrigger;
    });
  }, [templates, searchTerm, triggerFilter]);

  const handleOpenPreview = (tmpl: TemplateData) => {
    setPreviewLoading(true);
    previewMutation.mutate({ id: tmpl._id || tmpl.triggerEvent });
  };

  const handleOpenLivePreviewFromForm = async (htmlBody: string, subject: string, trigger: string) => {
    setPreviewLoading(true);
    try {
      const res = await api<PreviewResult>(`/api/email/templates/${trigger}/preview`, {
        method: "POST",
        body: JSON.stringify({
          htmlBody,
          subject
        })
      });
      setPreviewData(res);
      setPreviewOpen(true);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleOpenTestSend = (tmpl: TemplateData) => {
    setTestSendTemplate(tmpl);
    setTargetRecipient("");
    setTestSendResult(null);
    setTestSendOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-brand-charcoal">Notification Templates ({templates.length})</h2>
          <p className="text-xs text-slate-500">
            Centrally managed email templates rendered on system events, turnaround-time milestones, and escalations.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setEditingTemplate(null);
            setIsFormOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Create Template
        </Button>
      </div>

      <EmailRecipientRules />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search templates by name, key, or subject..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-xs text-brand-charcoal placeholder:text-slate-400 focus:border-brand-red focus:outline-hidden"
          />
        </div>

        <div className="w-64">
          <Select value={triggerFilter} onChange={(e) => setTriggerFilter(e.target.value)}>
            <option value="ALL">All Event Triggers</option>
            {EMAIL_TRIGGER_EVENTS.map((evt) => (
              <option key={evt} value={evt}>
                {EMAIL_TRIGGER_LABELS[evt]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Templates Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/80 font-bold text-slate-600">
              <tr>
                <th className="px-4 py-3">Template Name &amp; Key</th>
                <th className="px-4 py-3">Domain Trigger Event</th>
                <th className="px-4 py-3">Default Subject</th>
                <th className="px-4 py-3">To / CC</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTemplates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    {templatesQuery.isLoading ? "Loading templates..." : "No email templates found matching filters."}
                  </td>
                </tr>
              ) : (
                filteredTemplates.map((t: TemplateData) => (
                  <tr key={t._id || t.templateKey} className="transition hover:bg-slate-50/50">
                    <td className="px-4 py-3 align-top">
                      <div className="font-bold text-brand-charcoal">{t.templateName}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-slate-400">{t.templateKey}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {EMAIL_TRIGGER_LABELS[t.triggerEvent as EmailTriggerEvent] || t.triggerEvent}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top max-w-xs truncate text-slate-600">
                      {t.subject}
                    </td>
                    <td className="px-4 py-3 align-top text-[11px] leading-4 text-slate-600">
                      <div>
                        <strong className="text-slate-700">To:</strong> {EMAIL_DEFAULT_RECIPIENTS[t.triggerEvent]?.to || "—"}
                        {(t.toEmails?.length ?? 0) > 0 ? <span className="text-brand-red"> + {t.toEmails?.join(", ")}</span> : null}
                      </div>
                      <div>
                        <strong className="text-slate-700">CC:</strong> {EMAIL_DEFAULT_RECIPIENTS[t.triggerEvent]?.cc || "—"}
                        {(t.ccRules?.length ?? 0) > 0 ? <span className="text-brand-red"> + {t.ccRules?.join(", ")}</span> : null}
                      </div>
                      {(t.excludeEmails?.length ?? 0) > 0 ? <div className="text-red-700">Removed: {t.excludeEmails?.join(", ")}</div> : null}
                    </td>
                    <td className="px-4 py-3 align-top text-center">
                      {t.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                          <XCircle className="h-3 w-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          onClick={() => handleOpenPreview(t)}
                          title="Preview with sample data"
                          className="h-8 px-2 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5 text-slate-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleOpenTestSend(t)}
                          title="Send test email"
                          className="h-8 px-2 text-xs"
                        >
                          <Send className="h-3.5 w-3.5 text-slate-500" />
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditingTemplate(t);
                            setIsFormOpen(true);
                          }}
                          className="h-8 px-2.5 text-xs"
                        >
                          <Edit className="mr-1 h-3 w-3 text-slate-500" /> Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        title={editingTemplate ? `Edit: ${editingTemplate.templateName}` : "Create New Email Template"}
      >
        <EmailTemplateForm
          initialData={editingTemplate}
          onClose={() => setIsFormOpen(false)}
          onPreview={handleOpenLivePreviewFromForm}
        />
      </Modal>

      {/* Live Preview Modal */}
      <Modal open={previewOpen} onOpenChange={setPreviewOpen} title="Email Layout Live Preview">
        {previewLoading ? (
          <div className="flex h-64 items-center justify-center text-xs text-slate-400">
            Rendering preview...
          </div>
        ) : previewData ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="font-semibold text-slate-700">Subject:</div>
              <div className="font-bold text-brand-charcoal">{previewData.subject}</div>
              {previewData.missingVariables.length > 0 && (
                <div className="mt-1 text-[11px] text-amber-700">
                  <strong>Note:</strong> Missing variable substitutions: {previewData.missingVariables.join(", ")}
                </div>
              )}
            </div>

            <div className="max-h-[460px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
              <iframe
                title="Email HTML Preview"
                srcDoc={previewData.html}
                className="h-[420px] w-full border-0"
                sandbox="allow-same-origin"
              />
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
                Close Preview
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Test Send Modal */}
      <Modal
        open={testSendOpen}
        onOpenChange={setTestSendOpen}
        title={`Test Send: ${testSendTemplate?.templateName || ""}`}
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-slate-500">
            Sends a live email using this template with sample variables populated.
          </p>
          <Field label="Target Email Address" required>
            <Input
              type="email"
              placeholder="test.user@onepws.com"
              value={targetRecipient}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetRecipient(e.target.value)}
            />
          </Field>

          {testSendResult && (
            <div
              className={`rounded-lg p-3 text-xs font-medium ${
                testSendResult.startsWith("Failed")
                  ? "border border-red-200 bg-red-50 text-brand-red"
                  : "border border-green-200 bg-green-50 text-green-800"
              }`}
            >
              {testSendResult}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setTestSendOpen(false)}>
              Done
            </Button>
            <Button
              variant="primary"
              disabled={!targetRecipient.includes("@") || testSendMutation.isPending}
              onClick={() => {
                if (testSendTemplate?._id) {
                  testSendMutation.mutate({
                    id: testSendTemplate._id,
                    to: targetRecipient
                  });
                }
              }}
            >
              {testSendMutation.isPending ? "Sending..." : "Send Test Now"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
