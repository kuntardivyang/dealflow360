// Owner: A. Screen 10, Billing detail: one-time lines from the originating order, the
// recurring lines, the upcoming schedule and the invoices. Modify and cancel come next.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money, PageHeader, StatusBadge } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { OPS_ROLES } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { todayISO, toISODate } from "@/domain/dates";
import { formatDate } from "@/lib/format";
import { cancelSubscriptionForm, changeQuantityForm } from "../../actions/subscription";

export const dynamic = "force-dynamic";
const CYCLE = { WEEK: "Weekly", MONTH: "Monthly", QUARTER: "Quarterly", YEAR: "Yearly" } as const;

export default async function BillingDetailPage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ publicId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(undefined, `/subscriptions/${publicId}`);
  const canChange = OPS_ROLES.includes(user.role);
  const sub = await prisma.subscription.findUnique({
    where: { publicId },
    include: {
      customer: true,
      product: true,
      plan: true,
      schedule: { orderBy: { periodStart: "asc" }, include: { invoice: true } },
      invoices: { orderBy: { issueDate: "asc" } },
      changes: { orderBy: { createdAt: "desc" } },
      quotation: { include: { lines: { where: { lineType: "ONE_TIME" }, orderBy: { sortOrder: "asc" } }, invoices: { where: { kind: "ONE_TIME" } } } },
    },
  });
  if (!sub) notFound();
  const next = sub.schedule.find((s) => s.status === "SCHEDULED");
  const perPeriod = sub.schedule[0]?.total ?? 0;

  return (
    <div className="space-y-6">
      <Link href="/subscriptions" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Subscriptions
      </Link>
      <PageHeader
        title={`${sub.customer.name} · ${sub.product.name}`}
        description={`${CYCLE[sub.plan.interval]} · ${sub.qty} × ${sub.product.unit} · current period ${formatDate(sub.currentPeriodStart)} to ${formatDate(sub.currentPeriodEnd)}${sub.quotation ? ` · from order ${sub.quotation.number}` : ""}`}
        actions={
          <>
            <StatusBadge status={sub.status} className="h-6 px-3 text-sm" />
            {canChange && sub.status === "ACTIVE" ? (
              <a href="#cancel" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                Cancel Subscription
              </a>
            ) : null}
          </>
        }
      />

      {sp.error ? <p className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive ring-1 ring-inset ring-destructive/20">{sp.error}</p> : null}
      {sp.ok ? <p className="rounded-lg bg-success/8 px-3 py-2 text-sm text-success ring-1 ring-inset ring-success/20">{sp.ok}</p> : null}

      {canChange && sub.status === "ACTIVE" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Modify Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={changeQuantityForm} className="flex flex-wrap items-end gap-3 text-sm">
              <input type="hidden" name="subscriptionId" value={sub.id} />
              <input type="hidden" name="publicId" value={sub.publicId} />
              <label className="block">
                <span className="text-muted-foreground">New quantity (now {sub.qty})</span>
                <input name="newQty" type="number" min={1} defaultValue={sub.qty + 1} required className="mt-1 h-9 w-24 rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2 text-right" />
              </label>
              <label className="block">
                <span className="text-muted-foreground">Effective date</span>
                <input name="effectiveDate" type="date" defaultValue={todayISO()} min={toISODate(sub.currentPeriodStart)} max={toISODate(sub.currentPeriodEnd)} required className="mt-1 h-9 rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2" />
              </label>
              <Button type="submit">Apply change</Button>
              <p className="basis-full text-xs text-muted-foreground">
                Prorated by calendar day of the current period ({formatDate(sub.currentPeriodStart)} to {formatDate(sub.currentPeriodEnd)}): the old quantity is credited and the new one charged for the remaining days. More seats post a proration invoice; fewer seats issue a credit note. Future periods are re-priced.
              </p>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {canChange && sub.status === "ACTIVE" ? (
        <Card id="cancel">
          <CardHeader>
            <CardTitle className="text-base">Cancel Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={cancelSubscriptionForm} className="flex flex-wrap items-end gap-3 text-sm">
              <input type="hidden" name="subscriptionId" value={sub.id} />
              <input type="hidden" name="publicId" value={sub.publicId} />
              <label className="block">
                <span className="text-muted-foreground">Effective date</span>
                <input name="effectiveDate" type="date" defaultValue={todayISO()} min={toISODate(sub.currentPeriodStart)} max={toISODate(sub.currentPeriodEnd)} required className="mt-1 h-9 rounded-md border bg-card px-2" />
              </label>
              <label className="block grow">
                <span className="text-muted-foreground">Reason</span>
                <input name="reason" required minLength={3} placeholder="Why the customer is cancelling" className="mt-1 h-9 w-full rounded-md border bg-card px-2" />
              </label>
              <Button type="submit" variant="destructive">
                Cancel Subscription
              </Button>
              <p className="basis-full text-xs text-muted-foreground">
                Policy on this plan: {sub.plan.cancelPolicy === "END_OF_PERIOD" ? "runs to the end of the current period, nothing credited" : sub.plan.cancelPolicy === "NO_REFUND" ? "stops immediately, nothing credited" : `stops immediately, the unused days of the current period are credited as a ${sub.plan.refundMethod === "REFUND_PAYMENT" ? "refund on the paid invoice" : "credit note"}`}. Future scheduled periods are cancelled.
              </p>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {sub.changes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Proration history</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <table className="w-full">
              <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
                <tr>
                  <th className="py-2">Effective</th>
                  <th className="py-2">Change</th>
                  <th className="py-2 text-right">Days</th>
                  <th className="py-2 text-right">Credit</th>
                  <th className="py-2 text-right">Charge</th>
                  <th className="py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y [&_td]:pr-4 [&_td:last-child]:pr-0">
                {sub.changes.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2">{formatDate(c.effectiveDate)}</td>
                    <td className="py-2">
                      {c.oldQty} → {c.newQty} seats
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {c.remainingDays}/{c.daysInPeriod}
                    </td>
                    <td className="py-2 text-right"><Money paise={c.credit} /></td>
                    <td className="py-2 text-right"><Money paise={c.charge} /></td>
                    <td className="py-2 text-right"><Money paise={c.net} signed /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">One-time lines (from the originating order)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {!sub.quotation || sub.quotation.lines.length === 0 ? (
              <p className="text-muted-foreground">No one-time lines on this order.</p>
            ) : (
              <table className="w-full">
                <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
                  <tr>
                    <th className="py-2">Product</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y [&_td]:pr-4 [&_td:last-child]:pr-0">
                  {sub.quotation.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2">{l.description}</td>
                      <td className="py-2 text-right tabular-nums">{l.qty}</td>
                      <td className="py-2 text-right"><Money paise={l.total} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {sub.quotation?.invoices.map((i) => (
              <p key={i.id} className="mt-3 text-muted-foreground">
                Invoiced as{" "}
                <Link href={`/invoices/${i.publicId}`} className="font-medium text-link underline-offset-4 hover:underline">
                  {i.number}
                </Link>{" "}
                <StatusBadge status={i.status} />
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recurring lines</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <table className="w-full">
              <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
                <tr>
                  <th className="py-2">Plan</th>
                  <th className="py-2">Cycle</th>
                  <th className="py-2">Next bill date</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-2">
                    {sub.product.name} × {sub.qty}
                  </td>
                  <td className="py-2">{CYCLE[sub.plan.interval]}</td>
                  <td className="py-2">{next ? formatDate(next.billDate) : "–"}</td>
                  <td className="py-2 text-right"><Money paise={perPeriod} /></td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              Proration: {sub.plan.prorationMode === "DAY_BASED" ? "by calendar day of the real period" : "none, changes apply next period"}
              {sub.plan.billChangeDay ? ", the change day is billed" : ""}. Cancellation: {sub.plan.cancelPolicy.toLowerCase().replaceAll("_", " ")}, refunds as {sub.plan.refundMethod.toLowerCase().replaceAll("_", " ")}.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing schedule</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <table className="w-full">
            <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
              <tr>
                <th className="py-2">#</th>
                <th className="py-2">Period</th>
                <th className="py-2">Bill date</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2">Status</th>
                <th className="py-2">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y [&_td]:pr-4 [&_td:last-child]:pr-0">
              {sub.schedule.map((s, i) => (
                <tr key={s.id}>
                  <td className="py-2 tabular-nums">{i + 1}</td>
                  <td className="py-2">
                    {formatDate(s.periodStart)} to {formatDate(s.periodEnd)}
                  </td>
                  <td className="py-2">{formatDate(s.billDate)}</td>
                  <td className="py-2 text-right"><Money paise={s.total} /></td>
                  <td className="py-2"><StatusBadge status={s.status} label={s.status === "SCHEDULED" ? "Scheduled" : s.status === "INVOICED" ? "Invoiced" : "Cancelled"} /></td>
                  <td className="py-2">
                    {s.invoice ? (
                      <Link href={`/invoices/${s.invoice.publicId}`} className="font-medium text-link underline-offset-4 hover:underline">
                        {s.invoice.number} <StatusBadge status={s.invoice.status} />
                      </Link>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
