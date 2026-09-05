// Owner: B. Approval routing. Reads the ApprovalRule rows (as RoutingRule) and the
// risk result; returns the ordered chain of approver roles. Max, never an average:
// when a quote mixes categories, it goes to the highest level any fired rule demands.
import { riskBand, type ApproverRole, type Money, type RiskPreview, type RiskResult, type RoutingRule } from "@/lib/contract";

/** When every line is within its limit and the margin floor holds, nobody needs to review. */
export function needsReview(r: RiskResult): boolean {
  return r.worstOverageBp > 0 || r.blendedOverageBp > 0 || r.marginPenaltyBp > 0;
}

/** A rule fires on score, on the worst single overage, or on the order total (any one is enough). */
export function ruleFires(rule: RoutingRule, r: RiskResult, orderTotal: Money): boolean {
  return (
    r.score >= rule.minScore ||
    (rule.maxWorstOverageBp !== null && r.worstOverageBp > rule.maxWorstOverageBp) ||
    (rule.maxOrderTotal !== null && orderTotal > rule.maxOrderTotal)
  );
}

/** Safety net when the admin has deleted every rule: an over-limit quote still needs a manager. */
const FALLBACK_CHAIN: readonly ApproverRole[] = ["SALES_MANAGER"];

/**
 * [] iff nothing needs review. Otherwise the LONGEST chain among the rules that fire.
 * If something is over a limit but no rule fires (a tiny overage rounds the score to 0),
 * the lowest-sequence rule reviews it, so a violation can never slip through unreviewed.
 */
export function routeApproval(r: RiskResult, orderTotal: Money, rules: RoutingRule[]): ApproverRole[] {
  if (!needsReview(r)) return [];
  const ordered = [...rules].sort((a, b) => a.sequence - b.sequence);
  const fired = ordered.filter((rule) => ruleFires(rule, r, orderTotal));
  const pool = fired.length > 0 ? fired : ordered.slice(0, 1);
  const longest = pool.reduce<readonly ApproverRole[]>((best, rule) => (rule.chain.length > best.length ? rule.chain : best), []);
  return [...(longest.length > 0 ? longest : FALLBACK_CHAIN)];
}

/** What the builder shows before confirm and what confirm stores: score, components, chain, band. */
export function riskPreview(r: RiskResult, orderTotal: Money, rules: RoutingRule[]): RiskPreview {
  return { ...r, chain: routeApproval(r, orderTotal, rules), band: riskBand(r.score) };
}
