// Quotation arithmetic. A line discount and an order discount compound
// multiplicatively into one effective discount, which is what every ceiling is
// tested against. Rounding happens once per line for the discount and once for
// tax; totals are sums of the rounded lines.
import type { Bp, LineInput, LineTotals, Totals } from "@/lib/contract";
import { divRound, marginBp, pct } from "./money";

/** 1 - (1 - line)(1 - order): 10 % line plus 10 % order = 19 % effective. */
export function effectiveDiscountBp(lineBp: Bp, orderBp: Bp): Bp {
  return 10000 - divRound((10000 - lineBp) * (10000 - orderBp), 10000);
}

export function computeLineTotals(line: LineInput, orderDiscountBp: Bp): LineTotals {
  const eff = effectiveDiscountBp(line.discountBp, orderDiscountBp);
  const gross = line.unitPrice * line.qty;
  const discountAmount = pct(gross, eff);
  const net = gross - discountAmount;
  const tax = pct(net, line.taxBp);
  return {
    lineId: line.lineId,
    effectiveDiscountBp: eff,
    gross,
    discountAmount,
    net,
    tax,
    total: net + tax,
    cost: line.unitCost * line.qty,
  };
}

export function computeTotals(lines: LineInput[], orderDiscountBp: Bp): Totals {
  const computed = lines.map((l) => computeLineTotals(l, orderDiscountBp));
  const sum = (pick: (l: LineTotals) => number) => computed.reduce((acc, l) => acc + pick(l), 0);
  const netTotal = sum((l) => l.net);
  const costTotal = sum((l) => l.cost);
  return {
    lines: computed,
    grossTotal: sum((l) => l.gross),
    discountTotal: sum((l) => l.discountAmount),
    netTotal,
    taxTotal: sum((l) => l.tax),
    total: sum((l) => l.total),
    costTotal,
    marginBp: marginBp(netTotal, costTotal),
  };
}
