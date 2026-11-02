import { describe, expect, it } from "vitest";
import { reminderLookaheadDays, shouldRunScheduledEmails } from "./email-schedule";

// 2026-11-02 is a Monday; 03:00 UTC = 08:30 IST.
const monday = new Date("2026-11-02T03:00:00Z");
const tuesday = new Date("2026-11-03T03:00:00Z");

describe("shouldRunScheduledEmails", () => {
  it("never runs when switched off", () => {
    expect(shouldRunScheduledEmails({ enabled: false, frequencyDays: 7, now: monday }).run).toBe(false);
  });
  it("first weekly run waits for Monday", () => {
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 7, now: tuesday }).run).toBe(false);
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 7, now: monday }).run).toBe(true);
  });
  it("weekly repeats the next Monday, not before", () => {
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 7, lastRunAt: monday, now: new Date("2026-11-08T03:00:00Z") }).run).toBe(false);
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 7, lastRunAt: monday, now: new Date("2026-11-09T03:00:00Z") }).run).toBe(true);
  });
  it("custom shorter interval", () => {
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 3, now: tuesday }).run).toBe(true);
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 3, lastRunAt: monday, now: tuesday }).run).toBe(false);
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 3, lastRunAt: monday, now: new Date("2026-11-05T03:00:00Z") }).run).toBe(true);
  });

  it("never sends on Sunday, and resumes Monday", () => {
    const sunday = new Date("2026-11-08T03:00:00Z");
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 1, lastRunAt: new Date("2026-11-07T03:00:00Z"), now: sunday }).run).toBe(false);
    expect(shouldRunScheduledEmails({ enabled: true, frequencyDays: 1, lastRunAt: new Date("2026-11-07T03:00:00Z"), now: new Date("2026-11-09T03:00:00Z") }).run).toBe(true);
  });
  it("Saturday's due-tomorrow reminder also covers Sunday and Monday", () => {
    expect(reminderLookaheadDays(new Date("2026-11-07T03:00:00Z"))).toBe(2);
    expect(reminderLookaheadDays(monday)).toBe(1);
  });
});
