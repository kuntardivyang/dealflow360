import { describe, expect, it } from "vitest";
import { applyDiscount, divRound, marginBp, overageBp, pct } from "@/domain/money";

describe("money", () => {
  it("rounds half-up symmetrically", () => {
    expect(divRound(5, 10)).toBe(1);
    expect(divRound(4, 10)).toBe(0);
    expect(divRound(-5, 10)).toBe(-1);
    expect(divRound(25, 10)).toBe(3);
  });

  it("takes a percentage in basis points", () => {
    expect(pct(60000_00, 1200)).toBe(7200_00);
    expect(pct(1, 5000)).toBe(1); // 0.5 paise rounds up
    expect(pct(3, 3333)).toBe(1);
  });

  it("applies a discount", () => {
    expect(applyDiscount(10000, 1000)).toBe(9000);
    expect(applyDiscount(10000, 0)).toBe(10000);
    expect(applyDiscount(10000, 10000)).toBe(0);
  });

  it("computes margin in basis points and null without revenue", () => {
    expect(marginBp(9000, 6000)).toBe(3333); // price 100, cost 60, 10 % off
    expect(marginBp(0, 6000)).toBeNull();
    expect(marginBp(5000, 6000)).toBe(-2000);
  });

  it("reports overage only above the ceiling", () => {
    expect(overageBp(1800, 1000)).toBe(800); // PDF: 18 % given, 10 % allowed, 8 points over
    expect(overageBp(1200, 1500)).toBe(0); // PDF: 12 % given, 15 % allowed
  });
});
