import { WORKFLOW_STAGES, type TatHealth, type WorkflowStage } from "@shared/constants/domain";
import type { DomainComplaint, TatConfig } from "./types";
import { endOfDueDay, isPastDueDay } from "./due-day";

export type StageTat = {
  stage: WorkflowStage;
  dueAt: string;
  completedAt: string | null;
  health: TatHealth;
  overdue: boolean;
  delayReason: string | null;
  delayExplanation: string | null;
};

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

export function addHours(base: Date | string, hours: number): Date {
  return new Date(new Date(base).getTime() + hours * HOUR_MS);
}

export function addDays(base: Date | string, days: number): Date {
  return new Date(new Date(base).getTime() + days * DAY_MS);
}

/**
 * Stage due dates. The priority multiplier scales every window, exactly as the legacy
 * computeTATDue did: Critical 0.5x, High 0.75x, Medium 1x, Low 1.5x.
 */
export function computeStageDueDates(complaint: Pick<DomainComplaint, "receivedAt" | "priorityMultiplier">, config: TatConfig) {
  const multiplier = complaint.priorityMultiplier > 0 ? complaint.priorityMultiplier : 1;
  const base = complaint.receivedAt;
  return {
    ack: addHours(base, config.ackHours * multiplier),
    cont: addDays(base, config.containmentDays * multiplier),
    rca: addDays(base, config.rcaDays * multiplier),
    capa: addDays(base, config.capaDays * multiplier)
  } satisfies Record<WorkflowStage, Date>;
}

/** Planned target date for a D3 / D5 / D6 action row (legacy computeActionTargetDate). */
export function computeActionTargetDate(
  complaint: Pick<DomainComplaint, "receivedAt" | "priorityMultiplier">,
  stage: "d3" | "d5" | "d6",
  config: TatConfig
): string {
  const multiplier = complaint.priorityMultiplier > 0 ? complaint.priorityMultiplier : 1;
  const days = { d3: config.d3ContainmentDays, d5: config.d5CorrectiveActionDays, d6: config.d6VerificationDays }[stage];
  return addDays(complaint.receivedAt, Math.round(days * multiplier))
    .toISOString()
    .slice(0, 10);
}

export function stageHealth(
  dueAt: Date | string,
  completedAt: Date | string | null | undefined,
  now: Date,
  dueSoonHours: number
): TatHealth {
  // The due date is a calendar day: finishing at any time on it is on time.
  const due = endOfDueDay(dueAt);
  if (completedAt) return new Date(completedAt) <= due ? "on-time" : "overdue";
  if (now > due) return "overdue";
  const hoursRemaining = (due.getTime() - now.getTime()) / HOUR_MS;
  return hoursRemaining <= dueSoonHours ? "due-soon" : "on-time";
}

const COMPLETION_FIELD: Record<WorkflowStage, keyof DomainComplaint> = {
  ack: "acknowledgedAt",
  cont: "containmentAt",
  rca: "rcaAt",
  capa: "capaAssignedAt"
};

const DELAY_FIELD: Record<WorkflowStage, keyof DomainComplaint> = {
  ack: "ackDelayReason",
  cont: "contDelayReason",
  rca: "rcaDelayReason",
  capa: "capaDelayReason"
};

export function buildTatPlan(complaint: DomainComplaint, config: TatConfig, now: Date = new Date()): StageTat[] {
  const due = computeStageDueDates(complaint, config);
  return WORKFLOW_STAGES.map((stage) => {
    const completedAt = (complaint[COMPLETION_FIELD[stage]] as string | null | undefined) ?? null;
    const delay = complaint[DELAY_FIELD[stage]] as { category?: string; explanation?: string } | null | undefined;
    const health = stageHealth(due[stage], completedAt, now, config.dueSoonHours);
    return {
      stage,
      dueAt: due[stage].toISOString(),
      completedAt,
      health,
      overdue: health === "overdue",
      delayReason: delay?.category ?? null,
      delayExplanation: delay?.explanation ?? null
    };
  });
}

/** True when the stage is being completed after its due date and therefore needs a delay reason. */
export function isStageOverdueNow(complaint: DomainComplaint, stage: WorkflowStage, config: TatConfig, now: Date = new Date()): boolean {
  return isPastDueDay(computeStageDueDates(complaint, config)[stage], now);
}

/** Reminder trigger points as absolute timestamps, e.g. at 50 / 75 / 90 percent of the window. */
export function reminderTimestamps(receivedAt: string, dueAt: Date | string, percentages: readonly number[]): Date[] {
  const start = new Date(receivedAt).getTime();
  const end = new Date(dueAt).getTime();
  return percentages.map((pct) => new Date(start + (end - start) * (pct / 100)));
}

/** Escalation level for an overdue stage, resolved from configuration rather than hardcoded values. */
export function escalationLevelFor(
  hoursOverdue: number,
  levels: readonly { level: number; name: string; triggerHoursOverdue: number }[]
): { level: number; name: string; triggerHoursOverdue: number } | null {
  const eligible = levels.filter((entry) => hoursOverdue >= entry.triggerHoursOverdue).sort((a, b) => b.level - a.level);
  return eligible[0] ?? null;
}
