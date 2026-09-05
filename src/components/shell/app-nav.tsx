"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type NavLink = { label: string; href: string };

/**
 * Module tabs. The active module carries a cobalt bar on the bottom edge of the
 * header (mockup navigation key: "the highlighted tab shows which module you are in").
 *
 * The row scrolls horizontally once the nine tabs no longer fit (below roughly 1180 px
 * of viewport). A raw scrollbar inside a 56 px header collides with the active-tab
 * underline, so the affordance is a fade on whichever edge still has tabs behind it,
 * and the active tab is scrolled into view on navigation — otherwise the last tabs are
 * silently unreachable.
 */
const FADE = 30;
const MASK: Record<"none" | "start" | "end" | "both", string | undefined> = {
  none: undefined,
  end: `linear-gradient(to right, #000 calc(100% - ${FADE}px), transparent 100%)`,
  start: `linear-gradient(to right, transparent 0, #000 ${FADE}px)`,
  both: `linear-gradient(to right, transparent 0, #000 ${FADE}px, #000 calc(100% - ${FADE}px), transparent 100%)`,
};

export function AppNav({ items }: { items: NavLink[] }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement | null>(null);
  const [edge, setEdge] = useState<"none" | "start" | "end" | "both">("none");

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) return setEdge("none");
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft >= max - 1;
    setEdge(atStart ? "end" : atEnd ? "start" : "both");
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, items.length]);

  // Landing on a module whose tab is off-screen should still show you where you are.
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [pathname, measure]);

  return (
    <nav
      ref={ref}
      aria-label="Modules"
      onScroll={measure}
      style={{ maskImage: MASK[edge], WebkitMaskImage: MASK[edge] }}
      className="flex h-14 min-w-0 shrink items-stretch gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center rounded-md px-2 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 xl:px-2.5 2xl:px-3",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors",
              active ? "after:bg-link" : "after:bg-transparent hover:after:bg-border",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
