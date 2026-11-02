import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

/** A Mongoose-style query: every modifier returns the query, `lean()` resolves to the rows. */
const query = (rows: Row[]) => {
  const chain: Record<string, unknown> = {};
  for (const method of ["populate", "select", "sort"]) chain[method] = () => chain;
  chain.lean = async () => rows;
  return chain;
};

const sendTemplatedEmail = vi.fn(async (_input: Record<string, unknown>) => ({ status: "sent" as const }));
const resolveRecipients = vi.fn(async (options: { targetRoles?: string[]; explicitEmails?: string[] }) => {
  const roles = options.targetRoles ?? [];
  if (roles.includes("Complaint Owner")) return [...(options.explicitEmails ?? []), ...(ownersWithEmail ? ["owner@onepws.com"] : [])];
  if (roles.includes("Management")) return ["mgmt@onepws.com"];
  if (roles.includes("CAPA Owner")) return ["capaowner@onepws.com"];
  return [];
});
let ownersWithEmail = true;

let complaints: Row[] = [];
let openCapas: Row[] = [];
const COMMON = ["service@onepws.com", "jatin.chouhan@onepws.com", "process@onepws.com"];

vi.mock("../config/db", () => ({ connectDB: async () => undefined }));
vi.mock("../models/Complaint", () => ({ Complaint: { find: () => query(complaints) } }));
vi.mock("../models/Capa", () => ({
  Capa: {
    find: (filter: { dueDate?: unknown }) => query(filter.dueDate ? [] : openCapas)
  }
}));
vi.mock("../models/configuration", () => ({ TATConfiguration: { findOne: () => ({ lean: async () => null }) } }));
vi.mock("./email-recipient.service", () => ({ resolveRecipients }));
vi.mock("./email.service", () => ({ sendTemplatedEmail }));

const { processEscalations } = await import("./escalation.service");

const done = (iso: string) => new Date(iso);
const base = { owner: { name: "Owner" }, responsibleDept: { name: "Production" }, priority: { name: "Medium", tatMultiplier: 1 }, customer: "Acme" };

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  sendTemplatedEmail.mockClear();
  resolveRecipients.mockClear();
  ownersWithEmail = true;
  openCapas = [{ _id: "capa1" }];
  complaints = [
    // 34+ days late on every stage: Management is copied
    { ...base, _id: "A", number: "PWS-A", receivedAt: new Date("2026-09-01T09:00:00Z") },
    // 5 days late at most: no Management
    { ...base, _id: "B", number: "PWS-B", receivedAt: new Date("2026-10-14T09:00:00Z") },
    // every stage completed: nothing to chase
    {
      ...base, _id: "C", number: "PWS-C", receivedAt: new Date("2026-08-01T09:00:00Z"),
      acknowledgedAt: done("2026-08-02T00:00:00Z"), containmentAt: done("2026-08-03T00:00:00Z"), rcaAt: done("2026-08-04T00:00:00Z"), capaAssignedAt: done("2026-08-05T00:00:00Z")
    },
    // nothing is due yet
    { ...base, _id: "D", number: "PWS-D", receivedAt: new Date("2026-10-19T09:00:00Z") }
  ];
});

const calls = () => sendTemplatedEmail.mock.calls.map(([input]) => input as { recipients: string[]; cc: string[]; excludeManagement: boolean; dedupeKey: string; triggerEvent: string; data: Record<string, string> });
const forComplaint = (id: string) => calls().find((call) => call.dedupeKey.includes(`_${id}_`));

describe("daily TAT delay emails", () => {
  it("emails only complaints that have a delayed stage", async () => {
    await processEscalations();
    expect(calls().map((call) => call.data.complaintNumber)).toEqual(["PWS-A", "PWS-B"]);
    expect(calls().every((call) => call.triggerEvent === "TAT_DELAY_DAILY")).toBe(true);
  });

  it("puts the owner in To and the common mailboxes in CC", async () => {
    await processEscalations();
    const b = forComplaint("B")!;
    expect(b.recipients).toEqual(["owner@onepws.com"]);
    expect(b.cc).toEqual(COMMON);
  });

  it("never copies Management, however late a stage is", async () => {
    await processEscalations();
    for (const key of ["A", "B"]) {
      const mail = forComplaint(key)!;
      expect(mail.excludeManagement).toBe(true);
      expect(mail.cc).not.toContain("mgmt@onepws.com");
      expect(mail.cc).toEqual(expect.arrayContaining(COMMON));
      expect(mail.data.statusLabel).toBe("Delayed");
    }
  });

  it("lists all four stages and how late the delayed ones are", async () => {
    await processEscalations();
    const b = forComplaint("B")!;
    expect(b.data.ackStatus).toMatch(/^DELAYED by 5 days/);
    expect(b.data.contStatus).toMatch(/^DELAYED by 3 days/);
    expect(b.data.rcaStatus).toMatch(/^Due /);
    expect(b.data.capaStatus).toMatch(/^Due /);
    expect(b.data.delayedCount).toBe("2");
    expect(b.data.maxDaysLate).toBe("5 days");
  });

  it("repeats every day: the de-duplication key is per complaint per date", async () => {
    await processEscalations();
    expect(forComplaint("B")!.dedupeKey).toBe("TATDELAY_B_2026-10-20");
    sendTemplatedEmail.mockClear();
    vi.setSystemTime(new Date("2026-10-21T09:00:00Z"));
    await processEscalations();
    expect(forComplaint("B")!.dedupeKey).toBe("TATDELAY_B_2026-10-21");
    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
  });

  it("stops once a delayed stage is completed", async () => {
    complaints = [
      {
        ...base, _id: "B", number: "PWS-B", receivedAt: new Date("2026-10-14T09:00:00Z"),
        acknowledgedAt: done("2026-10-16T00:00:00Z"), containmentAt: done("2026-10-18T00:00:00Z")
      }
    ];
    await processEscalations();
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("also adds the owners of open CAPA actions when CAPA Assignment is the late stage", async () => {
    await processEscalations();
    expect(forComplaint("A")!.recipients).toEqual(expect.arrayContaining(["owner@onepws.com", "capaowner@onepws.com"]));
    expect(forComplaint("B")!.recipients).not.toContain("capaowner@onepws.com");
  });

  it("falls back to the common mailboxes when the owner has no reachable email", async () => {
    ownersWithEmail = false;
    complaints = [{ ...base, _id: "B", number: "PWS-B", receivedAt: new Date("2026-10-14T09:00:00Z") }];
    await processEscalations();
    const b = forComplaint("B")!;
    expect(b.recipients).toEqual(COMMON);
    expect(b.cc).toEqual([]);
  });
});
