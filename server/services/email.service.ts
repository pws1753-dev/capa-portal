import { Types } from "mongoose";
import { getAppUrl } from "../lib/app-url";
import { DEFAULT_EMAIL_LOGO_URL } from "../lib/email-layout";
import { escapeHtml, renderTemplate } from "../lib/email-template-renderer";
import { COMMON_CC_EMAILS, EXTERNAL_ADDRESS_MESSAGE, excludesManagementByDefault, splitByEmailPolicy } from "../lib/email-policy";
import { createTransporter, fromAddress, isSmtpConfigured } from "../lib/mailer";
import { resolveDepartmentCc, resolveRecipientChainCc } from "./email-recipient.service";
import { getActiveTemplateByTrigger } from "./email-template.service";
import { hasDedupeKeyBeenSent, writeEmailLog, getEmailLogById, getThreadHistory } from "./email-log.service";
import { applyReminderBanner, buildReminderBanner, nextReminderCount, threadSubject } from "../domain/email-thread";
import { Capa } from "../models/Capa";
import { randomUUID } from "node:crypto";
import { EmailLog } from "../models/EmailLog";
import { httpError } from "../utils/http";

export type SendTemplatedEmailInput = {
  triggerEvent: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  data: Record<string, string | number | undefined | null>;
  relatedComplaintId?: string | Types.ObjectId;
  relatedCapaId?: string | Types.ObjectId;
  dedupeKey?: string;
  sentBySystem?: boolean;
  /**
   * Whether to leave the department's Management addresses out of the CC (Manager and HOD are still
   * added). When not given, reminders about delay leave them out and every other email keeps them.
   */
  excludeManagement?: boolean;
  /**
   * Marks an automated reminder/escalation. It is numbered within the complaint's thread and shows the
   * reminder count and the days delayed (0 = not yet late). Every email about a complaint or its CAPAs
   * joins one thread; only these are counted as reminders.
   */
  automated?: { daysDelayed: number };
};

export type SendEmailResult = {
  status: "sent" | "failed" | "skipped";
  logId?: string;
  message?: string;
};

function normalizePortalLinks(data: Record<string, string | number | undefined | null>, appUrl: string) {
  const normalized = { ...data };
  for (const [key, value] of Object.entries(normalized)) {
    if (!/(url|link)$/i.test(key) || typeof value !== "string" || !value.startsWith("/")) continue;
    normalized[key] = new URL(value, appUrl).toString();
  }
  return normalized;
}

function appendTemporaryPasswordNotice(html: string, text: string, data: Record<string, string | number | undefined | null>) {
  const tempPassword = typeof data.tempPassword === "string" ? data.tempPassword : "";
  if (!tempPassword) return { html, text };

  const resetUrl = typeof data.resetUrl === "string" ? data.resetUrl : "";
  const safePassword = escapeHtml(tempPassword);
  const safeResetUrl = escapeHtml(resetUrl);
  const noticeHtml = `
              <div style="margin:16px 0;padding:14px 16px;background-color:#fff7ed;border-left:3px solid #f97316;border-radius:4px;color:#7c2d12;font-size:13px;line-height:1.5;">
                <strong>Temporary password:</strong>
                <div style="margin:8px 0 10px;font-family:Consolas,Menlo,monospace;font-size:16px;font-weight:700;letter-spacing:0.04em;color:#1e293b;">${safePassword}</div>
                Use this temporary password only if you need to sign in before creating your new password. Create a new password from the reset link${safeResetUrl ? `: <a href="${safeResetUrl}" target="_blank" style="color:#E31E25;font-weight:700;">${safeResetUrl}</a>` : "."}
              </div>`;
  const footerMarker = "          <!-- Footer -->";
  const nextHtml = html.includes(footerMarker) ? html.replace(footerMarker, `${noticeHtml}\n${footerMarker}`) : `${html}${noticeHtml}`;
  const nextText = `${text}\n\nTemporary password: ${tempPassword}${resetUrl ? `\nCreate a new password: ${resetUrl}` : ""}`;
  return { html: nextHtml, text: nextText };
}

/** Leaves a visible trace in the email log whenever an outside address was refused. */
async function recordBlockedAddresses(input: SendTemplatedEmailInput, blocked: string[]) {
  await writeEmailLog({
    triggerEvent: input.triggerEvent,
    recipients: blocked,
    status: "skipped",
    errorMessage: `Blocked ${blocked.length} external address(es). ${EXTERNAL_ADDRESS_MESSAGE()}.`,
    relatedComplaintId: input.relatedComplaintId,
    relatedCapaId: input.relatedCapaId,
    sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true
  }).catch(() => undefined);
}

async function resolveThreadKey(complaintId?: string | Types.ObjectId, capaId?: string | Types.ObjectId): Promise<string | undefined> {
  if (complaintId) return `CMP_${String(complaintId)}`;
  if (!capaId) return undefined;
  const capa = await Capa.findById(capaId).select("complaint").lean().catch(() => null);
  return capa?.complaint ? `CMP_${String(capa.complaint)}` : `CAPA_${String(capaId)}`;
}

function newMessageId(): string {
  const domain = /@([^>\s]+)>?$/.exec(fromAddress())?.[1] ?? "onepws.com";
  return `<${randomUUID()}@${domain}>`;
}

export async function sendTemplatedEmail(input: SendTemplatedEmailInput): Promise<SendEmailResult> {
  // Portal emails are internal only: a customer or any outside address is dropped before anything is sent.
  const toPolicy = splitByEmailPolicy(input.recipients);
  const ccPolicy = splitByEmailPolicy(input.cc);
  const bccPolicy = splitByEmailPolicy(input.bcc);
  const blockedOnEntry = [...toPolicy.blocked, ...ccPolicy.blocked, ...bccPolicy.blocked];
  input = { ...input, recipients: toPolicy.allowed, cc: ccPolicy.allowed, bcc: bccPolicy.allowed };
  if (blockedOnEntry.length > 0) await recordBlockedAddresses(input, blockedOnEntry);

  if (input.dedupeKey) {
    const alreadySent = await hasDedupeKeyBeenSent(input.dedupeKey);
    if (alreadySent) {
      const skippedLog = await writeEmailLog({
        triggerEvent: input.triggerEvent,
        recipients: input.recipients,
        cc: input.cc,
        bcc: input.bcc,
        status: "skipped",
        errorMessage: `Duplicate event suppressed (dedupeKey: ${input.dedupeKey})`,
        relatedComplaintId: input.relatedComplaintId,
        relatedCapaId: input.relatedCapaId,
        dedupeKey: input.dedupeKey,
        sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true
      });
      return { status: "skipped", logId: String(skippedLog._id), message: "Duplicate event suppressed" };
    }
  }

  const template = await getActiveTemplateByTrigger(input.triggerEvent);
  if (!template) {
    const skippedLog = await writeEmailLog({
      triggerEvent: input.triggerEvent,
      recipients: input.recipients,
      status: "skipped",
      errorMessage: `No active template found for trigger: ${input.triggerEvent}`,
      relatedComplaintId: input.relatedComplaintId,
      relatedCapaId: input.relatedCapaId,
      dedupeKey: input.dedupeKey,
      sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true
    });
    return { status: "skipped", logId: String(skippedLog._id), message: "No active template" };
  }

  const cleanRecipients = (input.recipients || []).filter(Boolean);
  if (cleanRecipients.length === 0) {
    const skippedLog = await writeEmailLog({
      templateKey: template.templateKey,
      triggerEvent: input.triggerEvent,
      recipients: [],
      status: "skipped",
      errorMessage: "No valid recipient email addresses resolved",
      relatedComplaintId: input.relatedComplaintId,
      relatedCapaId: input.relatedCapaId,
      dedupeKey: input.dedupeKey,
      sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true
    });
    return { status: "skipped", logId: String(skippedLog._id), message: "No recipients" };
  }

  // Department-specific emails always CC the Manager and HOD addresses kept in Master Data > Employees.
  // Management level people are copied on every complaint/CAPA email except reminders about delay,
  // where a sender adds them only after 10 days (excludeManagement: false).
  const excludeManagement = input.excludeManagement ?? excludesManagementByDefault(input.triggerEvent);
  const departmentCc = await resolveDepartmentCc({
    complaintId: input.relatedComplaintId,
    capaId: input.relatedCapaId,
    excludeManagement
  }).catch(() => [] as string[]);
  // Complaint and CAPA emails also copy the reporting line of each recipient. Account and password
  // emails carry no complaint or CAPA reference, so they are never copied to anyone else.
  const isCaseEmail = Boolean(input.relatedComplaintId || input.relatedCapaId);
  const recipientChainCc = isCaseEmail ? await resolveRecipientChainCc(cleanRecipients).catch(() => [] as string[]) : [];
  // The three common company mailboxes are on every complaint and CAPA email, whoever sent it.
  const commonCc = isCaseEmail ? COMMON_CC_EMAILS : [];
  const ccList = Array.from(
    new Set([...(input.cc ?? []), ...commonCc, ...departmentCc, ...recipientChainCc].map((email) => email.trim().toLowerCase()).filter(Boolean))
  ).filter((email) => !cleanRecipients.some((to) => to.trim().toLowerCase() === email));
  // The Manager, HOD and Management addresses above come from the directory, so they are checked too.
  const finalCc = splitByEmailPolicy(ccList);
  if (finalCc.blocked.length > 0) await recordBlockedAddresses(input, finalCc.blocked);
  input = { ...input, cc: finalCc.allowed };

  const appUrl = getAppUrl();
  const today =new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const normalizedInputData = normalizePortalLinks(input.data, appUrl);
  const mergedData: Record<string, string | number | undefined | null> = {
    companyName: "ONEPWS Private Limited",
    appUrl,
    logoUrl: DEFAULT_EMAIL_LOGO_URL,
    today,
    recipientName: cleanRecipients[0],
    ...normalizedInputData
  };

  let renderedSubject = renderTemplate(template.subject, mergedData).rendered;
  const renderedHtml = renderTemplate(template.htmlBody, mergedData).rendered;
  const renderedText = renderTemplate(template.textBody, mergedData).rendered;
  let finalBody = appendTemporaryPasswordNotice(renderedHtml, renderedText, mergedData);

  // One thread per complaint: every email about it, or about one of its CAPAs, replies to the first one,
  // so a reader sees all earlier reminders in a single conversation.
  const threadKey = await resolveThreadKey(input.relatedComplaintId, input.relatedCapaId);
  const history = threadKey ? await getThreadHistory(threadKey).catch(() => []) : [];
  const root = history[0];
  let reminderCount: number | undefined;
  if (root) renderedSubject = threadSubject(root.subject || renderedSubject);
  if (input.automated) {
    reminderCount = nextReminderCount(history);
    const banner = buildReminderBanner({ reminderCount, daysDelayed: input.automated.daysDelayed, prior: history });
    finalBody = applyReminderBanner(finalBody, banner);
    mergedData.reminderCount = reminderCount;
    mergedData.daysDelayed = input.automated.daysDelayed;
  }
  const messageId = threadKey ? newMessageId() : undefined;
  const threadHeaders =
    threadKey && root
      ? { inReplyTo: root.messageId as string, references: history.slice(-20).map((entry) => entry.messageId as string) }
      : {};
  const threadFields = {
    threadKey,
    messageId,
    automated: Boolean(input.automated),
    reminderCount,
    daysDelayed: input.automated?.daysDelayed
  };

  if (!isSmtpConfigured()) {
    const skippedLog = await writeEmailLog({
      templateKey: template.templateKey,
      triggerEvent: input.triggerEvent,
      recipients: cleanRecipients,
      cc: input.cc,
      bcc: input.bcc,
      subject: renderedSubject,
      status: "skipped",
      errorMessage: "SMTP is not configured on server; delivery skipped",
      relatedComplaintId: input.relatedComplaintId,
      relatedCapaId: input.relatedCapaId,
      dedupeKey: input.dedupeKey,
      sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true,
      payload: { data: mergedData }
    });
    return { status: "skipped", logId: String(skippedLog._id), message: "SMTP not configured" };
  }

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: fromAddress(),
      to: cleanRecipients,
      cc: input.cc && input.cc.length > 0 ? input.cc : undefined,
      bcc: input.bcc && input.bcc.length > 0 ? input.bcc : undefined,
      subject: renderedSubject,
      html: finalBody.html,
      text: finalBody.text,
      ...(messageId ? { messageId } : {}),
      ...threadHeaders
    });

    const sentLog = await writeEmailLog({
      templateKey: template.templateKey,
      triggerEvent: input.triggerEvent,
      recipients: cleanRecipients,
      cc: input.cc,
      bcc: input.bcc,
      subject: renderedSubject,
      status: "sent",
      relatedComplaintId: input.relatedComplaintId,
      relatedCapaId: input.relatedCapaId,
      dedupeKey: input.dedupeKey,
      sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true,
      ...threadFields
    });

    return { status: "sent", logId: String(sentLog._id) };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "SMTP transport error";
    const failedLog = await writeEmailLog({
      templateKey: template.templateKey,
      triggerEvent: input.triggerEvent,
      recipients: cleanRecipients,
      cc: input.cc,
      bcc: input.bcc,
      subject: renderedSubject,
      status: "failed",
      errorMessage: errorMsg,
      relatedComplaintId: input.relatedComplaintId,
      relatedCapaId: input.relatedCapaId,
      dedupeKey: input.dedupeKey,
      sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true,
      payload: {
        triggerEvent: input.triggerEvent,
        recipients: cleanRecipients,
        cc: input.cc,
        bcc: input.bcc,
        data: mergedData,
        relatedComplaintId: input.relatedComplaintId,
        relatedCapaId: input.relatedCapaId
      }
    });

    return { status: "failed", logId: String(failedLog._id), message: errorMsg };
  }
}

export async function retryEmail(logId: string): Promise<SendEmailResult> {
  const log = await getEmailLogById(logId);
  if (!log) throw httpError(404, "Log record not found");
  if (log.status === "sent") return { status: "sent", logId: String(log._id), message: "Email was already sent successfully" };

  const payload = (log.payload || {}) as Record<string, unknown>;
  const data = (payload.data || {}) as Record<string, string | number>;
  const result = await sendTemplatedEmail({
    triggerEvent: log.triggerEvent,
    recipients: log.recipients,
    cc: log.cc,
    bcc: log.bcc,
    data,
    relatedComplaintId: log.relatedComplaintId?._id ? String(log.relatedComplaintId._id) : undefined,
    relatedCapaId: log.relatedCapaId?._id ? String(log.relatedCapaId._id) : undefined,
    sentBySystem: false
  });

  await EmailLog.findByIdAndUpdate(logId, { $inc: { attemptCount: 1 } });
  return result;
}

export async function sendRawTestEmail(input: { to: string; subject?: string; message?: string }): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) throw httpError(400, "SMTP credentials are not configured on this server");
  if (splitByEmailPolicy([input.to]).allowed.length === 0) throw httpError(400, EXTERNAL_ADDRESS_MESSAGE());

  const subject = input.subject || "ONEPWS Portal - SMTP Test Email";
  const appUrl = getAppUrl();
  const testMessage = input.message || "This is a verification test email from the ONEPWS Complaint & CAPA Management Portal.";
  const safeMessage = escapeHtml(testMessage);
  const safeAppUrl = escapeHtml(appUrl);
  const html = `
    <div style="font-family: 'DM Sans', Arial, sans-serif; padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #E31E25; margin-top: 0;">SMTP Test Verification</h2>
      <p style="color: #1E293B; font-size: 14px;">${safeMessage}</p>
      <p style="color: #64748B; font-size: 12px; margin-top: 24px;">Sent from: <a href="${safeAppUrl}" style="color: #E31E25;">${safeAppUrl}</a></p>
    </div>
  `;

  try {
    const transporter = createTransporter();
    await transporter.sendMail({ from: fromAddress(), to: input.to, subject, html, text: `${subject}\n\n${testMessage}\n\nPortal: ${appUrl}` });
    const log = await writeEmailLog({ triggerEvent: "TEST_SMTP", recipients: [input.to], subject, status: "sent", sentBySystem: false });
    return { status: "sent", logId: String(log._id) };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to send test email";
    await writeEmailLog({ triggerEvent: "TEST_SMTP", recipients: [input.to], subject, status: "failed", errorMessage: msg, sentBySystem: false });
    throw httpError(500, `SMTP Test failed: ${msg}`);
  }
}

/** Backward compatible transport helper retained for non-templated internal calls. */
export async function sendMail(input: { to: string[]; subject: string; html: string; text: string }) {
  if (input.to.length === 0) return { status: "skipped" as const };
  return sendRawTestEmail({ to: input.to[0], subject: input.subject, message: input.text });
}
