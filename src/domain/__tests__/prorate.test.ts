import { describe, expect, it } from "vitest";
import { buildSchedule, nextPeriodStart, periodEnd, prorate } from "@/domain/prorate";

describe("periods", () => {
  it("uses real month lengths", () => {
    expect(periodEnd("2026-09-01", "MONTH")).toBe("2026-09-30");
    expect(periodEnd("2026-10-01", "MONTH")).toBe("2026-10-31");
    expect(periodEnd("2026-02-01", "MONTH")).toBe("2026-02-28");
    expect(nextPeriodStart("2026-01-31", "MONTH")).toBe("2026-02-28");
    expect(periodEnd("2026-09-06", "QUARTER")).toBe("2026-12-05");
    expect(periodEnd("2026-09-06", "YEAR")).toBe("2027-09-05");
    expect(periodEnd("2026-09-06", "WEEK")).toBe("2026-09-12");
  });

  it("builds a 12 period monthly schedule billed on the first day of each period", () => {
    const s = buildSchedule("2026-09-06", "MONTH", 12, 2000_00, 1800);
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ periodStart: "2026-09-06", periodEnd: "2026-10-05", billDate: "2026-09-06", net: 2000_00, tax: 360_00, total: 2360_00 });
    expect(s[11].periodStart).toBe("2027-08-06");
    expect(s.reduce((a, p) => a + p.total, 0)).toBe(12 * 2360_00);
  });
});

describe("prorate", () => {
  const base = { periodStart: "2026-09-01", periodEnd: "2026-09-30", unitPrice: 90_00, discountBp: 0, oldQty: 1, newQty: 2, mode: "DAY_BASED" as const, billChangeDay: true };

  it("charges the extra seat for the remaining days of a 30 day month", () => {
    const r = prorate({ ...base, changeDate: "2026-09-21" });
    expect(r.daysInPeriod).toBe(30);
    expect(r.remainingDays).toBe(10);
    expect(r.credit).toBe(30_00);
    expect(r.charge).toBe(60_00);
    expect(r.net).toBe(30_00);
  });

  it("uses 31 days in October and rounds each side half-up", () => {
    const r = prorate({ ...base, periodStart: "2026-10-01", periodEnd: "2026-10-31", changeDate: "2026-10-21" });
    expect(r.daysInPeriod).toBe(31);
    expect(r.remainingDays).toBe(11);
    expect(r.credit).toBe(31_94); // 9000 * 11 / 31 = 3193.5
    expect(r.charge).toBe(63_87); // 18000 * 11 / 31 = 6387.1
    expect(r.net).toBe(31_93);
  });

  it("matches the demo: Support Pro 1,000 a month, 2 to 3 seats with 25 days left", () => {
    const r = prorate({ ...base, unitPrice: 1000_00, oldQty: 2, newQty: 3, changeDate: "2026-09-06" });
    expect(r.remainingDays).toBe(25);
    expect(r.net).toBe(833_33);
  });

  it("gives a credit when quantity goes down, nothing in mode NONE, and respects billChangeDay", () => {
    expect(prorate({ ...base, changeDate: "2026-09-21", oldQty: 2, newQty: 1 }).net).toBe(-30_00);
    expect(prorate({ ...base, changeDate: "2026-09-21", mode: "NONE" }).net).toBe(0);
    expect(prorate({ ...base, changeDate: "2026-09-21", billChangeDay: false }).remainingDays).toBe(9);
    expect(prorate({ ...base, changeDate: "2026-10-05" }).remainingDays).toBe(0);
  });

  it("applies the line discount to the prorated amounts", () => {
    const r = prorate({ ...base, changeDate: "2026-09-21", discountBp: 1000 });
    expect(r.credit).toBe(27_00); // 8100 * 10 / 30
    expect(r.charge).toBe(54_00);
  });
});
