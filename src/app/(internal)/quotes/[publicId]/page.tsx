// Owner: A. Screen 4, Quotation detail: the builder (feature 34) while the quotation is
// editable, a read-only view otherwise, the approval preview (35) and the audit trail (38).
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, EmptyState, Money, PageHeader, StatusBadge, type Column, AuditTrail } from "@/components/shared";
import { overageBp } from "@/domain/money";
import { scoreLines } from "@/domain/risk";
import { riskPreview } from "@/domain/route";
import { requireUser } from "@/lib/auth/internal";
import type { RiskPreview } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatBp, formatDateTime, formatPoints } from "@/lib/format";
import { canTransition } from "@/lib/state";
import { cn } from "@/lib/utils";
import { loadRiskWeights, loadRoutingRules } from "@/services/quotation.service";
import { suggestFor } from "@/services/upsell.service";
import { confirmOnBehalfForm, reviseQuotationForm, sendToCustomerForm } from "../../actions/quotation";
import { Builder, type BuilderLine, type PickerProduct } from "./_components/builder";
import { CustomerField } from "@/components/quotes/customer-field";
import { RiskCard, chainLabel } from "./_components/risk-card";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { SALES_MANAGER: "Sales Manager", FINANCE: "Finance" };

export default async function QuotationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const [{ publicId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(undefined, `/quotes/${publicId}`);
  const q = await prisma.quotation.findUnique({
    where: { publicId },
    include: {
      customer: { include: { tier: true } },
      rep: true,
      lines: { orderBy: { sortOrder: "asc" }, include: { product: { include: { category: true } }, plan: true } },
      approvalRequests: { orderBy: { version: "desc" }, take: 1, include: { steps: { orderBy: { stepNo: "asc" }, include: { actedBy: true } } } },
    },
  });
  if (!q) notFound();
  const customers = await prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, include: { tier: true } });

  const tab = sp.tab === "audit" ? "audit" : "lines";
  const canEdit = canTransition(q.status, "EDIT_LINES") && (q.repUserId === user.id || user.role === "ADMIN");
  const request = q.approvalRequests[0] ?? null;

  const stored = (q.riskBreakdown as unknown as RiskPreview | null) ?? null;
  const risk =
    stored ??
    (q.lines.length > 0
      ? riskPreview(
          scoreLines(
            q.lines.map((l) => ({ lineId: l.id, effectiveDiscountBp: l.effectiveDiscountBp, ceilingBp: l.ceilingBp, gross: l.gross })),
            q.marginBp,
            await loadRiskWeights(prisma),
          ),
          q.total,
          await loadRoutingRules(prisma),
        )
      : null);

  const builderLines: BuilderLine[] = q.lines.map((l) => ({
    id: l.id,
    description: l.description,
    category: l.product.category.name,
    plan: l.plan?.name ?? null,
    qty: l.qty,
    unitPrice: l.unitPrice,
    discountBp: l.discountBp,
    effectiveDiscountBp: l.effectiveDiscountBp,
    ceilingBp: l.ceilingBp,
    total: l.total,
  }));

  const products: PickerProduct[] = canEdit
    ? (await prisma.product.findMany({ where: { archivedAt: null }, include: { category: true }, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }] })).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category.name,
        kind: p.kind,
        listPrice: p.listPrice,
        unit: p.unit,
        isPromoted: p.isPromoted,
      }))
    : [];

  const suggestions = canEdit ? await suggestFor(q.id) : [];

  const audit = tab === "audit" ? await prisma.auditLog.findMany({ where: { quotationId: q.id }, orderBy: { at: "desc" }, take: 100 }) : [];

  const initialView = {
    totals: {
      lines: q.lines.map((l) => ({
        lineId: l.id,
        effectiveDiscountBp: l.effectiveDiscountBp,
        gross: l.gross,
        discountAmount: l.discountAmount,
        net: l.net,
        tax: l.tax,
        total: l.total,
        cost: l.unitCost * l.qty,
      })),
      grossTotal: q.grossTotal,
      discountTotal: q.discountTotal,
      netTotal: q.netTotal,
      taxTotal: q.taxTotal,
      total: q.total,
      costTotal: q.costTotal,
      marginBp: q.marginBp,
    },
    risk,
    version: q.version,
  };

  type Line = (typeof q.lines)[number];
  const readColumns: Column<Line>[] = [
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

  const tabLink = (t: "lines" | "audit", label: string) => (
    <Link
      href={`/quotes/${publicId}${t === "audit" ? "?tab=audit" : ""}`}
      className={cn("border-b-2 px-3 py-2 text-sm font-medium", tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Quotations
      </Link>
      <PageHeader
        title={q.customer ? `${q.number} · ${q.customer.name}` : `${q.number} · New quotation`}
        description={`${q.customer ? `${q.customer.tier.name} tier (ceiling ${formatBp(q.customer.tier.discountCeilingBp)}) · ` : ""}Rep ${q.rep.name} · Last activity ${formatDateTime(q.lastActivityAt)}`}
        actions={
          <>
            <StatusBadge status={q.status} className="h-6 px-3 text-sm" />
            {q.status === "REJECTED" && (q.repUserId === user.id || user.role === "ADMIN") ? (
              <form action={reviseQuotationForm}>
                <input type="hidden" name="quotationId" value={q.id} />
                <input type="hidden" name="version" value={q.version} />
                <input type="hidden" name="publicId" value={q.publicId} />
                <Button type="submit" variant="outline">
                  Revise
                </Button>
              </form>
            ) : null}
          </>
        }
      />

      {sp.error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.error}</p> : null}

      <CustomerField
        quotationId={q.id}
        version={q.version}
        customerId={q.customerId}
        editable={canEdit}
        customers={customers.map((c) => ({ id: c.id, name: c.name, city: c.city, tier: c.tier.name, ceilingBp: c.tier.discountCeilingBp }))}
      />

      {request && q.status === "PENDING_APPROVAL" ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center gap-4 p-4 text-sm">
            <span className="font-medium">Awaiting approval, round {request.version}</span>
            <ol className="flex flex-wrap items-center gap-2">
              {request.steps.map((s) => (
                <li key={s.id} className="flex items-center gap-1">
                  <StatusBadge status={s.status} label={`${ROLE_LABEL[s.requiredRole] ?? s.requiredRole}: ${s.status.toLowerCase()}`} />
                </li>
              ))}
            </ol>
            <span className="text-muted-foreground">Blended risk {request.riskScore}. Approvers act from the Approvals tab.</span>
          </CardContent>
        </Card>
      ) : null}
      {q.status === "REJECTED" && request ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <span className="font-medium">Rejected.</span> {request.reason ?? "See the audit trail for the reason."} Press Revise to edit and confirm again.
          </CardContent>
        </Card>
      ) : null}
      {q.status === "APPROVED" ? (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              <span className="font-medium">Approved.</span> Routing needed {request ? chainLabel(request.chain as string[]) : "no approval"}. Send it to the customer to negotiate and confirm in the portal.
            </span>
            {q.repUserId === user.id || user.role === "ADMIN" ? (
              <form action={sendToCustomerForm}>
                <input type="hidden" name="quotationId" value={q.id} />
                <input type="hidden" name="version" value={q.version} />
                <input type="hidden" name="publicId" value={q.publicId} />
                <Button type="submit">Send to customer</Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {q.status === "SENT" || q.status === "UNDER_NEGOTIATION" ? (
        <Card className="border-info/40 bg-info/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              <span className="font-medium">{q.status === "SENT" ? "Sent to the customer." : "Under negotiation."}</span> Portal link:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/portal/q/{q.publicId}</code> (customer logs in with their portal account).
            </span>
            {user.role === "ADMIN" ? (
              <form action={confirmOnBehalfForm} className="flex items-center gap-2">
                <input type="hidden" name="quotationId" value={q.id} />
                <input type="hidden" name="version" value={q.version} />
                <input type="hidden" name="publicId" value={q.publicId} />
                <input type="hidden" name="customerName" value={q.customer?.name ?? ""} />
                <Button type="submit" variant="outline" title="Admin only: confirm the order on the customer's behalf">
                  Confirm on behalf
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {q.status === "CONFIRMED" || q.status === "FULFILLMENT" || q.status === "PAID" ? (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              <span className="font-medium">Order confirmed{q.confirmedName ? ` by ${q.confirmedName}` : ""}.</span> Warehouse split and billing follow from here.
            </span>
            <Link href={`/fulfillment/${q.publicId}`} className="text-sm font-medium underline-offset-4 hover:underline">
              Open fulfillment →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <nav className="flex border-b" aria-label="Sections">
        {tabLink("lines", "Lines and totals")}
        {tabLink("audit", "Audit trail")}
      </nav>

      {tab === "audit" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audit trail</CardTitle>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState title="No entries yet" />
            ) : (
              <AuditTrail entries={audit} subject={q.number} />
            )}
          </CardContent>
        </Card>
      ) : canEdit ? (
        <Builder
          key={`${q.version}-${q.updatedAt.getTime()}`}
          quotationId={q.id}
          status={q.status}
          lines={builderLines}
          products={products}
          suggestions={suggestions.map((s) => ({ productId: s.productId, name: s.name, category: s.category, listPrice: s.listPrice, unit: s.unit, marginDelta: s.marginDelta, isPromoted: s.isPromoted, reason: s.reason }))}
          orderDiscountBp={q.orderDiscountBp}
          initialView={initialView}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <section className="space-y-2">
            <DataTable columns={readColumns} rows={q.lines} rowKey={(l) => l.id} empty={<EmptyState title="No lines" />} />
          </section>
          <div className="space-y-6">
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
            <RiskCard risk={risk} hasLines={q.lines.length > 0} />
          </div>
        </div>
      )}
    </div>
  );
}
