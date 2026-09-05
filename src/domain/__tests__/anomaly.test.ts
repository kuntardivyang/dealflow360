import { describe, expect, it } from "vitest";
import type { HealthConfig, OpenQuote } from "@/lib/contract";
import { detectAnomalies, detectDiscountAnomalies, detectSlippage, detectStalled, healthScore, meanAndSd } from "@/domain/anomaly";

const cfg: HealthConfig = { stalledDays: 3, anomalyZ: 2, anomalyAbsBp: 1000, minHistory: 5 };
const now = new Date("2026-09-05T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const quote = (id: number, over: Partial<OpenQuote>): OpenQuote => ({ quotationId: id, repUserId: 1, status: "SENT", lastActivityAt: daysAgo(0), effectiveDiscountBp: 800, ...over });

describe("stalled deals", () => {
  it("flags open quotes idle longer than the configured days with severity days/threshold", () => {
    const alerts = detectStalled(now, [quote(1, { lastActivityAt: daysAgo(9) }), quote(2, { lastActivityAt: daysAgo(2) }), quote(3, { lastActivityAt: daysAgo(14), status: "CONFIRMED" })], cfg);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ quotationId: 1, type: "STALLED", severity: 3 });
    expect(alerts[0].message).toContain("Idle 9 days");
  });
});

describe("discount anomalies", () => {
  it("flags 22 % against a history of 6-9 % (z far above 2)", () => {
    const history = new Map([[1, [600, 700, 800, 900, 600]]]);
    const alerts = detectDiscountAnomalies([quote(1, { effectiveDiscountBp: 2200 })], history, [], cfg);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload).toMatchObject({ baseline: "rep" });
    expect(alerts[0].severity).toBeGreaterThanOrEqual(2);
  });

  it("does not flag a discount in line with the rep's history", () => {
    const history = new Map([[1, [600, 700, 800, 900, 600]]]);
    expect(detectDiscountAnomalies([quote(1, { effectiveDiscountBp: 900 })], history, [], cfg)).toHaveLength(0);
  });

  it("falls back to the team when the rep has too little history, and stays quiet with no history at all", () => {
    const thin = new Map([[1, [700, 800]]]);
    expect(detectDiscountAnomalies([quote(1, { effectiveDiscountBp: 2200 })], thin, [600, 700, 800, 900], cfg)[0]?.payload).toMatchObject({ baseline: "team" });
    expect(detectDiscountAnomalies([quote(1, { effectiveDiscountBp: 2200 })], new Map(), [], cfg)).toHaveLength(0);
  });

  it("floors the standard deviation at one point so a flat history still needs a real jump", () => {
    const flat = new Map([[1, [800, 800, 800, 800, 800]]]);
    expect(detectDiscountAnomalies([quote(1, { effectiveDiscountBp: 950 })], flat, [], cfg)).toHaveLength(0); // z = 1.5 with the 1 pt floor
    expect(detectDiscountAnomalies([quote(1, { effectiveDiscountBp: 1000 })], flat, [], cfg)).toHaveLength(1); // z = 2.0
    expect(detectDiscountAnomalies([quote(1, { effectiveDiscountBp: 1000 })], flat, [], { ...cfg, anomalyZ: 3 })).toHaveLength(0);
    expect(meanAndSd([800, 800]).sd).toBe(0);
  });
});

describe("delivery slippage", () => {
  it("flags an expected date after the promise and an overdue promise", () => {
    const alerts = detectSlippage("2026-09-05", [
      { quotationId: 1, promisedDate: "2026-09-04", expectedDate: "2026-09-07", shipped: false },
      { quotationId: 2, promisedDate: "2026-09-01", expectedDate: null, shipped: false },
      { quotationId: 3, promisedDate: "2026-09-01", expectedDate: null, shipped: true },
      { quotationId: 4, promisedDate: "2026-09-10", expectedDate: "2026-09-09", shipped: false },
    ]);
    expect(alerts.map((a) => [a.quotationId, a.severity])).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });
});

describe("detectAnomalies and healthScore", () => {
  it("combines the three detectors", () => {
    const all = detectAnomalies(now, [quote(1, { lastActivityAt: daysAgo(9), effectiveDiscountBp: 2200 })], new Map([[1, [600, 700, 800, 900, 600]]]), [], [{ quotationId: 9, promisedDate: "2026-09-01", expectedDate: null, shipped: false }], cfg);
    expect(all.map((a) => a.type).sort()).toEqual(["DELIVERY_SLIPPAGE", "DISCOUNT_ANOMALY", "STALLED"]);
  });

  it("scores health between 0 and 100", () => {
    expect(healthScore(0, 0, false, false)).toBe(100);
    expect(healthScore(9, 42, true, false)).toBe(100 - 36 - 13 - 15);
    expect(healthScore(30, 100, true, true)).toBe(0);
  });
});
