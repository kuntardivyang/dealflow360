// Owner: B. Screen 5, Approvals list: every quotation that needed, needs, or is going
// through discount approval. Counters, table, "Pending only" filter, row opens the detail.
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, PageHeader, StatTile, StatusBadge, type Column } from "@/components/shared";
import { formatDateTime } from "@/lib/format";
import { listApprovals, type ApprovalRow } from "@/services/approval.service";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const pendingOnly = filter === "pending";
  const { rows, counts } = await listApprovals();
  const visible = pendingOnly ? rows.filter((r) => r.status === "PENDING") : rows;

  const columns: Column<ApprovalRow>[] = [
    { key: "number", header: "Quotation", cell: (r) => <span className="font-medium">{r.number}</span> },
    { key: "customer", header: "Customer", cell: (r) => r.customer },
    {
      key: "risk",
      header: "Blended Risk",
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <StatusBadge status={r.band} />
          <span className="text-xs text-muted-foreground tabular-nums">{r.riskScore}</span>
        </span>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      cell: (r) => (r.status === "PENDING" ? <span className="font-medium">{r.stage}</span> : <StatusBadge status={r.status} />),
    },
    { key: "assigned", header: "Assigned To", cell: (r) => <span className="text-muted-foreground">{r.assignedTo}</span> },
    { key: "when", header: "Submitted", cell: (r) => <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Every quotation that needed, needs, or is going through discount approval. Click a row for the risk breakdown and audit trail."
        actions={
          <Button variant={pendingOnly ? "default" : "outline"} nativeButton={false} render={<Link href={pendingOnly ? "/approvals" : "/approvals?filter=pending"} />}>
            {pendingOnly ? "Show all" : "Filter: Pending Only"}
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Pending" value={counts.pending} caption="waiting for a reviewer" tone={counts.pending > 0 ? "warning" : "default"} href="/approvals?filter=pending" />
        <StatTile label="Returned" value={counts.returned} caption="sent back to the rep for revision" />
        <StatTile label="Approved" value={counts.approved} caption="cleared for the customer" tone="success" />
      </div>
      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(r) => r.requestId}
        rowHref={(r) => `/approvals/${r.publicId}`}
        empty={
          <EmptyState
            icon={ShieldCheck}
            title={pendingOnly ? "Nothing waiting for approval" : "No approval requests yet"}
            description="Confirming a quotation with a discount above its ceiling creates a request here automatically. The rep never asks for it."
          />
        }
      />
    </div>
  );
}
