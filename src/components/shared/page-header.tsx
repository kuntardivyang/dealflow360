import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page title row: one title, one short description, primary action on the right. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 max-w-3xl">
        <h1 className="font-heading text-[26px] leading-tight font-bold tracking-[-0.02em] text-foreground">{title}</h1>
        {description ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
