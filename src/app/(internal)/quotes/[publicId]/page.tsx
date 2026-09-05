// Screen 4, Quotation detail. Read-only view of lines, totals and the risk preview.
// The interactive builder (feature 34) replaces the lines table in the next cycle.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { overageBp } from "@/domain/money";
import type { RiskPreview } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatBp, formatDateTime, formatPaise, formatPt } from "@/lib/format";
import { QuotationStatusBadge } from "../_components/status-badge";

export const dynamic = "force-dynamic";

export default async function QuotationDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const q = await prisma.quotation.findUnique({
    where: { publicId },
    include: {
      customer: { include: { tier: true } },
      rep: true,
      lines: { orderBy: { sortOrder: "asc" }, include: { product: { include: { category: true } }, plan: true } },
    },
  });
  if (!q) notFound();
  const risk = (q.riskBreakdown as unknown as RiskPreview | null) ?? null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href="/quotes" className="text-xs text-muted-foreground hover:underline">
            ← Quotations
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {q.number} · {q.customer.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {q.customer.tier.name} tier (ceiling {formatBp(q.customer.tier.discountCeilingBp)}) · Rep {q.rep.name} · Last activity{" "}
            {formatDateTime(q.lastActivityAt)}
          </p>
        </div>
        <QuotationStatusBadge status={q.status} />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order lines</CardTitle>
        </CardHeader>
        <CardContent>
          {q.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lines yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Limit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.lines.map((l) => {
                  const over = overageBp(l.effectiveDiscountBp, l.ceilingBp);
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <p className="font-medium">{l.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.product.category.name}
                          {l.plan ? ` · ${l.plan.name}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaise(l.unitPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBp(l.effectiveDiscountBp)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBp(l.ceilingBp)}</TableCell>
                      <TableCell>
                        {over > 0 ? (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">OVER (+{formatPt(over)})</span>
                        ) : (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">OK</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaise(l.total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-1 text-sm tabular-nums">
              <dt className="text-muted-foreground">Gross</dt>
              <dd className="text-right">{formatPaise(q.grossTotal)}</dd>
              <dt className="text-muted-foreground">Discount{q.orderDiscountBp ? ` (order ${formatBp(q.orderDiscountBp)})` : ""}</dt>
              <dd className="text-right">− {formatPaise(q.discountTotal)}</dd>
              <dt className="text-muted-foreground">Net</dt>
              <dd className="text-right">{formatPaise(q.netTotal)}</dd>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right">{formatPaise(q.taxTotal)}</dd>
              <dt className="font-medium">Total</dt>
              <dd className="text-right font-semibold">{formatPaise(q.total)}</dd>
              <dt className="text-muted-foreground">Margin</dt>
              <dd className="text-right">{q.marginBp === null ? "n/a" : formatBp(q.marginBp)}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!risk || q.lines.length === 0 ? (
              <p className="text-muted-foreground">Add lines to see the blended risk score.</p>
            ) : (
              <>
                <p>
                  Blended risk <span className="font-semibold">{risk.score}</span> / 100 · {risk.band}
                </p>
                <dl className="grid grid-cols-2 gap-y-1 tabular-nums">
                  <dt className="text-muted-foreground">Worst line overage</dt>
                  <dd className="text-right">{formatPt(risk.worstOverageBp)}</dd>
                  <dt className="text-muted-foreground">Blended overage</dt>
                  <dd className="text-right">{formatPt(risk.blendedOverageBp)}</dd>
                  <dt className="text-muted-foreground">Margin penalty</dt>
                  <dd className="text-right">{formatPt(risk.marginPenaltyBp)}</dd>
                </dl>
                <p className="text-muted-foreground">
                  {risk.chain.length === 0
                    ? "Within every limit: confirm goes straight through."
                    : `Confirm will route to: ${risk.chain.map((r) => (r === "SALES_MANAGER" ? "Sales Manager" : "Finance")).join(" → ")}`}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
