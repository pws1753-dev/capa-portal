import { useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Save, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { EMAIL_TRIGGER_EVENTS, EMAIL_TRIGGER_LABELS, type EmailTriggerEvent } from "@shared/constants/domain";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { EmailTemplateVariableHelper } from "./EmailTemplateVariableHelper";
import { EmailListEditor } from "./EmailListEditor";
import { EMAIL_DEFAULT_RECIPIENTS } from "@shared/constants/email-recipients";

export type TemplateData = {
  _id?: string;
  templateKey: string;
  templateName: string;
  triggerEvent: EmailTriggerEvent;
  subject: string;
  htmlBody: string;
  textBody: string;
  supportedVariables: string[];
  isActive: boolean;
  /** Extra fixed To / CC / BCC addresses, and addresses never sent this email. */
  toEmails?: string[];
  ccRules?: string[];
  bccRules?: string[];
  excludeEmails?: string[];
};

type EmailTemplateFormProps = {
  initialData?: TemplateData | null;
  onClose: () => void;
  onPreview: (html: string, subject: string, trigger: string) => void;
};

export function EmailTemplateForm({ initialData, onClose, onPreview }: EmailTemplateFormProps) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(initialData?._id);

  const [form, setForm] = useState<TemplateData>({
    _id: initialData?._id,
    templateKey: initialData?.templateKey || "",
    templateName: initialData?.templateName || "",
    triggerEvent: initialData?.triggerEvent || "COMPLAINT_CREATED",
    subject: initialData?.subject || "",
    htmlBody: initialData?.htmlBody || "",
    textBody: initialData?.textBody || "",
    supportedVariables: initialData?.supportedVariables || [],
    isActive: initialData?.isActive !== undefined ? initialData.isActive : true,
    toEmails: initialData?.toEmails ?? [],
    ccRules: initialData?.ccRules ?? [],
    bccRules: initialData?.bccRules ?? [],
    excludeEmails: initialData?.excludeEmails ?? []
  });

  const [activeTab, setActiveTab] = useState<"html" | "text">("html");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setErrorMessage(null);
      if (isEditing && initialData?._id) {
        return api(`/api/email/templates/${initialData._id}`, {
          method: "PATCH",
          body: JSON.stringify({
            templateName: form.templateName,
            triggerEvent: form.triggerEvent,
            subject: form.subject,
            htmlBody: form.htmlBody,
            textBody: form.textBody,
            isActive: form.isActive,
            toEmails: form.toEmails,
            ccRules: form.ccRules,
            bccRules: form.bccRules,
            excludeEmails: form.excludeEmails
          })
        });
      }
      return api("/api/email/templates", {
        method: "POST",
        body: JSON.stringify(form)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      onClose();
    },
    onError: (err: Error) => {
      setErrorMessage(errorText(err, "Failed to save email template"));
    }
  });

  const insertVariable = (variableToken: string) => {
    if (activeTab === "html") {
      setForm((prev) => ({ ...prev, htmlBody: prev.htmlBody + variableToken }));
    } else {
      setForm((prev) => ({ ...prev, textBody: prev.textBody + variableToken }));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div>
          <h3 className="text-base font-bold text-brand-charcoal">
            {isEditing ? `Edit Template: ${initialData?.templateName}` : "Create New Email Template"}
          </h3>
          <p className="text-xs text-slate-500">
            Define corporate HTML structure, plain-text fallback, and dynamic variables.
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} className="h-8 w-8 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-brand-red">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template Display Name" required>
          <Input
            value={form.templateName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, templateName: e.target.value })}
            placeholder="e.g. Complaint Acknowledged"
          />
        </Field>

        <Field label="Template Key (Unique Identifier)" required>
          <Input
            value={form.templateKey}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, templateKey: e.target.value })}
            disabled={isEditing}
            placeholder="e.g. complaint-acknowledged"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Trigger Event" required>
          <Select
            value={form.triggerEvent}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setForm({ ...form, triggerEvent: e.target.value as EmailTriggerEvent })}
          >
            {EMAIL_TRIGGER_EVENTS.map((evt) => (
              <option key={evt} value={evt}>
                {EMAIL_TRIGGER_LABELS[evt]} ({evt})
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-center gap-2 pt-6">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-brand-red focus:ring-brand-red"
            />
            <span>Active Template (Enabled for automated delivery)</span>
          </label>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <div>
          <p className="text-sm font-bold text-brand-charcoal">Recipients (To / CC)</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Automatic recipients for this event: <strong>To</strong> {EMAIL_DEFAULT_RECIPIENTS[form.triggerEvent]?.to || "—"}
            {" · "}
            <strong>CC</strong> {EMAIL_DEFAULT_RECIPIENTS[form.triggerEvent]?.cc || "—"}. Add or remove addresses below; changes apply to every email sent with this template.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <EmailListEditor label="Also send To" value={form.toEmails ?? []} onChange={(toEmails) => setForm({ ...form, toEmails })} />
          <EmailListEditor label="Also CC" value={form.ccRules ?? []} onChange={(ccRules) => setForm({ ...form, ccRules })} />
          <EmailListEditor label="Also BCC" value={form.bccRules ?? []} onChange={(bccRules) => setForm({ ...form, bccRules })} />
          <EmailListEditor
            label="Remove these addresses from this email"
            hint="Never sent this email, wherever the address comes from (including Manager/HOD from the Employee Directory)."
            value={form.excludeEmails ?? []}
            onChange={(excludeEmails) => setForm({ ...form, excludeEmails })}
            tone="danger"
          />
        </div>
      </div>

      <Field label="Email Subject Line" required>
        <Input
          value={form.subject}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, subject: e.target.value })}
          placeholder="e.g. Complaint {{complaintNumber}} Acknowledged by {{ownerName}}"
        />
      </Field>

      <EmailTemplateVariableHelper
        variables={form.supportedVariables}
        onSelectVariable={insertVariable}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between border-b border-slate-200 pb-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("html")}
              className={`border-b-2 px-3 py-1.5 text-xs font-bold transition ${
                activeTab === "html"
                  ? "border-brand-red text-brand-red"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Responsive HTML Body
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("text")}
              className={`border-b-2 px-3 py-1.5 text-xs font-bold transition ${
                activeTab === "text"
                  ? "border-brand-red text-brand-red"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Plain Text Fallback
            </button>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => onPreview(form.htmlBody, form.subject, form.triggerEvent)}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
            Live Preview
          </Button>
        </div>

        {activeTab === "html" ? (
          <Field label="HTML Code (Corporate email layout compatible)">
            <Textarea
              rows={12}
              value={form.htmlBody}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, htmlBody: e.target.value })}
              className="font-mono text-xs leading-relaxed"
            />
          </Field>
        ) : (
          <Field label="Plain Text Alternative (For non-HTML clients)">
            <Textarea
              rows={12}
              value={form.textBody}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, textBody: e.target.value })}
              className="font-mono text-xs leading-relaxed"
            />
          </Field>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => saveMutation.mutate()}
          disabled={!form.templateName || !form.subject || !form.htmlBody || saveMutation.isPending}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saveMutation.isPending ? "Saving..." : isEditing ? "Update Template" : "Create Template"}
        </Button>
      </div>
    </div>
  );
}
