// Owner: B. Screen 16, Product catalog (PDF A2): every product, variant and price list in one place.
import Link from "next/link";
import { Package, Plus, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Money, PageHeader, StatTile, StatusBadge, type Column } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";
import { formatBp } from "@/lib/format";
import { getProducts } from "@/services/admin.service";

export const metadata = { title: "Products" };

const INTERVAL_UNIT: Record<string, string> = { WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year" };

export default async function ProductsPage() {
  await requireUser(BACKEND_ROLES);
  const { products, tiles } = await getProducts();
  type Row = (typeof products)[number];
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Product name",
      cell: (p) => (
        <span>
          <span className="font-medium">{p.name}</span>
          {p.parent ? <span className="block text-xs text-muted-foreground">variant of {p.parent.name}</span> : null}
        </span>
      ),
    },
    { key: "variants", header: "Variants", cell: (p) => (p.variants.length ? `${p.variants.length} (${p.variants.map((v) => v.variantLabel ?? "?").join(", ")})` : "–") },
    { key: "price", header: "Price", align: "right", cell: (p) => <span><Money paise={p.listPrice} />{p.isSubscription ? <span className="text-xs text-muted-foreground">/{INTERVAL_UNIT[p.recurringInterval ?? "MONTH"]}</span> : null}</span> },
    { key: "unit", header: "Unit", cell: (p) => p.unit },
    { key: "tax", header: "Tax", align: "right", cell: (p) => formatBp(p.taxBp) },
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.archivedAt ? "CANCELLED" : "ACTIVE"} label={p.archivedAt ? "Archived" : "Active"} /> },
    { key: "category", header: "Category", cell: (p) => <span>{p.category.name}{p.isSubscription ? <span className="ml-1 text-xs text-muted-foreground">subscription</span> : null}{p.isPromoted ? <span className="ml-1 text-xs text-info">promoted</span> : null}</span> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Product catalog"
        description="Every product, variant and price list in one place. Click a product row to open general info, variants and tier price lists."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/admin/tiers" />}>
              <Tags /> Manage Price fields
            </Button>
            <Button nativeButton={false} render={<Link href="/admin/products/new" />}>
              <Plus /> New Product
            </Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total Products" value={tiles.active} caption={`${tiles.active} active, ${tiles.archived} archived`} />
        <StatTile label="Pricelists" value={tiles.pricelistRules} caption={`${tiles.tiers} tiers, 1 currency (INR)`} href="/admin/tiers" />
        <StatTile label="Variants" value={tiles.variants} caption="child products with an extra price" />
      </div>
      <DataTable columns={columns} rows={products} rowKey={(p) => p.id} rowHref={(p) => `/admin/products/${p.id}`} empty={<EmptyState icon={Package} title="No products yet" description="Create the first product." />} />
    </div>
  );
}
