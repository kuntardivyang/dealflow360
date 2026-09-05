// Money is integer paise, percentages are integer basis points (1250 = 12.50 %).
// Every function here is pure integer arithmetic with half-up rounding, applied
// exactly once per amount, so totals always equal the sum of their lines.
import type { Bp, Money } from "@/lib/contract";

/** Integer division rounded half-up, symmetric for negative values. */
export function divRound(numerator: number, denominator: number): number {
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const a = Math.abs(numerator);
  const b = Math.abs(denominator);
  return sign * Math.floor((a + Math.floor(b / 2)) / b);
}

/** Share of an amount at a rate in basis points: pct(60000_00, 1200) = 7200_00. */
export const pct = (amount: Money, bp: Bp): Money => divRound(amount * bp, 10000);

/** Amount left after a discount in basis points. */
export const applyDiscount = (amount: Money, bp: Bp): Money => amount - pct(amount, bp);

/** Margin in basis points on a net amount, or null when there is no revenue to measure against. */
export const marginBp = (net: Money, cost: Money): Bp | null =>
  net === 0 ? null : divRound((net - cost) * 10000, net);

/** Basis points over a ceiling; 0 when within the limit (18 % against 10 % gives 800). */
export const overageBp = (effectiveBp: Bp, ceilingBp: Bp): Bp => Math.max(0, effectiveBp - ceilingBp);
