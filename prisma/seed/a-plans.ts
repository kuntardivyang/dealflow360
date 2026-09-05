// Owner: A. Recurring plans. Day-based proration, change day billed, prorated refund as credit note.
import type { PrismaClient } from "../../src/generated/prisma/client";
import { log } from "./util";

export async function seedPlans(db: PrismaClient) {
  const monthly = await db.recurringPlan.create({ data: { name: "Monthly", interval: "MONTH", periods: 12 } });
  const quarterly = await db.recurringPlan.create({ data: { name: "Quarterly", interval: "QUARTER", periods: 4 } });
  const yearly = await db.recurringPlan.create({ data: { name: "Yearly", interval: "YEAR", periods: 1 } });
  log("plans", "Monthly, Quarterly, Yearly (DAY_BASED, bill change day, credit note refunds)");
  return { monthly, quarterly, yearly };
}
