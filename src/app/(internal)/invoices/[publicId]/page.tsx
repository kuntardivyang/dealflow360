// Owner: A. Screen 13, Invoice detail: order progress, invoice lines, payments, Record Payment.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money, PageHeader, StatusBadge } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { OPS_ROLES } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatBp, formatDate, formatDateTime } from "@/lib/format";
import { publicId as newRef } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { recordPaymentForm } from "../../actions/billing";
import { PrintButton } from "./_components/print-button";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ publicId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(undefined, `/invoices/${publicId}`);
  const inv = await prisma.invoice.findUnique({
    where: { publicId },
    include: {
      customer: true,
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "asc" } },
      quotation: { include: { fulfillmentPlans: { where: { status: "ACCEPTED" }, include: { shipments: true } } } },
      subscription: { include: { plan: true } },
    },
  });
  if (!inv) notFound();
  const due = inv.total - inv.paidAmount;
  const canPay = OPS_ROLES.includes(user.role) && (inv.status === "POSTED" || inv.status === "PARTIAL");
  const shipped = inv.quotation?.fulfillmentPlans.some((p) => p.shipments.length > 0 && p.shipments.every((s) => s.status === "SHIPPED")) ?? false;
  const steps = [
    { label: "Order Confirmed", done: !!inv.quotation?.confirmedAt },
    { label: "Shipped", done: shipped },
    { label: "Invoiced", done: true },
    { label: "Paid", done: inv.status === "PAID" },
  ];

  return (
    <div className="space-y-6">
      <Link href="/invoices" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-print-hide>
        <ArrowLeft className="size-4" /> Invoices
      </Link>
      <PageHeader
        title={`${inv.number} · ${inv.customer.name}`}
        description={`${inv.kind === "ONE_TIME" ? "One-time invoice" : inv.kind === "RECURRING" ? `Recurring invoice · ${inv.subscription?.plan.name ?? ""}` : "Proration invoice"} · issued ${formatDate(inv.issueDate)} · due ${formatDate(inv.dueDate)}${inv.quotation ? ` · order ${inv.quotation.number}` : ""}`}
        actions={
          <>
            <StatusBadge status={inv.status} className="h-6 px-3 text-sm" />
            <PrintButton />
          </>
        }
      />
      {sp.error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.error}</p> : null}

      <ol className="flex flex-wrap items-center gap-2 text-sm" data-print-hide>
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={cn("flex size-6 items-center justify-center rounded-full border text-xs", s.done ? "border-success bg-success text-white" : "text-muted-foreground")}>{s.done ? <Check className="size-3.5" /> : i + 1}</span>
            <span className={s.done ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
            {i < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-border" /> : null}
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice lines</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Description</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Discount</th>
                  <th className="py-2 text-right">Net</th>
                  <th className="py-2 text-right">Tax</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2">{l.description}</td>
                    <td className="py-2 text-right tabular-nums">{l.qty}</td>
                    <td className="py-2 text-right"><Money paise={l.unitPrice} /></td>
                    <td className="py-2 text-right tabular-nums">{formatBp(l.discountBp)}</td>
                    <td className="py-2 text-right"><Money paise={l.net} /></td>
                    <td className="py-2 text-right"><Money paise={l.tax} /></td>
                    <td className="py-2 text-right"><Money paise={l.total} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-4 ml-auto grid w-72 grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right"><Money paise={inv.subtotal} /></dd>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right"><Money paise={inv.taxTotal} /></dd>
              <dt className="font-medium">Total</dt>
              <dd className="text-right font-semibold"><Money paise={inv.total} /></dd>
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right"><Money paise={inv.paidAmount} /></dd>
              <dt className="font-medium">Balance due</dt>
              <dd className="text-right font-semibold"><Money paise={due} /></dd>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {inv.payments.length === 0 ? <p className="text-muted-foreground">No payments yet.</p> : null}
              {inv.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <span>
                    {formatDateTime(p.receivedAt)} · {p.method.toLowerCase().replaceAll("_", " ")}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <Money paise={p.amount} />
                </div>
              ))}
            </CardContent>
          </Card>
          {canPay ? (
            <Card data-print-hide>
              <CardHeader>
                <CardTitle className="text-base">Record Payment</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={recordPaymentForm} className="space-y-3 text-sm">
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <input type="hidden" name="publicId" value={inv.publicId} />
                  <input type="hidden" name="clientRef" value={newRef(16)} />
                  <label className="block">
                    <span className="text-muted-foreground">Amount (₹), balance {(due / 100).toFixed(2)}</span>
                    <input name="amountRupees" type="number" step="0.01" min="0.01" max={(due / 100).toFixed(2)} defaultValue={(due / 100).toFixed(2)} required className="mt-1 h-9 w-full rounded-md border bg-card px-2 text-right" />
                  </label>
                  <label className="block">
                    <span className="text-muted-foreground">Method</span>
                    <select name="method" className="mt-1 h-9 w-full rounded-md border bg-card px-2" defaultValue="BANK_TRANSFER">
                      <option value="BANK_TRANSFER">Bank transfer</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-muted-foreground">Reference (optional)</span>
                    <input name="reference" className="mt-1 h-9 w-full rounded-md border bg-card px-2" placeholder="UTR / cheque no." />
                  </label>
                  <Button type="submit" className="w-full">
                    Record Payment
                  </Button>
                  <p className="text-xs text-muted-foreground">Partial payments allowed; more than the balance is refused.</p>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
