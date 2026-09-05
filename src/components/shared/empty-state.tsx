import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Empty state: an icon, one line that names what is missing, one line that says what fills it. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-foreground/15 bg-card/60 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" strokeWidth={1.75} />
      </div>
      <div className="space-y-1">
        <p className="font-heading text-[15px] font-semibold">{title}</p>
        {description ? <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
