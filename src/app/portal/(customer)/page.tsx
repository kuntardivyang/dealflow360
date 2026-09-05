import { FileText } from "lucide-react";
import { DataTable, EmptyState, Money, PageHeader, StatusBadge, type Column } from "@/components/shared";
import { requirePortal } from "@/lib/auth/portal";
import type { PortalQuotationDTO } from "@/lib/contract";
import { listPortalQuotations } from "@/services/portal.service";

export const metadata = { title: "My Quotations" };

const PORTAL_STATUS_CODE: Record<PortalQuotationDTO["status"], string> = {
  Sent: "SENT",
  "Under Negotiation": "UNDER_NEGOTIATION",
  "Awaiting internal approval": "PENDING_APPROVAL",
  Confirmed: "CONFIRMED",
};

export default async function MyQuotationsPage() {
  const user = await requirePortal();
  const quotes = await listPortalQuotations(user);
  const columns: Column<PortalQuotationDTO>[] = [
    { key: "number", header: "Quotation", cell: (q) => <span className="font-medium">{q.number}</span> },
    { key: "lines", header: "Lines", cell: (q) => q.lines.length },
    { key: "total", header: "Total (incl. tax)", align: "right", cell: (q) => <Money paise={q.total} /> },
    { key: "status", header: "Status", cell: (q) => <StatusBadge status={PORTAL_STATUS_CODE[q.status]} label={q.status} /> },
    { key: "open", header: "Open requests", cell: (q) => q.requests.filter((r) => r.status === "OPEN").length || "–" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="My Quotations" description={`Quotations sent to ${user.customerName}. Click one to review, negotiate or confirm.`} />
      <DataTable
        columns={columns}
        rows={quotes}
        rowKey={(q) => q.publicId}
        rowHref={(q) => `/portal/q/${q.publicId}`}
        empty={<EmptyState icon={FileText} title="No quotations yet" description="When your sales representative sends you a quotation it appears here." />}
      />
    </div>
  );
}
