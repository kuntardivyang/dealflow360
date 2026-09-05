// Owner: A. Screen 3, Quotations list (feature 23): a Kanban pipeline by stage by default
// (PDF B2), a table on request, stage chips with counts, and + New Quotation which opens a
// fresh draft for a customer.
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
// The five mockup columns (Draft | Pending Approval | Approved | Negotiation | Confirmed). Every
// other status folds into the nearest column so no quotation disappears from the board.
const PIPELINE = CHIPS;
const STAGE_OF: Record<QuotationStatus, QuotationStatus> = {
  DRAFT: "DRAFT",
  REJECTED: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  SENT: "UNDER_NEGOTIATION",
  UNDER_NEGOTIATION: "UNDER_NEGOTIATION",
  CONFIRMED: "CONFIRMED",
  FULFILLMENT: "CONFIRMED",
  PAID: "CONFIRMED",
  CANCELLED: "DRAFT",
};

type Search = { status?: string; view?: string; error?: string };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filter = CHIPS.find((s) => s === sp.status);
  const table = sp.view === "table";

  const [quotes, counts] = await Promise.all([
    prisma.quotation.findMany({
      where: filter ? { status: { in: (Object.keys(STAGE_OF) as QuotationStatus[]).filter((st) => STAGE_OF[st] === filter) } } : undefined,
      include: { customer: { select: { name: true } }, rep: { select: { name: true } } },
      orderBy: { lastActivityAt: "desc" },
      take: 200,
    }),
    prisma.quotation.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const total = counts.reduce((n, c) => n + c._count._all, 0);
  const countOf = (s: QuotationStatus) => counts.filter((c) => STAGE_OF[c.status] === s).reduce((n, c) => n + c._count._all, 0);

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
      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
      active ? "border-foreground/25 bg-accent font-semibold text-accent-foreground" : "border-border bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground",
    );

  type Row = (typeof quotes)[number];
  const columns: Column<Row>[] = [
    { key: "number", header: "Quotation", cell: (q) => <span className="font-semibold tabular-nums">{q.number}</span> },
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
        description={table ? "Every quotation in the system, one per row. Click a row to open it." : "Every quotation in the system, one card per quotation, grouped by stage. Click a card to open it."}
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

      {sp.error ? <p className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive ring-1 ring-inset ring-destructive/20">{sp.error}</p> : null}


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
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[900px] gap-3" style={{ gridTemplateColumns: `repeat(${(filter ? [filter] : PIPELINE).length}, minmax(0, 1fr))` }}>
            {(filter ? [filter] : PIPELINE).map((stage) => {
              const inStage = quotes.filter((q) => STAGE_OF[q.status] === stage);
              return (
                <section key={stage} className="flex min-h-64 flex-col rounded-xl bg-muted/70 p-2 ring-1 ring-inset ring-foreground/5" aria-label={`${QUOTATION_STATUS_LABEL[stage]} column`}>
                  <header className="flex items-center justify-between px-1.5 pt-0.5 pb-2.5 text-sm">
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <StatusBadge status={stage} className="h-[22px]" />
                    </span>
                    <span className="font-heading text-sm font-bold text-muted-foreground tabular-nums">{inStage.length}</span>
                  </header>
                  <ul className="space-y-2">
                    {inStage.map((q) => (
                      <li key={q.id}>
                        <Link href={`/quotes/${q.publicId}`} className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                          <Card className="surface-interactive gap-0 py-0">
                            <CardContent className="space-y-1.5 px-3 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-semibold leading-tight">{q.customer?.name ?? "No customer yet"}</p>
                                <Money paise={q.total} className="shrink-0 font-heading text-sm font-bold" />
                              </div>
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span className="tabular-nums">{q.number}</span>
                                {q.status !== stage ? <StatusBadge status={q.status} className="h-[18px] px-1.5 text-[10.5px]" /> : null}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {q.rep.name} · <span className="tabular-nums">{formatDateTime(q.lastActivityAt)}</span>
                              </p>
                            </CardContent>
                          </Card>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
