// Owner: A. Upsell and cross-sell suggestions (PDF A6, B5). Ranked by how often a product
// was bought together with what is in the cart: seeded co-purchase pairings plus real
// confirmed orders. Promoted products get a boost, products under their category's
// minimum margin are hidden, and anything already in the cart is excluded.
import { marginBp } from "@/domain/money";
import type { Bp, Money } from "@/lib/contract";
import { prisma } from "@/lib/db";

export interface Suggestion {
  productId: number;
  name: string;
  category: string;
  kind: "GOOD" | "SERVICE" | "SUBSCRIPTION";
  listPrice: Money;
  unit: string;
  marginDelta: Money; // margin added per unit at list price
  marginBp: Bp | null;
  isPromoted: boolean;
  coCount: number;
  score: number;
  reason: string;
}

const PROMO_BOOST = 5;
const CLOSED: ("CONFIRMED" | "FULFILLMENT" | "PAID")[] = ["CONFIRMED", "FULFILLMENT", "PAID"];

export async function suggestFor(quotationId: number, limit = 4): Promise<Suggestion[]> {
  const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { lines: { select: { productId: true } } } });
  const cart = [...new Set(q.lines.map((l) => l.productId))];

  // Co-purchase counts: seeded history plus every closed order that shares a cart product.
  const counts = new Map<number, number>();
  const names = new Map<number, string>();
  if (cart.length > 0) {
    const pairings = await prisma.productPairing.findMany({ where: { productId: { in: cart } }, include: { product: { select: { name: true } } } });
    for (const p of pairings) {
      counts.set(p.pairedProductId, (counts.get(p.pairedProductId) ?? 0) + p.coCount);
      names.set(p.pairedProductId, p.product.name);
    }
    const orders = await prisma.quotationLine.findMany({
      where: { productId: { in: cart }, quotation: { status: { in: CLOSED }, id: { not: quotationId } } },
      select: { quotationId: true },
      distinct: ["quotationId"],
    });
    if (orders.length > 0) {
      const together = await prisma.quotationLine.groupBy({
        by: ["productId"],
        where: { quotationId: { in: orders.map((o) => o.quotationId) }, productId: { notIn: cart } },
        _count: { quotationId: true },
      });
      for (const t of together) counts.set(t.productId, (counts.get(t.productId) ?? 0) + t._count.quotationId);
    }
  }

  const candidates = await prisma.product.findMany({
    where: { archivedAt: null, id: { notIn: cart }, OR: [{ id: { in: [...counts.keys()] } }, { isPromoted: true }] },
    include: { category: true },
  });

  const minMargin = new Map(candidates.map((p) => [p.id, p.category.minMarginBp]));
  return candidates
    .map((p): Suggestion => {
      const coCount = counts.get(p.id) ?? 0;
      const partner = names.get(p.id);
      return {
        productId: p.id,
        name: p.name,
        category: p.category.name,
        kind: p.kind,
        listPrice: p.listPrice,
        unit: p.unit,
        marginDelta: p.listPrice - p.cost,
        marginBp: marginBp(p.listPrice, p.cost),
        isPromoted: p.isPromoted,
        coCount,
        score: coCount + (p.isPromoted ? PROMO_BOOST : 0),
        reason: coCount > 0 ? `Bought with ${partner ?? "items in this cart"} ${coCount}×` : "Currently promoted",
      };
    })
    .filter((s) => (s.marginBp ?? 0) >= (minMargin.get(s.productId) ?? 0) && s.score > 0)
    .sort((a, b) => b.score - a.score || b.marginDelta - a.marginDelta || a.name.localeCompare(b.name))
    .slice(0, limit);
}
