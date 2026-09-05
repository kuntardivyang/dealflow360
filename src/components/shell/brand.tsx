import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Wordmark. The mark is a ledger line that resolves upward: three bars of a quotation
 * and a check-arrow through them, which is what the engine does to every line.
 */
export function Brand({ href = "/dashboard", tone = "default", className }: { href?: string; tone?: "default" | "inverse"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("flex shrink-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50", className)}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 items-center justify-center rounded-lg",
          tone === "inverse" ? "bg-ink-foreground text-ink" : "bg-primary text-primary-foreground",
        )}
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6.5h6" opacity=".55" />
          <path d="M4 10h4" opacity=".55" />
          <path d="M4 13.5h2.5" opacity=".55" />
          <path d="M8 14.5 11 11l2.2 2.2L17 9" />
          <path d="M14 9h3v3" />
        </svg>
      </span>
      <span className={cn("font-heading text-[17px] font-bold tracking-[-0.02em]", tone === "inverse" ? "text-ink-foreground" : "text-foreground")}>
        DealFlow<span className={tone === "inverse" ? "text-ink-foreground/60" : "text-link"}>360</span>
      </span>
    </Link>
  );
}
