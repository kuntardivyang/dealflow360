// Owner: A. Screen 3, Quotations list (feature 23): cards by default, table on request,
// stage chips with counts, and + New Quotation which opens a fresh draft (customer picked inside, Odoo-style).
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, EmptyState, Money, PageHeader, StatusBadge, type Column } from "@/components/shared";
import { QUOTATION_STATUS_LABEL, type QuotationStatus } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatBp, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createQuotationAndOpen } from "../actions/quotation";

export const metadata = { title: "Quotations" };
export const dynamic = "force-dynamic";

const CHIPS: QuotationStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "UNDER_NEGOTIATION", "CONFIRMED"];

type Search = { status?: string; view?: string; error?: string };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filter = CHIPS.find((s) => s === sp.status);
  const table = sp.view === "table";

  const [quotes, counts] = await Promise.all([
    prisma.quotation.findMany({
      where: filter ? { status: filter } : undefined,
      include: { customer: { select: { name: true } }, rep: { select: { name: true } } },
      orderBy: { lastActivityAt: "desc" },
      take: 200,
    }),
    prisma.quotation.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const total = counts.reduce((n, c) => n + c._count._all, 0);
  const countOf = (s: QuotationStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;

  const href = (next: { status?: QuotationStatus | null; view?: "table" | "cards" }) => {
    const p = new URLSearchParams();
    const status = next.status === undefined ? filter : next.status;
    const view = next.view ?? (table ? "table" : "cards");
    if (status) p.set("status", status);
    if (view === "table") p.set("view", "table");
    const qs = p.toString();
    return qs ? `/quotes?${qs}` : "/quotes";
  };

  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
      active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
    );

  type Row = (typeof quotes)[number];
  const columns: Column<Row>[] = [
    { key: "number", header: "Quotation", cell: (q) => <span className="font-medium">{q.number}</span> },
    { key: "customer", header: "Customer", cell: (q) => q.customer?.name ?? <span className="text-muted-foreground">No customer yet</span> },
    { key: "rep", header: "Rep", cell: (q) => q.rep.name },
    { key: "total", header: "Amount", align: "right", cell: (q) => <Money paise={q.total} /> },
    { key: "margin", header: "Margin", align: "right", cell: (q) => <span className="tabular-nums">{formatBp(q.marginBp)}</span> },
    { key: "status", header: "Stage", cell: (q) => <StatusBadge status={q.status} /> },
    { key: "activity", header: "Last activity", cell: (q) => <span className="text-muted-foreground">{formatDateTime(q.lastActivityAt)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Every quotation in the system, one per card. Click one to open it."
        actions={
          <>
            <form action={createQuotationAndOpen}>
              <Button type="submit">
                <Plus /> New Quotation
              </Button>
            </form>
            <Link href={href({ view: table ? "cards" : "table" })} className={buttonVariants({ variant: "outline" })}>
              {table ? "Switch to Card View" : "Switch to Table View"}
            </Link>
          </>
        }
      />

      {sp.error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.error}</p> : null}


      <div className="flex flex-wrap gap-2" data-print-hide>
        <Link href={href({ status: null })} className={chip(!filter)}>
          All <span className="tabular-nums opacity-80">{total}</span>
        </Link>
        {CHIPS.map((s) => (
          <Link key={s} href={href({ status: s })} className={chip(filter === s)}>
            {QUOTATION_STATUS_LABEL[s]} <span className="tabular-nums opacity-80">{countOf(s)}</span>
          </Link>
        ))}
      </div>

      {quotes.length === 0 ? (
        <EmptyState
          title={filter ? `No ${QUOTATION_STATUS_LABEL[filter].toLowerCase()} quotations` : "No quotations yet"}
          description="Press New Quotation to start one; the customer is picked inside the quotation."
        />
      ) : table ? (
        <DataTable columns={columns} rows={quotes} rowKey={(q) => q.id} rowHref={(q) => `/quotes/${q.publicId}`} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link href={`/quotes/${q.publicId}`} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium leading-tight">{q.customer?.name ?? "No customer yet"}</p>
                        <p className="text-xs text-muted-foreground">{q.number}</p>
                      </div>
                      <StatusBadge status={q.status} />
                    </div>
                    <Money paise={q.total} className="block text-lg font-semibold" />
                    <p className="text-xs text-muted-foreground">
                      {q.rep.name} · {formatDateTime(q.lastActivityAt)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
