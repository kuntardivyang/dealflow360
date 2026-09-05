// What happens the moment an order is confirmed, from the portal or by an admin on the
// customer's behalf. Runs inside the confirming transaction, so a failure here rolls the
// confirmation back. Fulfillment proposes the warehouse split; billing (invoices,
// subscriptions, schedule) is attached next.
import type { Actor } from "@/lib/contract";
import type { Tx } from "@/lib/db";
import { proposePlan } from "./fulfillment.service";

export async function onConfirmedHooks(tx: Tx, quotationId: number, actor: Actor): Promise<{ invoicesCreated: number; planProposed: boolean }> {
  const planId = await proposePlan(tx, quotationId, actor);
  return { invoicesCreated: 0, planProposed: planId !== null };
}
