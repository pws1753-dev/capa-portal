import { connectDB } from "../config/db";
import { COMMON_CC_EMAILS } from "../lib/email-policy";
import { EmailRouting } from "../models/EmailRouting";
import type { EmailRoutingInput } from "@shared/schemas/email";
import type { ApiUser } from "@shared/types/api";
import { writeAudit } from "./audit.service";

export type EmailRoutingSettings = { commonCc: string[]; excludeEmails: string[]; defaultCommonCc: string[] };

const clean = (emails: string[] | undefined) =>
  Array.from(new Set((emails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean)));

/** The recipient rules every email applies: the common CC list and the addresses that never get mail. */
export async function getEmailRouting(): Promise<EmailRoutingSettings> {
  await connectDB();
  const doc = await EmailRouting.findOne({ key: "global" }).lean();
  return {
    commonCc: doc?.commonCc ? clean(doc.commonCc) : [...COMMON_CC_EMAILS],
    excludeEmails: clean(doc?.excludeEmails),
    defaultCommonCc: [...COMMON_CC_EMAILS]
  };
}

export async function updateEmailRouting(input: EmailRoutingInput, user: ApiUser | undefined): Promise<EmailRoutingSettings> {
  await connectDB();
  const before = await getEmailRouting();
  const commonCc = clean(input.commonCc);
  const excludeEmails = clean(input.excludeEmails);
  await EmailRouting.findOneAndUpdate(
    { key: "global" },
    { $set: { key: "global", commonCc, excludeEmails, updatedBy: user?.id } },
    { upsert: true, new: true }
  );
  await writeAudit({
    actor: user,
    action: "MASTER_DATA_CHANGE",
    entity: "EmailRouting",
    entityId: "global",
    before: { commonCc: before.commonCc, excludeEmails: before.excludeEmails },
    after: { commonCc, excludeEmails }
  });
  return getEmailRouting();
}

/** Removes every excluded address (compared without case) from a recipient list. */
export function withoutExcluded(emails: string[] | undefined, excluded: Set<string>): string[] {
  return (emails ?? []).filter((email) => !excluded.has(email.trim().toLowerCase()));
}
