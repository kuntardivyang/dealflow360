"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { setCustomer } from "@/app/(internal)/actions/quotation";
import { formatBp } from "@/lib/format";

export type CustomerChoice = { id: number; name: string; city: string | null; tier: string; ceilingBp: number };

/**
 * Odoo-style header fields of the quotation form: Customer (a dropdown while the quote is
 * editable) and Price List (filled from the customer's tier). Changing the customer
 * re-prices every line from the tier's price list and its discount ceilings.
 */
export function CustomerField({
  quotationId,
  version,
  customerId,
  customers,
  editable,
}: {
  quotationId: number;
  version: number;
  customerId: number | null;
  customers: CustomerChoice[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<number | null>(customerId);
  const chosen = customers.find((c) => c.id === current) ?? null;

  const onChange = (value: string) => {
    const id = Number(value);
    if (!id) return;
    setCurrent(id);
    start(async () => {
      const r = await setCustomer({ quotationId, version, customerId: id });
      if (!r.ok) {
        toast.error(r.fieldErrors?.customerId?.[0] ?? r.message);
        setCurrent(customerId);
        if (r.code === "CONFLICT") router.refresh();
        return;
      }
      toast.success(`Customer set to ${r.data.customer.name} (${r.data.customer.tier} price list)`);
      router.refresh();
    });
  };

  const box = "flex h-9 w-full items-center rounded-lg border border-input bg-card px-2.5 text-sm";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="q-customer">Customer</Label>
        {editable ? (
          <div className="relative">
            <select
              id="q-customer"
              value={current ?? ""}
              disabled={pending}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={current === null}
              className={`${box} outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-warning`}
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` · ${c.city}` : ""} ({c.tier})
                </option>
              ))}
            </select>
            {pending ? <Loader2 className="absolute top-2.5 right-8 size-4 animate-spin text-muted-foreground" /> : null}
          </div>
        ) : (
          <div id="q-customer" className={box}>
            <span className="font-medium">{chosen?.name ?? "No customer"}</span>
            {chosen?.city ? <span className="ml-1 text-muted-foreground">· {chosen.city}</span> : null}
          </div>
        )}
        {current === null ? <p className="text-xs text-warning">Pick the customer first: prices and discount limits come from their tier.</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="q-pricelist">Price List</Label>
        <div id="q-pricelist" className={`${box} bg-muted/40`}>
          {chosen ? (
            <>
              <span className="font-medium">{chosen.tier} price list</span>
              <span className="ml-auto text-muted-foreground">ceiling {formatBp(chosen.ceilingBp)} · INR</span>
            </>
          ) : (
            <span className="text-muted-foreground">Filled from the customer&apos;s tier</span>
          )}
        </div>
      </div>
    </div>
  );
}
