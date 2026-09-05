// Owner: B. Warehouses and stock levels (PDF A4). The split algorithm reads StockLevel
// live, so a warehouse created here is used by the next fulfillment proposal.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Money, PageHeader } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";
import { EntityForm, type FieldDef } from "@/components/admin/entity-form";
import { saveStockLevel, saveWarehouse } from "@/app/(internal)/actions/admin";
import { getWarehousesWithStock } from "@/services/admin.service";

export const metadata = { title: "Warehouses and stock" };

const WAREHOUSE_FIELDS: FieldDef[] = [
  { name: "name", label: "Warehouse", type: "text", width: "w-44" },
  { name: "city", label: "City", type: "text", width: "w-36", nullable: true },
  { name: "shipCostWeight", label: "Ship cost weighting", type: "rupees", width: "w-36" },
  { name: "priority", label: "Priority", type: "number", width: "w-20", min: 1 },
];

export default async function WarehousesPage() {
  await requireUser(BACKEND_ROLES);
  const { warehouses, products } = await getWarehousesWithStock();
  const productOptions = products.map((p) => ({ value: String(p.id), label: `${p.name} (${p.sku})` }));
  const stockFields = (fixedWarehouse: boolean): FieldDef[] => [
    ...(fixedWarehouse ? [] : [{ name: "warehouseId", label: "Warehouse", type: "select" as const, options: warehouses.map((w) => ({ value: String(w.id), label: w.name })), width: "w-44" }]),
    { name: "productId", label: "Product", type: "select", options: productOptions, width: "w-56" },
    { name: "onHand", label: "On hand", type: "number", width: "w-24", min: 0 },
    { name: "reorderPoint", label: "Reorder point", type: "number", width: "w-28", min: 0 },
    { name: "leadDays", label: "Lead days", type: "number", width: "w-24", min: 0 },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouses and stock"
        description="Stock per warehouse with replenishment rules. The shipping cost weighting breaks ties when the auto-split chooses between warehouses; lower priority number wins otherwise."
      />
      <Card>
        <CardHeader>
          <CardTitle>Warehouses</CardTitle>
          <CardDescription>Ship cost weighting is the estimated cost of one shipment from this warehouse.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {warehouses.map((w) => (
            <EntityForm key={w.id} layout="inline" fields={WAREHOUSE_FIELDS} initial={w} hidden={{ id: w.id }} action={saveWarehouse} successMessage={`${w.name} saved`} />
          ))}
          <div className="border-t pt-3">
            <EntityForm layout="inline" fields={WAREHOUSE_FIELDS} initial={{ priority: warehouses.length + 1 }} action={saveWarehouse} submitLabel="Add warehouse" successMessage="Warehouse created" resetOnSuccess />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock levels</CardTitle>
          <CardDescription>Available = on hand − reserved. Reserved is set by accepted fulfillment plans and cannot be edited here. Every change to on hand writes a stock move.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-0">
          {warehouses.every((w) => w.stockLevels.length === 0) ? (
            <EmptyState className="mx-4" title="No stock yet" description="Add a stock level below." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">Warehouse</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">In Stock</TableHead>
                  <TableHead className="text-right">Reserved</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="px-4">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouses.flatMap((w) =>
                  w.stockLevels.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="px-4 font-medium">{w.name}</TableCell>
                      <TableCell>{s.product.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.onHand}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{s.reserved}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{s.onHand - s.reserved}</TableCell>
                      <TableCell className="px-4">
                        <EntityForm
                          layout="inline"
                          fields={stockFields(true).filter((f) => f.name !== "productId")}
                          initial={s}
                          hidden={{ warehouseId: w.id, productId: s.productId }}
                          action={saveStockLevel}
                          successMessage={`${s.product.name} at ${w.name} saved`}
                        />
                      </TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          )}
          <div className="border-t px-4 pt-4">
            <p className="mb-2 text-sm font-medium">Add or set a stock level</p>
            <EntityForm
              layout="inline"
              fields={stockFields(false)}
              initial={{ warehouseId: warehouses[0]?.id, productId: products[0]?.id, onHand: 0, reorderPoint: 0, leadDays: 7 }}
              action={saveStockLevel}
              submitLabel="Save stock level"
              successMessage="Stock level saved"
            />
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Ship cost weightings in the seed: Main Warehouse <Money paise={50000} />, East Depot <Money paise={80000} />.
      </p>
    </div>
  );
}
