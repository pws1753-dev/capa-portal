import { describe, expect, it } from "vitest";
import { lateText, needsManagementEscalation, stageDelays, stageStatusText } from "./tat-delay";

const at = (iso: string) => new Date(iso);
const dues = {
  ack: at("2026-10-01T00:00:00Z"),
  cont: at("2026-10-03T00:00:00Z"),
  rca: at("2026-10-07T00:00:00Z"),
  capa: at("2026-10-15T00:00:00Z")
};

describe("TAT delay detection", () => {
  it("marks every incomplete stage past its due date as delayed, not only the first", () => {
    const delays = stageDelays(dues, {}, at("2026-10-20T18:30:00Z"));
    expect(delays.map((entry) => entry.delayed)).toEqual([true, true, true, true]);
    expect(delays[0].overdueHours).toBe(19 * 24);
    expect(delays[3].overdueHours).toBe(5 * 24);
  });

  it("stops counting a stage once it is completed", () => {
    const delays = stageDelays(dues, { ack: at("2026-10-02T00:00:00Z"), cont: at("2026-10-04T00:00:00Z") }, at("2026-10-20T00:00:00Z"));
    expect(delays.map((entry) => entry.delayed)).toEqual([false, false, true, true]);
    expect(delays[0].overdueHours).toBe(0);
  });

  it("does not flag a stage that is not yet due", () => {
    const delays = stageDelays(dues, {}, at("2026-10-05T00:00:00Z"));
    expect(delays.map((entry) => entry.delayed)).toEqual([true, true, false, false]);
  });

  it("is not late on the due date itself, only after that day ends", () => {
    // ack is due 1 Oct 05:30 IST; the day ends at 18:30 UTC.
    expect(stageDelays(dues, {}, at("2026-10-01T12:00:00Z"))[0].delayed).toBe(false);
    expect(stageDelays(dues, {}, at("2026-10-01T18:31:00Z"))[0].delayed).toBe(true);
  });

  it("is all clear once every stage is complete", () => {
    const all = { ack: at("2026-10-01T00:00:00Z"), cont: at("2026-10-02T00:00:00Z"), rca: at("2026-10-03T00:00:00Z"), capa: at("2026-10-04T00:00:00Z") };
    expect(stageDelays(dues, all, at("2026-12-01T00:00:00Z")).some((entry) => entry.delayed)).toBe(false);
  });
});

describe("management escalation after ten days", () => {
  it("copies Management only when a delay is more than 10 days", () => {
    expect(needsManagementEscalation(5 * 24)).toBe(false);
    expect(needsManagementEscalation(10 * 24)).toBe(false);
    expect(needsManagementEscalation(10 * 24 + 1)).toBe(true);
    expect(needsManagementEscalation(40 * 24)).toBe(true);
  });
});

describe("delay wording", () => {
  it("describes how late a stage is", () => {
    expect(lateText(5)).toBe("less than a day");
    expect(lateText(24)).toBe("1 day");
    expect(lateText(24 * 28)).toBe("28 days");
  });

  it("writes one status line per stage state", () => {
    const [ack, , , capa] = stageDelays(dues, { ack: at("2026-10-02T00:00:00Z") }, at("2026-10-10T00:00:00Z"));
    expect(stageStatusText(ack)).toMatch(/^Completed on /);
    expect(stageStatusText(capa)).toMatch(/^Due /);
    const late = stageDelays(dues, {}, at("2026-10-20T18:30:00Z"))[0];
    expect(stageStatusText(late)).toMatch(/^DELAYED by 19 days \(was due /);
  });
});
