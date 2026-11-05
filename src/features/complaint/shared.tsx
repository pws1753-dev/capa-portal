import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ALLOWED_UPLOAD_MIME_TYPES, type AttachmentPurpose } from "@shared/constants/domain";
import { FileText, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { PersonMultiSelect, type PersonOption } from "@/components/ui/PersonMultiSelect";
import { useAssignableUsers, type ActionRow } from "@/services/queries";

/** A small Cloudinary-resized copy for list rows; any other URL is used unchanged. */
function thumbnailUrl(url: string) {
  return url.includes("/upload/") ? url.replace("/upload/", "/upload/c_fill,w_96,h_96,q_auto/") : url;
}

/** Image files show a thumbnail that opens a larger preview; other files keep a plain file icon. */
export function AttachmentThumb({ file }: { file: { secureUrl: string; originalFilename: string; mimeType: string } }) {
  const [open, setOpen] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  if (!file.mimeType.startsWith("image/")) return <FileText className="h-5 w-5 shrink-0 text-slate-400" />;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 hover:ring-2 hover:ring-brand-red/40"
        title="Preview image"
        aria-label={`Preview ${file.originalFilename}`}
      >
        <img
          src={thumbFailed ? file.secureUrl : thumbnailUrl(file.secureUrl)}
          alt={file.originalFilename}
          loading="lazy"
          onError={() => setThumbFailed(true)}
          className="h-full w-full object-cover"
        />
      </button>
      <Modal open={open} onOpenChange={setOpen} title={file.originalFilename}>
        <img src={file.secureUrl} alt={file.originalFilename} className="mx-auto max-h-[65vh] w-auto max-w-full rounded-md object-contain" />
        <div className="mt-3 text-right">
          <a href={file.secureUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-red hover:underline">
            Open original
          </a>
        </div>
      </Modal>
    </>
  );
}

export const ACTION_STATUSES =["Open", "In Progress", "Completed", "Verified"];

/** Reusable D3 / D5 / D6 action table with responsibility, target date and status. */
export function ActionRowsEditor({
  rows,
  onChange,
  readOnly,
  showCtq,
  showCustomerApproval,
  defaultTarget,
  company
}: {
  rows: ActionRow[];
  onChange: (rows: ActionRow[]) => void;
  readOnly: boolean;
  showCtq?: boolean;
  showCustomerApproval?: boolean;
  defaultTarget?: string;
  company?: string;
}) {
  const people = useAssignableUsers(company);
  const options = useMemo(() => {
    const seen = new Set<string>();
    const list: PersonOption[] = [];
    for (const user of people.data?.users ?? []) list.push({ name: user.name, hint: user.role });
    for (const employee of people.data?.employees ?? []) list.push({ name: employee.name, hint: employee.designation });
    return list
      .filter((option) => {
        const key = option.name.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data]);

  function update(index: number, patch: Partial<ActionRow>) {
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? <p className="text-xs text-slate-500">No rows yet.</p> : null}
      {rows.map((row, index) => (
        <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="grid gap-2 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Field label="Action">
                <Textarea rows={2} value={row.action ?? ""} disabled={readOnly} onChange={(event) => update(index, { action: event.target.value })} />
              </Field>
            </div>
            <div className="lg:col-span-3">
              <Field label="Responsibility">
                <PersonMultiSelect value={row.resp} options={options} disabled={readOnly} onChange={(resp) => update(index, { resp })} />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Target date">
                <Input type="date" value={row.target ?? ""} disabled={readOnly} onChange={(event) => update(index, { target: event.target.value })} />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Status">
                <Select value={row.status ?? "Open"} disabled={readOnly} onChange={(event) => update(index, { status: event.target.value })}>
                  {ACTION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {showCtq ? (
              <div className="lg:col-span-6">
                <Field label="CTQ impact">
                  <Input value={row.ctqImpact ?? ""} disabled={readOnly} onChange={(event) => update(index, { ctqImpact: event.target.value })} />
                </Field>
              </div>
            ) : null}
            {showCustomerApproval ? (
              <div className="lg:col-span-6">
                <Field label="Customer approval">
                  <Input
                    value={row.customerApproval ?? ""}
                    disabled={readOnly}
                    onChange={(event) => update(index, { customerApproval: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}
          </div>
          {!readOnly ? (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-brand-red hover:bg-red-50"
                onClick={() => onChange(rows.filter((_, position) => position !== index))}
              >
                <Trash2 className="h-4 w-4" />
                Remove row
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {!readOnly ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...rows, { action: "", resp: "", target: defaultTarget ?? "", status: "Open" }])}
        >
          <Plus className="h-4 w-4" />
          Add row
        </Button>
      ) : null}
    </div>
  );
}

/** Repeated-row 5-Why entry. Each answer becomes the question for the next step. */
export function WhyChainEditor({
  title,
  description,
  entries,
  onChange,
  readOnly,
  minimum = 3
}: {
  title: string;
  description?: string;
  entries: string[];
  onChange: (entries: string[]) => void;
  readOnly: boolean;
  minimum?: number;
}) {
  const filled = entries.filter((entry) => entry && entry.trim()).length;
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-brand-charcoal">{title}</p>
          {description ? <p className="text-xs text-slate-500">{description}</p> : null}
        </div>
        <span className={cn("text-xs font-semibold", filled >= minimum ? "text-green-700" : "text-amber-600")}>
          {filled} of at least {minimum} recorded
        </span>
      </div>
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="mt-2 w-14 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-400">Why {index + 1}</span>
            <Textarea
              rows={2}
              className="flex-1"
              value={entry}
              disabled={readOnly}
              placeholder={index === 0 ? "Why did the problem occur?" : "Why did that happen?"}
              onChange={(event) => onChange(entries.map((value, position) => (position === index ? event.target.value : value)))}
            />
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                className="mt-1 h-9 w-9 px-0 text-brand-red hover:bg-red-50"
                aria-label={`Remove why ${index + 1}`}
                onClick={() => onChange(entries.filter((_, position) => position !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {!readOnly ? (
        <Button type="button" variant="secondary" className="mt-2" onClick={() => onChange([...entries, ""])} disabled={entries.length >= 10}>
          <Plus className="h-4 w-4" />
          Add why
        </Button>
      ) : null}
    </div>
  );
}

/** Structured fishbone panels. Clearer to fill in than a decorative diagram. */
export function FishbonePanels({
  categories,
  values,
  onChange,
  readOnly
}: {
  categories: string[];
  values: Record<string, string[]>;
  onChange: (values: Record<string, string[]>) => void;
  readOnly: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {categories.map((category) => {
        const entries = values[category] ?? [];
        return (
          <div key={category} className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-bold text-brand-charcoal">{category}</p>
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={entry}
                    disabled={readOnly}
                    placeholder="Potential cause"
                    onChange={(event) =>
                      onChange({ ...values, [category]: entries.map((value, position) => (position === index ? event.target.value : value)) })
                    }
                  />
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 px-0 text-brand-red hover:bg-red-50"
                      aria-label={`Remove ${category} cause ${index + 1}`}
                      onClick={() => onChange({ ...values, [category]: entries.filter((_, position) => position !== index) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {entries.length === 0 ? <p className="text-xs text-slate-500">No causes recorded.</p> : null}
            </div>
            {!readOnly ? (
              <Button
                type="button"
                variant="ghost"
                className="mt-2 h-9 px-2"
                onClick={() => onChange({ ...values, [category]: [...entries, ""] })}
              >
                <Plus className="h-4 w-4" />
                Add cause
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export type UploadTarget = { entityType: "Complaint" | "Capa" | "Company"; entityId: string; purpose: AttachmentPurpose; company?: string };

type SignatureResponse = { timestamp: number; folder: string; signature: string; apiKey: string; cloudName: string; maxBytes: number };

/**
 * Signed direct upload. The file goes straight from the browser to Cloudinary and
 * only the resulting public id is confirmed with the API, so no secret is exposed
 * and no binary passes through the server.
 */
export function useCloudinaryUpload(target: UploadTarget) {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const mimeType = file.type || "application/octet-stream";
        if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType)) {
          throw new Error(`${file.name}: this file type (${mimeType}) is not supported. Use an image, PDF, Office file, CSV, text, email (.eml/.msg) or MP4/MOV video.`);
        }
        const signature = await api<SignatureResponse>("/api/attachments/signature", {
          method: "POST",
          body: JSON.stringify({ purpose: target.purpose })
        });
        if (file.size > signature.maxBytes) {
          throw new Error(`${file.name} is larger than the ${Math.round(signature.maxBytes / (1024 * 1024))} MB limit`);
        }

        const body = new FormData();
        body.append("file", file);
        body.append("api_key", signature.apiKey);
        body.append("timestamp", String(signature.timestamp));
        body.append("folder", signature.folder);
        body.append("signature", signature.signature);

        const response = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/auto/upload`, { method: "POST", body });
        if (!response.ok) throw new Error("The file could not be uploaded to the media service");
        const uploaded = (await response.json()) as { public_id?: string };
        if (!uploaded.public_id) throw new Error("The media service did not return an asset reference");

        return api<{ attachment: { _id: string; originalFilename: string } }>("/api/attachments/confirm", {
          method: "POST",
          body: JSON.stringify({
            publicId: uploaded.public_id,
            originalFilename: file.name,
            mimeType,
            entityType: target.entityType,
            entityId: target.entityId,
            purpose: target.purpose,
            company: target.company
          })
        });
      } finally {
        setUploading(false);
      }
    },
    [target.company, target.entityId, target.entityType, target.purpose]
  );

  return { upload, uploading };
}

export function UploadButton({
  label = "Upload file",
  disabled,
  uploading,
  onFiles
}: {
  label?: string;
  disabled?: boolean;
  uploading?: boolean;
  onFiles: (files: FileList) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50",
        (disabled || uploading) && "cursor-not-allowed opacity-60"
      )}
    >
      <Upload className="h-4 w-4" />
      {uploading ? "Uploading" : label}
      <input
        type="file"
        multiple
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </label>
  );
}

/** Blocking requirements returned by a 422, grouped by section. */
export function BlockedReasons({ title, issues }: { title: string; issues: { field: string; message: string; section?: string }[] }) {
  if (issues.length === 0) return null;
  const grouped = issues.reduce<Record<string, string[]>>((accumulator, issue) => {
    const section = issue.section ?? "Required";
    accumulator[section] = [...(accumulator[section] ?? []), issue.message];
    return accumulator;
  }, {});
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-bold text-red-900">{title}</p>
      <div className="mt-2 space-y-2">
        {Object.entries(grouped).map(([section, messages]) => (
          <div key={section}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-red-700">{section}</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs text-red-900">
              {messages.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TabPanel({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}
