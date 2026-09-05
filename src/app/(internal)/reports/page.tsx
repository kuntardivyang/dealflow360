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
    { key: "number", header: "Quotation", cell: (r) => <span className="font-semibold tabular-nums">{r.number}</span> },
    { key: "customer", header: "Customer", cell: (r) => r.customer },
    { key: "rep", header: "Rep", cell: (r) => <span className="text-muted-foreground">{r.rep}</span> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Created", cell: (r) => <span className="text-muted-foreground tabular-nums">{formatDate(r.createdAt)}</span> },
    { key: "discount", header: "Discount", align: "right", cell: (r) => <Money paise={r.discountTotal} className="text-muted-foreground" /> },
    { key: "total", header: "Total", align: "right", cell: (r) => <Money paise={r.total} className="font-medium" /> },
    { key: "margin", header: "Margin", align: "right", cell: (r) => <span className="tabular-nums">{formatBp(r.marginBp)}</span> },
    { key: "risk", header: "Risk", align: "right", cell: (r) => <span className="tabular-nums">{r.riskScore ?? "–"}</span> },
    { key: "upsell", header: "Upsell lines", align: "right", cell: (r) => <span className="tabular-nums">{r.upsellLines || "–"}</span> },
  ];

  const select = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
  const label = "block space-y-1 text-xs font-medium text-muted-foreground";

  return (
    <div className="space-y-6">
      <style>{`@media print { @page { size: A4 landscape; } }`}</style>
      <PageHeader
        title="Admin / Reporting Dashboard"
        description="Sales trends, approval bottlenecks and platform usage. Filter, then export what you see."
        actions={
          <>
            <PrintButton />
            <Button nativeButton={false} render={<a href={`/api/reports/export${qs ? `?${qs}` : ""}`} />} data-print-hide>
              <FileSpreadsheet /> Export XLS
            </Button>
          </>
        }
      />

      <form method="get" className="surface grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-[1fr_1fr_1fr_1.3fr_1fr_1.3fr_1.3fr_auto]" data-print-hide>
        <label className={label}>
          <span>Period</span>
          <select name="period" defaultValue={filter.period} className={select}>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        <label className={label}>
          <span>From</span>
          <input type="date" name="from" defaultValue={filter.from ?? ""} className={select} />
        </label>
        <label className={label}>
          <span>To</span>
          <input type="date" name="to" defaultValue={filter.to ?? ""} className={select} />
        </label>
        <label className={label}>
          <span>Sales Team / Rep</span>
          <select name="repUserId" defaultValue={filter.repUserId ? String(filter.repUserId) : ""} className={select}>
            <option value="">Whole team</option>
            {report.options.reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Approval Status</span>
          <select name="approval" defaultValue={filter.approval} className={select}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className={label}>
          <span>Product</span>
          <select name="productId" defaultValue={filter.productId ? String(filter.productId) : ""} className={select}>
            <option value="">Any product</option>
            {report.options.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>Category</span>
          <select name="categoryId" defaultValue={filter.categoryId ? String(filter.categoryId) : ""} className={select}>
            <option value="">Any category</option>
            {report.options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-3 self-end">
          <Button type="submit" variant="outline" size="lg" className="h-9">
            Apply filters
          </Button>
          <Link href="/reports" className="text-sm text-muted-foreground hover:text-foreground">
            Reset
          </Link>
        </div>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Quotes Created" value={report.tiles.quotesCreated} caption={`${formatDate(report.range.from)} to ${formatDate(report.range.to)}`} />
        <StatTile label="Avg Approval Time" value={report.tiles.avgApprovalHours === null ? "–" : `${report.tiles.avgApprovalHours.toFixed(1)} h`} caption="from submission to final approval" />
        <StatTile
          label="Top Upsold Product"
          value={<span className="text-[26px] leading-tight">{report.tiles.topUpsold ?? "–"}</span>}
          caption={report.tiles.topUpsold ? `${report.tiles.topUpsoldCount} upsell line${report.tiles.topUpsoldCount === 1 ? "" : "s"} in the period` : "no upsell lines in the period"}
        />
      </div>

      <DataTable
        columns={columns}
        rows={report.rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/quotes/${r.publicId}`}
        footer={
          <span className="flex flex-wrap items-baseline justify-end gap-6 tabular-nums">
            <span>{report.totals.count} quotations</span>
            <span>
              Discount <Money paise={report.totals.discountTotal} className="font-semibold text-foreground" />
            </span>
            <span>
              Net <Money paise={report.totals.netTotal} className="font-semibold text-foreground" />
            </span>
            <span>
              Total <Money paise={report.totals.total} className="font-semibold text-foreground" />
            </span>
          </span>
        }
        empty={<EmptyState title="No quotations match" description="Widen the period or clear a filter." />}
      />
    </div>
  );
}
