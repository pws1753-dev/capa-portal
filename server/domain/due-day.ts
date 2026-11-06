/**
 * A target date is a calendar day (India time). Work finished at any time on that day is on time;
 * it counts as late only when it is done after the day has ended.
 */
const IST_OFFSET_MS = 5.5 * 3600000;
const DAY_MS = 86400000;

/** The last moment (23:59:59.999 IST) of the calendar day a due timestamp falls on. */
export function endOfDueDay(due: Date | string): Date {
  const istMs = new Date(due).getTime() + IST_OFFSET_MS;
  const dayStart = Math.floor(istMs / DAY_MS) * DAY_MS;
  return new Date(dayStart + DAY_MS - 1 - IST_OFFSET_MS);
}

/** 00:00 IST of the day `now` falls on: a due date is overdue only when it is before this. */
export function startOfTodayIST(now: Date = new Date()): Date {
  const istMs = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(istMs / DAY_MS) * DAY_MS - IST_OFFSET_MS);
}

export function isPastDueDay(due: Date | string, now: Date = new Date()): boolean {
  return now.getTime() > endOfDueDay(due).getTime();
}

// Deployed from the capa-portal repository.
