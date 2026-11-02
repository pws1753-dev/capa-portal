import { connectDB } from "../config/db";
import { EscalationConfiguration } from "../models/configuration";
import { isSunday, shouldRunScheduledEmails, type ScheduleDecision } from "../domain/email-schedule";

type Job = "reminders" | "escalations";

/**
 * Called by the cron endpoints before a job runs.
 *
 * - "reminders" (the one-day-before-due reminder) runs every day while automatic emails are enabled; each
 *   stage is reminded only once, so the daily run cannot repeat an email.
 * - "escalations" (overdue reminders) follows the frequency saved on the Escalation Rules tab (weekly,
 *   Monday morning by default). The run is claimed atomically so two overlapping cron calls cannot both send.
 */
export async function claimScheduledRun(job: Job): Promise<ScheduleDecision> {
  await connectDB();
  const config = await EscalationConfiguration.findOne({ company: null }).lean();
  const enabled = config?.autoEmailEnabled ?? true;
  if (job === "reminders") {
    if (enabled && isSunday(new Date())) return { run: false, reason: "No automatic emails on Sunday" };
    return enabled ? { run: true, reason: "Daily due-date reminder check" } : { run: false, reason: "Automatic emails are switched off" };
  }

  const lastRunAt = config?.lastEscalationRunAt ?? null;
  const decision = shouldRunScheduledEmails({ enabled, frequencyDays: config?.frequencyDays ?? 7, lastRunAt });
  if (!decision.run) return decision;

  try {
    const claimed = await EscalationConfiguration.findOneAndUpdate(
      { company: null, lastEscalationRunAt: lastRunAt },
      { $set: { lastEscalationRunAt: new Date() } },
      { upsert: true, new: true }
    );
    if (!claimed) return { run: false, reason: "Another run already claimed this slot" };
  } catch {
    // The upsert collides with the existing configuration when another run changed lastEscalationRunAt first.
    return { run: false, reason: "Another run already claimed this slot" };
  }
  return decision;
}
