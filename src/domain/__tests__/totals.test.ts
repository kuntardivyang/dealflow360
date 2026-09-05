import { describe, expect, it } from "vitest";
import { computeLineTotals, computeTotals, effectiveDiscountBp } from "@/domain/totals";
import type { LineInput } from "@/lib/contract";

const laptop: LineInput = { lineId: 1, unitPrice: 60000_00, qty: 10, discountBp: 1200, unitCost: 42000_00, taxBp: 1800 };
const setup: LineInput = { lineId: 2, unitPrice: 8000_00, qty: 2, discountBp: 1800, unitCost: 6000_00, taxBp: 1800 };

describe("effective discount", () => {
  it("compounds line and order discounts", () => {
    expect(effectiveDiscountBp(0, 0)).toBe(0);
    expect(effectiveDiscountBp(1200, 0)).toBe(1200);
    expect(effectiveDiscountBp(0, 3000)).toBe(3000); // Bronze case from the blueprint
    expect(effectiveDiscountBp(1000, 1000)).toBe(1900); // 1 - 0.9 * 0.9
    expect(effectiveDiscountBp(10000, 5000)).toBe(10000);
  });
});

describe("line totals", () => {
  it("matches the PDF section 10 laptop line", () => {
    const t = computeLineTotals(laptop, 0);
    expect(t.gross).toBe(600000_00);
    expect(t.discountAmount).toBe(72000_00);
    expect(t.net).toBe(528000_00); // 5,28,000.00 as in the demo script
    expect(t.tax).toBe(95040_00);
    expect(t.total).toBe(623040_00);
    expect(t.cost).toBe(420000_00);
  });

  it("rounds once per component", () => {
    const t = computeLineTotals({ lineId: 3, unitPrice: 1, qty: 1, discountBp: 3333, unitCost: 0, taxBp: 1800 }, 0);
    expect(t.discountAmount).toBe(0); // 0.3333 paise rounds down
    expect(t.net).toBe(1);
    expect(t.tax).toBe(0); // 0.18 paise rounds down
    expect(Number.isInteger(t.total)).toBe(true);
  });
});

describe("quotation totals", () => {
  it("sums the PDF example and reports the margin", () => {
    const t = computeTotals([laptop, setup], 0);
    expect(t.netTotal).toBe(528000_00 + 13120_00);
    expect(t.total).toBe(t.netTotal + t.taxTotal);
    expect(t.total).toBe(t.lines.reduce((a, l) => a + l.total, 0));
    expect(t.costTotal).toBe(432000_00);
    expect(t.marginBp).toBe(2017); // (5,41,120 - 4,32,000) / 5,41,120 = 20.17 %, the "20.2 %" of the demo script
  });

  it("matches the seeded Beta hybrid draft exactly", () => {
    const t = computeTotals(
      [
        { lineId: 1, unitPrice: 60000_00, qty: 2, discountBp: 500, unitCost: 42000_00, taxBp: 1800 },
        { lineId: 2, unitPrice: 1000_00, qty: 2, discountBp: 0, unitCost: 400_00, taxBp: 1800 },
      ],
      0,
    );
    expect(t.netTotal).toBe(116000_00);
    expect(t.taxTotal).toBe(20880_00);
    expect(t.total).toBe(136880_00);
    expect(t.marginBp).toBe(2690);
  });

  it("returns a null margin with no lines", () => {
    const t = computeTotals([], 0);
    expect(t.total).toBe(0);
    expect(t.marginBp).toBeNull();
  });

  it("keeps totals equal to the sum of lines for random inputs", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 200; i++) {
      const lines: LineInput[] = Array.from({ length: 1 + rnd(6) }, (_, k) => ({
        lineId: k,
        unitPrice: rnd(10_000_000),
        qty: 1 + rnd(50),
        discountBp: rnd(10001),
        unitCost: rnd(10_000_000),
        taxBp: rnd(2801),
      }));
      const t = computeTotals(lines, rnd(10001));
      expect(t.total).toBe(t.lines.reduce((a, l) => a + l.total, 0));
      expect(t.netTotal).toBe(t.grossTotal - t.discountTotal);
      expect(t.total).toBe(t.netTotal + t.taxTotal);
      for (const l of t.lines) expect(Number.isInteger(l.total) && l.net >= 0).toBe(true);
    }
  });
});
