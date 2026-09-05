// Owner: B. What happens the moment a customer confirms. A owns the two services this
// calls; until they are merged (22:00) these are no-ops so the portal flow is clickable.
// TODO(contract): replace the bodies with billing.onConfirmed(tx, quotationId, actor)
// and fulfillment.propose(tx, quotationId) from A's services, then delete this note.
import type { Actor } from "@/lib/contract";
import type { Tx } from "@/lib/db";

export async function onConfirmedHooks(tx: Tx, quotationId: number, actor: Actor): Promise<{ invoicesCreated: number; planProposed: boolean }> {
  void tx;
  void quotationId;
  void actor;
  return { invoicesCreated: 0, planProposed: false };
}
