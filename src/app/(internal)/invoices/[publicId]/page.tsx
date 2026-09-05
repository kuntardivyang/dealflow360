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
      quotation: { include: { fulfillmentPlans: { where: { status: "ACCEPTED" }, include: { shipments: true } }, invoices: { orderBy: { id: "asc" } } } },
      subscription: { include: { plan: true } },
    },
  });
  if (!inv) notFound();
  const due = inv.total - inv.paidAmount;
  const canPay = OPS_ROLES.includes(user.role) && (inv.status === "POSTED" || inv.status === "PARTIAL");
  const shipped = inv.quotation?.fulfillmentPlans.some((p) => p.shipments.length > 0 && p.shipments.every((s) => s.status === "SHIPPED")) ?? false;
  const KIND_LABEL = { ONE_TIME: "", RECURRING: " (Recurring)", PRORATION: " (Proration)" } as const;
  const related = inv.quotation?.invoices ?? [];
  const steps = [
    { label: "Order Confirmed", done: !!inv.quotation?.confirmedAt },
    { label: "Shipped", done: shipped },
    { label: "Invoiced", done: true },
    { label: "Paid", done: inv.status === "PAID" },
  ];

  return (
    <div className="space-y-6">
      <Link href="/invoices" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground" data-print-hide>
        <ArrowLeft className="size-4" /> Invoices
      </Link>
      <PageHeader
        className="print:hidden"
        title={`${inv.number} · ${inv.customer.name}`}
        description={`${inv.kind === "ONE_TIME" ? "One-time invoice" : inv.kind === "RECURRING" ? `Recurring invoice · ${inv.subscription?.plan.name ?? ""}` : "Proration invoice"} · issued ${formatDate(inv.issueDate)} · due ${formatDate(inv.dueDate)}${inv.quotation ? ` · order ${inv.quotation.number}` : ""}`}
        actions={
          <>
            <StatusBadge status={inv.status} className="h-6 px-3 text-sm" />
            <PrintButton />
          </>
        }
      />
      <section className="hidden print:block">
        <div className="flex items-start justify-between border-b pb-3">
          <div>
            <p className="font-heading text-lg font-bold">DealFlow360 Demo Pvt. Ltd.</p>
            <p className="text-xs text-muted-foreground">Bengaluru, India · GSTIN 29ABCDE1234F1Z5 · billing@dealflow360.demo</p>
          </div>
          <div className="text-right">
            <p className="font-heading text-xl font-bold tracking-tight">TAX INVOICE</p>
            <p className="text-sm tabular-nums">{inv.number}</p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-5 gap-4 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Bill to</dt>
            <dd className="font-medium">{inv.customer.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Issue date</dt>
            <dd>{formatDate(inv.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Due date</dt>
            <dd>{formatDate(inv.dueDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{inv.quotation ? "Order" : "Status"}</dt>
            <dd>{inv.quotation ? inv.quotation.number : inv.status === "PAID" ? "Paid" : "Unpaid"}</dd>
          </div>
        </dl>
      </section>
      {sp.error ? <p className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive ring-1 ring-inset ring-destructive/20">{sp.error}</p> : null}

      <ol className="surface flex flex-wrap items-center gap-3 px-5 py-3 text-sm" data-print-hide aria-label="Order progress">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  s.done ? "bg-success text-white" : "bg-card text-muted-foreground ring-1 ring-border",
                )}
              >
                {s.done ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={s.done ? "font-semibold" : "text-muted-foreground"}>{s.label}</span>
            </span>
            {i < steps.length - 1 ? <span aria-hidden className={cn("h-px w-8 sm:w-12", steps[i + 1].done ? "bg-success/50" : "bg-border")} /> : null}
          </li>
        ))}
      </ol>

      {related.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoices on order {inv.quotation?.number}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
                <tr>
                  <th className="py-2">Invoice #</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Due date</th>
                </tr>
              </thead>
              <tbody className="divide-y [&_td]:pr-4 [&_td:last-child]:pr-0">
                {related.map((r) => (
                  <tr key={r.id} className={cn(r.id === inv.id && "font-medium")}>
                    <td className="py-2">
                      {r.id === inv.id ? (
                        <span>{r.number}{KIND_LABEL[r.kind]}</span>
                      ) : (
                        <Link href={`/invoices/${r.publicId}`} className="font-medium text-link underline-offset-4 hover:underline">
                          {r.number}{KIND_LABEL[r.kind]}
                        </Link>
                      )}
                    </td>
                    <td className="py-2 text-right"><Money paise={r.total} /></td>
                    <td className="py-2"><StatusBadge status={r.status} /></td>
                    <td className="py-2">{formatDate(r.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">One-time and recurring lines of the same order are billed separately; each invoice settles on its own.</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice lines</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
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
              <tbody className="divide-y [&_td]:pr-4 [&_td:last-child]:pr-0">
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
                    <input name="amountRupees" type="number" step="0.01" min="0.01" max={(due / 100).toFixed(2)} defaultValue={(due / 100).toFixed(2)} required className="mt-1 h-9 w-full rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2 text-right" />
                  </label>
                  <label className="block">
                    <span className="text-muted-foreground">Method</span>
                    <select name="method" className="mt-1 h-9 w-full rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2" defaultValue="BANK_TRANSFER">
                      <option value="BANK_TRANSFER">Bank transfer</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-muted-foreground">Reference (optional)</span>
                    <input name="reference" className="mt-1 h-9 w-full rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2" placeholder="UTR / cheque no." />
                  </label>
                  <Button type="submit" className="w-full">
                    Record Payment
                  </Button>
                  <p className="text-xs text-muted-foreground">Partial payments allowed; more than the balance is refused.</p>
                </form>
              </CardContent>
            </Card>
          ) : null}
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-inset ring-warning/30" data-print-hide>
            Partial invoicing stays reconciled with partial delivery: the stepper above tracks shipment against payment for this order.
          </p>
        </div>
      </div>
      <p className="mt-6 hidden text-xs text-muted-foreground print:block">Computer-generated invoice · payment terms 15 days.</p>
    </div>
  );
}
