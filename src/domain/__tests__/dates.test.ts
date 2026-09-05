import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysInclusive, diffDays, isValidISODate, parseISODate, todayISO, toISODate } from "@/domain/dates";

describe("dates", () => {
  it("validates calendar dates strictly", () => {
    expect(isValidISODate("2026-09-05")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-9-5")).toBe(false);
    expect(() => parseISODate("nope")).toThrow();
  });

  it("round-trips through UTC midnight", () => {
    expect(toISODate(parseISODate("2026-09-05"))).toBe("2026-09-05");
    expect(parseISODate("2026-09-05").toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("uses the Asia/Kolkata calendar day for today", () => {
    expect(todayISO("Asia/Kolkata", new Date("2026-09-06T18:00:00Z"))).toBe("2026-09-06"); // 23:30 IST
    expect(todayISO("Asia/Kolkata", new Date("2026-09-06T18:31:00Z"))).toBe("2026-09-07"); // 00:01 IST next day
    expect(todayISO("UTC", new Date("2026-09-06T18:31:00Z"))).toBe("2026-09-06");
  });

  it("adds days and months with month-end clamping", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-09-01", 1)).toBe("2026-10-01");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("counts calendar days, September has 30 and October 31", () => {
    expect(diffDays("2026-09-01", "2026-09-21")).toBe(20);
    expect(daysInclusive("2026-09-01", "2026-09-30")).toBe(30);
    expect(daysInclusive("2026-10-01", "2026-10-31")).toBe(31);
    expect(diffDays("2026-09-05", "2026-09-01")).toBe(-4);
  });
});
