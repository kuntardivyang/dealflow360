// Owner: A. Screen 4, Quotation detail. Read-only view of lines, totals and the approval
// preview; the interactive builder (feature 34) replaces the lines card next.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, EmptyState, Money, PageHeader, StatusBadge, type Column } from "@/components/shared";
import { overageBp } from "@/domain/money";
import type { RiskPreview } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatBp, formatDateTime, formatPoints } from "@/lib/format";

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

  type Line = (typeof q.lines)[number];
  const columns: Column<Line>[] = [
    {
      key: "product",
      header: "Product",
      cell: (l) => (
        <div>
          <p className="font-medium">{l.description}</p>
          <p className="text-xs text-muted-foreground">
            {l.product.category.name}
            {l.plan ? ` · ${l.plan.name}` : ""}
          </p>
        </div>
      ),
    },
    { key: "qty", header: "Qty", align: "right", cell: (l) => <span className="tabular-nums">{l.qty}</span> },
    { key: "price", header: "Price", align: "right", cell: (l) => <Money paise={l.unitPrice} /> },
    { key: "discount", header: "Discount", align: "right", cell: (l) => <span className="tabular-nums">{formatBp(l.effectiveDiscountBp)}</span> },
    { key: "limit", header: "Limit", align: "right", cell: (l) => <span className="tabular-nums">{formatBp(l.ceilingBp)}</span> },
    {
      key: "status",
      header: "Status",
      cell: (l) => {
        const over = overageBp(l.effectiveDiscountBp, l.ceilingBp);
        return over > 0 ? <StatusBadge status="OVER" label={`Over +${formatPoints(over)}`} /> : <StatusBadge status="OK" />;
      },
    },
    { key: "total", header: "Total", align: "right", cell: (l) => <Money paise={l.total} /> },
  ];

  return (
    <div className="space-y-6">
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Quotations
      </Link>
      <PageHeader
        title={`${q.number} · ${q.customer.name}`}
        description={`${q.customer.tier.name} tier (ceiling ${formatBp(q.customer.tier.discountCeilingBp)}) · Rep ${q.rep.name} · Last activity ${formatDateTime(q.lastActivityAt)}`}
        actions={<StatusBadge status={q.status} className="h-6 px-3 text-sm" />}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Order lines</h2>
        <DataTable
          columns={columns}
          rows={q.lines}
          rowKey={(l) => l.id}
          empty={<EmptyState title="No lines yet" description="The builder to add products arrives with the next merge." />}
        />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Gross</dt>
              <dd className="text-right"><Money paise={q.grossTotal} /></dd>
              <dt className="text-muted-foreground">Discount{q.orderDiscountBp ? ` (order ${formatBp(q.orderDiscountBp)})` : ""}</dt>
              <dd className="text-right">− <Money paise={q.discountTotal} /></dd>
              <dt className="text-muted-foreground">Net</dt>
              <dd className="text-right"><Money paise={q.netTotal} /></dd>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right"><Money paise={q.taxTotal} /></dd>
              <dt className="font-medium">Total</dt>
              <dd className="text-right font-semibold"><Money paise={q.total} /></dd>
              <dt className="text-muted-foreground">Margin</dt>
              <dd className="text-right tabular-nums">{formatBp(q.marginBp)}</dd>
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
                <p className="flex items-center gap-2">
                  Blended risk <span className="text-lg font-semibold tabular-nums">{risk.score}</span>
                  <span className="text-muted-foreground">/ 100</span>
                  <StatusBadge status={risk.band} />
                </p>
                <dl className="grid grid-cols-2 gap-y-1 tabular-nums">
                  <dt className="text-muted-foreground">Worst line overage</dt>
                  <dd className="text-right">{formatPoints(risk.worstOverageBp)}</dd>
                  <dt className="text-muted-foreground">Blended overage</dt>
                  <dd className="text-right">{formatPoints(risk.blendedOverageBp)}</dd>
                  <dt className="text-muted-foreground">Margin penalty</dt>
                  <dd className="text-right">{formatPoints(risk.marginPenaltyBp)}</dd>
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
    </div>
  );
}
