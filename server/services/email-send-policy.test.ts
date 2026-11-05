import { beforeEach, describe, expect, it, vi } from "vitest";

type Mail = { to: string[]; cc?: string[]; bcc?: string[]; [key: string]: unknown };
const sendMail = vi.fn(async (_mail: Mail) => ({ messageId: "m1" }));
const writeEmailLog = vi.fn(async (entry: Record<string, unknown>) => ({ _id: "log1", ...entry }));
const resolveDepartmentCc = vi.fn(async (_ref: { excludeManagement?: boolean }) => [] as string[]);
const resolveRecipientChainCc = vi.fn(async () => [] as string[]);
const getThreadHistory = vi.fn(async (_key: string) => [] as Record<string, unknown>[]);

let routing = { commonCc: ["service@onepws.com", "jatin.chouhan@onepws.com", "process@onepws.com"], excludeEmails: [] as string[], defaultCommonCc: [] as string[] };
vi.mock("./email-routing.service", async () => {
  const actual = await vi.importActual<typeof import("./email-routing.service")>("./email-routing.service");
  return { ...actual, getEmailRouting: async () => routing };
});
vi.mock("../lib/mailer", () => ({
  createTransporter: () => ({ sendMail }),
  fromAddress: () => "portal@onepws.com",
  isSmtpConfigured: () => true
}));
vi.mock("../lib/app-url", () => ({ getAppUrl: () => "https://care.onepws.com" }));
let templateExtras: Record<string, unknown> = {};
vi.mock("./email-template.service", () => ({
  getActiveTemplateByTrigger: async () => ({
    ...templateExtras,
    templateKey: "t",
    templateName: "T",
    subject: "Complaint {{complaintNumber}}",
    htmlBody: "<p>{{complaintNumber}}</p>",
    textBody: "{{complaintNumber}}",
    supportedVariables: []
  })
}));
vi.mock("./email-log.service", () => ({
  hasDedupeKeyBeenSent: async () => false,
  writeEmailLog,
  getEmailLogById: async () => null,
  getThreadHistory
}));
vi.mock("../models/Capa", () => ({ Capa: { findById: () => ({ select: () => ({ lean: async () => null }) }) } }));
vi.mock("./email-recipient.service", () => ({ resolveDepartmentCc, resolveRecipientChainCc }));
vi.mock("../models/EmailLog", () => ({ EmailLog: { findByIdAndUpdate: async () => null } }));

const { sendTemplatedEmail } = await import("./email.service");

const base = { triggerEvent: "COMPLAINT_CLOSED", data: { complaintNumber: "PWS-1" }, relatedComplaintId: "6ae076b3a20125450b25cdb0" } as const;
const COMMON = ["service@onepws.com", "jatin.chouhan@onepws.com", "process@onepws.com"];

beforeEach(() => {
  sendMail.mockClear();
  writeEmailLog.mockClear();
  templateExtras = {};
  routing = { commonCc: ["service@onepws.com", "jatin.chouhan@onepws.com", "process@onepws.com"], excludeEmails: [], defaultCommonCc: [] };
  getThreadHistory.mockReset();
  getThreadHistory.mockResolvedValue([]);
  resolveDepartmentCc.mockResolvedValue([]);
  resolveRecipientChainCc.mockResolvedValue([]);
});

describe("portal emails never leave the company", () => {
  it("sends to company addresses", async () => {
    const result = await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com"], cc: ["boss@onepws.com"] });
    expect(result.status).toBe("sent");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ["owner@onepws.com"], cc: ["boss@onepws.com", ...COMMON] }));
  });

  it("drops a customer address from To, CC and BCC and still sends to the company people", async () => {
    await sendTemplatedEmail({
      ...base,
      recipients: ["owner@onepws.com", "buyer@customer.com"],
      cc: ["manager@onepws.com", "ceo@customer.com"],
      bcc: ["audit@gmail.com"]
    });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toEqual(["owner@onepws.com"]);
    expect(mail.cc).toEqual(["manager@onepws.com", ...COMMON]);
    expect(mail.bcc).toBeUndefined();
    const everyAddress = [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? [])];
    expect(everyAddress.every((address) => address.endsWith("@onepws.com"))).toBe(true);
  });

  it("sends nothing when the only recipient is a customer, and logs the refusal", async () => {
    const result = await sendTemplatedEmail({ ...base, recipients: ["buyer@customer.com"] });
    expect(result.status).toBe("skipped");
    expect(sendMail).not.toHaveBeenCalled();
    expect(writeEmailLog).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", recipients: ["buyer@customer.com"] }));
  });

  it("also filters the Manager/HOD/Management CCs that come from the directory", async () => {
    resolveDepartmentCc.mockResolvedValue(["hod@onepws.com", "typo-entered@customer.com"]);
    resolveRecipientChainCc.mockResolvedValue(["chain@onepws.com", "external-manager@gmail.com"]);
    await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com"] });
    expect(sendMail.mock.calls[0][0].cc).toEqual([...COMMON, "hod@onepws.com", "chain@onepws.com"]);
  });

  it("always copies the three common mailboxes on a complaint or CAPA email, whoever sent it", async () => {
    for (const trigger of ["COMPLAINT_CREATED", "TAT_DELAY_DAILY", "TAT_REMINDER", "CAPA_OVERDUE", "EFFECTIVENESS_REVIEW_DUE", "COMPLAINT_CLOSED"]) {
      sendMail.mockClear();
      await sendTemplatedEmail({ ...base, triggerEvent: trigger, recipients: ["owner@onepws.com"] });
      expect(sendMail.mock.calls[0][0].cc, trigger).toEqual(expect.arrayContaining(COMMON));
    }
    sendMail.mockClear();
    await sendTemplatedEmail({ triggerEvent: "CAPA_ASSIGNED", data: {}, relatedCapaId: "6ae076b3a20125450b25cdb1", recipients: ["owner@onepws.com"] });
    expect(sendMail.mock.calls[0][0].cc).toEqual(expect.arrayContaining(COMMON));
  });

  it("does not move a common mailbox to CC when it is already a recipient", async () => {
    await sendTemplatedEmail({ ...base, recipients: ["service@onepws.com"] });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toEqual(["service@onepws.com"]);
    expect(mail.cc).toEqual(["jatin.chouhan@onepws.com", "process@onepws.com"]);
  });

  it("does not copy anyone on account emails that have no complaint or CAPA behind them", async () => {
    await sendTemplatedEmail({ triggerEvent: "PASSWORD_CHANGED", data: {}, recipients: ["user@onepws.com"] });
    expect(sendMail.mock.calls[0][0].cc).toBeUndefined();
  });

  it("leaves Management out of reminders about delay unless the sender says it is over 10 days", async () => {
    for (const trigger of ["TAT_REMINDER", "TAT_DUE_SOON", "CAPA_DUE_REMINDER", "TAT_DELAY_DAILY", "CAPA_OVERDUE", "EFFECTIVENESS_REVIEW_DUE"]) {
      resolveDepartmentCc.mockClear();
      await sendTemplatedEmail({ ...base, triggerEvent: trigger, recipients: ["owner@onepws.com"] });
      expect(resolveDepartmentCc.mock.calls[0][0].excludeManagement, trigger).toBe(true);
    }
    resolveDepartmentCc.mockClear();
    await sendTemplatedEmail({ ...base, triggerEvent: "TAT_DELAY_DAILY", recipients: ["owner@onepws.com"], excludeManagement: false });
    expect(resolveDepartmentCc.mock.calls[0][0].excludeManagement).toBe(false);
  });

  it("keeps Management in the CC of every other complaint and CAPA email", async () => {
    for (const trigger of ["COMPLAINT_CREATED", "COMPLAINT_CLOSED", "COMPLAINT_REOPENED", "CAPA_ASSIGNED", "COMPLAINT_ACKNOWLEDGED"]) {
      resolveDepartmentCc.mockClear();
      await sendTemplatedEmail({ ...base, triggerEvent: trigger, recipients: ["owner@onepws.com"] });
      expect(resolveDepartmentCc.mock.calls[0][0].excludeManagement, trigger).toBe(false);
    }
  });

  it("does not let a look-alike domain through", async () => {
    const result = await sendTemplatedEmail({ ...base, recipients: ["x@onepws.com.evil.com", "y@notonepws.com"] });
    expect(result.status).toBe("skipped");
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("one email thread per complaint", () => {
  it("starts the thread with its own Message-ID and no reply headers", async () => {
    await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com"] });
    const mail = sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(String(mail.messageId)).toMatch(/^<.+@onepws\.com>$/);
    expect(mail.inReplyTo).toBeUndefined();
    expect(writeEmailLog).toHaveBeenCalledWith(expect.objectContaining({ threadKey: "CMP_6ae076b3a20125450b25cdb0" }));
  });

  it("replies to the root, keeps the subject, and numbers the reminder with days delayed", async () => {
    const day = new Date("2026-11-02T03:00:00Z");
    getThreadHistory.mockResolvedValue([
      { subject: "Complaint PWS-1", messageId: "<root@onepws.com>", triggerEvent: "TAT_REMINDER", createdAt: day, automated: true, reminderCount: 1, daysDelayed: 0 },
      { subject: "Re: Complaint PWS-1", messageId: "<two@onepws.com>", triggerEvent: "TAT_DELAY_DAILY", createdAt: day, automated: true, reminderCount: 2, daysDelayed: 3 }
    ]);
    await sendTemplatedEmail({ ...base, triggerEvent: "TAT_DELAY_DAILY", recipients: ["owner@onepws.com"], automated: { daysDelayed: 10 } });
    const mail = sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(mail.subject).toBe("Re: Complaint PWS-1");
    expect(mail.inReplyTo).toBe("<root@onepws.com>");
    expect(mail.references).toEqual(["<root@onepws.com>", "<two@onepws.com>"]);
    expect(String(mail.html)).toContain("Reminder #3");
    expect(String(mail.html)).toContain("10 days delayed");
    expect(writeEmailLog).toHaveBeenCalledWith(expect.objectContaining({ automated: true, reminderCount: 3, daysDelayed: 10 }));
  });

  it("does not count a non-reminder email as a reminder", async () => {
    getThreadHistory.mockResolvedValue([{ subject: "Complaint PWS-1", messageId: "<root@onepws.com>", triggerEvent: "COMPLAINT_REGISTERED", createdAt: new Date(), automated: false }]);
    await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com"], automated: { daysDelayed: 0 } });
    expect(String((sendMail.mock.calls[0][0] as Record<string, unknown>).html)).toContain("Reminder #1");
  });
});

describe("recipient rules kept by the administrator", () => {
  it("never emails an address on the global exclusion list, in To, CC or BCC", async () => {
    routing.excludeEmails = ["puneet@onepws.com"];
    resolveDepartmentCc.mockResolvedValue(["puneet@onepws.com", "ritik@onepws.com"]);
    await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com", "Puneet@onepws.com"], cc: ["puneet@onepws.com"] });
    const mail = sendMail.mock.calls[0][0] as Mail;
    expect(mail.to).toEqual(["owner@onepws.com"]);
    expect(mail.cc).not.toContain("puneet@onepws.com");
    expect(mail.cc).toContain("ritik@onepws.com");
  });

  it("uses the editable common CC list instead of the built-in one", async () => {
    routing.commonCc = ["quality@onepws.com"];
    await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com"] });
    expect((sendMail.mock.calls[0][0] as Mail).cc).toEqual(["quality@onepws.com"]);
  });

  it("adds a template's own To, CC and BCC addresses and honours its exclusions", async () => {
    templateExtras = { toEmails: ["extra.to@onepws.com"], ccRules: ["extra.cc@onepws.com"], bccRules: ["audit@onepws.com"], excludeEmails: ["service@onepws.com"] };
    await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com"] });
    const mail = sendMail.mock.calls[0][0] as Mail;
    expect(mail.to).toEqual(["owner@onepws.com", "extra.to@onepws.com"]);
    expect(mail.cc).toContain("extra.cc@onepws.com");
    expect(mail.cc).not.toContain("service@onepws.com");
    expect(mail.bcc).toEqual(["audit@onepws.com"]);
  });

  it("skips the email when every recipient is excluded", async () => {
    routing.excludeEmails = ["owner@onepws.com"];
    const result = await sendTemplatedEmail({ ...base, recipients: ["owner@onepws.com"] });
    expect(result.status).toBe("skipped");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
