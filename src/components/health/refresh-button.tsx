"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { refreshHealth } from "@/app/(internal)/actions/health";

export function RefreshHealthButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await refreshHealth();
          if (r.ok) toast.success(`Health recomputed: ${r.data.open} open alert${r.data.open === 1 ? "" : "s"}`);
          else toast.error(r.message);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Recompute now
    </Button>
  );
}
