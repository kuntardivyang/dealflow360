// Screen 3, Quotations list: one card or row per quotation, filter by stage, click to open.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QUOTATION_STATUS_LABEL, QuotationStatus, type QuotationStatus as Status } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatBp, formatDateTime, formatPaise } from "@/lib/format";
import { createQuotationAndOpen } from "../actions/quotation";
import { QuotationStatusBadge } from "./_components/status-badge";

export const dynamic = "force-dynamic";

const CHIPS: Status[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "UNDER_NEGOTIATION", "CONFIRMED", "PAID"];

type Search = { status?: string; view?: string; error?: string };

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const status = CHIPS.includes(sp.status as Status) ? (sp.status as Status) : undefined;
  const table = sp.view === "table";

  const [quotes, customers] = await Promise.all([
    prisma.quotation.findMany({
      where: status ? { status } : undefined,
      include: { customer: true, rep: true },
      orderBy: { lastActivityAt: "desc" },
    }),
    prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, include: { tier: true } }),
  ]);

  const href = (next: Partial<Search>) => {
    const p = new URLSearchParams();
    const s = next.status === undefined ? status : next.status || undefined;
    const v = next.view ?? (table ? "table" : undefined);
    if (s) p.set("status", s);
    if (v) p.set("view", v);
    const qs = p.toString();
    return qs ? `/quotes?${qs}` : "/quotes";
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
          <p className="text-sm text-muted-foreground">Every quotation in the system, one per row. Click one to open it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={createQuotationAndOpen} className="flex items-center gap-2">
            <select name="customerId" required className="h-9 rounded-md border bg-background px-2 text-sm" defaultValue="">
              <option value="" disabled>
                Customer…
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.tier.name})
                </option>
              ))}
            </select>
            <Button type="submit">+ New Quotation</Button>
          </form>
          <Link href={href({ view: table ? "" : "table" })} className="text-sm underline-offset-4 hover:underline">
            {table ? "Switch to Card View" : "Switch to Table View"}
          </Link>
        </div>
      </header>

      {sp.error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</p> : null}

      <nav className="flex flex-wrap gap-2" aria-label="Filter by stage">
        <Chip active={!status} href={href({ status: "" })}>
          All ({quotes.length})
        </Chip>
        {CHIPS.map((s) => (
          <Chip key={s} active={status === s} href={href({ status: s })}>
            {QUOTATION_STATUS_LABEL[s]}
          </Chip>
        ))}
      </nav>

      {quotes.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No quotations here yet.</p>
      ) : table ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Rep</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((q) => (
              <TableRow key={q.id}>
                <TableCell>
                  <Link href={`/quotes/${q.publicId}`} className="font-medium hover:underline">
                    {q.number}
                  </Link>
                </TableCell>
                <TableCell>{q.customer.name}</TableCell>
                <TableCell>{q.rep.name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPaise(q.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{q.marginBp === null ? "n/a" : formatBp(q.marginBp)}</TableCell>
                <TableCell>
                  <QuotationStatusBadge status={q.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(q.lastActivityAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quotes.map((q) => (
            <li key={q.id}>
              <Link href={`/quotes/${q.publicId}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium leading-tight">{q.customer.name}</p>
                        <p className="text-xs text-muted-foreground">{q.number}</p>
                      </div>
                      <QuotationStatusBadge status={q.status} />
                    </div>
                    <p className="text-lg font-semibold tabular-nums">{formatPaise(q.total)}</p>
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
    </main>
  );
}

function Chip({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-foreground text-background" : "hover:bg-muted"}`}
    >
      {children}
    </Link>
  );
}

// Keep the enum import used so the runtime object stays available for future filters.
void QuotationStatus;
