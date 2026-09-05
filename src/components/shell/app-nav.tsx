"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavLink = { label: string; href: string };

/** Top navigation tabs. The white tab shows which module you are in (mockup navigation key). */
export function AppNav({ items }: { items: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Modules" className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
