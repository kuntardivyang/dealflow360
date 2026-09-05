// Owner: A. Screen 8, Fulfillment detail: the recommended warehouse split for one order,
// Accept Suggested Split, backorders, and shipping once stock is reserved.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money, PageHeader, StatusBadge } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { OPS_ROLES } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { acceptSplitForm, shipForm } from "../../actions/fulfillment";

export const dynamic = "force-dynamic";

export default async function FulfillmentDetailPage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ publicId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(undefined, `/fulfillment/${publicId}`);
  const q = await prisma.quotation.findUnique({
    where: { publicId },
    include: {
      customer: true,
      fulfillmentPlans: {
        where: { status: { not: "SUPERSEDED" } },
        orderBy: { id: "desc" },
        take: 1,
        include: { lines: { include: { warehouse: true, quotationLine: true } }, shipments: { include: { warehouse: true }, orderBy: { id: "asc" } } },
      },
    },
  });
  if (!q) notFound();
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
      <Link href="/fulfillment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Fulfillment
      </Link>
      <PageHeader
        title={`${q.number} · ${q.customer.name}`}
        description={plan ? `${plan.isManual ? "Manual split" : "Recommended split"} from live stock · ${plan.shipmentCount} shipment${plan.shipmentCount === 1 ? "" : "s"}` : "No goods to ship on this order"}
        actions={
          <>
            <StatusBadge status={q.status} className="h-6 px-3 text-sm" />
            <Link href={`/quotes/${q.publicId}`} className="text-sm underline-offset-4 hover:underline">
              Open quotation
            </Link>
          </>
        }
      />
      {sp.error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.error}</p> : null}

      {plan ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Warehouse split</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2">Warehouse</th>
                    <th className="py-2">Qty fulfilled</th>
                    <th className="py-2 text-right">Est. shipments</th>
                    <th className="py-2 text-right">Cost</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
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
                <Button variant="outline" className="w-full" disabled title="Manual override arrives with the next merge">
                  Manual Override
                </Button>
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
