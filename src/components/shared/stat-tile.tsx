import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * KPI tile: a small label, a big Manrope number and a one-line caption. The tone
 * colours the number only (colour means state); a thin bar on the left edge repeats it
 * so the tile still reads on a projector. Optional link wraps the whole tile.
 */
export function StatTile({
  label,
  value,
  caption,
  href,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  href?: string;
  tone?: "default" | "warning" | "danger" | "success";
  className?: string;
}) {
  const valueClass = {
    default: "text-foreground",
    warning: "text-warning",
    danger: "text-destructive",
    success: "text-success",
  }[tone];
  const barClass = {
    default: "bg-link/70",
    warning: "bg-warning",
    danger: "bg-destructive",
    success: "bg-success",
  }[tone];

  const tile = (
    <div className={cn("surface relative flex h-full flex-col gap-2 overflow-hidden px-5 py-4", href && "surface-interactive", className)}>
      <span aria-hidden className={cn("absolute inset-y-4 left-0 w-[3px] rounded-r-full", barClass)} />
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <span className={cn("font-heading text-[34px] leading-none font-bold tracking-[-0.03em] tabular-nums", valueClass)}>{value}</span>
      {caption ? <span className="text-xs leading-snug text-muted-foreground">{caption}</span> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      {tile}
    </Link>
  ) : (
    tile
  );
}
