import { connectDB } from "../config/db";
import { Complaint } from "../models/Complaint";
import { Capa } from "../models/Capa";
import { TATConfiguration } from "../models/configuration";
import { DEFAULT_TAT_CONFIG } from "@shared/constants/domain";
import { computeStageDueDates } from "../domain/tat";
import { startOfTodayIST } from "../domain/due-day";
import { lateText, stageDelays, stageStatusText } from "../domain/tat-delay";
import { getEmailRouting } from "./email-routing.service";
import { resolveRecipients } from "./email-recipient.service";
import { sendTemplatedEmail } from "./email.service";

export type EscalationRunResult = {
  complaintsChecked: number;
  complaintsEscalated: number;
  capasChecked: number;
  capasEscalated: number;
};

const unique = (emails: string[]) => Array.from(new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)));

/**
 * Reminders for delayed work. The cron gate (Escalation Rules tab) runs this once per interval, weekly by default.
 *
 * Each run, for a complaint with a delayed TAT stage (Acknowledgement, Containment, RCA Completion or
 * CAPA Assignment that is incomplete and past its due date) its owner gets one email listing all
 * four stages, until they are completed. The copy list is the common mailboxes plus the department's
 * Manager and HOD. Management is never copied; it gets only the monthly summary.
 */
export async function processEscalations(): Promise<EscalationRunResult> {
  await connectDB();
  let complaintsEscalated = 0;
  let capasEscalated = 0;

  const { commonCc } = await getEmailRouting();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

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

  // 1. Open complaints with at least one delayed TAT stage
  const openComplaints = await Complaint.find({ status: { $nin: ["Closed"] } })
    .populate("owner", "name email")
    .populate("ownerEmployee", "name email")
    .populate("responsibleDept", "name")
    .populate("priority", "name tatMultiplier")
    .lean();

  for (const complaint of openComplaints) {
    const multiplier = (complaint.priority as { tatMultiplier?: number })?.tatMultiplier ?? 1;
    const dues = computeStageDueDates({ receivedAt: new Date(complaint.receivedAt).toISOString(), priorityMultiplier: multiplier }, tatConfig);
    const delays = stageDelays(
      dues,
      { ack: complaint.acknowledgedAt, cont: complaint.containmentAt, rca: complaint.rcaAt, capa: complaint.capaAssignedAt },
      now
    );
    const delayed = delays.filter((entry) => entry.delayed);
    if (delayed.length === 0) continue; // nothing is late, or every late stage has been completed

    const maxOverdueHours = Math.max(...delayed.map((entry) => entry.overdueHours));

    // To: the people who have to act. The complaint owner always; for a late CAPA Assignment also the
    // owners of the complaint's open CAPA actions.
    const ownerEmployee = complaint.ownerEmployee as { name?: string; email?: string } | null;
    let to = await resolveRecipients({
      complaintId: complaint._id,
      targetRoles: ["Complaint Owner"],
      explicitEmails: ownerEmployee?.email ? [ownerEmployee.email] : undefined
    });
    if (delayed.some((entry) => entry.stage === "capa")) {
      const openCapas = await Capa.find({ complaint: complaint._id, status: { $nin: ["Closed", "Completed"] } }).select("_id").lean();
      for (const capa of openCapas) {
        to = to.concat(await resolveRecipients({ capaId: capa._id, targetRoles: ["CAPA Owner"] }));
      }
    }

    // CC: the common mailboxes (the department Manager and HOD are added by the mail service). Management
    // is never copied on reminders; it receives only the monthly summary report.
    let cc = [...commonCc];

    // A complaint with no reachable owner still has to be chased: the common mailboxes become the recipients.
    to = unique(to);
    if (to.length === 0) {
      to = [...commonCc];
      cc = cc.filter((email) => !commonCc.includes(email));
    }

    const status = Object.fromEntries(delays.map((entry) => [entry.stage, stageStatusText(entry)])) as Record<(typeof delays)[number]["stage"], string>;
    const res = await sendTemplatedEmail({
      triggerEvent: "TAT_DELAY_DAILY",
      recipients: to,
      cc: unique(cc),
      excludeManagement: true,
      dedupeKey: `TATDELAY_${complaint._id}_${todayStr}`,
      relatedComplaintId: complaint._id,
      automated: { daysDelayed: Math.floor(maxOverdueHours / 24) },
      data: {
        statusLabel: "Delayed",
        complaintNumber: complaint.number,
        delayedCount: String(delayed.length),
        maxDaysLate: lateText(maxOverdueHours),
        ackStatus: status.ack,
        contStatus: status.cont,
        rcaStatus: status.rca,
        capaStatus: status.capa,
        customerName: complaint.customer || complaint.product || complaint.description?.slice(0, 80) || "Internal Issue",
        departmentName: (complaint.responsibleDept as { name?: string })?.name || "General",
        ownerName: ownerEmployee?.name || (complaint.owner as { name?: string })?.name || "Assigned Owner",
        priority: (complaint.priority as { name?: string })?.name || "Standard",
        escalationNote: "Management receives only the monthly summary report.",
        actionUrl: `/complaints/${complaint._id}`
      }
    });
    if (res.status === "sent") complaintsEscalated++;
  }

  // 2. Overdue CAPAs: same rule, Management is never copied
  const overdueCapas = await Capa.find({
    status: { $nin: ["Closed", "Completed", "Under Verification"] },
    dueDate: { $lt: startOfTodayIST(now) }
  })
    .populate("owner", "name email")
    .populate("ownerEmployee", "name email")
    .populate("complaint", "number")
    .lean();

  for (const capa of overdueCapas) {
    if (!capa.dueDate) continue;
    const targetDate = new Date(capa.dueDate);
    const dedupeKey = `ESCALATION_CAPA_${capa._id}_${todayStr}`;

    const recipients = await resolveRecipients({
      capaId: capa._id,
      targetRoles: ["CAPA Owner", "Department Head"]
    });

    if (recipients.length > 0) {
      const res = await sendTemplatedEmail({
        triggerEvent: "CAPA_OVERDUE",
        recipients,
        excludeManagement: true,
        dedupeKey,
        relatedCapaId: capa._id,
        automated: { daysDelayed: Math.floor((now.getTime() - targetDate.getTime()) / 86400000) },
        data: {
          capaNumber: capa.number,
          assignedTo: (capa.ownerEmployee as { name?: string } | null)?.name || (capa.owner as { name?: string })?.name || "CAPA Owner",
          targetDate: targetDate.toLocaleDateString("en-IN"),
          complaintNumber: (capa.complaint as { number?: string })?.number || "N/A",
          actionUrl: `/capa/tracker`
        }
      });
      if (res.status === "sent") capasEscalated++;
    }
  }

  return {
    complaintsChecked: openComplaints.length,
    complaintsEscalated,
    capasChecked: overdueCapas.length,
    capasEscalated
  };
}
