import { describe, expect, it } from "vitest";
import { makeActor, makeComplaint, tatConfig } from "./fixtures";
import { canCloseComplaint, canEditCapa, canEditComplaint, canSeeCompany, canViewComplaint, hasPermission } from "./rbac";
import { findRepeatMatches, matchesRepeatRule, repeatCutoff } from "./repeat";
import {
  buildTatPlan,
  computeActionTargetDate,
  computeStageDueDates,
  escalationLevelFor,
  isStageOverdueNow,
  reminderTimestamps
} from "./tat";
import { makeCapa } from "./fixtures";

describe("TAT engine", () => {
  const complaint = makeComplaint();

  it("derives stage due dates from configuration", () => {
    const due = computeStageDueDates(complaint, tatConfig);
    expect(due.ack.toISOString()).toBe("2026-05-02T00:00:00.000Z");
    expect(due.cont.toISOString()).toBe("2026-05-04T00:00:00.000Z");
    expect(due.rca.toISOString()).toBe("2026-05-08T00:00:00.000Z");
    expect(due.capa.toISOString()).toBe("2026-05-16T00:00:00.000Z");
  });

  it("tightens every window for a critical priority", () => {
    const critical = makeComplaint({ priorityMultiplier: 0.5 });
    const due = computeStageDueDates(critical, tatConfig);
    expect(due.ack.toISOString()).toBe("2026-05-01T12:00:00.000Z");
    expect(due.rca.toISOString()).toBe("2026-05-04T12:00:00.000Z");
  });

  it("classifies on-time, due-soon and overdue", () => {
    const plan = buildTatPlan(complaint, tatConfig, new Date("2026-05-02T00:00:00.000Z"));
    expect(plan.find((entry) => entry.stage === "ack")?.health).toBe("due-soon");
    expect(plan.find((entry) => entry.stage === "capa")?.health).toBe("on-time");

    const late = buildTatPlan(complaint, tatConfig, new Date("2026-05-10T00:00:00.000Z"));
    expect(late.find((entry) => entry.stage === "ack")?.health).toBe("overdue");
    expect(late.find((entry) => entry.stage === "ack")?.overdue).toBe(true);
  });

  it("treats completion at any time on the due date as on time, and late only after that day", () => {
    // ack is due 2 May 05:30 IST: finishing that evening (IST) is still on time.
    const sameDay = makeComplaint({ acknowledgedAt: "2026-05-02T12:34:00.000Z" });
    expect(buildTatPlan(sameDay, tatConfig, new Date("2026-05-02T13:00:00.000Z")).find((entry) => entry.stage === "ack")?.health).toBe("on-time");
    const nextDay = makeComplaint({ acknowledgedAt: "2026-05-02T19:00:00.000Z" });
    expect(buildTatPlan(nextDay, tatConfig, new Date("2026-05-03T00:00:00.000Z")).find((entry) => entry.stage === "ack")?.health).toBe("overdue");
    // Not completed: still on the due date, not overdue yet.
    expect(buildTatPlan(complaint, tatConfig, new Date("2026-05-02T12:00:00.000Z")).find((entry) => entry.stage === "ack")?.overdue).toBe(false);
  });

  it("marks a stage completed after its due date as overdue", () => {
    const completedLate = makeComplaint({ acknowledgedAt: "2026-05-03T00:00:00.000Z" });
    const plan = buildTatPlan(completedLate, tatConfig, new Date("2026-05-04T00:00:00.000Z"));
    expect(plan.find((entry) => entry.stage === "ack")?.health).toBe("overdue");
  });

  it("knows when completing a stage now would be late", () => {
    expect(isStageOverdueNow(complaint, "ack", tatConfig, new Date("2026-05-01T12:00:00.000Z"))).toBe(false);
    expect(isStageOverdueNow(complaint, "ack", tatConfig, new Date("2026-05-03T00:00:00.000Z"))).toBe(true);
  });

  it("computes D3, D5 and D6 action target dates", () => {
    expect(computeActionTargetDate(complaint, "d3", tatConfig)).toBe("2026-05-04");
    expect(computeActionTargetDate(complaint, "d5", tatConfig)).toBe("2026-05-16");
    expect(computeActionTargetDate(complaint, "d6", tatConfig)).toBe("2026-05-31");
  });

  it("places reminders at the configured percentages of the window", () => {
    const [half] = reminderTimestamps(complaint.receivedAt, "2026-05-03T00:00:00.000Z", [50]);
    expect(half.toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  it("selects the highest escalation level the overdue hours have reached", () => {
    const levels = [
      { level: 1, name: "Owner", triggerHoursOverdue: 0 },
      { level: 2, name: "Department Head", triggerHoursOverdue: 24 },
      { level: 3, name: "Quality Head", triggerHoursOverdue: 72 },
      { level: 4, name: "Management", triggerHoursOverdue: 168 }
    ];
    expect(escalationLevelFor(1, levels)?.name).toBe("Owner");
    expect(escalationLevelFor(30, levels)?.name).toBe("Department Head");
    expect(escalationLevelFor(200, levels)?.name).toBe("Management");
  });
});

describe("repeat detection", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const cutoff = repeatCutoff(60, now);
  const candidate = {
    id: "new",
    companyId: "company-1",
    customer: "Acme Ltd",
    product: "Workstation",
    category: "Product quality issue",
    receivedAt: now.toISOString()
  };

  it("matches on same company, category and customer inside the window", () => {
    const match = matchesRepeatRule(
      candidate,
      { ...candidate, id: "old", product: "Other", receivedAt: "2026-05-20T00:00:00.000Z" },
      cutoff
    );
    expect(match?.basis).toEqual(["customer"]);
  });

  it("matches on product when the customer differs", () => {
    const match = matchesRepeatRule(
      candidate,
      { ...candidate, id: "old", customer: "Other Ltd", receivedAt: "2026-05-20T00:00:00.000Z" },
      cutoff
    );
    expect(match?.basis).toEqual(["product"]);
  });

  it("rejects a different category, a different company and anything outside the window", () => {
    expect(matchesRepeatRule(candidate, { ...candidate, id: "a", category: "Delivery issue" }, cutoff)).toBeNull();
    expect(matchesRepeatRule(candidate, { ...candidate, id: "b", companyId: "company-2" }, cutoff)).toBeNull();
    expect(matchesRepeatRule(candidate, { ...candidate, id: "c", receivedAt: "2026-01-01T00:00:00.000Z" }, cutoff)).toBeNull();
  });

  it("never matches the complaint against itself", () => {
    expect(findRepeatMatches(candidate, [candidate], 60, now)).toHaveLength(0);
  });
});

describe("authorization", () => {
  it("treats a wildcard permission as full access", () => {
    const admin = makeActor({ roleName: "Master Admin", permissions: ["*"], companyIds: [] });
    expect(hasPermission(admin, "complaint.close")).toBe(true);
    expect(canSeeCompany(admin, "any-company")).toBe(true);
  });

  it("scopes a company-limited user to their own companies", () => {
    const actor = makeActor({ companyIds: ["company-1"] });
    expect(canSeeCompany(actor, "company-1")).toBe(true);
    expect(canSeeCompany(actor, "company-2")).toBe(false);
    expect(canViewComplaint(actor, { companyId: "company-2" })).toBe(false);
  });

  it("honours owner-scoped and department-scoped edit permissions", () => {
    const complaint = makeComplaint({ ownerId: "owner-1", responsibleDept: "dept-9" });
    const owner = makeActor({ id: "owner-1", permissions: ["view.company", "complaint.edit.own"] });
    const otherOwner = makeActor({ id: "owner-2", permissions: ["view.company", "complaint.edit.own"] });
    const head = makeActor({ id: "head-1", permissions: ["view.company", "complaint.edit.dept"], department: "dept-9" });
    const wrongHead = makeActor({ id: "head-2", permissions: ["view.company", "complaint.edit.dept"], department: "dept-3" });

    expect(canEditComplaint(owner, complaint)).toBe(true);
    expect(canEditComplaint(otherOwner, complaint)).toBe(false);
    expect(canEditComplaint(head, complaint)).toBe(true);
    expect(canEditComplaint(wrongHead, complaint)).toBe(false);
  });

  it("blocks closure without the close permission", () => {
    const viewer = makeActor({ permissions: ["view.company"] });
    const quality = makeActor({ roleName: "Quality Head", permissions: ["view.company", "complaint.close"] });
    expect(canCloseComplaint(viewer, { companyId: "company-1" })).toBe(false);
    expect(canCloseComplaint(quality, { companyId: "company-1" })).toBe(true);
  });

  it("lets a CAPA owner edit only their own CAPA", () => {
    const complaint = makeComplaint();
    const capa = makeCapa({ ownerId: "capa-owner" });
    const owner = makeActor({ id: "capa-owner", roleName: "CAPA Owner", permissions: ["view.company", "capa.edit.own"] });
    const stranger = makeActor({ id: "someone", roleName: "CAPA Owner", permissions: ["view.company", "capa.edit.own"] });
    expect(canEditCapa(owner, capa, complaint)).toBe(true);
    expect(canEditCapa(stranger, capa, complaint)).toBe(false);
  });
});
