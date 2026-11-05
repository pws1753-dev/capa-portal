import { MANAGEMENT_ESCALATION_DAYS, WORKFLOW_STAGES, type WorkflowStage } from "@shared/constants/domain";
import { endOfDueDay } from "./due-day";

const HOUR_MS = 60 * 60 * 1000;

export type StageDelay = {
  stage: WorkflowStage;
  /** When the stage was completed, if it has been. */
  completedAt: Date | null;
  dueAt: Date;
  /** Whole hours past the due date; 0 when the stage is complete or not yet late. */
  overdueHours: number;
  /** Incomplete and past its due date. */
  delayed: boolean;
};

/**
 * The four TAT milestones with how late each is. A stage counts as delayed while it is incomplete
 * and past its due date, whatever state the complaint's earlier stages are in.
 */
export function stageDelays(
  dues: Record<WorkflowStage, Date>,
  completed: Partial<Record<WorkflowStage, Date | null>>,
  now: Date
): StageDelay[] {
  return WORKFLOW_STAGES.map((stage) => {
    const completedAt = completed[stage] ? new Date(completed[stage] as Date) : null;
    // Late only after the due date's day has ended; hours are counted from then.
    const lateMs = now.getTime() - endOfDueDay(dues[stage]).getTime();
    const delayed = !completedAt && lateMs > 0;
    return { stage, completedAt, dueAt: dues[stage], overdueHours: delayed ? Math.floor(lateMs / HOUR_MS) : 0, delayed };
  });
}

/** Management level people are copied only when a delay is more than ten days (strictly), not at ten. */
export function needsManagementEscalation(maxOverdueHours: number): boolean {
  return maxOverdueHours > MANAGEMENT_ESCALATION_DAYS * 24;
}

const dateText = (date: Date) => date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** "less than a day", "1 day", "28 days". */
export function lateText(hours: number): string {
  const days = Math.floor(hours / 24);
  return days < 1 ? "less than a day" : `${days} day${days === 1 ? "" : "s"}`;
}

/** One line per stage for the email: completed, delayed (and by how much), or still on time. */
export function stageStatusText(entry: StageDelay): string {
  if (entry.completedAt) return `Completed on ${dateText(entry.completedAt)}`;
  return entry.delayed ? `DELAYED by ${lateText(entry.overdueHours)} (was due ${dateText(entry.dueAt)})` : `Due ${dateText(entry.dueAt)}`;
}
