import { useState } from "react";
import { Plus, X } from "lucide-react";

const EMAIL_PATTERN = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;

/**
 * A list of email addresses an administrator can add to and remove from. Several addresses can be
 * pasted at once, separated by commas, spaces or semicolons.
 */
export function EmailListEditor({
  label,
  hint,
  value,
  onChange,
  disabled,
  tone = "default"
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (emails: string[]) => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const entries = draft
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (entries.length === 0) return;
    const invalid = entries.filter((entry) => !EMAIL_PATTERN.test(entry));
    if (invalid.length > 0) {
      setError(`Not a valid email address: ${invalid.join(", ")}`);
      return;
    }
    onChange(Array.from(new Set([...value, ...entries])));
    setDraft("");
    setError(null);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-slate-700">{label}</p>
      {hint ? <p className="text-[11px] leading-4 text-slate-500">{hint}</p> : null}
      <div className="flex min-h-[2rem] flex-wrap gap-1.5">
        {value.length === 0 ? <span className="text-xs text-slate-400">None</span> : null}
        {value.map((email) => (
          <span
            key={email}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
              tone === "danger" ? "bg-red-50 text-red-800" : "bg-slate-100 text-slate-800"
            }`}
          >
            {email}
            {!disabled ? (
              <button type="button" aria-label={`Remove ${email}`} className="rounded-full hover:bg-black/10" onClick={() => onChange(value.filter((entry) => entry !== email))}>
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {!disabled ? (
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="name@onepws.com"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-red"
            aria-label={`Add to ${label}`}
          />
          <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-brand-red">{error}</p> : null}
    </div>
  );
}
