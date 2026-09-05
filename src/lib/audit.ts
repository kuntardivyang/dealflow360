// Owner: B. The one audit helper. Called with the transaction client inside the
// service that changes state, so a rolled-back change logs nothing and a committed
// change always logs. Also bumps the quotation's lastActivityAt, which is what
// "inactive for N days" on the Deal Health dashboard reads.
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/contract";
import type { Tx } from "@/lib/db";

export interface AuditEvent {
  entityType: string; // "Quotation", "QuotationLine", "ApprovalStep", "Invoice", "StockLevel", "RiskConfig", ...
  entityId: number;
  quotationId?: number | null; // set whenever the change belongs to a quotation
  action: string; // UPPER_SNAKE verb: LINE_UPDATE, CONFIRM, APPROVE, RETURN, PORTAL_COUNTER, RECORD_PAYMENT, ...
  actor: Actor;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Dates and other non-JSON values become strings; undefined stays undefined so the column is left null. */
const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Append one audit row and return its id. */
export async function audit(tx: Tx, e: AuditEvent): Promise<number> {
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
