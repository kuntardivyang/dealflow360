import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Dashboard tile: a label, a big number and a caption. Optional link wraps the card. */
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

  const card = (
    <Card size="sm" className={cn("h-full transition-shadow", href && "hover:ring-foreground/20", className)}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("font-heading text-3xl font-semibold tabular-nums", valueClass)}>{value}</CardTitle>
      </CardHeader>
      {caption ? <CardContent className="text-xs text-muted-foreground">{caption}</CardContent> : null}
    </Card>
  );

  return href ? (
    <Link href={href} className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      {card}
    </Link>
  ) : (
    card
  );
}
