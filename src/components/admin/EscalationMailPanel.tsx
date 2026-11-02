import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, ShieldAlert, CheckCircle2, AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";

type EscalationConfig = {
  active: boolean;
  levels: Array<{ level: number; name: string; triggerHoursOverdue: number }>;
  reminderPercentages: number[];
  autoEmailEnabled?: boolean;
  frequencyDays?: number;
};

type EscalationRunResult = {
  complaintsChecked: number;
  complaintsEscalated: number;
  capasChecked: number;
  capasEscalated: number;
};

export function EscalationMailPanel() {
  const queryClient = useQueryClient();
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const [frequencyInput, setFrequencyInput] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: ["escalation-config"],
    queryFn: async () => (await api<{ escalation: EscalationConfig }>("/api/configuration")).escalation
  });

  const saveMutation = useMutation({
    mutationFn: (patch: { autoEmailEnabled?: boolean; frequencyDays?: number }) => {
      const current = configQuery.data;
      return api("/api/configuration/escalation", {
        method: "PUT",
        body: JSON.stringify({
          company: null,
          levels: current?.levels,
          reminderPercentages: current?.reminderPercentages,
          active: current?.active ?? true,
          autoEmailEnabled: current?.autoEmailEnabled ?? true,
          frequencyDays: current?.frequencyDays ?? 7,
          ...patch
        })
      });
    },
    onSuccess: () => {
      setFrequencyInput(null);
      setRunMessage("Escalation run completed: schedule settings saved.");
      queryClient.invalidateQueries({ queryKey: ["escalation-config"] });
      queryClient.invalidateQueries({ queryKey: ["configuration"] });
    },
    onError: (err: Error) => setRunMessage(`Escalation run failed: could not save settings. ${errorText(err, "Try again.")}`)
  });

  const runMutation = useMutation({
    mutationFn: () =>
      api<EscalationRunResult>("/api/email/escalation/run", {
        method: "POST"
      }),
    onSuccess: (data: EscalationRunResult) => {
      setRunMessage(
        `Escalation run completed: Checked ${data.complaintsChecked} open complaints (${data.complaintsEscalated} escalated), ${data.capasChecked} CAPAs (${data.capasEscalated} escalated).`
      );
      queryClient.invalidateQueries({ queryKey: ["email-logs"] });
    },
    onError: (err: Error) => {
      setRunMessage(`Escalation run failed: ${errorText(err, "Try again.")}`);
    }
  });

  const config = configQuery.data;
  const autoEnabled = config?.autoEmailEnabled ?? true;
  const frequencyDays = config?.frequencyDays ?? 7;
  const levels = config?.levels || [
    { level: 1, name: "Owner", triggerHoursOverdue: 0 },
    { level: 2, name: "Department Head", triggerHoursOverdue: 24 },
    { level: 3, name: "Quality Head", triggerHoursOverdue: 72 },
    { level: 4, name: "Management", triggerHoursOverdue: 168 }
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-brand-charcoal">Overdue Escalation Automation</h2>
            <p className="text-xs text-slate-500">
              Automatic escalation chain governed by the central Escalation Master Configuration.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
          >
            <Send className={`mr-1.5 h-3.5 w-3.5 ${runMutation.isPending ? "animate-pulse" : ""}`} />
            {runMutation.isPending ? "Evaluating..." : "Run Escalation Check Now"}
          </Button>
        </div>

        {/* Automatic sending schedule */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={autoEnabled}
              aria-label="Automatic email sending"
              disabled={!config || saveMutation.isPending}
              onClick={() => saveMutation.mutate({ autoEmailEnabled: !autoEnabled })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${autoEnabled ? "bg-green-600" : "bg-slate-300"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${autoEnabled ? "left-[22px]" : "left-0.5"}`} />
            </button>
            <div>
              <p className="text-sm font-bold text-brand-charcoal">
                Automatic emails: {autoEnabled ? "Enabled" : "Disabled"}
              </p>
              <p className="text-xs text-slate-500">
                {autoEnabled
                  ? frequencyDays === 7
                    ? "Reminder and escalation emails go out every Monday morning, then wait a full week."
                    : `Reminder and escalation emails repeat every ${frequencyDays} day(s).`
                  : "Scheduled reminder and escalation emails are paused. “Run Escalation Check Now” still works."}
              </p>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs font-semibold text-slate-600">
              Repeat every (days)
              <input
                type="number"
                min={1}
                max={90}
                value={frequencyInput ?? String(frequencyDays)}
                onChange={(event) => setFrequencyInput(event.target.value)}
                className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <Button
              variant="secondary"
              disabled={!config || saveMutation.isPending || frequencyInput === null || !(Number(frequencyInput) >= 1 && Number(frequencyInput) <= 90 && Number.isInteger(Number(frequencyInput)))}
              onClick={() => saveMutation.mutate({ frequencyDays: Number(frequencyInput) })}
            >
              Save frequency
            </Button>
          </div>
        </div>

        {runMessage && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg p-3 text-xs font-semibold ${
              runMessage.startsWith("Escalation run completed")
                ? "border border-green-200 bg-green-50 text-green-800"
                : "border border-red-200 bg-red-50 text-brand-red"
            }`}
          >
            {runMessage.startsWith("Escalation run completed") ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-brand-red" />
            )}
            <span>{runMessage}</span>
          </div>
        )}

        {/* Tier Cards */}
        <div className="mt-6 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Escalation Chain &amp; Recipient Hierarchy
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {levels.map((lvl) => (
              <div
                key={lvl.level}
                className="relative flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4 transition hover:border-slate-300"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-brand-red/10 px-2 py-0.5 text-[10px] font-bold text-brand-red">
                      Level {lvl.level}
                    </span>
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="mt-2 text-sm font-bold text-brand-charcoal">{lvl.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Triggers when overdue by <strong className="text-slate-800">{lvl.triggerHoursOverdue} hrs</strong>
                  </p>
                </div>
                <div className="mt-4 border-t border-slate-200/60 pt-2 text-[10px] text-slate-400">
                  Template: <code className="text-slate-600">tat-escalation</code>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Milestone Reminders Config */}
        <div className="mt-6 rounded-lg border border-slate-100 bg-slate-50/80 p-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-brand-red" />
            <h4 className="text-xs font-bold text-slate-700">Due-Date Reminder &amp; Email Thread</h4>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            The Complaint/CAPA Owner gets one reminder <strong>1 day before the due date</strong>. After that, overdue reminders go out{" "}
            <strong>{frequencyDays === 7 ? "every Monday morning" : `every ${frequencyDays} day(s)`}</strong> in the same email thread, each showing the reminder count and days delayed.
          </p>
        </div>

        {/* Single Source of Truth Note */}
        <div className="mt-4 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
          <span>
            <strong>Single Source of Truth:</strong> Thresholds and levels are synced with Master Data &amp; Governance configuration.
          </span>
          <a
            href="/master-data"
            className="flex items-center gap-1 font-bold text-blue-700 hover:underline"
          >
            Configure Rules <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
