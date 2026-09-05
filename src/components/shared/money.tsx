import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Integer paise rendered as INR. `signed` prefixes positive deltas with "+" (margin deltas, proration). */
export function Money({ paise, signed = false, className }: { paise: number; signed?: boolean; className?: string }) {
  const prefix = signed && paise > 0 ? "+" : "";
  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {formatMoney(paise)}
    </span>
  );
}
