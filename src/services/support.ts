// Owner: A. Small helpers shared by A's services.
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, type Actor, type QuotationStatus, type SessionUser } from "@/lib/contract";
import { formatNumber } from "@/lib/ids";

const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Append one audit row inside the caller's transaction and bump the quotation's
 * lastActivityAt, so "inactive for N days" can never be forgotten.
 * TODO(contract): switch to audit() from "@/lib/audit" when B lands feature 29.
 */
export async function writeAudit(
  tx: Tx,
  e: {
    entityType: string;
    entityId: number;
    quotationId?: number | null;
    action: string;
    actor: Actor;
    reason?: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<number> {
  const row = await tx.auditLog.create({
    data: {
      entityType: e.entityType,
      entityId: e.entityId,
      quotationId: e.quotationId ?? null,
      action: e.action,
      actorType: e.actor.type,
      actorId: e.actor.id,
      actorName: e.actor.name,
      actorRole: e.actor.role ?? null,
      reason: e.reason ?? null,
      ...(e.before !== undefined ? { beforeJson: toJson(e.before) } : {}),
      ...(e.after !== undefined ? { afterJson: toJson(e.after) } : {}),
    },
  });
  if (e.quotationId) {
    await tx.quotation.update({ where: { id: e.quotationId }, data: { lastActivityAt: new Date() } });
  }
  return row.id;
}

/**
 * Status guard. TODO(contract): replace with assertTransition() from
 * "@/lib/state/quotation.machine" when B lands feature 28.
 */
export function assertStatus(current: QuotationStatus, allowed: readonly QuotationStatus[], action: string): void {
  if (!allowed.includes(current)) {
    throw new ConflictError(`Cannot ${action} a quotation that is ${current.toLowerCase().replace("_", " ")}`);
  }
}

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
