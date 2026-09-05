"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavLink = { label: string; href: string };

/**
 * Module tabs. The active module carries a cobalt bar on the bottom edge of the
 * header (mockup navigation key: "the highlighted tab shows which module you are in").
 */
export function AppNav({ items }: { items: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Modules" className="flex h-14 min-w-0 shrink items-stretch gap-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
