// Owner: A. Small helpers shared by A's services.
import type { Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, type SessionUser } from "@/lib/contract";
import { formatNumber } from "@/lib/ids";

/** Optimistic lock: bump the version only if the caller saw the current one. */
export async function lockQuotation(tx: Tx, id: number, version: number): Promise<void> {
  const r = await tx.quotation.updateMany({ where: { id, version }, data: { version: { increment: 1 } } });
  if (r.count !== 1) throw new ConflictError("This quotation was changed by someone else. Refresh and try again.");
}

export function assertOwnerOrAdmin(q: { repUserId: number }, user: SessionUser): void {
  if (q.repUserId !== user.id && user.role !== "ADMIN") {
    throw new ForbiddenError("Only the owning sales rep or an admin can edit this quotation");
  }
}

/** Next human readable number from the counter table, atomic inside the transaction. */
export async function nextNumber(tx: Tx, key: "quotation" | "invoice" | "credit_note", prefix: string): Promise<string> {
  const row = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } });
  return formatNumber(prefix, new Date().getUTCFullYear(), row.value);
}
