"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { actOnAlert } from "@/app/(internal)/actions/health";

/** Nudge Rep and Escalate on one alert; the result shows inline and as an audit row on the quote. */
export function AlertActions({ alertId, canAct, nudgedAt, escalatedAt }: { alertId: number; canAct: boolean; nudgedAt: string | null; escalatedAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (action: "NUDGE" | "ESCALATE") =>
    start(async () => {
      const r = await actOnAlert({ alertId, action });
      if (!r.ok) {
        toast.error(r.message);
        if (r.code === "CONFLICT") router.refresh();
        return;
      }
      toast.success(action === "NUDGE" ? `Nudge sent to ${r.data.rep} on ${r.data.quotationNumber}` : `${r.data.quotationNumber} escalated to management`, {
        description: `Audit entry #${r.data.auditLogId} written on the quotation.`,
      });
      router.refresh();
    });
  return (
    <div className="flex flex-col items-start gap-1.5">
      {escalatedAt ? (
        <span className="text-xs font-semibold text-destructive">Escalated {escalatedAt}</span>
      ) : nudgedAt ? (
        <span className="text-xs font-semibold text-success">Nudge sent {nudgedAt}</span>
      ) : null}
      {canAct ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="outline" disabled={pending} onClick={() => act("NUDGE")}>
            {pending ? <Loader2 className="animate-spin" /> : <BellRing />} Nudge Rep
          </Button>
          <Button size="xs" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={pending || !!escalatedAt} onClick={() => act("ESCALATE")}>
            <TriangleAlert /> Escalate
          </Button>
        </span>
      ) : null}
    </div>
  );
}
