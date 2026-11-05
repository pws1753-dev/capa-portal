import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type PersonOption = { name: string; hint?: string };

/** Names are stored as one comma separated string, as before, so existing records keep working. */
export function splitNames(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Dropdown that picks one or more people from the master employee list. A name typed by hand is
 * still allowed for someone who is not in the list yet.
 */
export function PersonMultiSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Select responsible persons"
}: {
  value: string | undefined;
  options: PersonOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const selected = splitNames(value);
  const selectedKeys = new Set(selected.map((name) => name.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return options.filter((option) => !term || option.name.toLowerCase().includes(term) || (option.hint ?? "").toLowerCase().includes(term));
  }, [options, search]);

  function toggle(name: string) {
    const next = selectedKeys.has(name.toLowerCase()) ? selected.filter((entry) => entry.toLowerCase() !== name.toLowerCase()) : [...selected, name];
    onChange(next.join(", "));
  }

  function addCustom() {
    const name = custom.trim().replace(/,/g, " ");
    if (!name) return;
    if (!selectedKeys.has(name.toLowerCase())) onChange([...selected, name].join(", "));
    setCustom("");
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-left text-sm",
          disabled && "cursor-not-allowed bg-slate-50 opacity-70"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex flex-wrap gap-1">
          {selected.length === 0 ? <span className="px-1 text-slate-400">{placeholder}</span> : null}
          {selected.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
              {name}
              {!disabled ? (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove ${name}`}
                  className="rounded-full hover:bg-slate-200"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.stopPropagation();
                      toggle(name);
                    }
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              ) : null}
            </span>
          ))}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employees"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-red"
            />
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 ? <li className="px-3 py-2 text-xs text-slate-500">No employee matches.</li> : null}
            {visible.map((option) => {
              const checked = selectedKeys.has(option.name.toLowerCase());
              return (
                <li key={option.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(option.name)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", checked ? "border-brand-red bg-brand-red text-white" : "border-slate-300")}>
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="flex-1">
                      {option.name}
                      {option.hint ? <span className="ml-1 text-xs text-slate-400">— {option.hint}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-1 border-t border-slate-100 p-2">
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Not in the list? Type a name"
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-brand-red"
            />
            <button type="button" onClick={addCustom} className="inline-flex items-center rounded-md border border-slate-200 px-2 text-slate-700 hover:bg-slate-50" aria-label="Add name">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
