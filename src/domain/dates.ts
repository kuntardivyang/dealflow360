// Calendar dates travel as YYYY-MM-DD strings. The server runs in UTC; "today"
// for business purposes is the Asia/Kolkata calendar date. No time-of-day math here.
import type { ISODate } from "@/lib/contract";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isValidISODate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** UTC midnight Date for a calendar date. Throws on malformed input. */
export function parseISODate(s: ISODate): Date {
  if (!isValidISODate(s)) throw new Error(`Invalid calendar date: ${s}`);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Calendar date from the UTC components of a Date (use for @db.Date values). */
export function toISODate(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's calendar date in a time zone (default Asia/Kolkata). */
export function todayISO(timeZone = "Asia/Kolkata", now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return toISODate(new Date(parseISODate(date).getTime() + days * DAY_MS));
}

/** Add months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28). */
export function addMonths(date: ISODate, months: number): ISODate {
  const d = parseISODate(date);
  const targetMonth = d.getUTCMonth() + months;
  const first = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return toISODate(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), lastDay))));
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / DAY_MS);
}

/** Days in an inclusive range: Sep 1..Sep 30 = 30. */
export function daysInclusive(start: ISODate, end: ISODate): number {
  return diffDays(start, end) + 1;
}

export const compareISODate = (a: ISODate, b: ISODate): number => (a < b ? -1 : a > b ? 1 : 0);
