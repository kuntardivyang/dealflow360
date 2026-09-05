// Owner: A. Demo quotations. Q-2026-0001 is empty for the live build; Q-2026-0004 is the
// hybrid draft for flow 2. Q-0002 (pending approval) and Q-0003 (approved) arrive in seed v2.
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { seedCatalogue } from "./a-catalogue";
import type { seedCustomers } from "./a-customers";
import type { seedPlans } from "./a-plans";
import type { seedUsers } from "./b-users";
import { YEAR, daysAgo, lineMoney, log, pct, publicId } from "./util";

type Catalogue = Awaited<ReturnType<typeof seedCatalogue>>;
type Customers = Awaited<ReturnType<typeof seedCustomers>>;
type Plans = Awaited<ReturnType<typeof seedPlans>>;
type Users = Awaited<ReturnType<typeof seedUsers>>;

const number = (n: number) => `Q-${YEAR}-${String(n).padStart(4, "0")}`;

type LineSpec = {
  product: Catalogue[keyof Catalogue] & {
    listPrice: number;
    cost: number;
    taxBp: number;
    name: string;
    kind: string;
  };
  qty: number;
  discountBp: number;
  ceilingBp: number;
  planId?: number;
};

export async function seedQuotes(
  db: PrismaClient,
  c: Catalogue,
  cu: Customers,
  plans: Plans,
  users: Users,
) {
  await db.counter.createMany({
    data: [
      { key: "quotation", value: 4 },
      { key: "invoice", value: 0 },
      { key: "credit_note", value: 0 },
    ],
  });

  // Q-2026-0001: Acme Corp, empty draft, built live in flow 1.
  await db.quotation.create({
    data: {
      publicId: publicId(),
      number: number(1),
      customerId: cu.acme.id,
      repUserId: users.riya.id,
      status: "DRAFT",
      lastActivityAt: daysAgo(0),
    },
  });

  // Q-2026-0004: Beta Industries (Silver, ceiling 10 %), Laptop x2 @5 % + Support Pro x2 monthly.
  const lines: LineSpec[] = [
    { product: c.laptop, qty: 2, discountBp: pct(5), ceilingBp: pct(10) },
    {
      product: c.supportPro,
      qty: 2,
      discountBp: 0,
      ceilingBp: pct(10),
      planId: plans.monthly.id,
    },
  ];
  const computed = lines.map((l, i) => {
    const m = lineMoney(
      l.product.listPrice,
      l.qty,
      l.discountBp,
      l.product.taxBp,
      l.product.cost,
    );
    return {
      cost: m.cost,
      data: {
        productId: l.product.id,
        planId: l.planId ?? null,
        lineType: (l.product.kind === "SUBSCRIPTION"
          ? "RECURRING"
          : "ONE_TIME") as "RECURRING" | "ONE_TIME",
        description: l.product.name,
        qty: l.qty,
        unitPrice: l.product.listPrice,
        unitCost: l.product.cost,
        taxBp: l.product.taxBp,
        discountBp: l.discountBp,
        effectiveDiscountBp: l.discountBp,
        ceilingBp: l.ceilingBp,
        gross: m.gross,
        discountAmount: m.discountAmount,
        net: m.net,
        tax: m.tax,
        total: m.total,
        sortOrder: i + 1,
      },
    };
  });
  const sum = (k: "gross" | "discountAmount" | "net" | "tax" | "total") =>
    computed.reduce((a, l) => a + l.data[k], 0);
  const costTotal = computed.reduce((a, l) => a + l.cost, 0);
  const netTotal = sum("net");
  await db.quotation.create({
    data: {
      publicId: publicId(),
      number: number(4),
      customerId: cu.beta.id,
      repUserId: users.riya.id,
      status: "DRAFT",
      grossTotal: sum("gross"),
      discountTotal: sum("discountAmount"),
      netTotal,
      taxTotal: sum("tax"),
      total: sum("total"),
      costTotal,
      marginBp:
        netTotal === 0
          ? null
          : Math.round(((netTotal - costTotal) * 10000) / netTotal),
      riskScore: 0,
      lastActivityAt: daysAgo(1),
      lines: { create: computed.map((l) => l.data) },
    },
  });
  log(
    "quotes",
    `${number(1)} Acme draft (empty), ${number(4)} Beta hybrid draft`,
  );
}
