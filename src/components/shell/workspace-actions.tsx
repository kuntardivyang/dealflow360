"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * PDF B1 actions. Reload Data re-fetches every server component on the page
 * (pricing, stock, approvals); Go to Back-end opens configuration; Close Workspace
 * ends the session view (wired to the logout action when auth lands).
 */
export function WorkspaceActions({ canOpenBackend }: { canOpenBackend: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const reload = () =>
    startTransition(() => {
      router.refresh();
      toast.success("Data reloaded", { description: "Pricing, stock and approval data refreshed from the back-end." });
    });

  return (
    <div className="flex items-center gap-1" data-print-hide>
      <Button variant="ghost" size="sm" onClick={reload} disabled={pending} title="Reload Data">
        <RefreshCw className={cn(pending && "animate-spin")} />
        <span className="hidden xl:inline">Reload Data</span>
      </Button>
      {canOpenBackend ? (
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/admin" />} title="Go to Back-end">
          <Settings2 />
          <span className="hidden xl:inline">Go to Back-end</span>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/login" />} title="Close Workspace">
        <LogOut />
        <span className="hidden xl:inline">Close Workspace</span>
      </Button>
    </div>
  );
}
