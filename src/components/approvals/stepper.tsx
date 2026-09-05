import { Check, Circle, CircleDot, RotateCcw, X } from "lucide-react";
import type { ApprovalRequestStatus, ApprovalStepStatus, QuotationStatus } from "@/lib/contract";
import { cn } from "@/lib/utils";

type Step = { stepNo: number; role: string; status: ApprovalStepStatus; actedBy: string | null; actedAt: string | null; note: string | null };

/** Submitted -> Sales Manager -> Finance (only when required) -> Confirmed. */
export function ApprovalStepper({
  steps,
  requestStatus,
  quotationStatus,
  submittedAt,
}: {
  steps: Step[];
  requestStatus: ApprovalRequestStatus;
  quotationStatus: QuotationStatus;
  submittedAt: string;
}) {
  const confirmed = ["CONFIRMED", "FULFILLMENT", "PAID"].includes(quotationStatus);
  const firstPending = steps.find((s) => s.status === "PENDING")?.stepNo;

  const items: { label: string; state: "done" | "current" | "todo" | "failed" | "returned"; detail?: string | null }[] = [
    { label: "Submitted", state: "done", detail: submittedAt },
    ...steps.map((s) => ({
      label: s.role,
      state:
        s.status === "APPROVED"
          ? ("done" as const)
          : s.status === "REJECTED"
            ? ("failed" as const)
            : requestStatus === "RETURNED"
              ? ("returned" as const)
              : requestStatus === "PENDING" && s.stepNo === firstPending
                ? ("current" as const)
                : ("todo" as const),
      detail: s.actedBy ? `${s.actedBy}${s.actedAt ? `, ${s.actedAt}` : ""}${s.note ? ` · ${s.note}` : ""}` : null,
    })),
    { label: "Confirmed", state: confirmed ? "done" : "todo", detail: confirmed ? "Order confirmed by the customer" : "After approval and customer confirmation" },
  ];

  return (
    <ol className="space-y-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
              it.state === "done" && "bg-success/15 text-success",
              it.state === "current" && "bg-warning/20 text-warning ring-2 ring-warning/40",
              it.state === "failed" && "bg-destructive/10 text-destructive",
              it.state === "returned" && "bg-warning/15 text-warning",
              it.state === "todo" && "bg-muted text-muted-foreground",
            )}
          >
            {it.state === "done" && <Check className="size-3.5" />}
            {it.state === "current" && <CircleDot className="size-3.5" />}
            {it.state === "failed" && <X className="size-3.5" />}
            {it.state === "returned" && <RotateCcw className="size-3.5" />}
            {it.state === "todo" && <Circle className="size-3" />}
          </span>
          <span className="min-w-0">
            <span className={cn("block text-sm font-medium", it.state === "todo" && "text-muted-foreground")}>
              {it.label}
              {it.state === "current" ? <span className="ml-2 text-xs font-normal text-warning">waiting</span> : null}
            </span>
            {it.detail ? <span className="block text-xs text-muted-foreground">{it.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
