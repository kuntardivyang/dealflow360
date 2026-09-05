// Owner: A. Screen 10, Billing detail: one-time lines from the originating order, the
// recurring lines, the upcoming schedule and the invoices. Modify and cancel come next.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money, PageHeader, StatusBadge } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const CYCLE = { WEEK: "Weekly", MONTH: "Monthly", QUARTER: "Quarterly", YEAR: "Yearly" } as const;

export default async function BillingDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  await requireUser(undefined, `/subscriptions/${publicId}`);
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
      <Link href="/subscriptions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Subscriptions
      </Link>
      <PageHeader
        title={`${sub.customer.name} · ${sub.product.name}`}
        description={`${CYCLE[sub.plan.interval]} · ${sub.qty} × ${sub.product.unit} · current period ${formatDate(sub.currentPeriodStart)} to ${formatDate(sub.currentPeriodEnd)}${sub.quotation ? ` · from order ${sub.quotation.number}` : ""}`}
        actions={
          <>
            <StatusBadge status={sub.status} className="h-6 px-3 text-sm" />
            <Button variant="outline" disabled title="Quantity changes with proration arrive with the next merge">
              Modify Subscription
            </Button>
            <Button variant="outline" disabled title="Cancellation with credit note arrives with the next merge">
              Cancel Subscription
            </Button>
          </>
        }
      />

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
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2">Product</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
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
                <Link href={`/invoices/${i.publicId}`} className="underline-offset-4 hover:underline">
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
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
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
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2">#</th>
                <th className="py-2">Period</th>
                <th className="py-2">Bill date</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2">Status</th>
                <th className="py-2">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y">
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
                      <Link href={`/invoices/${s.invoice.publicId}`} className="underline-offset-4 hover:underline">
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
