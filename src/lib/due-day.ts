/** A due date is a calendar day (India time): late only after that day has ended. */
const IST_OFFSET_MS = 5.5 * 3600000;
const DAY_MS = 86400000;

export function isPastDueDay(due: string | Date, now: number = Date.now()): boolean {
  const istMs = new Date(due).getTime() + IST_OFFSET_MS;
  const endOfDay = Math.floor(istMs / DAY_MS) * DAY_MS + DAY_MS - 1 - IST_OFFSET_MS;
  return now > endOfDay;
}
