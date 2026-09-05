// Owner: B. Deal health (PDF B9): stalled deals, discount anomalies against the rep's own
// history, and delivery promise slippage. Pure functions; thresholds come from the
// RiskConfig row (stalledDays, anomalyZ, anomalyAbsBp, minHistory).
import type { Bp, HealthAlert, HealthConfig, OpenQuote, SlipRow } from "@/lib/contract";
import { diffDays, todayISO } from "./dates";

const DAY_MS = 86_400_000;
const OPEN = new Set(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "UNDER_NEGOTIATION"]);

export function meanAndSd(values: Bp[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/** Idle whole days since the last activity. */
export const idleDays = (lastActivityAt: Date, now: Date): number => Math.floor((now.getTime() - lastActivityAt.getTime()) / DAY_MS);

export function detectStalled(now: Date, open: OpenQuote[], cfg: HealthConfig): HealthAlert[] {
  return open
    .filter((q) => OPEN.has(q.status))
    .map((q) => ({ q, days: idleDays(q.lastActivityAt, now) }))
    .filter(({ days }) => days > cfg.stalledDays)
    .map(({ q, days }) => ({
      quotationId: q.quotationId,
      type: "STALLED" as const,
      severity: Math.max(1, Math.floor(days / cfg.stalledDays)),
      message: `Idle ${days} days (limit ${cfg.stalledDays})`,
      payload: { idleDays: days, stalledDays: cfg.stalledDays },
    }));
}

/**
 * A discount well above the rep's own average: z-score against the rep's history with the
 * standard deviation floored at one point, or at least anomalyAbsBp above the mean. Reps
 * with fewer than minHistory confirmed quotes are compared with the team instead.
 */
export function detectDiscountAnomalies(open: OpenQuote[], repHistory: Map<number, Bp[]>, teamHistory: Bp[], cfg: HealthConfig): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  for (const q of open) {
    if (!OPEN.has(q.status) || q.effectiveDiscountBp <= 0) continue;
    const own = repHistory.get(q.repUserId) ?? [];
    const baseline = own.length >= cfg.minHistory ? own : teamHistory;
    if (baseline.length === 0) continue;
    const { mean, sd } = meanAndSd(baseline);
    const z = (q.effectiveDiscountBp - mean) / Math.max(sd, 100);
    const overMean = q.effectiveDiscountBp - mean;
    if (z >= cfg.anomalyZ || overMean >= cfg.anomalyAbsBp) {
      alerts.push({
        quotationId: q.quotationId,
        type: "DISCOUNT_ANOMALY",
        severity: Math.max(1, Math.round(z)),
        message: `Discount ${(q.effectiveDiscountBp / 100).toFixed(1)}% vs ${own.length >= cfg.minHistory ? "rep" : "team"} average ${(mean / 100).toFixed(1)}%`,
        payload: { discountBp: q.effectiveDiscountBp, meanBp: Math.round(mean), sdBp: Math.round(sd), z: Number(z.toFixed(2)), baseline: own.length >= cfg.minHistory ? "rep" : "team" },
      });
    }
  }
  return alerts;
}

/** Promise date passed without shipping, or the expected date is later than promised. */
export function detectSlippage(today: string, slips: SlipRow[]): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  for (const s of slips) {
    if (s.shipped) continue;
    const late = s.expectedDate && s.expectedDate > s.promisedDate ? diffDays(s.promisedDate, s.expectedDate) : 0;
    const overdue = today > s.promisedDate ? diffDays(s.promisedDate, today) : 0;
    const slip = Math.max(late, overdue);
    if (slip <= 0) continue;
    alerts.push({
      quotationId: s.quotationId,
      type: "DELIVERY_SLIPPAGE",
      severity: slip,
      message: late > 0 ? `Expected ${s.expectedDate}, promised ${s.promisedDate} (${slip} days late)` : `Promised ${s.promisedDate}, not shipped (${slip} days overdue)`,
      payload: { promisedDate: s.promisedDate, expectedDate: s.expectedDate, slipDays: slip },
    });
  }
  return alerts;
}

export function detectAnomalies(now: Date, open: OpenQuote[], repHistory: Map<number, Bp[]>, teamHistory: Bp[], slips: SlipRow[], cfg: HealthConfig): HealthAlert[] {
  return [...detectStalled(now, open, cfg), ...detectDiscountAnomalies(open, repHistory, teamHistory, cfg), ...detectSlippage(todayISO("Asia/Kolkata", now), slips)];
}

/** 0..100, higher is healthier: idle days, risk and open flags each take points off. */
export function healthScore(idle: number, riskScore: number, anomaly: boolean, slippage: boolean): number {
  const score = 100 - Math.min(40, idle * 4) - Math.round(riskScore * 0.3) - (anomaly ? 15 : 0) - (slippage ? 15 : 0);
  return Math.max(0, Math.min(100, score));
}
