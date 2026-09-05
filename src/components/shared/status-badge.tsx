import { QUOTATION_STATUS_LABEL } from "@/lib/contract";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

// Tinted field, darker text of the same hue, hairline ring. Prints black on white via
// the [data-status] rule in globals.css.
const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-foreground/10",
  info: "bg-info/10 text-info ring-info/25",
  success: "bg-success/10 text-success ring-success/25",
  warning: "bg-warning/12 text-warning ring-warning/30",
  danger: "bg-destructive/10 text-destructive ring-destructive/25",
};

// One place for every status colour in the app. Keys are the database enum values
// (quotation, approval, invoice, portal request, fulfillment, subscription) plus the
// risk bands and the per-line OK / OVER markers.
const STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: QUOTATION_STATUS_LABEL.DRAFT, tone: "neutral" },
  PENDING_APPROVAL: { label: QUOTATION_STATUS_LABEL.PENDING_APPROVAL, tone: "warning" },
  APPROVED: { label: QUOTATION_STATUS_LABEL.APPROVED, tone: "success" },
  REJECTED: { label: QUOTATION_STATUS_LABEL.REJECTED, tone: "danger" },
  SENT: { label: QUOTATION_STATUS_LABEL.SENT, tone: "info" },
  UNDER_NEGOTIATION: { label: QUOTATION_STATUS_LABEL.UNDER_NEGOTIATION, tone: "info" },
  CONFIRMED: { label: QUOTATION_STATUS_LABEL.CONFIRMED, tone: "success" },
  FULFILLMENT: { label: QUOTATION_STATUS_LABEL.FULFILLMENT, tone: "info" },
  PAID: { label: QUOTATION_STATUS_LABEL.PAID, tone: "success" },
  CANCELLED: { label: QUOTATION_STATUS_LABEL.CANCELLED, tone: "neutral" },
  // approval requests and steps
  PENDING: { label: "Pending", tone: "warning" },
  RETURNED: { label: "Returned", tone: "warning" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
  // invoices
  POSTED: { label: "Unpaid", tone: "info" },
  PARTIAL: { label: "Partially Paid", tone: "warning" },
  VOID: { label: "Void", tone: "neutral" },
  // portal requests
  OPEN: { label: "Open", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  // fulfillment
  PROPOSED: { label: "Split Pending", tone: "info" },
  RESERVED: { label: "Reserved", tone: "info" },
  SHIPPED: { label: "Shipped", tone: "success" },
  BACKORDER: { label: "Backorder", tone: "warning" },
  // subscriptions
  ACTIVE: { label: "Active", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  // risk bands
  LOW: { label: "Low", tone: "success" },
  MEDIUM: { label: "Medium", tone: "warning" },
  HIGH: { label: "High", tone: "danger" },
  // per-line ceiling check
  OK: { label: "OK", tone: "success" },
  OVER: { label: "Over", tone: "danger" },
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const meta = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        TONE_CLASS[meta.tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {label ?? meta.label}
    </span>
  );
}
