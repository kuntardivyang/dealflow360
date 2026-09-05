// Placeholder quotations list by B (feature 22/23 hand-off). A replaces this file with the
// real list and builder entry point; the shared components and the route stay the same.
import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { QUOTATION_STATUS_LABEL, type QuotationStatus } from "@/lib/contract";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Money, PageHeader, StatusBadge, type Column } from "@/components/shared";

export const metadata = { title: "Quotations" };

const CHIPS: QuotationStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "UNDER_NEGOTIATION", "CONFIRMED"];

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = CHIPS.find((s) => s === status);

  const [quotes, counts] = await Promise.all([
    prisma.quotation.findMany({
      where: filter ? { status: filter } : undefined,
      include: { customer: { select: { name: true } }, rep: { select: { name: true } } },
      orderBy: { lastActivityAt: "desc" },
      take: 100,
    }),
    prisma.quotation.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const total = counts.reduce((n, c) => n + c._count._all, 0);
  const countOf = (s: QuotationStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;

  type Row = (typeof quotes)[number];
  const columns: Column<Row>[] = [
    { key: "number", header: "Quotation", cell: (q) => <span className="font-medium">{q.number}</span> },
    { key: "customer", header: "Customer", cell: (q) => q.customer.name },
    { key: "total", header: "Amount", align: "right", cell: (q) => <Money paise={q.total} /> },
    { key: "status", header: "Stage", cell: (q) => <StatusBadge status={q.status} /> },
    { key: "rep", header: "Rep", cell: (q) => q.rep.name },
    {
      key: "activity",
      header: "Last activity",
      cell: (q) => <span className="text-muted-foreground">{formatDateTime(q.lastActivityAt)}</span>,
    },
  ];

  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
      active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Every quotation in the system, one row per quotation. Click a row to open it."
        actions={
          <Button disabled title="The quotation builder arrives with the next merge">
            <Plus /> New Quotation
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2" data-print-hide>
        <Link href="/quotes" className={chip(!filter)}>
          All <span className="tabular-nums opacity-80">{total}</span>
        </Link>
        {CHIPS.map((s) => (
          <Link key={s} href={`/quotes?status=${s}`} className={chip(filter === s)}>
            {QUOTATION_STATUS_LABEL[s]} <span className="tabular-nums opacity-80">{countOf(s)}</span>
          </Link>
        ))}
      </div>
      <DataTable
        columns={columns}
        rows={quotes}
        rowKey={(q) => q.id}
        rowHref={(q) => `/quotes/${q.publicId}`}
        empty={
          <EmptyState
            title={filter ? `No ${QUOTATION_STATUS_LABEL[filter].toLowerCase()} quotations` : "No quotations yet"}
            description="Run pnpm reset to load the demo seed, or create one from the builder."
          />
        }
      />
    </div>
  );
}
