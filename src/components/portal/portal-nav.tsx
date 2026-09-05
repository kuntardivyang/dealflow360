"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "My Quotation", href: "/portal" },
  { label: "Messages", href: "/portal/messages" },
  { label: "Profile", href: "/portal/profile" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Portal" className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
      {ITEMS.map((item) => {
        const active = item.href === "/portal" ? pathname === "/portal" || pathname.startsWith("/portal/q/") : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
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
