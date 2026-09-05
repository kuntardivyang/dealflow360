// Display formatting. Money is integer paise, percentages are integer basis points,
// timestamps are shown in Asia/Kolkata, calendar dates (YYYY-MM-DD) are shown as-is.
// Safe to import from server and client components.

export const DISPLAY_TZ = "Asia/Kolkata";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: DISPLAY_TZ, day: "2-digit", month: "short", year: "numeric" });
const dateFmtUtc = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: DISPLAY_TZ,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 52800000 -> "₹5,28,000.00" */
export function formatMoney(paise: number): string {
  return inr.format(paise / 100);
}

/** 52800000 -> "₹5.3L" (tiles and cards). */
export function formatMoneyCompact(paise: number): string {
  return inrCompact.format(paise / 100);
}

/** 1250 -> "12.5%"; null -> fallback (margin is null when net is zero). */
export function formatBp(bp: number | null | undefined, fallback = "n/a"): string {
  if (bp === null || bp === undefined) return fallback;
  return `${number.format(bp / 100)}%`;
}

/** 800 -> "8 pt" (overage in percentage points). */
export function formatPoints(bp: number): string {
  return `${number.format(bp / 100)} pt`;
}

/** A calendar date string ("2026-09-05") or a timestamp -> "05 Sept 2026". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "–";
  if (typeof value === "string") return dateFmtUtc.format(new Date(`${value}T00:00:00Z`));
  return dateFmt.format(value);
}

/** Timestamp -> "05 Sept, 14:30" in Asia/Kolkata. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "–";
  return dateTimeFmt.format(typeof value === "string" ? new Date(value) : value);
}

/** Whole days between two instants, floored (used for "idle 9 days"). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** "Riya Rao" -> "RR" for avatars. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
