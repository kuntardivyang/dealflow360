// Owner: A. Screen 7, Fulfillment and Stock: live stock per warehouse and every order
// that still needs fulfilling. Click an order to open its split detail.
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, EmptyState, PageHeader, StatusBadge, type Column } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { OPS_ROLES } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { receiveStockForm } from "../actions/fulfillment";

export const metadata = { title: "Fulfillment" };
export const dynamic = "force-dynamic";

export default async function FulfillmentPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, requireUser(undefined, "/fulfillment")]);
  const [stock, orders, warehouses, goods] = await Promise.all([
    prisma.stockLevel.findMany({ include: { warehouse: true, product: true }, orderBy: [{ warehouse: { priority: "asc" } }, { product: { name: "asc" } }] }),
    prisma.quotation.findMany({
      where: { status: { in: ["CONFIRMED", "FULFILLMENT"] } },
      include: { customer: true, fulfillmentPlans: { where: { status: { not: "SUPERSEDED" } }, orderBy: { id: "desc" }, take: 1, include: { lines: { include: { warehouse: true } }, shipments: true } } },
      orderBy: { confirmedAt: "desc" },
    }),
    prisma.warehouse.findMany({ where: { archivedAt: null }, orderBy: { priority: "asc" } }),
    prisma.product.findMany({ where: { kind: "GOOD", archivedAt: null }, orderBy: { name: "asc" } }),
  ]);
  const canReceive = OPS_ROLES.includes(user.role);

  type Stock = (typeof stock)[number];
  const stockColumns: Column<Stock>[] = [
    { key: "wh", header: "Warehouse", cell: (s) => s.warehouse.name },
    { key: "product", header: "Product", cell: (s) => s.product.name },
    { key: "onHand", header: "In Stock", align: "right", cell: (s) => <span className="tabular-nums">{s.onHand}</span> },
    { key: "reserved", header: "Reserved", align: "right", cell: (s) => <span className="tabular-nums">{s.reserved}</span> },
    {
      key: "available",
      header: "Available",
      align: "right",
      cell: (s) => <span className={`tabular-nums font-medium ${s.onHand - s.reserved <= s.reorderPoint ? "text-warning" : ""}`}>{s.onHand - s.reserved}</span>,
    },
  ];

  type Order = (typeof orders)[number];
  const stateOf = (o: Order) => {
    const plan = o.fulfillmentPlans[0];
    if (!plan) return "NO_STOCK_LINES";
    if (plan.status === "PROPOSED") return "PROPOSED";
    if (plan.shipments.length > 0 && plan.shipments.every((s) => s.status === "SHIPPED")) return "SHIPPED";
    if (plan.lines.some((l) => l.isBackorder)) return "BACKORDER";
    return "RESERVED";
  };
  const orderColumns: Column<Order>[] = [
    { key: "number", header: "Order", cell: (o) => <span className="font-medium">{o.number}</span> },
    { key: "customer", header: "Customer", cell: (o) => o.customer!.name },
    {
      key: "status",
      header: "Status",
      cell: (o) => {
        const s = stateOf(o);
        return s === "NO_STOCK_LINES" ? <span className="text-muted-foreground">Nothing to ship</span> : <StatusBadge status={s} />;
      },
    },
    {
      key: "warehouses",
      header: "Warehouses",
      cell: (o) => [...new Set(o.fulfillmentPlans[0]?.lines.map((l) => l.warehouse?.name ?? "Backorder") ?? [])].join(" + ") || "–",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Fulfillment and Stock" description="Live stock per warehouse, plus every confirmed order that still needs fulfilling." />
      {sp.error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.error}</p> : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Stock</h2>
        <DataTable columns={stockColumns} rows={stock} rowKey={(s) => s.id} empty={<EmptyState title="No stock rows" />} />
      </section>

      {canReceive ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Receive stock</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={receiveStockForm} className="flex flex-wrap items-end gap-2 text-sm">
              <select name="warehouseId" required className="h-9 rounded-md border bg-card px-2" aria-label="Warehouse">
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <select name="productId" required className="h-9 rounded-md border bg-card px-2" aria-label="Product">
                {goods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input name="qty" type="number" min={1} defaultValue={5} required className="h-9 w-20 rounded-md border bg-card px-2 text-right" aria-label="Quantity" />
              <Button type="submit" variant="outline">
                Record receipt
              </Button>
              <span className="text-xs text-muted-foreground">Simulates a delivery arriving at a warehouse.</span>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Orders awaiting fulfillment</h2>
        <DataTable
          columns={orderColumns}
          rows={orders}
          rowKey={(o) => o.id}
          rowHref={(o) => `/fulfillment/${o.publicId}`}
          empty={<EmptyState title="Nothing to fulfil yet" description="Confirmed orders appear here with their recommended warehouse split." />}
        />
      </section>
    </div>
  );
}
