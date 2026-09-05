import { describe, expect, it } from "vitest";
import { judgeProposal, summariseConcessions } from "@/domain/concession";

describe("summariseConcessions", () => {
  it("summarises a customer's realised discounts", () => {
    // 8 %, 12 %, 10 %, 14 %, 11 %
    const h = summariseConcessions([800, 1200, 1000, 1400, 1100]);
    expect(h).not.toBeNull();
    expect(h!.count).toBe(5);
    expect(h!.meanBp).toBe(1100); // 5500 / 5
    expect(h!.maxBp).toBe(1400);
  });

  it("stays silent rather than quote an average of one", () => {
    expect(summariseConcessions([])).toBeNull();
    expect(summariseConcessions([1200])).toBeNull();
    expect(summariseConcessions([1200, 800])).not.toBeNull();
  });

  it("honours a caller-supplied minimum", () => {
    expect(summariseConcessions([1200, 800], 5)).toBeNull();
    expect(summariseConcessions([1200, 800, 900, 1000, 1100], 5)).not.toBeNull();
  });

  it("rounds the mean to whole basis points", () => {
    // 1000 + 1001 + 1001 = 3002 / 3 = 1000.67
    expect(summariseConcessions([1000, 1001, 1001])!.meanBp).toBe(1001);
  });
});

describe("judgeProposal", () => {
  const history = summariseConcessions([800, 1200, 1000, 1400, 1100])!; // mean 1100, max 1400

  it("calls a counter at or below the average in line", () => {
    expect(judgeProposal(history, 900).band).toBe("IN_LINE");
    expect(judgeProposal(history, 1100).band).toBe("IN_LINE");
    expect(judgeProposal(history, 900).overMeanBp).toBe(0);
  });

  it("flags a counter above the average, with the gap in points", () => {
    const v = judgeProposal(history, 1300);
    expect(v.band).toBe("ABOVE_AVERAGE");
    expect(v.overMeanBp).toBe(200); // 13 % against an 11 % average
  });

  it("flags a counter worse than anything they have ever had", () => {
    const v = judgeProposal(history, 1500);
    expect(v.band).toBe("HIGHEST_EVER");
    expect(v.overMeanBp).toBe(400);
  });

  it("treats matching the previous worst as merely above average, not a new high", () => {
    expect(judgeProposal(history, 1400).band).toBe("ABOVE_AVERAGE");
  });
});
