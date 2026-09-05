// Owner: A. Screen 12, Invoices list: every invoice from one-time and recurring orders.
import { DataTable, EmptyState, Money, PageHeader, StatTile, StatusBadge, type Column } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const KIND_LABEL = { ONE_TIME: "One-time", RECURRING: "Recurring", PRORATION: "Proration" } as const;

export default async function InvoicesPage() {
  await requireUser(undefined, "/invoices");
  const invoices = await prisma.invoice.findMany({ include: { customer: true }, orderBy: [{ status: "asc" }, { dueDate: "asc" }] });
  const unpaid = invoices.filter((i) => i.status === "POSTED" || i.status === "PARTIAL").length;
  const paid = invoices.filter((i) => i.status === "PAID").length;
  const due = invoices.reduce((s, i) => s + (i.total - i.paidAmount), 0);

  type Row = (typeof invoices)[number];
  const columns: Column<Row>[] = [
    { key: "number", header: "Invoice #", cell: (i) => <span className="font-semibold tabular-nums">{i.number}</span> },
    { key: "customer", header: "Customer", cell: (i) => i.customer.name },
    { key: "kind", header: "Type", cell: (i) => KIND_LABEL[i.kind] },
    { key: "total", header: "Amount", align: "right", cell: (i) => <Money paise={i.total} /> },
    { key: "paid", header: "Paid", align: "right", cell: (i) => <Money paise={i.paidAmount} /> },
    { key: "status", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
    { key: "due", header: "Due date", cell: (i) => formatDate(i.dueDate) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Every invoice generated from one-time and recurring orders. Click a row to record a payment." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Unpaid" value={String(unpaid)} caption="posted or partially paid" />
        <StatTile label="Paid" value={String(paid)} caption="fully settled" />
        <StatTile label="Balance due" value={<Money paise={due} />} caption="across all open invoices" />
      </div>
      <DataTable columns={columns} rows={invoices} rowKey={(i) => i.id} rowHref={(i) => `/invoices/${i.publicId}`} empty={<EmptyState title="No invoices yet" description="Invoices are posted the moment an order is confirmed." />} />
    </div>
  );
}
