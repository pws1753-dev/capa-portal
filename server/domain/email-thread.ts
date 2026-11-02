import { escapeHtml } from "../lib/email-template-renderer";

/** One earlier email in a complaint's thread (only what the banner needs). */
export type ThreadEntry = {
  triggerEvent: string;
  createdAt: Date;
  automated?: boolean | null;
  reminderCount?: number | null;
  daysDelayed?: number | null;
};

const TRIGGER_LABELS: Record<string, string> = {
  TAT_REMINDER: "Due-date reminder",
  TAT_DUE_SOON: "Due-date reminder",
  TAT_DELAY_DAILY: "Delay reminder",
  CAPA_DUE_REMINDER: "CAPA due-date reminder",
  CAPA_OVERDUE: "CAPA overdue reminder",
  EFFECTIVENESS_REVIEW_DUE: "Effectiveness review reminder"
};

export const triggerLabel = (trigger: string) => TRIGGER_LABELS[trigger] ?? trigger;

const dateText = (date: Date) => new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** Strips any "Re:" / "Fwd:" prefixes so every mail in a thread carries the same base subject. */
export function baseSubject(subject: string): string {
  return subject.replace(/^\s*((re|fwd?)\s*:\s*)+/i, "").trim();
}

/** The subject of a follow-up in a thread: the root subject with a single "Re:". */
export function threadSubject(rootSubject: string): string {
  return `Re: ${baseSubject(rootSubject)}`;
}

/** Reminder number for a new automated email: earlier automated emails in the thread, plus this one. */
export function nextReminderCount(prior: ThreadEntry[]): number {
  return prior.filter((entry) => entry.automated).length + 1;
}

export function daysDelayedText(daysDelayed: number): string {
  if (daysDelayed <= 0) return "Not yet delayed (due soon)";
  return `${daysDelayed} day${daysDelayed === 1 ? "" : "s"} delayed`;
}

/** Banner placed in every automated email: reminder number, days delayed, and the earlier reminders. */
export function buildReminderBanner(input: { reminderCount: number; daysDelayed: number; prior: ThreadEntry[] }) {
  const history = input.prior.filter((entry) => entry.automated);
  const rows = history
    .map((entry, index) => ({
      count: entry.reminderCount ?? index + 1,
      date: dateText(entry.createdAt),
      label: triggerLabel(entry.triggerEvent),
      delay: daysDelayedText(entry.daysDelayed ?? 0)
    }))
    .slice(-10);
  const heading = `Reminder #${input.reminderCount} · ${daysDelayedText(input.daysDelayed)}`;

  const historyHtml = rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;width:100%;border-collapse:collapse;font-size:12px;color:#334155;">
        <tr><td style="padding:4px 6px;font-weight:700;border-bottom:1px solid #fecaca;">#</td><td style="padding:4px 6px;font-weight:700;border-bottom:1px solid #fecaca;">Sent</td><td style="padding:4px 6px;font-weight:700;border-bottom:1px solid #fecaca;">Reminder</td><td style="padding:4px 6px;font-weight:700;border-bottom:1px solid #fecaca;">Status then</td></tr>
        ${rows
          .map(
            (row) =>
              `<tr><td style="padding:4px 6px;">${row.count}</td><td style="padding:4px 6px;">${escapeHtml(row.date)}</td><td style="padding:4px 6px;">${escapeHtml(row.label)}</td><td style="padding:4px 6px;">${escapeHtml(row.delay)}</td></tr>`
          )
          .join("")}
      </table>`
    : "";

  const html = `
              <div style="margin:16px 0;padding:14px 16px;background-color:#fef2f2;border-left:3px solid #E31E25;border-radius:4px;color:#7f1d1d;font-size:13px;line-height:1.5;">
                <strong style="font-size:14px;">${escapeHtml(heading)}</strong>
                ${rows.length ? `<div style="margin-top:6px;color:#475569;">Previous reminders in this thread:</div>` : `<div style="margin-top:6px;color:#475569;">This is the first reminder in this thread. Later reminders will be added to the same thread.</div>`}
                ${historyHtml}
              </div>`;
  const text = [
    "",
    heading,
    ...(rows.length
      ? ["Previous reminders in this thread:", ...rows.map((row) => `  #${row.count} - ${row.date} - ${row.label} - ${row.delay}`)]
      : ["This is the first reminder in this thread."])
  ].join("\n");
  return { html, text, heading };
}

/** Inserts the banner before the footer (or at the end when the template has no footer marker). */
export function applyReminderBanner(body: { html: string; text: string }, banner: { html: string; text: string }) {
  const footerMarker = "          <!-- Footer -->";
  const html = body.html.includes(footerMarker) ? body.html.replace(footerMarker, `${banner.html}\n${footerMarker}`) : `${body.html}${banner.html}`;
  return { html, text: `${body.text}\n${banner.text}` };
}
