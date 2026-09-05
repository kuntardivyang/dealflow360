// Display helpers. Storage is paise and basis points; only the UI converts.
import type { Bp, Money } from "@/lib/contract";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** 5280000 -> "₹52,800.00" */
export const formatPaise = (paise: Money): string => inr.format(paise / 100);

/** 1250 -> "12.5%", 1200 -> "12%" */
export const formatBp = (bp: Bp): string => `${Number((bp / 100).toFixed(2))}%`;

/** Percentage points for overage badges: 800 -> "8pt" */
export const formatPt = (bp: Bp): string => `${Number((bp / 100).toFixed(2))}pt`;

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export const formatDate = (d: Date | string): string => dateFmt.format(typeof d === "string" ? new Date(d) : d);
export const formatDateTime = (d: Date | string): string => dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
