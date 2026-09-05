import { describe, expect, it } from "vitest";
import { daysBetween, formatBp, formatDate, formatMoney, formatPaise, formatPoints, formatPt, initials } from "@/lib/format";

describe("format", () => {
  it("formats integer paise as INR with Indian grouping", () => {
    expect(formatMoney(52800000)).toBe("₹5,28,000.00");
    expect(formatMoney(0)).toBe("₹0.00");
    expect(formatMoney(83333)).toBe("₹833.33");
  });

  it("formats basis points as percentages and points", () => {
    expect(formatBp(1250)).toBe("12.5%");
    expect(formatBp(1200)).toBe("12%");
    expect(formatBp(null)).toBe("n/a");
    expect(formatPoints(800)).toBe("8 pt");
    expect(formatPt(800)).toBe("8pt");
    expect(formatPaise(52800000)).toBe(formatMoney(52800000));
  });

  it("formats calendar dates without shifting the day", () => {
    expect(formatDate("2026-09-05")).toMatch(/05 Sep\w* 2026/);
    expect(formatDate(null)).toBe("–");
    expect(formatDate("2026-09-05T20:30:00Z")).toMatch(/06 Sep\w* 2026/);
  });

  it("counts whole days and builds initials", () => {
    expect(daysBetween(new Date("2026-08-27T10:00:00Z"), new Date("2026-09-05T09:00:00Z"))).toBe(8);
    expect(initials("Riya Rao")).toBe("RR");
    expect(initials("Admin")).toBe("A");
  });
});
