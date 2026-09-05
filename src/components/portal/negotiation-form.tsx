"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { confirm, submitRequest } from "@/app/portal/actions";
import type { PortalQuotationDTO } from "@/lib/contract";
import { formatBp } from "@/lib/format";
import { cn } from "@/lib/utils";

type RequestType = "COMMENT" | "CHANGE_REQUEST" | "COUNTER_DISCOUNT";

/**
 * Screen 11 controls: line-level comment / change request / counter discount with a
 * requested delivery date, Submit Request, and Confirm Quotation with a typed full name.
 * Confirm is disabled while a counter is open or the quote awaits internal approval.
 */
export function NegotiationForm({ quotation }: { quotation: PortalQuotationDTO }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState<RequestType>("COMMENT");
  const [lineId, setLineId] = useState<string>(quotation.lines[0] ? String(quotation.lines[0].id) : "");
  const [message, setMessage] = useState("");
  const [counterPct, setCounterPct] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const awaiting = quotation.status === "Awaiting internal approval";
  const confirmed = quotation.status === "Confirmed";
  const openCounter = quotation.requests.some((r) => r.type === "COUNTER_DISCOUNT" && r.status === "OPEN");
  const canRequest = !awaiting && !confirmed;
  const selectedLine = quotation.lines.find((l) => String(l.id) === lineId);

  const submit = () =>
    start(async () => {
      setErrors({});
      const pct = counterPct.trim() === "" ? undefined : Number(counterPct);
      const result = await submitRequest({
        publicId: quotation.publicId,
        type,
        lineId: lineId ? Number(lineId) : undefined,
        message: message.trim() || undefined,
        proposedDiscountBp: type === "COUNTER_DISCOUNT" && pct !== undefined && Number.isFinite(pct) ? Math.round(pct * 100) : undefined,
        requestedDeliveryDate: deliveryDate || undefined,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? { _: [result.message] });
        if (result.code === "CONFLICT") {
          toast.error(result.message);
          router.refresh();
        }
        return;
      }
      const d = result.data;
      toast.success(
        d.status === "Awaiting internal approval"
          ? "Request sent. Your counter-offer needs an internal approval; we will update the quotation here."
          : "Request sent to your sales representative.",
      );
      setMessage("");
      setCounterPct("");
      setDeliveryDate("");
      router.refresh();
    });

  const doConfirm = () =>
    start(async () => {
      setConfirmError(null);
      const result = await confirm({ publicId: quotation.publicId, fullName: fullName.trim() });
      if (!result.ok) {
        setConfirmError(result.fieldErrors?.fullName?.[0] ?? result.message);
        if (result.code === "CONFLICT") router.refresh();
        return;
      }
      setConfirmOpen(false);
      toast.success(result.data.status === "Confirmed" ? "Quotation confirmed. Thank you!" : "Confirmation received. The final terms need an internal approval first.");
      router.refresh();
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(260px,320px)]">
      <Card>
        <CardHeader>
          <CardTitle>Ask, change or counter</CardTitle>
          <CardDescription>
            {canRequest ? "Pick a line and tell us what you need. A counter-offer above our limits is routed for approval automatically." : awaiting ? "Your last request is being reviewed internally. You will see the outcome here." : "This quotation is confirmed."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5 rounded-lg bg-muted p-1 sm:grid-cols-3">
            {(
              [
                ["COMMENT", "Comment"],
                ["CHANGE_REQUEST", "Change request"],
                ["COUNTER_DISCOUNT", "Counter discount"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={!canRequest}
                onClick={() => setType(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                  type === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-line">Line</Label>
              <select
                id="req-line"
                value={lineId}
                disabled={!canRequest}
                onChange={(e) => setLineId(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {type !== "COUNTER_DISCOUNT" ? <option value="">Whole quotation</option> : null}
                {quotation.lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} (current discount {formatBp(l.discountBp)})
                  </option>
                ))}
              </select>
              {errors.lineId ? <p className="text-xs text-destructive">{errors.lineId[0]}</p> : null}
            </div>
            {type === "COUNTER_DISCOUNT" ? (
              <div className="space-y-1.5">
                <Label htmlFor="req-counter">Counter Discount %</Label>
                <Input
                  id="req-counter"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  inputMode="decimal"
                  value={counterPct}
                  disabled={!canRequest}
                  onChange={(e) => setCounterPct(e.target.value)}
                  placeholder={selectedLine ? `e.g. ${Math.min(100, selectedLine.discountBp / 100 + 5)}` : "e.g. 15"}
                  aria-invalid={!!errors.proposedDiscountBp}
                />
                {errors.proposedDiscountBp ? <p className="text-xs text-destructive">{errors.proposedDiscountBp[0]}</p> : null}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="req-date">Requested Delivery Date</Label>
                <Input id="req-date" type="date" value={deliveryDate} disabled={!canRequest} onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-message">{type === "COUNTER_DISCOUNT" ? "Message (optional)" : "Message"}</Label>
            <Textarea
              id="req-message"
              value={message}
              disabled={!canRequest}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={type === "COUNTER_DISCOUNT" ? "Why this discount works for both of us" : type === "CHANGE_REQUEST" ? "e.g. Can we push this to next month?" : "e.g. Can this be 15% off instead of 10%?"}
              aria-invalid={!!errors.message}
            />
            {errors.message ? <p className="text-xs text-destructive">{errors.message[0]}</p> : null}
          </div>
          {errors._ ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errors._[0]}</p> : null}
          <Button onClick={submit} disabled={!canRequest || pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />} Submit Request
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" className="self-start">
        <CardHeader>
          <CardTitle>Confirm Quotation</CardTitle>
          <CardDescription>
            {confirmed
              ? `Confirmed${quotation.confirmedAt ? ` on ${new Date(quotation.confirmedAt).toLocaleDateString("en-IN")}` : ""}. Your order is being prepared.`
              : awaiting
                ? "Confirm is disabled while the terms are awaiting internal approval."
                : openCounter
                  ? "Confirm is disabled while your counter-offer is open. Wait for the answer, or it will be applied automatically once approved."
                  : "One click confirms the current terms. If the final terms exceed our thresholds, the quotation re-enters approval automatically."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" disabled={!quotation.canConfirm || pending} onClick={() => setConfirmOpen(true)}>
            <CheckCircle2 /> Confirm Quotation
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && !pending && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {quotation.number}</DialogTitle>
            <DialogDescription>Type your full name to confirm the quotation at the terms shown. This is recorded with the time.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-name">Full name</Label>
            <Input id="confirm-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" autoFocus aria-invalid={!!confirmError} />
            {confirmError ? <p role="alert" className="text-xs text-destructive">{confirmError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={doConfirm} disabled={pending || fullName.trim().length < 2}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Confirm Quotation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
