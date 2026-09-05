// Owner: A. Screen 8, Fulfillment detail: the recommended warehouse split for one order,
// Accept Suggested Split, backorders, and shipping once stock is reserved.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money, PageHeader, StatusBadge } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { OPS_ROLES } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { acceptSplitForm, overrideSplitForm, shipForm } from "../../actions/fulfillment";

export const dynamic = "force-dynamic";

export default async function FulfillmentDetailPage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ error?: string; override?: string }> }) {
  const [{ publicId }, sp] = await Promise.all([params, searchParams]);
  const overriding = sp.override === "1";
  const user = await requireUser(undefined, `/fulfillment/${publicId}`);
  const q = await prisma.quotation.findUnique({
    where: { publicId },
    include: {
      customer: true,
      fulfillmentPlans: {
        where: { status: { not: "SUPERSEDED" } },
        orderBy: { id: "desc" },
        take: 1,
        include: { lines: { include: { warehouse: true, quotationLine: { include: { product: true } } } }, shipments: { include: { warehouse: true }, orderBy: { id: "asc" } } },
      },
    },
  });
  if (!q) notFound();
  const warehouses = overriding ? await prisma.warehouse.findMany({ where: { archivedAt: null }, orderBy: { priority: "asc" }, include: { stockLevels: true } }) : [];
  // Manual Override rows: one per goods line on the order, with the proposed allocation prefilled.
  const demand = new Map<number, { description: string; productId: number; qty: number; proposed: Map<number, number> }>();
  for (const l of q.fulfillmentPlans[0]?.lines ?? []) {
    const entry = demand.get(l.quotationLineId) ?? { description: l.quotationLine.description, productId: l.quotationLine.productId, qty: 0, proposed: new Map() };
    entry.qty += l.qty;
    if (l.warehouseId !== null) entry.proposed.set(l.warehouseId, (entry.proposed.get(l.warehouseId) ?? 0) + l.qty);
    demand.set(l.quotationLineId, entry);
  }
  const plan = q.fulfillmentPlans[0] ?? null;
  const canAct = OPS_ROLES.includes(user.role) || user.id === q.repUserId;
  const canShip = OPS_ROLES.includes(user.role);

  const byWarehouse = new Map<number, { name: string; cost: number; lines: { product: string; qty: number }[] }>();
  for (const l of plan?.lines ?? []) {
    if (!l.warehouse) continue;
    const entry = byWarehouse.get(l.warehouse.id) ?? { name: l.warehouse.name, cost: l.warehouse.shipCostWeight, lines: [] };
    entry.lines.push({ product: l.quotationLine.description, qty: l.qty });
    byWarehouse.set(l.warehouse.id, entry);
  }
  const backorders = plan?.lines.filter((l) => l.isBackorder) ?? [];

  return (
    <div className="space-y-6">
      <Link href="/fulfillment" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Fulfillment
      </Link>
      <PageHeader
        title={`${q.number} · ${q.customer.name}`}
        description={plan ? `Opened from the Fulfillment list · ${plan.isManual ? "manual split" : "recommended split"} from live stock · ${plan.shipmentCount} shipment${plan.shipmentCount === 1 ? "" : "s"}` : "No goods to ship on this order"}
        actions={
          <>
            <StatusBadge status={q.status} className="h-6 px-3 text-sm" />
            <Link href={`/quotes/${q.publicId}`} className="text-sm font-medium text-link underline-offset-4 hover:underline">
              Open quotation
            </Link>
          </>
        }
      />
      {sp.error ? <p className="rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive ring-1 ring-inset ring-destructive/20">{sp.error}</p> : null}

      {plan ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Warehouse split</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="col-label border-b border-foreground/10 text-left [&_th]:pr-4 [&_th:last-child]:pr-0">
                  <tr>
                    <th className="py-2">Warehouse</th>
                    <th className="py-2">Qty fulfilled</th>
                    <th className="py-2 text-right">Est. shipments</th>
                    <th className="py-2 text-right">Cost</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y [&_td]:pr-4 [&_td:last-child]:pr-0">
                  {[...byWarehouse.entries()].map(([wid, w]) => {
                    const shipment = plan.shipments.find((s) => s.warehouseId === wid);
                    return (
                      <tr key={wid}>
                        <td className="py-3 font-medium">{w.name}</td>
                        <td className="py-3">
                          {w.lines.map((l) => (
                            <div key={l.product}>
                              {l.qty} × {l.product}
                            </div>
                          ))}
                        </td>
                        <td className="py-3 text-right tabular-nums">1</td>
                        <td className="py-3 text-right"><Money paise={w.cost} /></td>
                        <td className="py-3 text-right">
                          {shipment ? (
                            shipment.status === "SHIPPED" ? (
                              <StatusBadge status="SHIPPED" label={`Shipped ${shipment.shippedAt ? formatDate(shipment.shippedAt) : ""}`} />
                            ) : canShip ? (
                              <form action={shipForm}>
                                <input type="hidden" name="shipmentId" value={shipment.id} />
                                <input type="hidden" name="publicId" value={q.publicId} />
                                <Button type="submit" size="sm" variant="outline">
                                  Mark shipped
                                </Button>
                              </form>
                            ) : (
                              <StatusBadge status="RESERVED" />
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {backorders.map((b) => (
                    <tr key={b.id} className="text-warning">
                      <td className="py-3 font-medium">Backorder</td>
                      <td className="py-3">
                        {b.qty} × {b.quotationLine.description}
                      </td>
                      <td className="py-3 text-right">–</td>
                      <td className="py-3 text-right">{b.expectedDate ? `expected ${formatDate(b.expectedDate)}` : "–"}</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
              {backorders.length > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">A &quot;Consolidate Remaining Backorder&quot; prompt appears here when stock arrives at a warehouse already in this plan.</p>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {overriding && plan.status === "PROPOSED" && q.status === "CONFIRMED" ? (
              <Card className="border-l-4 border-l-link">
                <CardHeader>
                  <CardTitle className="text-base">Manual Override</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={overrideSplitForm} className="space-y-3 text-sm">
                    <input type="hidden" name="quotationId" value={q.id} />
                    <input type="hidden" name="planId" value={plan.id} />
                    <input type="hidden" name="publicId" value={q.publicId} />
                    {[...demand.entries()].map(([lineId, d]) => (
                      <fieldset key={lineId} className="space-y-1 rounded-md border p-2">
                        <legend className="px-1 text-xs font-medium">
                          {d.description} · need {d.qty}
                        </legend>
                        {warehouses.map((w) => {
                          const available = w.stockLevels.filter((sl) => sl.productId === d.productId).reduce((n, sl) => n + sl.onHand - sl.reserved, 0);
                          return (
                            <label key={w.id} className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">
                                {w.name} <span className="text-xs">({available} available)</span>
                              </span>
                              <input name={`alloc.${lineId}.${w.id}`} type="number" min={0} max={d.qty} defaultValue={d.proposed.get(w.id) ?? 0} className="h-8 w-20 rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2 text-right" aria-label={`${w.name} quantity for ${d.description}`} />
                            </label>
                          );
                        })}
                      </fieldset>
                    ))}
                    <label className="block">
                      <span className="text-muted-foreground">Reason</span>
                      <input name="reason" required minLength={3} placeholder="Why the suggested split is being changed" className="mt-1 h-9 w-full rounded-lg border border-input bg-card outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 px-2" />
                    </label>
                    <Button type="submit" className="w-full" disabled={!canAct}>
                      Apply override
                    </Button>
                    <p className="text-xs text-muted-foreground">Anything left unallocated becomes a backorder. The new split replaces the suggestion and still needs Accept.</p>
                  </form>
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardContent className="space-y-2 p-4 text-sm">
                <p className="flex justify-between">
                  <span className="text-muted-foreground">Shipments</span>
                  <span className="tabular-nums">{plan.shipmentCount}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">Estimated shipping cost</span>
                  <Money paise={plan.estCost} />
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <StatusBadge status={plan.status} />
                </p>
                {plan.reason ? <p className="text-muted-foreground">Override reason: {plan.reason}</p> : null}
              </CardContent>
            </Card>
            {plan.status === "PROPOSED" && q.status === "CONFIRMED" ? (
              <>
                <form action={acceptSplitForm}>
                  <input type="hidden" name="quotationId" value={q.id} />
                  <input type="hidden" name="planId" value={plan.id} />
                  <input type="hidden" name="publicId" value={q.publicId} />
                  <Button type="submit" className="w-full" size="lg" disabled={!canAct}>
                    Accept Suggested Split
                  </Button>
                </form>
                {overriding ? (
                  <Link href={`/fulfillment/${q.publicId}`} className={buttonVariants({ variant: "outline", className: "w-full" })}>
                    Cancel override
                  </Link>
                ) : (
                  <Link href={`/fulfillment/${q.publicId}?override=1`} className={buttonVariants({ variant: "outline", className: "w-full" })} aria-disabled={!canAct}>
                    Manual Override
                  </Link>
                )}
                <p className="text-center text-xs text-muted-foreground">Accepting reserves the stock in one locked transaction.</p>
              </>
            ) : plan.status === "ACCEPTED" ? (
              <p className="text-center text-xs text-muted-foreground">Stock is reserved. Mark each shipment as shipped when it leaves the warehouse.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">This order has only services or subscriptions, so nothing ships.</CardContent>
        </Card>
      )}
    </div>
  );
}
