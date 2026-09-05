// What this customer has already extracted, shown to the rep at the moment they answer a
// counter-offer. The discount anomaly detector (anomaly.ts) asks "is this unusual for the
// REP?"; this asks "is this unusual for the CUSTOMER?" — the same statistic pointed at the
// other party. Pure integer basis points; the caller supplies the history.
import type { Bp } from "@/lib/contract";
import { meanAndSd } from "./anomaly";

/** What a customer has historically been given, across their own closed orders. */
export interface ConcessionHistory {
  /** Closed orders the average is drawn from. */
  count: Bp;
  meanBp: Bp;
  maxBp: Bp;
  sdBp: Bp;
}

export type ConcessionBand = "IN_LINE" | "ABOVE_AVERAGE" | "HIGHEST_EVER";

export interface ConcessionVerdict {
  proposedBp: Bp;
  /** Points above the customer's own average; 0 when at or below it. */
  overMeanBp: Bp;
  band: ConcessionBand;
}

/**
 * Summarise a customer's realised order-level discounts. `null` when there is no history
 * to compare against, so the caller can stay silent rather than quote an average of one.
 */
export function summariseConcessions(history: Bp[], minHistory = 2): ConcessionHistory | null {
  if (history.length < minHistory) return null;
  const { mean, sd } = meanAndSd(history);
  return {
    count: history.length,
    meanBp: Math.round(mean),
    maxBp: Math.max(...history),
    sdBp: Math.round(sd),
  };
}

/**
 * Where a proposed discount sits against that history. Deliberately blunt: a rep glancing
 * at this while deciding needs "worse than usual" or "worse than ever", not a z-score.
 */
export function judgeProposal(history: ConcessionHistory, proposedBp: Bp): ConcessionVerdict {
  const overMeanBp = Math.max(0, proposedBp - history.meanBp);
  const band: ConcessionBand = proposedBp > history.maxBp ? "HIGHEST_EVER" : proposedBp > history.meanBp ? "ABOVE_AVERAGE" : "IN_LINE";
  return { proposedBp, overMeanBp, band };
}
