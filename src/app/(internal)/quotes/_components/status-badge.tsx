// TODO(contract): replace with StatusBadge from "@/components/shared" when B lands feature 22.
import { Badge } from "@/components/ui/badge";
import { QUOTATION_STATUS_LABEL, type QuotationStatus } from "@/lib/contract";

const tone: Record<QuotationStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  SENT: "bg-sky-100 text-sky-800 border-sky-200",
  UNDER_NEGOTIATION: "bg-violet-100 text-violet-800 border-violet-200",
  CONFIRMED: "bg-emerald-200 text-emerald-900 border-emerald-300",
  FULFILLMENT: "bg-teal-100 text-teal-800 border-teal-200",
  PAID: "bg-green-200 text-green-900 border-green-300",
  CANCELLED: "bg-gray-200 text-gray-600 border-gray-300",
};

export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  return (
    <Badge variant="outline" className={tone[status]}>
      {QUOTATION_STATUS_LABEL[status]}
    </Badge>
  );
}
