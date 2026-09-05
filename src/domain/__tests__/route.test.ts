import { describe, expect, it } from "vitest";
import type { RiskResult, RoutingRule } from "@/lib/contract";
import { needsReview, riskPreview, routeApproval } from "@/domain/route";

// Seeded approval rules.
const rules: RoutingRule[] = [
  { sequence: 1, minScore: 1, maxWorstOverageBp: null, maxOrderTotal: null, chain: ["SALES_MANAGER"] },
  { sequence: 2, minScore: 50, maxWorstOverageBp: 1000, maxOrderTotal: 10_00_000_00, chain: ["SALES_MANAGER", "FINANCE"] },
];

const result = (over: Partial<RiskResult>): RiskResult => ({
  score: 0,
  worstOverageBp: 0,
  blendedOverageBp: 0,
  marginBp: 2500,
  marginPenaltyBp: 0,
  lines: [],
  ...over,
});

describe("routeApproval", () => {
  it("returns no chain when nothing is over a limit, however large the order", () => {
    const clean = result({});
    expect(needsReview(clean)).toBe(false);
    expect(routeApproval(clean, 50_00_000_00, rules)).toEqual([]);
  });

  it("routes the PDF example (score 42, worst 8 pp) to the Sales Manager only", () => {
    expect(routeApproval(result({ score: 42, worstOverageBp: 800, blendedOverageBp: 21 }), 6_38_521_60, rules)).toEqual(["SALES_MANAGER"]);
  });

  it("adds Finance when the worst overage passes the second rule's threshold", () => {
    expect(routeApproval(result({ score: 100, worstOverageBp: 2500 }), 1_00_000_00, rules)).toEqual(["SALES_MANAGER", "FINANCE"]);
    expect(routeApproval(result({ score: 30, worstOverageBp: 1200 }), 1_00_000_00, rules)).toEqual(["SALES_MANAGER", "FINANCE"]);
  });

  it("adds Finance for a large order once something is over a limit", () => {
    const small = result({ score: 5, worstOverageBp: 100 });
    expect(routeApproval(small, 9_00_000_00, rules)).toEqual(["SALES_MANAGER"]);
    expect(routeApproval(small, 12_00_000_00, rules)).toEqual(["SALES_MANAGER", "FINANCE"]);
  });

  it("gives different chains for the same score under different rule sets", () => {
    const r = result({ score: 42, worstOverageBp: 800 });
    const stricter: RoutingRule[] = [rules[0], { ...rules[1], minScore: 40 }];
    expect(routeApproval(r, 1000, rules)).toEqual(["SALES_MANAGER"]);
    expect(routeApproval(r, 1000, stricter)).toEqual(["SALES_MANAGER", "FINANCE"]);
  });

  it("takes the longest chain among fired rules, never an average, regardless of rule order", () => {
    const shuffled: RoutingRule[] = [rules[1], rules[0]];
    expect(routeApproval(result({ score: 60, worstOverageBp: 300 }), 1000, shuffled)).toEqual(["SALES_MANAGER", "FINANCE"]);
  });

  it("still reviews a tiny overage whose score rounds to zero: the first rule catches it", () => {
    expect(routeApproval(result({ score: 0, worstOverageBp: 5 }), 1000, rules)).toEqual(["SALES_MANAGER"]);
  });

  it("falls back to the Sales Manager when no rules are configured at all", () => {
    expect(routeApproval(result({ score: 42, worstOverageBp: 800 }), 1000, [])).toEqual(["SALES_MANAGER"]);
  });

  it("routes a margin-floor breach with no line over its limit", () => {
    expect(routeApproval(result({ score: 15, marginBp: 500, marginPenaltyBp: 1500 }), 1000, rules)).toEqual(["SALES_MANAGER"]);
  });
});

describe("riskPreview", () => {
  it("attaches the chain and the band", () => {
    expect(riskPreview(result({ score: 42, worstOverageBp: 800 }), 1000, rules)).toMatchObject({ chain: ["SALES_MANAGER"], band: "MEDIUM" });
    expect(riskPreview(result({}), 1000, rules)).toMatchObject({ chain: [], band: "LOW" });
    expect(riskPreview(result({ score: 50, worstOverageBp: 1200 }), 1000, rules)).toMatchObject({ chain: ["SALES_MANAGER", "FINANCE"], band: "HIGH" });
  });
});
