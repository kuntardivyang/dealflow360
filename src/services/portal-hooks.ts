// What happens the moment an order is confirmed, from the portal or by an admin on the
// customer's behalf. Runs inside the confirming transaction, so a failure here rolls the
// confirmation back: invoices and subscriptions are posted, then the warehouse split is proposed.
import type { Actor } from "@/lib/contract";
import type { Tx } from "@/lib/db";
import { onConfirmed } from "./billing.service";
import { proposePlan } from "./fulfillment.service";

export async function onConfirmedHooks(tx: Tx, quotationId: number, actor: Actor): Promise<{ invoicesCreated: number; planProposed: boolean }> {
  const billing = await onConfirmed(tx, quotationId, actor);
  const planId = await proposePlan(tx, quotationId, actor);
  return { invoicesCreated: billing.invoicesCreated, planProposed: planId !== null };
}
