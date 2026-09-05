import { Check, RotateCcw, X } from "lucide-react";
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
    <ol className="relative">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className={cn("absolute top-6 left-3 h-[calc(100%-1.5rem)] w-px -translate-x-1/2", it.state === "done" ? "bg-success/40" : "bg-border")}
              />
            ) : null}
            <span
              className={cn(
                "relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                it.state === "done" && "bg-success text-white",
                it.state === "current" && "bg-card text-warning ring-2 ring-warning",
                it.state === "failed" && "bg-destructive text-white",
                it.state === "returned" && "bg-warning/15 text-warning ring-1 ring-warning/40",
                it.state === "todo" && "bg-card text-muted-foreground ring-1 ring-border",
              )}
            >
              {it.state === "done" && <Check className="size-3.5" strokeWidth={2.5} />}
              {it.state === "current" && <span className="size-2 rounded-full bg-warning" />}
              {it.state === "failed" && <X className="size-3.5" strokeWidth={2.5} />}
              {it.state === "returned" && <RotateCcw className="size-3.5" />}
              {it.state === "todo" && <span className="size-1.5 rounded-full bg-border" />}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className={cn("block text-sm font-semibold", it.state === "todo" && "font-medium text-muted-foreground")}>
                {it.label}
                {it.state === "current" ? <span className="ml-2 text-xs font-medium text-warning">waiting</span> : null}
              </span>
              {it.detail ? <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{it.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
