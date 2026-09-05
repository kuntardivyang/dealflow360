import { describe, expect, it } from "vitest";
import type { RiskLine, RiskWeights } from "@/lib/contract";
import { lineCeilingBp, riskScore, scoreLines } from "@/domain/risk";

// Seeded RiskConfig: 50/40/10, normalisers 10 pp / 5 pp / 10 pp, margin floor 20 %.
const cfg: RiskWeights = { wWorst: 50, wBlended: 40, wMargin: 10, normWorstBp: 1000, normBlendedBp: 500, normMarginBp: 1000, floorMarginBp: 2000 };

// PDF section 10: Gold customer (15 %), laptop 12 % against 15 %, setup service 18 % against 10 %.
const laptop: RiskLine = { lineId: 1, unitPrice: 60000_00, qty: 10, discountBp: 1200, unitCost: 42000_00, taxBp: 1800, categoryCeilingBp: 1500 };
const setup: RiskLine = { lineId: 2, unitPrice: 8000_00, qty: 2, discountBp: 1800, unitCost: 6000_00, taxBp: 1800, categoryCeilingBp: 1000 };

describe("per-line ceiling", () => {
  it("is the stricter of tier and category, and the tier alone when the category has none", () => {
    expect(lineCeilingBp(1500, 1000)).toBe(1000);
    expect(lineCeilingBp(500, 1500)).toBe(500);
    expect(lineCeilingBp(1500, null)).toBe(1500);
  });
});

describe("riskScore", () => {
  it("scores the PDF example at 42: laptop fine, service 8 points over its own limit", () => {
    const r = riskScore([laptop, setup], 1500, 0, cfg);
    expect(r.lines.map((l) => l.overageBp)).toEqual([0, 800]);
    expect(r.worstOverageBp).toBe(800);
    expect(r.blendedOverageBp).toBe(21); // 800 * 16,000 / 616,000 = 20.78 -> 21 bp
    expect(r.marginBp).toBe(2017); // 20.17 %, above the 20 % floor
    expect(r.marginPenaltyBp).toBe(0);
    expect(r.score).toBe(42);
  });

  it("is zero when every line is within its limit and the margin floor holds", () => {
    const r = riskScore([{ ...laptop, discountBp: 1000 }, { ...setup, discountBp: 500 }], 1500, 0, cfg);
    expect(r.worstOverageBp).toBe(0);
    expect(r.blendedOverageBp).toBe(0);
    expect(r.score).toBe(0);
  });

  it("tests ceilings on the effective discount, so an order discount cannot bypass them", () => {
    // Bronze (5 %), lines at 0 %, order discount 30 %: effective 30 %, 25 points over.
    const r = riskScore([{ ...laptop, discountBp: 0, categoryCeilingBp: null }], 500, 3000, cfg);
    expect(r.lines[0].effectiveDiscountBp).toBe(3000);
    expect(r.worstOverageBp).toBe(2500);
    expect(r.score).toBe(100);
  });

  it("penalises a thin margin even when no line is over its limit", () => {
    const thin: RiskLine = { lineId: 1, unitPrice: 100_00, qty: 1, discountBp: 0, unitCost: 95_00, taxBp: 1800, categoryCeilingBp: null };
    const r = riskScore([thin], 1500, 0, cfg);
    expect(r.worstOverageBp).toBe(0);
    expect(r.marginBp).toBe(500);
    expect(r.marginPenaltyBp).toBe(1500);
    expect(r.score).toBe(15); // 10 % weight * 1500 / 1000 = 0.15
  });

  it("reads its weights from the config row: worst-only weights turn the PDF example into 80", () => {
    const worstOnly: RiskWeights = { ...cfg, wWorst: 100, wBlended: 0, wMargin: 0 };
    expect(riskScore([laptop, setup], 1500, 0, worstOnly).score).toBe(80);
  });
});

describe("scoreLines (from snapshotted lines)", () => {
  const line = (lineId: number, effectiveDiscountBp: number) => ({ lineId, effectiveDiscountBp, ceilingBp: 1000, gross: 1000_00 });

  it("blends: three lines 2, 3 and 2 points over score higher than one line 3 points over", () => {
    const spread = scoreLines([line(1, 1200), line(2, 1300), line(3, 1200)], 3000, cfg);
    const single = scoreLines([line(1, 1300), line(2, 900), line(3, 800)], 3000, cfg);
    expect(spread.worstOverageBp).toBe(single.worstOverageBp);
    expect(spread.blendedOverageBp).toBe(233);
    expect(single.blendedOverageBp).toBe(100);
    expect(spread.score).toBeGreaterThan(single.score);
  });

  it("weights the blended overage by line value", () => {
    const bigLineOver = scoreLines([{ ...line(1, 1300), gross: 9000_00 }, { ...line(2, 1000), gross: 1000_00 }], 3000, cfg);
    const smallLineOver = scoreLines([{ ...line(1, 1300), gross: 1000_00 }, { ...line(2, 1000), gross: 9000_00 }], 3000, cfg);
    expect(bigLineOver.blendedOverageBp).toBe(270);
    expect(smallLineOver.blendedOverageBp).toBe(30);
  });

  it("clamps at 100 and treats a null margin (zero revenue) as no penalty", () => {
    expect(scoreLines([line(1, 9000)], null, cfg).score).toBe(100);
    expect(scoreLines([], null, cfg)).toMatchObject({ score: 0, worstOverageBp: 0, blendedOverageBp: 0, marginPenaltyBp: 0 });
  });
});
