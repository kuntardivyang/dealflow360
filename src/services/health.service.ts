// Owner: B. Deal health (PDF B9). Recomputes alerts from live data on every dashboard
// load: new conditions open a DealAlert, repeated runs update the same row (dedup on
// quotation + type while unresolved), cleared conditions resolve it. Nudge and escalate
// write an audit row on the quotation so the action is visible on its trail.
import type { Prisma } from "@/generated/prisma/client";
import { detectAnomalies } from "@/domain/anomaly";
import { toISODate } from "@/domain/dates";
import { audit } from "@/lib/audit";
import { actorFromUser, ConflictError, NotFoundError, type Bp, type HealthConfig, type OpenQuote, type SessionUser, type SlipRow } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { OPEN_STATUSES } from "@/lib/state";

const HISTORY_STATUSES = ["CONFIRMED", "FULFILLMENT", "PAID"] as const;

async function loadConfig(): Promise<HealthConfig> {
  const row = await prisma.riskConfig.findUnique({ where: { id: 1 } });
  return { stalledDays: row?.stalledDays ?? 3, anomalyZ: row?.anomalyZ ?? 2, anomalyAbsBp: row?.anomalyAbsBp ?? 1000, minHistory: row?.minHistory ?? 5 };
}

/** Order-level effective discount in basis points (what the anomaly check compares). */
const orderDiscountBp = (q: { grossTotal: number; discountTotal: number }): Bp => (q.grossTotal === 0 ? 0 : Math.round((q.discountTotal * 10000) / q.grossTotal));

/** Run the detectors and sync DealAlert rows. Returns the number of open alerts. */
export async function refreshAlerts(now = new Date()): Promise<number> {
  const cfg = await loadConfig();
  const [open, history, slipQuotes] = await Promise.all([
    prisma.quotation.findMany({ where: { status: { in: [...OPEN_STATUSES] } }, select: { id: true, repUserId: true, status: true, lastActivityAt: true, grossTotal: true, discountTotal: true } }),
    prisma.quotation.findMany({
      where: { status: { in: [...HISTORY_STATUSES] } },
      orderBy: { confirmedAt: "desc" },
      take: 500,
      select: { repUserId: true, grossTotal: true, discountTotal: true },
    }),
    prisma.quotation.findMany({
      where: { status: { in: ["CONFIRMED", "FULFILLMENT"] }, promisedDate: { not: null } },
      select: { id: true, promisedDate: true, fulfillmentPlans: { where: { status: "ACCEPTED" }, select: { lines: { select: { isBackorder: true, expectedDate: true } }, shipments: { select: { status: true } } } } },
    }),
  ]);

  const openQuotes: OpenQuote[] = open.map((q) => ({ quotationId: q.id, repUserId: q.repUserId, status: q.status, lastActivityAt: q.lastActivityAt, effectiveDiscountBp: orderDiscountBp(q) }));
  const repHistory = new Map<number, Bp[]>();
  const teamHistory: Bp[] = [];
  for (const h of history) {
    const d = orderDiscountBp(h);
    teamHistory.push(d);
    repHistory.set(h.repUserId, [...(repHistory.get(h.repUserId) ?? []), d]);
  }
  const slips: SlipRow[] = slipQuotes.map((q) => {
    const plan = q.fulfillmentPlans[0];
    const backorders = plan?.lines.filter((l) => l.isBackorder && l.expectedDate) ?? [];
    const expected = backorders.map((l) => toISODate(l.expectedDate!)).sort().at(-1) ?? null;
    const shipped = !!plan && plan.shipments.length > 0 && plan.shipments.every((s) => s.status === "SHIPPED") && backorders.length === 0;
    return { quotationId: q.id, promisedDate: toISODate(q.promisedDate!), expectedDate: expected, shipped };
  });

  const found = detectAnomalies(now, openQuotes, repHistory, teamHistory, slips, cfg);
  const existing = await prisma.dealAlert.findMany({ where: { resolvedAt: null } });
  const key = (a: { quotationId: number; type: string }) => `${a.quotationId}:${a.type}`;
  const foundKeys = new Set(found.map(key));

  await prisma.$transaction(async (tx) => {
    for (const a of found) {
      const row = existing.find((e) => key(e) === key(a));
      if (row) await tx.dealAlert.update({ where: { id: row.id }, data: { severity: a.severity, message: a.message, payload: a.payload as Prisma.InputJsonValue, lastSeenAt: now } });
      else await tx.dealAlert.create({ data: { quotationId: a.quotationId, type: a.type, severity: a.severity, message: a.message, payload: a.payload as Prisma.InputJsonValue, firstSeenAt: now, lastSeenAt: now } });
    }
    const cleared = existing.filter((e) => !foundKeys.has(key(e)));
    if (cleared.length) await tx.dealAlert.updateMany({ where: { id: { in: cleared.map((c) => c.id) } }, data: { resolvedAt: now } });
  });
  return found.length;
}

export async function listAlerts() {
  const alerts = await prisma.dealAlert.findMany({
    where: { resolvedAt: null },
    orderBy: [{ severity: "desc" }, { firstSeenAt: "asc" }],
    include: { quotation: { select: { id: true, publicId: true, number: true, status: true, riskScore: true, customer: { select: { name: true } }, rep: { select: { id: true, name: true } } } } },
  });
  const count = (type: string) => alerts.filter((a) => a.type === type).length;
  return { alerts, counts: { stalled: count("STALLED"), anomalies: count("DISCOUNT_ANOMALY"), slippage: count("DELIVERY_SLIPPAGE") } };
}

export type AlertRow = Awaited<ReturnType<typeof listAlerts>>["alerts"][number];

/** Nudge the rep (or escalate to management) from an alert: audit row on the quote, timestamp on the alert. */
export async function actOnAlert(alertId: number, action: "NUDGE" | "ESCALATE", user: SessionUser) {
  return prisma.$transaction(async (tx) => {
    const alert = await tx.dealAlert.findUnique({ where: { id: alertId }, include: { quotation: { select: { id: true, number: true, rep: { select: { name: true } } } } } });
    if (!alert) throw new NotFoundError("Alert not found");
    if (alert.resolvedAt) throw new ConflictError("This alert is already resolved");
    const now = new Date();
    await tx.dealAlert.update({ where: { id: alert.id }, data: action === "NUDGE" ? { lastNudgedAt: now } : { escalatedAt: now } });
    const auditLogId = await audit(tx, {
      entityType: "DealAlert",
      entityId: alert.id,
      quotationId: alert.quotationId,
      action,
      actor: actorFromUser(user),
      reason: alert.message,
      after: action === "NUDGE" ? { nudged: alert.quotation.rep.name, type: alert.type } : { escalated: true, type: alert.type },
    });
    return { alertId: alert.id, action, auditLogId, quotationNumber: alert.quotation.number, rep: alert.quotation.rep.name };
  });
}
