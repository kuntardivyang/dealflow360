import { cn } from "@/lib/utils";

// The three lines of the mockup's Quotation Detail (screen 4), rendered as the product
// sees them: discount against limit, one line over, so the quote needs approval.
const LINES = [
  { name: "Laptop Pro 14", qty: 2, discount: "12%", limit: "15%", over: null },
  { name: "Onsite Setup Service", qty: 1, discount: "18%", limit: "10%", over: "+8 pt" },
  { name: "Extended Warranty", qty: 1, discount: "10%", limit: "15%", over: null },
] as const;

/** Static illustration for the login panel. Server component, no data. */
export function LedgerHero({ className }: { className?: string }) {
  return (
    <figure className={cn("max-w-md", className)} aria-label="Example: a quotation with one line over its discount limit">
      <div className="overflow-hidden rounded-xl bg-ink-foreground text-foreground shadow-raised ring-1 ring-black/20">
        <div className="flex items-center justify-between gap-4 border-b border-foreground/10 px-4 py-2.5">
          <span className="font-heading text-sm font-bold tracking-tight">Q-1042 · Acme Corp</span>
          <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-warning/12 px-2 text-xs font-semibold text-warning ring-1 ring-inset ring-warning/30">
            <span className="size-1.5 rounded-full bg-current" />
            Pending Approval
          </span>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="col-label border-b border-foreground/10 bg-muted/60">
              <th className="px-4 py-1.5 text-left font-semibold">Product</th>
              <th className="px-2 py-1.5 text-right font-semibold">Discount</th>
              <th className="px-2 py-1.5 text-right font-semibold">Limit</th>
              <th className="px-4 py-1.5 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((l) => (
              <tr key={l.name} className={cn("border-b border-foreground/8 last:border-0", l.over && "bg-destructive/6")}>
                <td className="px-4 py-2 font-medium">
                  {l.name} <span className="text-muted-foreground">× {l.qty}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{l.discount}</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{l.limit}</td>
                <td className="px-4 py-2 text-right">
                  {l.over ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                      <span className="size-1.5 rounded-full bg-current" /> OVER {l.over}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-success">
                      <span className="size-1.5 rounded-full bg-current" /> OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-4 border-t border-foreground/10 bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Blended risk <span className="font-semibold text-destructive">HIGH</span>
          </span>
          <span>
            Route: <span className="font-semibold text-foreground">Sales Manager</span>, then <span className="font-semibold text-foreground">Finance</span>
          </span>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-ink-foreground/55">One line 8 points over its ceiling is enough to require approval. The rep never has to ask.</figcaption>
    </figure>
  );
}
