// Owner: B. Discount tiers, approval chain rules and the risk configuration.
import type { PrismaClient } from "../../src/generated/prisma/client";
import { log, pct, rs } from "./util";

export async function seedGovernance(db: PrismaClient) {
  const bronze = await db.customerTier.create({ data: { name: "Bronze", discountCeilingBp: pct(5), sortOrder: 1 } });
  const silver = await db.customerTier.create({ data: { name: "Silver", discountCeilingBp: pct(10), sortOrder: 2 } });
  const gold = await db.customerTier.create({ data: { name: "Gold", discountCeilingBp: pct(15), sortOrder: 3 } });

  // Routing takes the longest chain among the rules that fire.
  await db.approvalRule.createMany({
    data: [
      { sequence: 1, name: "Over limit", minScore: 1, chain: ["SALES_MANAGER"] },
      {
        sequence: 2,
        name: "High risk or large order",
        minScore: 50,
        maxWorstOverageBp: pct(10),
        maxOrderTotal: rs(10_00_000),
        chain: ["SALES_MANAGER", "FINANCE"],
      },
    ],
  });

  await db.riskConfig.create({
    data: {
      id: 1,
      wWorst: 50,
      wBlended: 40,
      wMargin: 10,
      normWorstBp: pct(10),
      normBlendedBp: pct(5),
      normMarginBp: pct(10),
      floorMarginBp: pct(20),
      stalledDays: 3,
      anomalyZ: 2,
      anomalyAbsBp: pct(10),
      minHistory: 5,
    },
  });
  log("governance", "tiers Bronze 5 / Silver 10 / Gold 15, 2 approval rules, risk config");
  return { bronze, silver, gold };
}
