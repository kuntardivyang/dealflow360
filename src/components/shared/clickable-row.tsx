"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** A table row that opens `href` on click or Enter, but leaves inner links and buttons alone. */
export function ClickableRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();

  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, [role=menuitem]")) return;
    router.push(href);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(href);
    }
  };

  return (
    <TableRow
      role="link"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={() => router.prefetch(href)}
      className={cn("cursor-pointer outline-none focus-visible:bg-muted/60", className)}
    >
      {children}
    </TableRow>
  );
}
