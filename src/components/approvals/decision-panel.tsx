"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decide } from "@/app/(internal)/actions/approval";

type Decision = "APPROVE" | "REJECT" | "RETURN";

const COPY: Record<Decision, { title: string; description: string; button: string; noteLabel: string; needsReason: boolean }> = {
  APPROVE: {
    title: "Approve this step",
    description: "Your approval is recorded with your name, the time and your note. If this is the last step the quotation becomes Approved.",
    button: "Approve",
    noteLabel: "Note (optional)",
    needsReason: false,
  },
  RETURN: {
    title: "Return for revision",
    description: "The quotation goes back to Draft. The rep edits it and confirms again, which starts a fresh approval from step 1.",
    button: "Return for Revision",
    noteLabel: "Reason (required)",
    needsReason: true,
  },
  REJECT: {
    title: "Reject this quotation",
    description: "The request and the quotation are marked Rejected. The rep can revise it into a new draft.",
    button: "Reject",
    noteLabel: "Reason (required)",
    needsReason: true,
  },
};

/** Approve / Return for Revision / Reject with a reason dialog; the confirmation shows the audit entry that was written. */
export function DecisionPanel({
  requestId,
  stepId,
  stepRole,
  canDecide,
  blockedWhy,
}: {
  requestId: number;
  stepId: number;
  stepRole: string;
  canDecide: boolean;
  blockedWhy: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    if (!open) return;
    const copy = COPY[open];
    if (copy.needsReason && note.trim().length < 3) {
      setError("Give a reason (at least 3 characters)");
      return;
    }
    start(async () => {
      const result = await decide({ requestId, stepId, decision: open, note: note.trim() || undefined });
      if (!result.ok) {
        setError(result.fieldErrors?.note?.[0] ?? result.message);
        if (result.code === "CONFLICT") {
          toast.error(result.message);
          setOpen(null);
          router.refresh();
        }
        return;
      }
      const verb = open === "APPROVE" ? "Approved" : open === "REJECT" ? "Rejected" : "Returned for revision";
      toast.success(`${verb}. Audit entry #${result.data.auditLogId} written.`, {
        description: `${result.data.number} is now ${result.data.status.toLowerCase().replaceAll("_", " ")}.`,
      });
      setOpen(null);
      setNote("");
      router.push(`?audit=${result.data.auditLogId}`);
      router.refresh();
    });
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Decision</CardTitle>
        <CardDescription>{canDecide ? `Waiting for ${stepRole}. That is you.` : (blockedWhy ?? `Waiting for ${stepRole}.`)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          disabled={!canDecide || pending}
          onClick={() => {
            setError(null);
            setOpen("APPROVE");
          }}
        >
          <Check /> Approve
        </Button>
        <Button
          variant="outline"
          disabled={!canDecide || pending}
          onClick={() => {
            setError(null);
            setOpen("RETURN");
          }}
        >
          <RotateCcw /> Return for Revision
        </Button>
        <Button
          variant="destructive"
          disabled={!canDecide || pending}
          onClick={() => {
            setError(null);
            setOpen("REJECT");
          }}
        >
          <X /> Reject
        </Button>
      </CardContent>

      <Dialog open={open !== null} onOpenChange={(o) => !o && !pending && setOpen(null)}>
        {open ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{COPY[open].title}</DialogTitle>
              <DialogDescription>{COPY[open].description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="decision-note">{COPY[open].noteLabel}</Label>
              <Textarea
                id="decision-note"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setError(null);
                }}
                aria-invalid={!!error}
                placeholder={open === "APPROVE" ? "e.g. ok, 8 pp on services" : "e.g. Requested justification for the service discount"}
                autoFocus
              />
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(null)} disabled={pending}>
                Cancel
              </Button>
              <Button variant={open === "REJECT" ? "destructive" : "default"} onClick={submit} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {COPY[open].button}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}
