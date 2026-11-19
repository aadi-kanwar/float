import { formatInTimeZone } from "date-fns-tz";

/** All dates in the app are in India Standard Time. */
export const TIMEZONE = "Asia/Kolkata";

/** Today's date (YYYY-MM-DD) in Asia/Kolkata. */
export function todayInIndia(nowMs = Date.now()): string {
  return formatInTimeZone(new Date(nowMs), TIMEZONE, "yyyy-MM-dd");
}

/** "YYYY-MM" of a date. */
export const monthOf = (date: string) => date.slice(0, 7);

// ---------------------------------------------------------------------------
// India-time calendar helpers for the money rules. India has no daylight
// saving, so IST is always UTC+05:30 and plain arithmetic is exact.
// ---------------------------------------------------------------------------

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** The India date (YYYY-MM-DD) of a moment. */
export function istDate(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The India month (YYYY-MM) of a moment. */
export const istMonth = (ms: number) => istDate(ms).slice(0, 7);

/** 00:00 India time on `date` (YYYY-MM-DD), as a moment. */
export function istStartOfDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - IST_OFFSET_MS;
}

/** "YYYY-MM" shifted by n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** The last date of a month, e.g. "2027-02" -> "2027-02-28". */
export function lastDateOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** "YYYY-MM-DD" shifted by n days. */
export function shiftDate(date: string, n: number): string {
  return istDate(istStartOfDay(date) + n * DAY_MS);
}

/** When a month's statement is made: its last day, 23:59 India time. */
export function statementTime(month: string): number {
  return istStartOfDay(lastDateOfMonth(month)) + (23 * 60 + 59) * 60 * 1000;
}

/** A statement's deadline date: `dueDay` of the next month. */
export function dueDateFor(month: string, dueDay: number): string {
  return `${shiftMonth(month, 1)}-${pad(dueDay)}`;
}

/** The deadline moment: the end of the due date (23:59:59.999 India time). */
export const endOfDay = (date: string) => istStartOfDay(date) + DAY_MS - 1;
