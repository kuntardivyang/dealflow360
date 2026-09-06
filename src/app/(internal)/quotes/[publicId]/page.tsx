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
import { formatBp, formatDate, formatDateTime, formatPoints } from "@/lib/format";
import { canTransition } from "@/lib/state";
import { cn } from "@/lib/utils";
import { loadRiskWeights, loadRoutingRules } from "@/services/quotation.service";
import { customerConcessionHistory } from "@/services/concession.service";
import { judgeProposal } from "@/domain/concession";
import { suggestFor } from "@/services/upsell.service";
import { confirmOnBehalfForm, respondToRequestForm, reviseQuotationForm, sendToCustomerForm } from "../../actions/quotation";
import { Builder, type BuilderLine, type PickerProduct } from "./_components/builder";
import { CustomerField } from "@/components/quotes/customer-field";
import { RiskCard, chainLabel } from "./_components/risk-card";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { SALES_MANAGER: "Sales Manager", FINANCE: "Finance" };
const RECURRING_LABEL: Record<string, string> = { WEEK: "billed weekly", MONTH: "billed monthly", QUARTER: "billed quarterly", YEAR: "billed yearly" };
const REQUEST_TYPE_LABEL: Record<string, string> = { COMMENT: "Comment", CHANGE_REQUEST: "Change request", COUNTER_DISCOUNT: "Counter discount" };

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
      subscription: { select: { publicId: true, qty: true, product: { select: { name: true } } } },
      approvalRequests: { orderBy: { version: "desc" }, take: 1, include: { steps: { orderBy: { stepNo: "asc" }, include: { actedBy: true } } } },
      portalRequests: { orderBy: { createdAt: "desc" }, include: { line: { select: { description: true } }, contact: { select: { name: true } } } },
    },
  });
  if (!q) notFound();
  const customers = await prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, include: { tier: true } });

  const tab = sp.tab === "audit" ? "audit" : "lines";
  const canEdit = canTransition(q.status, "EDIT_LINES") && (q.repUserId === user.id || user.role === "ADMIN");
  const request = q.approvalRequests[0] ?? null;
  const isOwner = q.repUserId === user.id || user.role === "ADMIN";
  // B8: the rep answers portal requests only while the customer is negotiating; otherwise the panel is read-only.
  const canRespond = isOwner && canTransition(q.status, "REP_RESPOND");

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
    ? (await prisma.product.findMany({ where: { archivedAt: null }, include: { category: true, planPrices: { include: { plan: { select: { id: true, name: true } } }, orderBy: { planId: "asc" } } }, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }] })).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category.name,
        kind: p.kind,
        listPrice: p.listPrice,
        unit: p.unit,
        isPromoted: p.isPromoted,
        recurring: p.isSubscription ? RECURRING_LABEL[p.recurringInterval ?? "MONTH"] : null,
        planPrices: p.isSubscription ? p.planPrices.map((pp) => ({ planId: pp.planId, planName: pp.plan.name, price: pp.price })) : [],
      }))
    : [];

  const suggestions = canEdit ? await suggestFor(q.id) : [];

  // What this customer has already been given, so the rep sees it while answering a
  // counter rather than a week later on a report. Only loaded when there is something to
  // answer; excludes this quotation so the deal is never compared against itself.
  const concessions = q.customerId && q.portalRequests.length > 0 ? await customerConcessionHistory(q.customerId, q.id) : null;

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
      className={cn("-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50", tab === t ? "border-link text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground" data-print-hide>
        <ArrowLeft className="size-4" /> Quotations
      </Link>
      <PageHeader
        title={q.customer ? `${q.number} · ${q.customer.name}` : `${q.number} · New quotation`}
        description={`Rep ${q.rep.name} · Last activity ${formatDateTime(q.lastActivityAt)}`}
        actions={
          <>
            <StatusBadge status={q.status} className="h-6 px-3 text-sm" />
            {q.status === "REJECTED" && isOwner ? (
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

      {sp.error ? <p className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive ring-1 ring-inset ring-destructive/20">{sp.error}</p> : null}

      <CustomerField
        quotationId={q.id}
        version={q.version}
        customerId={q.customerId}
        editable={canEdit}
        customers={customers.map((c) => ({ id: c.id, name: c.name, city: c.city, tier: c.tier.name, ceilingBp: c.tier.discountCeilingBp }))}
      />

      {request && q.status === "PENDING_APPROVAL" ? (
        <Card className="border-l-4 border-l-warning bg-warning/5">
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
        <Card className="border-l-4 border-l-destructive bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <span className="font-medium">Rejected.</span> {request.reason ?? "See the audit trail for the reason."} Press Revise to edit and confirm again.
          </CardContent>
        </Card>
      ) : null}
      {q.status === "APPROVED" ? (
        <Card className="border-l-4 border-l-success bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              <span className="font-medium">Approved.</span> Routing needed {request ? chainLabel(request.chain as string[]) : "no approval"}. Send it to the customer to negotiate and confirm in the portal.
            </span>
            {isOwner ? (
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
        <Card className="border-l-4 border-l-info bg-info/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              <span className="font-medium">{q.status === "SENT" ? "Sent to the customer." : "Under negotiation."}</span> Portal link:{" "}
              <code className="rounded-md bg-card px-1.5 py-0.5 font-mono text-xs ring-1 ring-foreground/10">/portal/q/{q.publicId}</code> (customer logs in with their portal account).
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
        <Card className="border-l-4 border-l-success bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              <span className="font-medium">Order confirmed{q.confirmedName ? ` by ${q.confirmedName}` : ""}.</span> Warehouse split and billing follow from here.
            </span>
            <Link href={`/fulfillment/${q.publicId}`} className="text-sm font-medium text-link underline-offset-4 hover:underline">
              Open fulfillment →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {q.portalRequests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer requests</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="mb-3 text-xs text-muted-foreground">
              Requests the customer raised in the portal. Accepting a counter discount applies it to the line; if the new terms exceed the ceilings the quotation re-enters approval automatically.
              {!canRespond ? " Read-only: only the owning rep can answer, and only while the quotation is under negotiation." : ""}
            </p>
            {concessions ? (
              <p className="mb-3 rounded-lg bg-muted/50 px-3 py-2 text-xs ring-1 ring-inset ring-border/70">
                <span className="font-medium">{q.customer!.name}</span> has averaged{" "}
                <span className="font-semibold tabular-nums">{formatBp(concessions.meanBp)}</span> across their last{" "}
                <span className="tabular-nums">{concessions.count}</span> confirmed{" "}
                {concessions.count === 1 ? "order" : "orders"}, highest{" "}
                <span className="font-semibold tabular-nums">{formatBp(concessions.maxBp)}</span>.
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
                  <tr>
                    <th className="py-2">Type</th>
                    <th className="py-2">Line</th>
                    <th className="py-2">Message</th>
                    <th className="py-2 text-right whitespace-nowrap">Proposed</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Date</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y [&_td]:pr-4 [&_td:last-child]:pr-0">
                  {q.portalRequests.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="py-2 whitespace-nowrap">{REQUEST_TYPE_LABEL[r.type] ?? r.type}</td>
                      <td className="py-2">{r.line?.description ?? <span className="text-muted-foreground">Whole order</span>}</td>
                      <td className="py-2">
                        {r.message ?? <span className="text-muted-foreground">–</span>}
                        {r.requestedDeliveryDate ? <p className="text-xs text-muted-foreground">Requested delivery {formatDate(r.requestedDeliveryDate)}</p> : null}
                        {r.responseNote ? <p className="text-xs text-muted-foreground">Response: {r.responseNote}</p> : null}
                        <p className="text-xs text-muted-foreground">by {r.contact.name}</p>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {r.proposedDiscountBp !== null ? formatBp(r.proposedDiscountBp) : "–"}
                        {concessions && r.proposedDiscountBp !== null
                          ? (() => {
                              const v = judgeProposal(concessions, r.proposedDiscountBp);
                              if (v.band === "IN_LINE") return null;
                              return (
                                <span className={cn("block text-[11px] font-medium", v.band === "HIGHEST_EVER" ? "text-destructive" : "text-warning")}>
                                  {v.band === "HIGHEST_EVER" ? "their highest ever" : `+${formatPoints(v.overMeanBp)} over their average`}
                                </span>
                              );
                            })()
                          : null}
                      </td>
                      <td className="py-2"><StatusBadge status={r.status} /></td>
                      <td className="py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                      <td className="py-2">
                        {r.status === "OPEN" && canRespond ? (
                          <form action={respondToRequestForm} className="flex flex-wrap items-center justify-end gap-1">
                            <input type="hidden" name="quotationId" value={q.id} />
                            <input type="hidden" name="requestId" value={r.id} />
                            <input type="hidden" name="publicId" value={q.publicId} />
                            <input name="note" placeholder="Note (optional)" aria-label="Response note" className="h-8 w-36 rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2 text-xs" />
                            <Button type="submit" name="decision" value="ACCEPT" size="sm">
                              Accept
                            </Button>
                            <Button type="submit" name="decision" value="DECLINE" size="sm" variant="outline">
                              Decline
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <nav className="flex border-b" aria-label="Sections" data-print-hide>
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
            {q.status === "DRAFT" && !canEdit ? <p className="text-sm text-muted-foreground">Only the owning rep ({q.rep.name}) can edit this draft.</p> : null}
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
