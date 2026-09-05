// Owner: A. Categories, products (with one variant), tier price rules, co-purchase pairings.
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { seedGovernance } from "./b-governance";
import { log, pct, rs } from "./util";

type Tiers = Awaited<ReturnType<typeof seedGovernance>>;

export async function seedCatalogue(db: PrismaClient, tiers: Tiers) {
  const hardware = await db.productCategory.create({
    data: { name: "Hardware", discountCeilingBp: pct(15), minMarginBp: pct(15), sortOrder: 1 },
  });
  const services = await db.productCategory.create({
    data: { name: "Services", discountCeilingBp: pct(10), minMarginBp: pct(20), sortOrder: 2 },
  });
  const subscriptions = await db.productCategory.create({
    data: { name: "Subscriptions", discountCeilingBp: pct(12), minMarginBp: pct(30), sortOrder: 3 },
  });

  const laptop = await db.product.create({
    data: { sku: "HW-LAP-14", name: 'Laptop 14"', kind: "GOOD", categoryId: hardware.id, listPrice: rs(60_000), cost: rs(42_000), description: "14 inch business laptop" },
  });
  const laptop16 = await db.product.create({
    data: {
      sku: "HW-LAP-16",
      name: 'Laptop 16"',
      kind: "GOOD",
      categoryId: hardware.id,
      listPrice: rs(75_000),
      cost: rs(52_500),
      parentId: laptop.id,
      variantLabel: "16 inch",
      extraPrice: rs(15_000),
    },
  });
  const dock = await db.product.create({
    data: { sku: "HW-DOCK", name: "Docking Station", kind: "GOOD", categoryId: hardware.id, listPrice: rs(6_000), cost: rs(3_600) },
  });
  const monitor = await db.product.create({
    data: { sku: "HW-MON-27", name: 'Monitor 27"', kind: "GOOD", categoryId: hardware.id, listPrice: rs(18_000), cost: rs(12_600) },
  });
  const setup = await db.product.create({
    data: { sku: "SV-SETUP", name: "Setup Service", kind: "SERVICE", categoryId: services.id, listPrice: rs(8_000), cost: rs(6_000), unit: "Visit" },
  });
  const training = await db.product.create({
    data: { sku: "SV-TRAIN", name: "Training Day", kind: "SERVICE", categoryId: services.id, listPrice: rs(15_000), cost: rs(11_000), unit: "Day" },
  });
  const supportBasic = await db.product.create({
    data: { sku: "SB-SUP-BASIC", name: "Support Basic", kind: "SERVICE", isSubscription: true, recurringInterval: "MONTH", categoryId: subscriptions.id, listPrice: rs(500), cost: rs(200), unit: "Seat" },
  });
  const supportPro = await db.product.create({
    data: { sku: "SB-SUP-PRO", name: "Support Pro", kind: "SERVICE", isSubscription: true, recurringInterval: "MONTH", categoryId: subscriptions.id, listPrice: rs(1_000), cost: rs(400), unit: "Seat", isPromoted: true },
  });

  // Tier price rules target Training Day only, so the demo numbers stay on list prices.
  await db.pricelistRule.createMany({
    data: [
      { tierId: tiers.gold.id, productId: training.id, discountBp: pct(10), note: "Gold price on training" },
      { tierId: tiers.silver.id, productId: training.id, discountBp: pct(5), note: "Silver price on training" },
    ],
  });

  // Historical co-purchase counts (also what the upsell query would compute from history).
  await db.productPairing.createMany({
    data: [
      { productId: laptop.id, pairedProductId: dock.id, coCount: 14 },
      { productId: laptop.id, pairedProductId: setup.id, coCount: 11 },
      { productId: laptop.id, pairedProductId: monitor.id, coCount: 7 },
      { productId: supportBasic.id, pairedProductId: supportPro.id, coCount: 5 },
    ],
  });

  log("catalogue", "3 categories, 8 products (1 variant), 2 price rules, 4 pairings");
  return { hardware, services, subscriptions, laptop, laptop16, dock, monitor, setup, training, supportBasic, supportPro };
}
