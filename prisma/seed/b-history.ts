// Owner: B. Seed v2 for Deal Health: confirmed history per rep (Riya 5-8 %, Arjun 7-11 %),
// one Arjun quote at 22 % two days ago (anomaly), a Gamma quote idle 9 days and a Beta
// quote idle 14 days (stalled), and a confirmed Acme order with a backorder three days
// past its promise (slippage). Idempotent: skipped when the history already exists.
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { seedCatalogue } from "./a-catalogue";
import type { seedCustomers } from "./a-customers";
import type { seedUsers } from "./b-users";
import { YEAR, daysAgo, lineMoney, log, pct, publicId, today } from "./util";

type Catalogue = Awaited<ReturnType<typeof seedCatalogue>>;
type Customers = Awaited<ReturnType<typeof seedCustomers>>;
type Users = Awaited<ReturnType<typeof seedUsers>>;

const number = (n: number) => `Q-${YEAR}-${String(n).padStart(4, "0")}`;
const dateOffset = (days: number) => new Date(today().getTime() + days * 86_400_000);

type Product = { id: number; name: string; listPrice: number; cost: number; taxBp: number };

function line(p: Product, qty: number, discountBp: number, ceilingBp: number, sortOrder: number) {
  const m = lineMoney(p.listPrice, qty, discountBp, p.taxBp, p.cost);
  return {
    data: { productId: p.id, description: p.name, qty, unitPrice: p.listPrice, unitCost: p.cost, taxBp: p.taxBp, discountBp, effectiveDiscountBp: discountBp, ceilingBp, gross: m.gross, discountAmount: m.discountAmount, net: m.net, tax: m.tax, total: m.total, sortOrder },
    cost: m.cost,
  };
}

async function createQuote(
  db: PrismaClient,
  opts: { n: number; customerId: number; repUserId: number; status: "DRAFT" | "APPROVED" | "SENT" | "CONFIRMED" | "FULFILLMENT" | "PAID"; activityDaysAgo: number; lines: ReturnType<typeof line>[]; promisedDate?: Date; sentAt?: Date; confirmedAt?: Date },
) {
  const sum = (k: "gross" | "discountAmount" | "net" | "tax" | "total") => opts.lines.reduce((a, l) => a + l.data[k], 0);
  const netTotal = sum("net");
  const costTotal = opts.lines.reduce((a, l) => a + l.cost, 0);
  return db.quotation.create({
    data: {
      publicId: publicId(),
      number: number(opts.n),
      customerId: opts.customerId,
      repUserId: opts.repUserId,
      status: opts.status,
      grossTotal: sum("gross"),
      discountTotal: sum("discountAmount"),
      netTotal,
      taxTotal: sum("tax"),
      total: sum("total"),
      costTotal,
      marginBp: netTotal === 0 ? null : Math.round(((netTotal - costTotal) * 10000) / netTotal),
      riskScore: 0,
      lastActivityAt: daysAgo(opts.activityDaysAgo),
      createdAt: daysAgo(opts.activityDaysAgo + 1),
      promisedDate: opts.promisedDate ?? null,
      sentAt: opts.sentAt ?? null,
      confirmedAt: opts.confirmedAt ?? null,
      lines: { create: opts.lines.map((l) => l.data) },
    },
    include: { lines: true },
  });
}

export async function seedHistory(db: PrismaClient, c: Catalogue, cu: Customers, users: Users) {
  if (await db.quotation.findUnique({ where: { number: number(1001) } })) {
    log("history", "already present, skipped");
    return;
  }
  // Ceilings: Acme Gold 15, Beta Silver 10, Gamma Bronze 5; Hardware 15, Services 10.
  const customers = [cu.acme, cu.beta, cu.gamma];
  const tierCeiling = [pct(15), pct(10), pct(5)];
  let n = 1001;

  // 12 confirmed quotes per rep over the last 60 days. Discounts are order-level effective (all lines the same).
  const riyaPattern = [500, 600, 700, 800, 550, 650, 750, 600, 700, 800, 500, 650];
  const arjunPattern = [700, 800, 900, 1000, 1100, 750, 850, 950, 1050, 900, 1000, 800];
  for (const [rep, pattern] of [
    [users.riya, riyaPattern],
    [users.arjun, arjunPattern],
  ] as const) {
    for (let i = 0; i < pattern.length; i++) {
      const ci = i % 3;
      const d = pattern[i];
      const ceilingHw = Math.min(tierCeiling[ci], pct(15));
      const qty = 1 + (i % 4);
      const daysBack = 58 - i * 4;
      await createQuote(db, {
        n: n++,
        customerId: customers[ci].id,
        repUserId: rep.id,
        status: i % 2 === 0 ? "PAID" : "CONFIRMED",
        activityDaysAgo: daysBack,
        confirmedAt: daysAgo(daysBack),
        sentAt: daysAgo(daysBack + 1),
        lines: [line(c.laptop, qty, d, ceilingHw, 1), ...(i % 3 === 0 ? [line(c.dock, qty, d, ceilingHw, 2)] : [])],
      });
    }
  }

  // Anomaly: Arjun at 22 % on a Gold customer two days ago, sent and waiting.
  await createQuote(db, {
    n: n++,
    customerId: cu.acme.id,
    repUserId: users.arjun.id,
    status: "SENT",
    activityDaysAgo: 2,
    sentAt: daysAgo(2),
    lines: [line(c.monitor, 4, pct(22), pct(15), 1)],
  });
  // Stalled: Gamma draft idle 9 days, Beta approved quote idle 14 days.
  await createQuote(db, { n: n++, customerId: cu.gamma.id, repUserId: users.riya.id, status: "DRAFT", activityDaysAgo: 9, lines: [line(c.training, 2, pct(5), pct(5), 1)] });
  await createQuote(db, { n: n++, customerId: cu.beta.id, repUserId: users.arjun.id, status: "APPROVED", activityDaysAgo: 14, lines: [line(c.dock, 5, pct(8), pct(10), 1)] });

  // Slippage: a confirmed Acme order promised yesterday with a backorder expected in three days.
  const main = await db.warehouse.findFirstOrThrow({ where: { name: "Main Warehouse" } });
  const slipped = await createQuote(db, {
    n: n++,
    customerId: cu.acme.id,
    repUserId: users.riya.id,
    status: "FULFILLMENT",
    activityDaysAgo: 4,
    sentAt: daysAgo(6),
    confirmedAt: daysAgo(5),
    promisedDate: dateOffset(-1),
    lines: [line(c.laptop16, 4, pct(10), pct(15), 1)],
  });
  const plan = await db.fulfillmentPlan.create({
    data: { quotationId: slipped.id, status: "ACCEPTED", shipmentCount: 1, estCost: main.shipCostWeight, acceptedAt: daysAgo(5), createdAt: daysAgo(5) },
  });
  const shipment = await db.shipment.create({ data: { planId: plan.id, warehouseId: main.id, status: "RESERVED", shipCost: main.shipCostWeight } });
  await db.fulfillmentLine.createMany({
    data: [
      { planId: plan.id, quotationLineId: slipped.lines[0].id, warehouseId: main.id, shipmentId: shipment.id, qty: 3 },
      { planId: plan.id, quotationLineId: slipped.lines[0].id, warehouseId: null, shipmentId: null, qty: 1, isBackorder: true, expectedDate: dateOffset(3) },
    ],
  });
  log("history", `24 confirmed quotes (${number(1001)}-${number(1024)}), 1 anomaly, 2 stalled, 1 slippage`);
}
