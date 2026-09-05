import { describe, expect, it } from "vitest";
import { previewRisk } from "@/services/risk-preview";
import type { RiskWeights, RoutingRule } from "@/lib/contract";

const cfg: RiskWeights = { wWorst: 50, wBlended: 40, wMargin: 10, normWorstBp: 1000, normBlendedBp: 500, normMarginBp: 1000, floorMarginBp: 2000 };
const rules: RoutingRule[] = [
  { sequence: 1, minScore: 1, maxWorstOverageBp: null, maxOrderTotal: null, chain: ["SALES_MANAGER"] },
  { sequence: 2, minScore: 50, maxWorstOverageBp: 1000, maxOrderTotal: 100_000_000, chain: ["SALES_MANAGER", "FINANCE"] },
];

describe("risk preview (provisional, same spec as domain/risk)", () => {
  it("scores the PDF section 10 example at 42 and routes to the Sales Manager only", () => {
    const r = previewRisk(
      [
        { lineId: 1, effectiveDiscountBp: 1200, ceilingBp: 1500, gross: 600000_00 }, // laptop 12 % vs 15 %
        { lineId: 2, effectiveDiscountBp: 1800, ceilingBp: 1000, gross: 16000_00 }, // setup 18 % vs 10 %
      ],
      2017,
      638521_60,
      cfg,
      rules,
    );
    expect(r.lines[0].overageBp).toBe(0);
    expect(r.lines[1].overageBp).toBe(800);
    expect(r.worstOverageBp).toBe(800);
    expect(r.blendedOverageBp).toBe(21);
    expect(r.marginPenaltyBp).toBe(0);
    expect(r.score).toBe(42);
    expect(r.chain).toEqual(["SALES_MANAGER"]);
    expect(r.band).toBe("MEDIUM");
  });

  it("returns an empty chain and zero score when every line is within its limit", () => {
    const r = previewRisk([{ lineId: 1, effectiveDiscountBp: 500, ceilingBp: 1000, gross: 100 }], 2500, 118, cfg, rules);
    expect(r.score).toBe(0);
    expect(r.chain).toEqual([]);
  });

  it("spreads matter: three lines a little over score higher than one line over with the rest within limits", () => {
    const oneBadLine = previewRisk(
      [
        { lineId: 1, effectiveDiscountBp: 1300, ceilingBp: 1000, gross: 1000 },
        { lineId: 2, effectiveDiscountBp: 900, ceilingBp: 1000, gross: 1000 },
        { lineId: 3, effectiveDiscountBp: 800, ceilingBp: 1000, gross: 1000 },
      ],
      3000,
      3000,
      cfg,
      rules,
    );
    const everyLineOver = previewRisk(
      [
        { lineId: 1, effectiveDiscountBp: 1200, ceilingBp: 1000, gross: 1000 },
        { lineId: 2, effectiveDiscountBp: 1300, ceilingBp: 1000, gross: 1000 },
        { lineId: 3, effectiveDiscountBp: 1200, ceilingBp: 1000, gross: 1000 },
      ],
      3000,
      3000,
      cfg,
      rules,
    );
    expect(oneBadLine.worstOverageBp).toBe(everyLineOver.worstOverageBp); // same worst line, 3 points
    expect(everyLineOver.blendedOverageBp).toBeGreaterThan(oneBadLine.blendedOverageBp);
    expect(everyLineOver.score).toBeGreaterThan(oneBadLine.score);
  });

  it("escalates to Finance when the worst overage passes the second rule", () => {
    const r = previewRisk([{ lineId: 1, effectiveDiscountBp: 3000, ceilingBp: 500, gross: 1000 }], 1000, 1180, cfg, rules); // Bronze, 30 % order discount
    expect(r.worstOverageBp).toBe(2500);
    expect(r.chain).toEqual(["SALES_MANAGER", "FINANCE"]);
  });
});
