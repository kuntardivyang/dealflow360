// Owner: B. Blended discount risk score (PDF section 10).
// Every line is checked against its own ceiling, the stricter of the customer tier
// and the product category. The score blends the worst single overage, the
// value-weighted overage across the whole order (so many small violations cannot
// hide), and any shortfall under the margin floor. Weights and normalisers come
// from the RiskConfig row; nothing here is a constant.
import type { Bp, Money, RiskLine, RiskLineResult, RiskResult, RiskWeights } from "@/lib/contract";
import { divRound, overageBp } from "./money";
import { computeTotals } from "./totals";

/** A line once its effective discount and ceiling are known (quotation lines snapshot both). */
export interface ScoredLine {
  lineId: number;
  effectiveDiscountBp: Bp;
  ceilingBp: Bp;
  gross: Money;
}

/** Per-line ceiling: min(tier ceiling, category ceiling); a category without a ceiling inherits the tier's. */
export function lineCeilingBp(tierCeilingBp: Bp, categoryCeilingBp: Bp | null): Bp {
  return categoryCeilingBp === null ? tierCeilingBp : Math.min(tierCeilingBp, categoryCeilingBp);
}

/** value / norm, clamped so a zero normaliser cannot divide by zero. */
const ratio = (value: number, normBp: Bp): number => (normBp <= 0 ? (value > 0 ? 1 : 0) : value / normBp);

/**
 * score = round(100 * clamp(wWorst% * worst/W + wBlended% * blended/B + wMargin% * penalty/M, 0, 1))
 *   worst   = largest overage on any line, in bp (18 % given against 10 % allowed = 800)
 *   blended = sum(overage_i * gross_i) / sum(gross_i), the value-weighted overage of the order
 *   penalty = max(0, floorMargin - orderMargin), in bp
 */
export function scoreLines(lines: ScoredLine[], marginBp: Bp | null, cfg: RiskWeights): RiskResult {
  const results: RiskLineResult[] = lines.map((l) => ({
    lineId: l.lineId,
    effectiveDiscountBp: l.effectiveDiscountBp,
    ceilingBp: l.ceilingBp,
    overageBp: overageBp(l.effectiveDiscountBp, l.ceilingBp),
  }));
  const worst = results.reduce((max, l) => Math.max(max, l.overageBp), 0);
  const grossSum = lines.reduce((sum, l) => sum + l.gross, 0);
  const weighted = lines.reduce((sum, l, i) => sum + results[i].overageBp * l.gross, 0);
  const blended = grossSum === 0 ? 0 : divRound(weighted, grossSum);
  const penalty = marginBp === null ? 0 : Math.max(0, cfg.floorMarginBp - marginBp);
  const raw =
    (cfg.wWorst / 100) * ratio(worst, cfg.normWorstBp) +
    (cfg.wBlended / 100) * ratio(blended, cfg.normBlendedBp) +
    (cfg.wMargin / 100) * ratio(penalty, cfg.normMarginBp);
  const score = Math.round(100 * Math.min(1, Math.max(0, raw)));
  return { score, worstOverageBp: worst, blendedOverageBp: blended, marginBp, marginPenaltyBp: penalty, lines: results };
}

/**
 * Score from raw line inputs: compounds line and order discounts into the effective
 * discount, derives each line's ceiling, computes the order margin, then scores.
 */
export function riskScore(lines: RiskLine[], tierCeilingBp: Bp, orderDiscountBp: Bp, cfg: RiskWeights): RiskResult {
  const totals = computeTotals(lines, orderDiscountBp);
  const scored: ScoredLine[] = lines.map((l, i) => ({
    lineId: l.lineId,
    effectiveDiscountBp: totals.lines[i].effectiveDiscountBp,
    ceilingBp: lineCeilingBp(tierCeilingBp, l.categoryCeilingBp),
    gross: totals.lines[i].gross,
  }));
  return scoreLines(scored, totals.marginBp, cfg);
}
