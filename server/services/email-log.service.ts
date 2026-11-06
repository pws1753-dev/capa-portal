import { Types } from "mongoose";
import { connectDB } from "../config/db";
import { EmailLog, type EmailLogDocument } from "../models/EmailLog";
import type { EmailLogQueryInput } from "@shared/schemas/email";
import { httpError } from "../utils/http";

export type WriteEmailLogInput = {
  templateKey?: string;
  triggerEvent: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  status: "sent" | "failed" | "skipped";
  errorMessage?: string;
  relatedComplaintId?: string | Types.ObjectId;
  relatedCapaId?: string | Types.ObjectId;
  sentBySystem?: boolean;
  payload?: Record<string, unknown>;
  dedupeKey?: string;
  attemptCount?: number;
  threadKey?: string;
  messageId?: string;
  automated?: boolean;
  reminderCount?: number;
  daysDelayed?: number;
};

/**
 * Sanitizes payload object to strictly ensure NO credentials, secrets, or passwords
 * ever enter the database log.
 */
function sanitizePayload(rawPayload?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!rawPayload) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawPayload)) {
    if (/(password|secret|token|auth|cookie)/i.test(key)) {
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      safe[key] = sanitizePayload(value as Record<string, unknown>);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

export async function writeEmailLog(input: WriteEmailLogInput): Promise<EmailLogDocument> {
  await connectDB();
  return EmailLog.create({
    templateKey: input.templateKey,
    triggerEvent: input.triggerEvent,
    recipients: input.recipients,
    cc: input.cc || [],
    bcc: input.bcc || [],
    subject: input.subject || "",
    status: input.status,
    errorMessage: input.errorMessage,
    relatedComplaintId: input.relatedComplaintId,
    relatedCapaId: input.relatedCapaId,
    sentBySystem: input.sentBySystem !== undefined ? input.sentBySystem : true,
    payload: sanitizePayload(input.payload),
    dedupeKey: input.dedupeKey,
    attemptCount: input.attemptCount || 1,
    threadKey: input.threadKey,
    messageId: input.messageId,
    automated: input.automated ?? false,
    reminderCount: input.reminderCount,
    daysDelayed: input.daysDelayed
  });
}

/** Earlier sent emails of a thread, oldest first. The first is the thread root. */
export async function getThreadHistory(threadKey: string) {
  await connectDB();
  return EmailLog.find({ threadKey, status: "sent", messageId: { $exists: true, $ne: null } })
    .sort({ createdAt: 1 })
    .select("subject messageId triggerEvent createdAt automated reminderCount daysDelayed")
    .lean();
}

export async function hasDedupeKeyBeenSent(dedupeKey: string): Promise<boolean> {
  if (!dedupeKey) return false;
  await connectDB();
  const existing = await EmailLog.findOne({ dedupeKey, status: "sent" }).select("_id").lean();
  return Boolean(existing);
}

export async function queryEmailLogs(query: EmailLogQueryInput) {
  await connectDB();
  const filter: Record<string, unknown> = {};

  if (query.status && query.status !== "all") {
    filter.status = query.status;
  }

  if (query.triggerEvent && query.triggerEvent.trim().length > 0) {
    filter.triggerEvent = query.triggerEvent.trim();
  }

  if (query.templateKey && query.templateKey.trim().length > 0) {
    filter.templateKey = query.templateKey.trim().toLowerCase();
  }

  if (query.recipient && query.recipient.trim().length > 0) {
    filter.recipients = { $in: [new RegExp(query.recipient.trim(), "i")] };
  }

  if (query.search && query.search.trim().length > 0) {
    const s = query.search.trim();
    filter.$or = [
      { subject: { $regex: s, $options: "i" } },
      { recipients: { $regex: s, $options: "i" } },
      { triggerEvent: { $regex: s, $options: "i" } },
      { templateKey: { $regex: s, $options: "i" } }
    ];
  }

  if (query.startDate || query.endDate) {
    filter.createdAt = {};
    if (query.startDate) {
      (filter.createdAt as Record<string, unknown>).$gte = new Date(query.startDate);
    }
    if (query.endDate) {
      (filter.createdAt as Record<string, unknown>).$lte = new Date(query.endDate);
    }
  }

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
  const skip = (page - 1) * pageSize;

  const [total, items] = await Promise.all([
    EmailLog.countDocuments(filter),
    EmailLog.find(filter)
      .populate("relatedComplaintId", "number description")
      .populate("relatedCapaId", "number action")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean()
  ]);

  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}

export async function getEmailLogById(id: string) {
  if (!Types.ObjectId.isValid(id)) throw httpError(400, "Invalid log ID");
  await connectDB();
  const log = await EmailLog.findById(id)
    .populate("relatedComplaintId", "number description status priority")
    .populate("relatedCapaId", "number action status")
    .lean();
  if (!log) throw httpError(404, "Email log record not found");
  return log;
}
