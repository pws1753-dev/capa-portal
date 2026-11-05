import { connectDB } from "../config/db";
import { Complaint } from "../models/Complaint";
import { Capa } from "../models/Capa";
import { TATConfiguration } from "../models/configuration";
import { DEFAULT_TAT_CONFIG, type WorkflowStage } from "@shared/constants/domain";
import { computeStageDueDates } from "../domain/tat";
import { daysUntil, effectivenessReminderBucket, nextReviewDue } from "../domain/effectiveness-review";
import { isPastDueDay } from "../domain/due-day";
import { istDaysUntil, reminderLookaheadDays } from "../domain/email-schedule";
import { EffectivenessCheck } from "../models/EffectivenessCheck";
import { resolveRecipients } from "./email-recipient.service";
import { sendTemplatedEmail } from "./email.service";

export type ReminderRunResult = {
  complaintsChecked: number;
  complaintRemindersSent: number;
  capasChecked: number;
  capaRemindersSent: number;
  effectivenessRemindersSent: number;
};

/**
 * A run emails at most this many reminders. Complaints closed long ago are all overdue the first
 * time the job sees them; the rest follow on the next days (each reminder is sent only once).
 */
const MAX_EFFECTIVENESS_REMINDERS_PER_RUN = 25;

/**
 * Closed complaints are re-checked every six months after closure. This reminds the complaint
 * owner, Quality Heads and Master Admins as each check approaches, and weekly while it is overdue,
 * until the check is recorded in the Effectiveness Tracker.
 */
async function processEffectivenessReviewReminders(now: Date): Promise<number> {
  let sent = 0;
  const closed = await Complaint.find({ status: "Closed", closedAt: { $ne: null } })
    .select("number customer product description closedAt owner ownerEmployee")
    .populate("owner", "name")
    .populate("ownerEmployee", "name email")
    .lean();
  if (closed.length === 0) return 0;

  const checks = await EffectivenessCheck.find({ complaint: { $in: closed.map((entry) => entry._id) } })
    .select("complaint closedAt")
    .lean();
  const checkClosures = new Map<string, number[]>();
  for (const check of checks) {
    const key = String(check.complaint);
    checkClosures.set(key, [...(checkClosures.get(key) ?? []), check.closedAt.getTime()]);
  }

  const due = closed
    .map((complaint) => {
      const closedAt = new Date(complaint.closedAt as Date);
      // Only checks recorded for this closure count; a reopen and re-close starts the series again.
      const done = (checkClosures.get(String(complaint._id)) ?? []).filter((time) => time === closedAt.getTime()).length;
      const dueAt = nextReviewDue(closedAt, done);
      return { complaint, cycle: done + 1, dueAt, daysLeft: daysUntil(dueAt, now) };
    })
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  for (const { complaint, cycle, dueAt, daysLeft } of due) {
    if (sent >= MAX_EFFECTIVENESS_REMINDERS_PER_RUN) break;
    const bucket = effectivenessReminderBucket(daysLeft);
    if (!bucket) continue;

    const employee = complaint.ownerEmployee as { name?: string; email?: string } | null;
    const recipients = await resolveRecipients({
      complaintId: complaint._id,
      targetRoles: ["Complaint Owner", "Quality Head", "Master Admin"],
      explicitEmails: employee?.email ? [employee.email] : undefined
    });
    if (recipients.length === 0) continue;


    const res = await sendTemplatedEmail({
      triggerEvent: "EFFECTIVENESS_REVIEW_DUE",
      recipients,
      excludeManagement: true,
      dedupeKey: `EFFREV_${complaint._id}_${cycle}_${bucket.key}`,
      relatedComplaintId: complaint._id,
      automated: { daysDelayed: bucket.overdue ? Math.max(0, -daysLeft) : 0 },
      data: {
        complaintNumber: complaint.number,
        customerName: complaint.customer || complaint.product || complaint.description?.slice(0, 80) || "Internal Issue",
        dueDate: dueAt.toLocaleDateString("en-IN"),
        ownerName: employee?.name || (complaint.owner as { name?: string } | null)?.name || "Assigned Owner",
        statusLabel: bucket.overdue ? "OVERDUE" : daysLeft === 0 ? "Due Today" : "Upcoming",
        timingText: bucket.overdue
          ? `overdue by ${-daysLeft} day(s)`
          : daysLeft === 0
            ? "due today"
            : `due in ${daysLeft} day(s), on ${dueAt.toLocaleDateString("en-IN")}`,
        actionUrl: "/effectiveness"
      }
    });
    if (res.status === "sent") sent++;
  }
  return sent;
}

function getActiveStage(c: {
  acknowledgedAt?: Date | null;
  containmentAt?: Date | null;
  rcaAt?: Date | null;
  capaAssignedAt?: Date | null;
}): WorkflowStage | null {
  if (!c.acknowledgedAt) return "ack";
  if (!c.containmentAt) return "cont";
  if (!c.rcaAt) return "rca";
  if (!c.capaAssignedAt) return "capa";
  return null;
}

export async function processReminders(): Promise<ReminderRunResult> {
  await connectDB();
  let complaintRemindersSent = 0;
  let capaRemindersSent = 0;

  const now = new Date();

  // 1. Load Configurations
  const tatConfigDoc = await TATConfiguration.findOne({ company: null }).lean();

  const tatConfig = {
    ackHours: tatConfigDoc?.ackHours ?? DEFAULT_TAT_CONFIG.ackHours,
    containmentDays: tatConfigDoc?.containmentDays ?? DEFAULT_TAT_CONFIG.containmentDays,
    rcaDays: tatConfigDoc?.rcaDays ?? DEFAULT_TAT_CONFIG.rcaDays,
    capaDays: tatConfigDoc?.capaDays ?? DEFAULT_TAT_CONFIG.capaDays,
    d3ContainmentDays: tatConfigDoc?.d3ContainmentDays ?? DEFAULT_TAT_CONFIG.d3ContainmentDays,
    d5CorrectiveActionDays: tatConfigDoc?.d5CorrectiveActionDays ?? DEFAULT_TAT_CONFIG.d5CorrectiveActionDays,
    d6VerificationDays: tatConfigDoc?.d6VerificationDays ?? DEFAULT_TAT_CONFIG.d6VerificationDays,
    d7ShortTermDays: tatConfigDoc?.d7ShortTermDays ?? DEFAULT_TAT_CONFIG.d7ShortTermDays,
    d7LongTermDays: tatConfigDoc?.d7LongTermDays ?? DEFAULT_TAT_CONFIG.d7LongTermDays,
    repeatWindowDays: tatConfigDoc?.repeatWindowDays ?? DEFAULT_TAT_CONFIG.repeatWindowDays,
    dueSoonHours: tatConfigDoc?.dueSoonHours ?? DEFAULT_TAT_CONFIG.dueSoonHours
  };

  // 2. Process Open Complaints
  const openComplaints = await Complaint.find({
    status: { $nin: ["Closed"] }
  })
    .populate("owner", "name email")
    .populate("responsibleDept", "name")
    .populate("priority", "name tatMultiplier")
    .lean();

  for (const complaint of openComplaints) {
    const stage = getActiveStage(complaint);
    if (!stage) continue;

    const multiplier = (complaint.priority as { tatMultiplier?: number })?.tatMultiplier ?? 1;
    const stageDues = computeStageDueDates({ receivedAt: new Date(complaint.receivedAt).toISOString(), priorityMultiplier: multiplier }, tatConfig);
    const targetDate = stageDues[stage];

    // One reminder, the day before the stage's due date. Later reminders (once the stage is late) come
    // from the escalation job, weekly, in the same email thread.
    // Not yet late: the due date's day has not ended.
    if (!isPastDueDay(targetDate, now) && istDaysUntil(targetDate, now) <= reminderLookaheadDays(now)) {
      const recipients = await resolveRecipients({
        complaintId: complaint._id,
        targetRoles: ["Complaint Owner", "Coordinator"]
      });

      if (recipients.length > 0) {
        const res = await sendTemplatedEmail({
          triggerEvent: "TAT_REMINDER",
          recipients,
          dedupeKey: `PREDUE_CMP_${complaint._id}_${stage}`,
          relatedComplaintId: complaint._id,
          automated: { daysDelayed: 0 },
          data: {
            complaintNumber: complaint.number,
            thresholdPct: "100",
            stage: stage.toUpperCase(),
            dueDate: targetDate.toLocaleDateString("en-IN"),
            ownerName: (complaint.owner as { name?: string })?.name || "Assigned Owner",
            priority: (complaint.priority as { name?: string })?.name || "Standard",
            actionUrl: `/complaints/${complaint._id}`
          }
        });
        if (res.status === "sent") complaintRemindersSent++;
      }
    }
  }

  // 3. Process Open CAPAs
  const openCapas = await Capa.find({
    status: { $nin: ["Closed", "Completed", "Under Verification"] }
  })
    .populate("owner", "name email")
    .populate("ownerEmployee", "name email")
    .populate("complaint", "number")
    .lean();

  for (const capa of openCapas) {
    if (!capa.dueDate) continue;
    const targetDate = new Date(capa.dueDate);
    // One reminder the day before the target date; overdue reminders follow weekly in the same thread.
    if (!isPastDueDay(targetDate, now) && istDaysUntil(targetDate, now) <= reminderLookaheadDays(now)) {
      const dedupeKey = `PREDUE_CAPA_${capa._id}`;
      const recipients = await resolveRecipients({
        capaId: capa._id,
        targetRoles: ["CAPA Owner"]
      });

      if (recipients.length > 0) {
        const res = await sendTemplatedEmail({
          triggerEvent: "CAPA_DUE_REMINDER",
          recipients,
          dedupeKey,
          relatedCapaId: capa._id,
          automated: { daysDelayed: 0 },
          data: {
            capaNumber: capa.number,
            capaTitle: capa.action || "Corrective Action",
            targetDate: targetDate.toLocaleDateString("en-IN"),
            assignedTo: (capa.ownerEmployee as { name?: string } | null)?.name || (capa.owner as { name?: string })?.name || "CAPA Owner",
            actionUrl: `/capa/tracker`
          }
        });
        if (res.status === "sent") capaRemindersSent++;
      }
    }
  }

  const effectivenessRemindersSent = await processEffectivenessReviewReminders(now);

  return {
    complaintsChecked: openComplaints.length,
    complaintRemindersSent,
    capasChecked: openCapas.length,
    capaRemindersSent,
    effectivenessRemindersSent
  };
}
