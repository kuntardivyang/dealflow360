// Owner: A. Recurring plans. Day-based proration, change day billed, prorated refund as credit note.
import type { PrismaClient } from "../../src/generated/prisma/client";
import { log, rs } from "./util";

export async function seedPlans(db: PrismaClient) {
  const monthly = await db.recurringPlan.create({ data: { name: "Monthly", interval: "MONTH", periods: 12 } });
  const quarterly = await db.recurringPlan.create({ data: { name: "Quarterly", interval: "QUARTER", periods: 4 } });
  const yearly = await db.recurringPlan.create({ data: { name: "Yearly", interval: "YEAR", periods: 1 } });
  // Time-based pricing: one Support Pro sold on three cycles, cheaper the longer the commitment.
  const pro = await db.product.findUnique({ where: { sku: "SB-SUP-PRO" } });
  if (pro) {
    await db.productPlanPrice.createMany({
      data: [
        { productId: pro.id, planId: monthly.id, price: rs(1_000) },
        { productId: pro.id, planId: quarterly.id, price: rs(2_700) }, // 10 % off three months
        { productId: pro.id, planId: yearly.id, price: rs(10_000) }, // two months free
      ],
    });
  }
  log("plans", "Monthly, Quarterly, Yearly (DAY_BASED, bill change day, credit note refunds); Support Pro priced on all three");
  return { monthly, quarterly, yearly };
}
