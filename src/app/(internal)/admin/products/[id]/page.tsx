// Owner: B. Screen 17, Product and pricelist: general info, subscription flag, variants as
// child products with an extra price, tier price rules.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money, PageHeader, StatusBadge } from "@/components/shared";
import { EntityForm, type FieldDef } from "@/components/admin/entity-form";
import { savePricelistRule, saveProduct } from "@/app/(internal)/actions/admin";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";
import { formatBp } from "@/lib/format";
import { getProductEditor } from "@/services/admin.service";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }] = await Promise.all([params, requireUser(BACKEND_ROLES)]);
  const isNew = id === "new";
  const numericId = isNew ? null : Number(id);
  if (!isNew && !Number.isInteger(numericId)) notFound();
  const { product, categories, tiers, parents, warehouses } = await getProductEditor(numericId);
  if (!isNew && !product) notFound();

  const categoryOptions = categories.map((c) => ({ value: String(c.id), label: c.name }));
  const generalFields: FieldDef[] = [
    { name: "name", label: "Product name", type: "text" },
    { name: "sku", label: "SKU", type: "text" },
    { name: "kind", label: "Subscription?", type: "select", options: [{ value: "GOOD", label: "No, a physical good" }, { value: "SERVICE", label: "No, a service" }, { value: "SUBSCRIPTION", label: "Yes, recurring" }], hint: "Recurring products are billed per plan period; pick the plan on the quotation line." },
    { name: "categoryId", label: "Category", type: "select", options: categoryOptions, hint: "Sets the discount ceiling and the minimum upsell margin." },
    { name: "listPrice", label: "Price", type: "rupees", hint: "Per unit, or per period for a subscription." },
    { name: "cost", label: "Cost", type: "rupees", hint: "Drives the live margin indicator and the upsell margin delta." },
    { name: "unit", label: "Unit", type: "text", placeholder: "Each" },
    { name: "taxBp", label: "Tax", type: "percent" },
    { name: "isPromoted", label: "Currently promoted (ranks higher in upsell)", type: "checkbox" },
    { name: "description", label: "Description", type: "textarea" },
    ...(isNew || product?.parentId ? [{ name: "parentId", label: "Variant of", type: "select" as const, nullable: true, options: parents.filter((p) => p.id !== numericId).map((p) => ({ value: String(p.id), label: p.name })) }, { name: "variantLabel", label: "Variant label", type: "text" as const, placeholder: "16 inch, Black, 8GB" }, { name: "extraPrice", label: "Extra price", type: "rupees" as const }] : []),
  ];
  const variantFields: FieldDef[] = [
    { name: "variantLabel", label: "Attribute value", type: "text", width: "w-40", placeholder: "Blue, 8GB, HP" },
    { name: "sku", label: "SKU", type: "text", width: "w-36" },
    { name: "extraPrice", label: "Extra price", type: "rupees", width: "w-32" },
    { name: "listPrice", label: "Price", type: "rupees", width: "w-32" },
    { name: "cost", label: "Cost", type: "rupees", width: "w-32" },
  ];
  const ruleFields: FieldDef[] = [
    { name: "tierId", label: "Tier", type: "select", width: "w-36", options: tiers.map((t) => ({ value: String(t.id), label: t.name })) },
    { name: "discountBp", label: "Price rule: minus", type: "percent", width: "w-36" },
    { name: "note", label: "Note", type: "text", width: "w-56", nullable: true, placeholder: "Gold price on training" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={isNew ? "New product" : product!.name}
        description={isNew ? "Product details should be filled. A recurring product is invoiced at the beginning of each period." : `${product!.sku} · ${product!.category.name}${product!.parent ? ` · variant of ${product!.parent.name}` : ""}`}
        actions={<Link href="/admin/products" className="text-sm text-muted-foreground hover:text-foreground">Back to catalog</Link>}
      />
      <Card>
        <CardHeader>
          <CardTitle>General Info</CardTitle>
          <CardDescription>Name, category, price, unit, tax and description. The subscription switch reveals the recurring behaviour.</CardDescription>
        </CardHeader>
        <CardContent>
          <EntityForm
            fields={generalFields}
            initial={product ? { ...product, description: product.description ?? "", variantLabel: product.variantLabel ?? "" } : { kind: "GOOD", unit: "Each", taxBp: 1800, categoryId: categories[0]?.id, extraPrice: 0 }}
            hidden={product ? { id: product.id, ...(product.parentId ? {} : { parentId: null, extraPrice: 0 }) } : {}}
            action={saveProduct}
            submitLabel={isNew ? "Create product" : "Save product"}
            successMessage="Product saved"
            redirectTo={isNew ? "/admin/products/:id" : undefined}
            className="lg:grid-cols-3"
          />
        </CardContent>
      </Card>

      {product && !product.parentId ? (
        <Card>
          <CardHeader>
            <CardTitle>Product Variants</CardTitle>
            <CardDescription>Variants are child products with their own SKU and an extra price on top of the parent (Attribute: Values, Extra price).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {product.variants.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Value</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Extra price</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {product.variants.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>
                        <Link href={`/admin/products/${v.id}`} className="font-medium text-primary hover:underline">
                          {v.variantLabel ?? v.name}
                        </Link>
                      </TableCell>
                      <TableCell>{v.sku}</TableCell>
                      <TableCell className="text-right"><Money paise={v.extraPrice} signed /></TableCell>
                      <TableCell className="text-right"><Money paise={v.listPrice} /></TableCell>
                      <TableCell><StatusBadge status={v.archivedAt ? "CANCELLED" : "ACTIVE"} label={v.archivedAt ? "Archived" : "Active"} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No variants yet.</p>
            )}
            <div className="border-t pt-3">
              <EntityForm
                layout="inline"
                fields={variantFields}
                initial={{ listPrice: product.listPrice, cost: product.cost, extraPrice: 0 }}
                hidden={{ parentId: product.id, kind: product.kind, categoryId: product.categoryId, unit: product.unit, taxBp: product.taxBp, name: `${product.name} variant`, isPromoted: false }}
                action={saveProduct}
                submitLabel="Add variant"
                successMessage="Variant created"
                resetOnSuccess
              />
              <p className="mt-1 text-xs text-muted-foreground">The variant is named after the parent plus its value; open it to rename.</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {product ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Pricelists</CardTitle>
              <CardDescription>Tier-based price rules for this product (Currency INR). Without a rule the tier pays list price.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {product.pricelistRules.map((r) => (
                <EntityForm key={r.id} layout="inline" fields={ruleFields} initial={{ ...r, note: r.note ?? "" }} hidden={{ id: r.id, productId: product.id, categoryId: null }} action={savePricelistRule} successMessage="Price rule saved" />
              ))}
              <div className="border-t pt-3">
                <EntityForm layout="inline" fields={ruleFields} initial={{ tierId: tiers[0]?.id }} hidden={{ productId: product.id, categoryId: null }} action={savePricelistRule} submitLabel="Add price rule" successMessage="Price rule created" resetOnSuccess />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{product.kind === "SUBSCRIPTION" ? "Recurring" : "Quantity on hand"}</CardTitle>
              <CardDescription>
                {product.kind === "SUBSCRIPTION"
                  ? "Recurring orders with this product are invoiced at the beginning of each period. Plans are managed under Subscription plans."
                  : "Stock per warehouse; edit under Warehouses and stock."}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {product.kind === "SUBSCRIPTION" ? (
                <ul className="list-disc pl-5">
                  {(product.plans.length ? product.plans : []).map((p) => (
                    <li key={p.id}>{p.name} ({p.interval.toLowerCase()})</li>
                  ))}
                  {product.plans.length === 0 ? <li className="list-none text-muted-foreground">Any plan without a product restriction applies. <Link href="/admin/plans" className="text-primary hover:underline">Manage plans</Link></li> : null}
                </ul>
              ) : (
                <ul className="space-y-1">
                  {warehouses.map((w) => {
                    const s = product.stockLevels.find((l) => l.warehouseId === w.id);
                    return (
                      <li key={w.id} className="flex justify-between">
                        <span>{w.name}</span>
                        <span className="tabular-nums">{s ? `${s.onHand - s.reserved} available (${s.onHand} on hand, ${s.reserved} reserved)` : "no stock row"}</span>
                      </li>
                    );
                  })}
                  <li className="pt-2"><Link href="/admin/warehouses" className="text-primary hover:underline">Edit stock levels</Link></li>
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Ceiling for this category: {product.category.discountCeilingBp === null ? "tier ceiling" : formatBp(product.category.discountCeilingBp)}.</p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
