// Owner: A. PROVISIONAL. Implements the blended risk score and routing exactly as
// specified for the builder preview until B's domain/risk.ts (26) and
// domain/route.ts (27) merge.
// TODO(contract): delete this file then and import riskScore() + routeApproval().
import { divRound, overageBp } from "@/domain/money";
import { riskBand, type ApproverRole, type Bp, type Money, type RiskPreview, type RiskWeights, type RoutingRule } from "@/lib/contract";

export interface PreviewLine {
  lineId: number;
  effectiveDiscountBp: Bp;
  ceilingBp: Bp; // min(tier ceiling, category ceiling), snapshotted on the line
  gross: Money;
}

/**
 * score = 100 * clamp(wWorst * worst/normWorst + wBlended * blended/normBlended + wMargin * penalty/normMargin)
 * worst   = largest overage on any line (PDF: service 18 % against 10 % = 800 bp)
 * blended = value weighted average overage across the order
 * penalty = shortfall of the order margin under the configured floor
 */
export function previewRisk(lines: PreviewLine[], marginBp: Bp | null, orderTotal: Money, cfg: RiskWeights, rules: RoutingRule[]): RiskPreview {
  const lineResults = lines.map((l) => ({
    lineId: l.lineId,
    effectiveDiscountBp: l.effectiveDiscountBp,
    ceilingBp: l.ceilingBp,
    overageBp: overageBp(l.effectiveDiscountBp, l.ceilingBp),
  }));
  const worst = lineResults.reduce((m, l) => Math.max(m, l.overageBp), 0);
  const grossSum = lines.reduce((a, l) => a + l.gross, 0);
  const weighted = lines.reduce((a, l, i) => a + lineResults[i].overageBp * l.gross, 0);
  const blended = grossSum === 0 ? 0 : divRound(weighted, grossSum);
  const penalty = marginBp === null ? 0 : Math.max(0, cfg.floorMarginBp - marginBp);
  const raw =
    (cfg.wWorst / 100) * (worst / cfg.normWorstBp) +
    (cfg.wBlended / 100) * (blended / cfg.normBlendedBp) +
    (cfg.wMargin / 100) * (penalty / cfg.normMarginBp);
  const score = Math.round(100 * Math.min(1, Math.max(0, raw)));
  const chain = routeChain(score, worst, blended, penalty, orderTotal, rules);
  return { score, worstOverageBp: worst, blendedOverageBp: blended, marginBp, marginPenaltyBp: penalty, lines: lineResults, chain, band: riskBand(score) };
}

/** Empty chain only when nothing is over any limit; otherwise the LONGEST chain among fired rules. */
function routeChain(score: number, worst: Bp, blended: Bp, penalty: Bp, orderTotal: Money, rules: RoutingRule[]): ApproverRole[] {
  if (worst === 0 && blended === 0 && penalty === 0) return [];
  const fired = rules.filter(
    (r) =>
      score >= r.minScore ||
      (r.maxWorstOverageBp !== null && worst > r.maxWorstOverageBp) ||
      (r.maxOrderTotal !== null && orderTotal > r.maxOrderTotal),
  );
  // Something is over a limit but no rule fired (score rounded to 0): the first rule still reviews it.
  const pool = fired.length > 0 ? fired : [...rules].sort((a, b) => a.sequence - b.sequence).slice(0, 1);
  return pool.reduce<ApproverRole[]>((best, r) => (r.chain.length > best.length ? r.chain : best), []);
}
