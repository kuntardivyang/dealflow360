// Owner: B. Screen 14, Deal Health and Anomaly Dashboard (PDF B9). Alerts are recomputed
// from live data on every load, so a quote that becomes active again drops off by itself.
import Link from "next/link";
import { HeartPulse } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatTile, StatusBadge } from "@/components/shared";
import { AlertActions } from "@/components/health/alert-actions";
import { RefreshHealthButton } from "@/components/health/refresh-button";
import { requireUser } from "@/lib/auth/internal";
import { formatDateTime } from "@/lib/format";
import { prisma } from "@/lib/db";
import { listAlerts, refreshAlerts } from "@/services/health.service";

export const metadata = { title: "Deal Health" };

const TYPE_LABEL = { STALLED: "Stalled", DISCOUNT_ANOMALY: "Discount anomaly", DELIVERY_SLIPPAGE: "Delivery slippage" } as const;
const TYPE_TONE = { STALLED: "PENDING", DISCOUNT_ANOMALY: "HIGH", DELIVERY_SLIPPAGE: "BACKORDER" } as const;

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const [user, { type }] = await Promise.all([requireUser(), searchParams]);
  await refreshAlerts();
  const [{ alerts, counts }, cfg] = await Promise.all([listAlerts(), prisma.riskConfig.findUnique({ where: { id: 1 } })]);
  const visible = type ? alerts.filter((a) => a.type === type) : alerts;
  const canAct = user.role === "SALES_MANAGER" || user.role === "ADMIN" || user.role === "FINANCE";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deal Health and Anomaly Dashboard"
        description={`Real-time flags for stalled deals (idle more than ${cfg?.stalledDays ?? 3} days), discounts well above a rep's own average (z ≥ ${cfg?.anomalyZ ?? 2} or ${((cfg?.anomalyAbsBp ?? 1000) / 100).toFixed(0)} points over), and delivery promise slippage. Clicking an alert opens the quotation.`}
        actions={<RefreshHealthButton />}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Stalled Deals" value={counts.stalled} caption={`quotes idle ${(cfg?.stalledDays ?? 3) + 1}+ days`} tone={counts.stalled ? "warning" : "default"} href={type === "STALLED" ? "/health" : "/health?type=STALLED"} />
        <StatTile label="Discount Anomalies" value={counts.anomalies} caption="above the rep's own average" tone={counts.anomalies ? "danger" : "default"} href={type === "DISCOUNT_ANOMALY" ? "/health" : "/health?type=DISCOUNT_ANOMALY"} />
        <StatTile label="Delivery Slippage" value={counts.slippage} caption="promise dates at risk" tone={counts.slippage ? "warning" : "default"} href={type === "DELIVERY_SLIPPAGE" ? "/health" : "/health?type=DELIVERY_SLIPPAGE"} />
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={HeartPulse} title={type ? "No alerts of this kind" : "Every deal is healthy"} description="Alerts appear here as soon as a quote goes idle, a discount jumps above the rep's average, or a promised delivery slips." />
      ) : (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Deal</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Flagged</TableHead>
                <TableHead className="px-4">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="px-4">
                    <Link href={`/quotes/${a.quotation.publicId}`} className="font-medium text-primary hover:underline">
                      {a.quotation.customer.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {a.quotation.number} · {a.quotation.rep.name} · <StatusBadge status={a.quotation.status} className="h-4 px-1.5 text-[10px]" />
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <StatusBadge status={TYPE_TONE[a.type]} label={TYPE_LABEL[a.type]} />
                      <span>{a.message}</span>
                      {a.severity > 1 ? <span className="text-xs text-muted-foreground">severity {a.severity}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(a.firstSeenAt)}</TableCell>
                  <TableCell className="px-4">
                    <AlertActions alertId={a.id} canAct={canAct} nudgedAt={a.lastNudgedAt ? formatDateTime(a.lastNudgedAt) : null} escalatedAt={a.escalatedAt ? formatDateTime(a.escalatedAt) : null} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
