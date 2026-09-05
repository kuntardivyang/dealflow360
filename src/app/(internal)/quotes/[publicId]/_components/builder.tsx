"use client";

// Feature 34: the quotation builder. Every click calls a server action; the response
// carries the fresh totals and risk, so the margin and the OK / Over markers update at
// once, then the page data refreshes in the background. No money is computed here.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Minus, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money, StatusBadge } from "@/components/shared";
import type { ActionResult, QuotationTotalsView, RiskPreview, Totals } from "@/lib/contract";
import { formatBp, formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addLine, confirmQuotation, removeLine, setOrderDiscount, updateLine } from "../../../actions/quotation";
import { RiskCard, chainLabel } from "./risk-card";

export type BuilderLine = {
  id: number;
  description: string;
  category: string;
  plan: string | null;
  qty: number;
  unitPrice: number;
  discountBp: number;
  effectiveDiscountBp: number;
  ceilingBp: number;
  total: number;
};
export type PickerProduct = { id: number; name: string; category: string; kind: string; listPrice: number; unit: string; isPromoted: boolean };
export type BuilderView = { totals: Totals; risk: RiskPreview | null; version: number };
export type UpsellSuggestion = { productId: number; name: string; category: string; listPrice: number; unit: string; marginDelta: number; isPromoted: boolean; reason: string };

const percentToBp = (s: string): number | null => {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
};

export function Builder({
  quotationId,
  lines,
  products,
  suggestions,
  orderDiscountBp,
  initialView,
}: {
  quotationId: number;
  lines: BuilderLine[];
  products: PickerProduct[];
  suggestions: UpsellSuggestion[];
  orderDiscountBp: number;
  initialView: BuilderView;
}) {
  const router = useRouter();
  const [view, setView] = useState<BuilderView>(initialView);
  const [orderDiscount, setOrderDiscount_] = useState(String(orderDiscountBp / 100));
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [category, setCategory] = useState<string>("All");
  const [dismissed, setDismissed] = useState<number[]>([]);
  const visibleSuggestions = suggestions.filter((s) => !dismissed.includes(s.productId));
  const [pending, start] = useTransition();

  const categories = ["All", ...Array.from(new Set(products.map((p) => p.category)))];
  const visible = products.filter((p) => category === "All" || p.category === category);

  function run<T extends QuotationTotalsView>(call: Promise<ActionResult<T>>) {
    start(async () => {
      const r = await call;
      if (!r.ok) {
        const detail = r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" ") : "";
        toast.error(`${r.message}${detail ? ` ${detail}` : ""}`);
        if (r.code === "CONFLICT") router.refresh();
        return;
      }
      setView({ totals: r.data.totals, risk: r.data.risk, version: r.data.version });
      router.refresh();
    });
  }

  const overageOf = (line: BuilderLine) =>
    view.risk?.lines.find((l) => l.lineId === line.id)?.overageBp ?? Math.max(0, line.effectiveDiscountBp - line.ceilingBp);
  const lineTotal = (line: BuilderLine) => view.totals.lines.find((l) => l.lineId === line.id)?.total ?? line.total;
  const effective = (line: BuilderLine) => view.totals.lines.find((l) => l.lineId === line.id)?.effectiveDiscountBp ?? line.effectiveDiscountBp;

  const changeQty = (line: BuilderLine, delta: number) => {
    const qty = line.qty + delta;
    if (qty <= 0) run(removeLine({ quotationId, version: view.version, lineId: line.id }));
    else run(updateLine({ quotationId, version: view.version, lineId: line.id, qty }));
  };

  const commitDiscount = (line: BuilderLine) => {
    const raw = drafts[line.id];
    if (raw === undefined) return;
    const bp = percentToBp(raw);
    if (bp === null) {
      toast.error("Discount must be between 0 and 100 percent");
      return;
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[line.id];
      return next;
    });
    if (bp !== line.discountBp) run(updateLine({ quotationId, version: view.version, lineId: line.id, discountBp: bp }));
  };

  const applyOrderDiscount = () => {
    const bp = percentToBp(orderDiscount);
    if (bp === null) {
      toast.error("Order discount must be between 0 and 100 percent");
      return;
    }
    run(setOrderDiscount({ quotationId, version: view.version, orderDiscountBp: bp }));
  };

  const confirm = () =>
    start(async () => {
      const r = await confirmQuotation({ quotationId, version: view.version });
      if (!r.ok) {
        toast.error(r.message);
        if (r.code === "CONFLICT") router.refresh();
        return;
      }
      toast.success(r.data.status === "APPROVED" ? "Approved. No approval was required." : `Sent for approval: ${chainLabel(r.data.chain)}`);
      router.refresh();
    });

  const hasLines = lines.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]" data-print-hide>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Order lines</CardTitle>
            <span className={cn("text-xs", pending ? "text-link" : "text-muted-foreground")}>{pending ? "Saving…" : "Every change is saved"}</span>
          </CardHeader>
          <CardContent>
            {!hasLines ? (
              <p className="text-sm text-muted-foreground">No lines yet. Add products from the catalogue below.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b-foreground/10 hover:bg-transparent">
                    <TableHead className="col-label h-9">Product</TableHead>
                    <TableHead className="col-label h-9 text-center">Qty</TableHead>
                    <TableHead className="col-label h-9 text-right">Price</TableHead>
                    <TableHead className="col-label h-9 text-right">Discount %</TableHead>
                    <TableHead className="col-label h-9 text-right">Limit</TableHead>
                    <TableHead className="col-label h-9">Status</TableHead>
                    <TableHead className="col-label h-9 text-right">Total</TableHead>
                    <TableHead className="col-label h-9" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const over = overageOf(line);
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <p className="font-medium">{line.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {line.category}
                            {line.plan ? ` · ${line.plan}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="outline" size="icon-sm" aria-label="Decrease" disabled={pending} onClick={() => changeQty(line, -1)}>
                              <Minus />
                            </Button>
                            <span className="w-8 text-center tabular-nums">{line.qty}</span>
                            <Button variant="outline" size="icon-sm" aria-label="Increase" disabled={pending} onClick={() => changeQty(line, 1)}>
                              <Plus />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Money paise={line.unitPrice} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step={0.5}
                            className="ml-auto h-8 w-20 text-right"
                            aria-label="Line discount percent"
                            value={drafts[line.id] ?? String(line.discountBp / 100)}
                            onChange={(e) => setDrafts((d) => ({ ...d, [line.id]: e.target.value }))}
                            onBlur={() => commitDiscount(line)}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            disabled={pending}
                          />
                          {effective(line) !== line.discountBp ? (
                            <p className="text-[11px] text-muted-foreground">effective {formatBp(effective(line))}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBp(line.ceilingBp)}</TableCell>
                        <TableCell>
                          {over > 0 ? <StatusBadge status="OVER" label={`Over +${formatPoints(over)}`} /> : <StatusBadge status="OK" />}
                        </TableCell>
                        <TableCell className="text-right">
                          <Money paise={lineTotal(line)} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon-sm" aria-label="Remove line" disabled={pending} onClick={() => run(removeLine({ quotationId, version: view.version, lineId: line.id }))}>
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <label className="flex items-center gap-2 text-sm">
                Order discount %
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  className="h-8 w-20 text-right"
                  value={orderDiscount}
                  onChange={(e) => setOrderDiscount_(e.target.value)}
                  disabled={pending}
                />
                <Button variant="outline" size="sm" disabled={pending} onClick={applyOrderDiscount}>
                  Apply
                </Button>
              </label>
              <p className="text-xs text-muted-foreground">Line and order discounts compound into one effective discount, checked against each line&apos;s limit.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    category === c ? "border-foreground/25 bg-accent font-semibold text-accent-foreground" : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {visible.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 transition-colors hover:border-foreground/20">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {p.name} {p.isPromoted ? <StatusBadge status="PROMO" label="Promo" className="ml-1" /> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <Money paise={p.listPrice} /> · {p.unit}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(addLine({ quotationId, version: view.version, productId: p.id, qty: 1, discountBp: 0, source: "MANUAL" }))}>
                    <Plus /> Add
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Gross</dt>
              <dd className="text-right"><Money paise={view.totals.grossTotal} /></dd>
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="text-right">− <Money paise={view.totals.discountTotal} /></dd>
              <dt className="text-muted-foreground">Net</dt>
              <dd className="text-right"><Money paise={view.totals.netTotal} /></dd>
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="text-right"><Money paise={view.totals.taxTotal} /></dd>
              <dt className="font-medium">Total</dt>
              <dd className="text-right font-semibold"><Money paise={view.totals.total} /></dd>
              <dt className="text-muted-foreground">Margin</dt>
              <dd className={cn("text-right tabular-nums font-medium", view.totals.marginBp !== null && view.totals.marginBp < 2000 ? "text-warning" : "text-success")}>
                {formatBp(view.totals.marginBp)}
              </dd>
            </dl>
          </CardContent>
        </Card>
        <RiskCard risk={view.risk} hasLines={hasLines} />
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <CardTitle className="text-base">Upsell and Cross-Sell</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {visibleSuggestions.length === 0 ? (
              <p className="text-muted-foreground">No suggestions right now.</p>
            ) : (
              visibleSuggestions.map((s) => (
                <div key={s.productId} className="rounded-lg border bg-card p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {s.name} {s.isPromoted ? <StatusBadge status="PROMO" label="Promo" className="ml-1" /> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.reason}</p>
                    </div>
                    <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground" onClick={() => setDismissed((d) => [...d, s.productId])}>
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs">
                      <Money paise={s.listPrice} /> · margin <Money paise={s.marginDelta} signed className="font-medium text-success" /> each
                    </span>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(addLine({ quotationId, version: view.version, productId: s.productId, qty: 1, discountBp: 0, source: "UPSELL" }))}>
                      <Plus /> Add to Quote
                    </Button>
                  </div>
                </div>
              ))
            )}
            <p className="text-xs text-muted-foreground">Ranked by co-purchase history and promotions; low-margin products are hidden. Totals and margin update on add.</p>
          </CardContent>
        </Card>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <Link href="/quotes" className={cn(buttonVariants({ variant: "outline", size: "lg" }))} title="Every change is already saved; go back to the list">
            Save Draft
          </Link>
          <Button size="lg" disabled={pending || !hasLines} onClick={confirm}>
            {view.risk?.chain.length ? "Submit for Approval" : "Confirm Quotation"}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {!hasLines ? "Add a line to confirm." : view.risk?.chain.length ? `Routes automatically to: ${chainLabel(view.risk.chain)}` : "Within every limit: approves immediately, no approval step needed."}
        </p>
      </div>
    </div>
  );
}
