// Owner: B. Screen 15, Admin / Reporting Dashboard (PDF A7): period, sales rep, approval
// status and product / category filters; tiles; the quotation table; Export PDF and XLS.
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Money, PageHeader, StatTile, StatusBadge, type Column } from "@/components/shared";
import { PrintButton } from "@/components/reports/print-button";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES, reportFilterSchema, type ReportFilterInput } from "@/lib/contract";
import { formatBp, formatDate } from "@/lib/format";
import { runReport, type ReportResult } from "@/services/reports.service";

export const metadata = { title: "Reports" };

type Row = ReportResult["rows"][number];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [sp] = await Promise.all([searchParams, requireUser(BACKEND_ROLES)]);
  const parsed = reportFilterSchema.safeParse(sp);
  const filter: ReportFilterInput = parsed.success ? parsed.data : reportFilterSchema.parse({});
  const report = await runReport(filter);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();

  const columns: Column<Row>[] = [
    { key: "number", header: "Quotation", cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: "customer", header: "Customer", cell: (r) => r.customer },
    { key: "rep", header: "Rep", cell: (r) => r.rep },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Created", cell: (r) => <span className="text-muted-foreground">{formatDate(r.createdAt)}</span> },
    { key: "discount", header: "Discount", align: "right", cell: (r) => <Money paise={r.discountTotal} /> },
    { key: "total", header: "Total", align: "right", cell: (r) => <Money paise={r.total} /> },
    { key: "margin", header: "Margin", align: "right", cell: (r) => <span className="tabular-nums">{formatBp(r.marginBp)}</span> },
    { key: "risk", header: "Risk", align: "right", cell: (r) => <span className="tabular-nums">{r.riskScore ?? "–"}</span> },
    { key: "upsell", header: "Upsell lines", align: "right", cell: (r) => <span className="tabular-nums">{r.upsellLines || "–"}</span> },
  ];

  const select = "h-8 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin / Reporting Dashboard"
        description="Sales trends, approval bottlenecks and platform usage. Filter, then export what you see."
        actions={
          <>
            <PrintButton />
            <Button nativeButton={false} render={<a href={`/api/reports/export${qs ? `?${qs}` : ""}`} />}>
              <FileSpreadsheet /> Export XLS
            </Button>
          </>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-print-hide>
        <label className="space-y-1 text-xs text-muted-foreground">
          Period
          <select name="period" defaultValue={filter.period} className={`${select} block`}>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={filter.from ?? ""} className={`${select} block`} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          To
          <input type="date" name="to" defaultValue={filter.to ?? ""} className={`${select} block`} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Sales Team / Rep
          <select name="repUserId" defaultValue={filter.repUserId ? String(filter.repUserId) : ""} className={`${select} block`}>
            <option value="">Whole team</option>
            {report.options.reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Approval Status
          <select name="approval" defaultValue={filter.approval} className={`${select} block`}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Product
          <select name="productId" defaultValue={filter.productId ? String(filter.productId) : ""} className={`${select} block`}>
            <option value="">Any product</option>
            {report.options.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Category
          <select name="categoryId" defaultValue={filter.categoryId ? String(filter.categoryId) : ""} className={`${select} block`}>
            <option value="">Any category</option>
            {report.options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
        <Link href="/reports" className="text-sm text-muted-foreground hover:text-foreground">
          Reset
        </Link>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Quotes Created" value={report.tiles.quotesCreated} caption={`${formatDate(report.range.from)} to ${formatDate(report.range.to)}`} />
        <StatTile label="Avg Approval Time" value={report.tiles.avgApprovalHours === null ? "–" : `${report.tiles.avgApprovalHours.toFixed(1)} h`} caption="from submission to final approval" />
        <StatTile label="Top Upsold Product" value={report.tiles.topUpsold ?? "–"} caption={report.tiles.topUpsold ? `${report.tiles.topUpsoldCount} upsell line${report.tiles.topUpsoldCount === 1 ? "" : "s"} in the period` : "no upsell lines in the period"} />
      </div>

      <DataTable
        columns={columns}
        rows={report.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/quotes/${r.publicId}`}
        footer={
          <span className="flex flex-wrap justify-end gap-6">
            <span>{report.totals.count} quotations</span>
            <span>
              Discount <Money paise={report.totals.discountTotal} className="font-medium text-foreground" />
            </span>
            <span>
              Net <Money paise={report.totals.netTotal} className="font-medium text-foreground" />
            </span>
            <span>
              Total <Money paise={report.totals.total} className="font-medium text-foreground" />
            </span>
          </span>
        }
        empty={<EmptyState title="No quotations match" description="Widen the period or clear a filter." />}
      />
    </div>
  );
}
