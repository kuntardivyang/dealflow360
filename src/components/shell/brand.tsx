import Link from "next/link";

export function Brand({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <span aria-hidden className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 12 7 8l2.5 2.5L13 6" />
          <path d="M10 6h3v3" />
        </svg>
      </span>
      <span className="font-heading text-base font-semibold tracking-tight">
        DealFlow<span className="text-primary">360</span>
      </span>
    </Link>
  );
}
