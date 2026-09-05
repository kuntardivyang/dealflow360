import { describe, expect, it } from "vitest";
import { reportFilterSchema } from "@/lib/validation/reports";
import { zISODate } from "@/lib/validation/common";
import { parseInput } from "@/lib/contract";

describe("zISODate", () => {
  // A `.refine()` still runs when the preceding `.regex()` fails, so the refine must not
  // assume the string is date-shaped. Building `new Date("T00:00:00Z")` and calling
  // toISOString() on it throws a RangeError, which escapes safeParse and reaches the user
  // as a 500 instead of a field error.
  it("returns a failed result for malformed input instead of throwing", () => {
    for (const bad of ["", "   ", "nonsense", "2026-9-5", "05-09-2026", "2026-09-05T00:00:00Z"]) {
      expect(() => zISODate.safeParse(bad), `safeParse(${JSON.stringify(bad)}) must not throw`).not.toThrow();
      expect(zISODate.safeParse(bad).success, `safeParse(${JSON.stringify(bad)}) should fail`).toBe(false);
    }
  });

  it("accepts real calendar dates and rejects impossible ones", () => {
    expect(zISODate.safeParse("2026-09-05").success).toBe(true);
    expect(zISODate.safeParse("2024-02-29").success).toBe(true); // leap year
    expect(zISODate.safeParse("2026-02-29").success).toBe(false); // not a leap year
    expect(zISODate.safeParse("2026-02-31").success).toBe(false);
    expect(zISODate.safeParse("2026-13-01").success).toBe(false);
  });
});

describe("reportFilterSchema", () => {
  // The filter UI is a plain GET form, so every field is submitted on every Apply and the
  // unused ones arrive as "". `.optional()` only tolerates `undefined`, so a blank field
  // used to fail the whole object and silently reset every filter to its default.
  const asSubmittedByTheForm = (over: Record<string, string> = {}) => ({
    period: "month",
    from: "",
    to: "",
    repUserId: "",
    approval: "all",
    productId: "",
    categoryId: "",
    ...over,
  });

  it("applies a period the form submitted, instead of falling back to the default", () => {
    const result = parseInput(reportFilterSchema, asSubmittedByTheForm({ period: "today" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.period).toBe("today");
  });

  it("applies a rep filter chosen while every other dropdown is left blank", () => {
    const result = parseInput(reportFilterSchema, asSubmittedByTheForm({ repUserId: "4" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.repUserId).toBe(4);
  });

  it("applies an approval filter the same way", () => {
    const result = parseInput(reportFilterSchema, asSubmittedByTheForm({ approval: "pending" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.approval).toBe("pending");
  });

  it("accepts a real custom range", () => {
    const result = parseInput(reportFilterSchema, asSubmittedByTheForm({ period: "custom", from: "2026-08-01", to: "2026-08-31" }));
    expect(result.ok).toBe(true);
  });

  it("still rejects a custom range that is missing its dates, and a malformed date", () => {
    expect(parseInput(reportFilterSchema, asSubmittedByTheForm({ period: "custom" })).ok).toBe(false);
    expect(parseInput(reportFilterSchema, asSubmittedByTheForm({ from: "not-a-date" })).ok).toBe(false);
  });

  it("never throws on anything the form can submit", () => {
    const overrides: Record<string, string>[] = [{}, { period: "today" }, { period: "custom" }, { from: "not-a-date" }, { repUserId: "abc" }];
    for (const over of overrides) {
      expect(() => parseInput(reportFilterSchema, asSubmittedByTheForm(over))).not.toThrow();
    }
  });
});
