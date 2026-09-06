# Screen 16 — Product catalog (`/admin/products`, and the `/admin` hub)

## 1. What this screen is

This is where a product is born.

Everything you will later see on a quotation line — the price, the cost, the tax rate, the discount limit — is copied from a row that somebody created on this screen or on Screen 17. Nothing on a quotation is typed by the rep except the quantity and the discount. So if you ever ask "where did this ₹60,000 come from?", the answer is always: a `product` row, created here.

Two pages are covered:

- `/admin` — the hub. Six cards, each a link. No data, just navigation (`src/app/(internal)/admin/page.tsx:9-16`).
- `/admin/products` — the catalog list. Three counters and one table of every product, archived ones included.

The list is read-only. Clicking a row opens Screen 17, which is where you actually edit.

The hub's own strapline states the design rule the whole area exists for: "Everything the deal engine reads at runtime lives in these tables. Nothing is hard-coded." (`src/app/(internal)/admin/page.tsx:22`).

## 2. Who can open it, and who enforces that

| Role | Can open `/admin` and `/admin/products`? | Enforced where |
| --- | --- | --- |
| ADMIN | Yes | `src/middleware.ts:25`, `src/app/(internal)/admin/layout.tsx:7` |
| SALES_MANAGER | Yes | same |
| FINANCE | Yes | same |
| SALES_REP | No — redirected to `/dashboard?forbidden=admin` | `src/middleware.ts:25-30` |
| Not logged in | Redirected to `/login?next=...` | `src/middleware.ts:35-42` |

There are three layers, and they all read the same constant:

1. **Middleware** (`src/middleware.ts:25`): `if (pathname.startsWith("/admin") && !BACKEND_ROLES.includes(role))` → redirect. This runs before any page renders, so no catalogue data is ever streamed to a Sales Rep's browser.
2. **Layout** (`src/app/(internal)/admin/layout.tsx:7`): `await requireUser(BACKEND_ROLES)`. Belt to the middleware's braces.
3. **Page** (`src/app/(internal)/admin/products/page.tsx:14`): `await requireUser(BACKEND_ROLES)` again, per page.

`BACKEND_ROLES` is defined once, at `src/lib/contract.ts:63`:

```ts
export const BACKEND_ROLES: readonly Role[] = ["ADMIN", "SALES_MANAGER", "FINANCE"];
```

The role is never read from the browser. The cookie holds an opaque session token; the role is looked up from the `app_user` row on every single request (`src/middleware.ts:46-49`, `src/lib/auth/internal.ts:1-4`). So demoting somebody takes effect on their next click.

**This is wider than the spec.** The spec (docs/DealFlow360.txt:96-113) describes A2 "Product & Price List Management" as part of the "Sales Backend (Configuration Area)", which in the spec's role model is the Admin's area. The code lets a Sales Manager and a Finance user create products, change list prices and change tax rates too. Only `/admin/users` is narrowed to ADMIN (`src/app/(internal)/admin/users/page.tsx:15`). If you want catalogue setup to be Admin-only, that is a one-line change in `src/app/(internal)/admin/products/page.tsx:14` plus the action's role list at `src/app/(internal)/actions/admin.ts:35`.

The nav tab is hidden for a Sales Rep as well, so they do not see a link they cannot use (`src/lib/nav.ts:17`, `visibleNavItems` at `src/lib/nav.ts:21-23`).

## 3. Everything on the screen, and where each value comes from

Every value on this page comes from one query: `getProducts()` at `src/services/admin.service.ts:270-289`.

| What you see | Example value (seed) | Which query produced it | table.column | How that value came to exist | Where it goes next (FORWARD trace) |
| --- | --- | --- | --- | --- | --- |
| **Product name** | `Laptop 14"` | `admin.service.ts:272-275` | `product.name` | Typed on Screen 17, saved by `saveProduct` (`admin.service.ts:172-197`); seeded at `prisma/seed/a-catalogue.ts:20` | Copied into `quotation_line.description` at `quotation.service.ts:178`. That copy is a **snapshot** — renaming the product later does not rename existing quote lines. |
| "variant of …" under the name | `variant of Laptop 14"` for `Laptop 16"` | `admin.service.ts:274` (`parent: { select: { name: true } }`) | `product.parent_id` → `product.name` | Set when the child product was created with a `parentId` | Nothing downstream reads `parentId`. A variant is just another product on a quote line. |
| **Variants** column | `1 (16 inch)` on `Laptop 14"` | `admin.service.ts:274` (`variants: { select: { id, variantLabel } }`) | `product.parent_id` (reverse), `product.variant_label` | Child rows created via the "Add variant" form on Screen 17 | Display only. |
| **Price** | `₹60,000.00` | `admin.service.ts:272` | `product.list_price` = `6000000` paise | Typed as rupees on Screen 17 and multiplied by 100 by the form (`entity-form.tsx:59`) | **The origin of `quotation_line.unit_price`.** See §"The origin story" below. |
| `/period` suffix | on `Support Basic` | `products/page.tsx:29` | derived from `product.kind === "SUBSCRIPTION"` | Chosen in the "Subscription?" select on Screen 17 | `kind` decides `quotation_line.line_type` = `RECURRING` (`quotation.service.ts:176`) and whether a `RecurringPlan` must be picked (`quotation.service.ts:139-147`). |
| **Unit** | `Each`, `Visit`, `Day`, `Seat / month` | `admin.service.ts:272` | `product.unit` | Typed on Screen 17; default `"Each"` (`prisma/schema.prisma:327`, `validation/admin.ts:79`) | Shown in the quote builder's product picker (`quotes/[publicId]/page.tsx:95`). Never stored on the line. |
| **Tax** | `18%` | `products/page.tsx:31`, `formatBp` at `src/lib/format.ts:46-49` | `product.tax_bp` = `1800` | Typed as a percent on Screen 17, ×100 by the form | **Copied to `quotation_line.tax_bp`** at `quotation.service.ts:182`. That snapshot then drives `tax` in `computeTotals` (`src/domain/totals.ts`). |
| **Status** | `Active` / `Archived` | `products/page.tsx:32` | derived: `product.archived_at IS NULL` | Nothing in the app sets `archivedAt` — see Gotchas | Archived products are excluded from the quote builder's picker (`quotes/[publicId]/page.tsx:88`) and from the warehouse/plan pickers (`admin.service.ts:252,260`). |
| **Category** | `Hardware` | `admin.service.ts:274` (`category: { select: { name: true } }`) | `product.category_id` → `product_category.name` | Category rows are created on Screen 18; seeded at `prisma/seed/a-catalogue.ts:9-17` | The category carries `discount_ceiling_bp` and `min_margin_bp`. The ceiling becomes half of `quotation_line.ceiling_bp` (`quotation.service.ts:151-152`); the min margin filters upsell suggestions (`upsell.service.ts:80`). |
| `recurring` tag next to the category | on `Support Basic` | `products/page.tsx:33` | derived from `kind` | — | — |
| `promoted` tag | on `Support Pro` | `products/page.tsx:33` | `product.is_promoted` = `true` | Checkbox on Screen 17; seeded at `prisma/seed/a-catalogue.ts:51` | Adds `PROMO_BOOST = 5` to the upsell ranking score (`upsell.service.ts:24,76`). |
| Tile **Total Products** | `8` (clean seed) | `admin.service.ts:282` | count of `product` where `archived_at IS NULL` | computed in JS from the same `findMany` | — |
| its caption | `8 active, 0 archived` | `admin.service.ts:282-283` | same | — | — |
| Tile **Pricelists** | `2` (clean seed) | `admin.service.ts:276` `prisma.pricelistRule.count()` | `COUNT(pricelist_rule)` | Rules added on Screen 17; seeded at `prisma/seed/a-catalogue.ts:55-60` | Each rule can become `quotation_line.pricelist_rule_id` (`quotation.service.ts:185`). |
| its caption | `3 tiers, 1 currency (INR)` | `admin.service.ts:277` `prisma.customerTier.count()`; the "1 currency (INR)" text is hardcoded at `products/page.tsx:53` | `COUNT(customer_tier)` | Tiers created on Screen 18 | — |
| Tile **Variants** | `1` (clean seed: `Laptop 16"`) | `admin.service.ts:286` | count of `product` where `parent_id IS NOT NULL` | — | — |
| Row click target | `/admin/products/17` | `products/page.tsx:56` `rowHref` | `product.id` | — | Opens Screen 17. |
| "New Product" button | → `/admin/products/new` | `products/page.tsx:45-47` | — | — | Screen 17 in create mode. |
| "Manage Price fields" button | → `/admin/tiers` | `products/page.tsx:42-44` | — | — | Screen 18. |

**Live-database warning.** The dev database currently holds test leftovers from earlier agent runs — 44 products, extra tiers named `TierT adm…`, `Platinum mtom…`, warehouses called `MX Depot` and `Smoke Depot`. Ignore those numbers. Every example above uses the seed (`prisma/seed/`), which is what a fresh `pnpm db:seed` gives you.

### THE ORIGIN STORY — a product row becomes a quotation line

This is the single most important trace in the app. A rep adds `Laptop 14"` to a quote for a Gold customer. Here is every copy, with the exact function:

| Source (created on this screen / Screen 17) | Function that copies it | Destination on the quote |
| --- | --- | --- |
| `product.list_price` = `6000000` | `addLine` — `quotation.service.ts:150`: `const unitPrice = rule ? applyDiscount(product.listPrice, rule.discountBp) : product.listPrice;` then written at `:180` | `quotation_line.unit_price` |
| `product.cost` = `4200000` | `addLine` — `quotation.service.ts:181`: `unitCost: product.cost` | `quotation_line.unit_cost` |
| `product.tax_bp` = `1800` | `addLine` — `quotation.service.ts:182`: `taxBp: product.taxBp` | `quotation_line.tax_bp` |
| `product.name` | `quotation.service.ts:178`: `description: product.name` | `quotation_line.description` |
| `product_category.discount_ceiling_bp` **combined with** `customer_tier.discount_ceiling_bp` | `addLine` — `quotation.service.ts:151-152`: `const ceilingBp = product.category.discountCeilingBp === null ? tier.discountCeilingBp : Math.min(tier.discountCeilingBp, product.category.discountCeilingBp);` written at `:184` | `quotation_line.ceiling_bp` |
| the winning `pricelist_rule.id` | `quotation.service.ts:185`: `pricelistRuleId: rule?.id ?? null` | `quotation_line.pricelist_rule_id` (the receipt for why the price is what it is) |

The same six copies happen again when the rep changes the customer on an existing quote — `setCustomer` re-prices every line from the new tier (`quotation.service.ts:106-111`). Note that `setCustomer` re-writes `unitPrice`, `ceilingBp` and `pricelistRuleId`, but **not** `unitCost` or `taxBp`; those keep their original snapshot.

The pure equivalent of the ceiling rule also exists in the domain layer: `lineCeilingBp` at `src/domain/risk.ts:60-62`.

**Snapshot, not a live link.** After the line exists, changing the product's price on Screen 17 does *not* change the quote. `recompute` (`quotation.service.ts:349-393`) reads `l.unitPrice`, `l.unitCost`, `l.taxBp`, `l.ceilingBp` from the **line**, never from the product. That is deliberate: a quote sent to a customer must not silently re-price itself. The consequence is covered in Scenario 4 below.

## 4. The queries this page runs

`getProducts()` — `src/services/admin.service.ts:270-289`. Three queries in one `Promise.all`:

```ts
prisma.product.findMany({
  orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  include: { category: { select: { name: true } },
             variants: { select: { id: true, variantLabel: true } },
             parent:   { select: { name: true } } },
})
prisma.pricelistRule.count()
prisma.customerTier.count()
```

Notes:

- **No `where`.** Archived products are listed too, sorted first (`archivedAt: "asc"` puts NULLs first in Postgres by default, so active rows lead).
- The three tiles are computed in JavaScript from the array already in memory (`admin.service.ts:281-288`), not by separate `COUNT` queries.
- The page is a server component with no caching directive, so it re-runs on every request. `revalidatePath("/admin/products")` after a save (`actions/admin.ts:52,76`) is what refreshes it after an edit on Screen 17.

`/admin` itself runs **no** query at all — its six cards are a hardcoded array (`src/app/(internal)/admin/page.tsx:9-16`).

## 5. Every condition on this page

| Condition | Where | What happens |
| --- | --- | --- |
| Role not in `BACKEND_ROLES` | `src/middleware.ts:25` | Redirect to `/dashboard?forbidden=admin` |
| No session / expired / user deactivated | `src/middleware.ts:46-49` | Redirect to `/login?next=/admin/products` |
| `p.parent` is set | `products/page.tsx:24` | Second line under the name: "variant of X" |
| `p.variants.length` is 0 | `products/page.tsx:28` | Variants column shows `–` |
| `p.variants.length` > 0 | `products/page.tsx:28` | `"1 (16 inch)"` — count plus the labels joined with commas |
| a variant has a null `variantLabel` | `products/page.tsx:28` | prints `?` for that one |
| `p.kind === "SUBSCRIPTION"` | `products/page.tsx:29,33` | `/period` after the price, `recurring` after the category |
| `p.isPromoted` | `products/page.tsx:33` | blue `promoted` tag |
| `p.archivedAt` is set | `products/page.tsx:32` | Status badge switches from `Active` to `Archived` |
| the product list is empty | `products/page.tsx:56` | EmptyState: "No products yet — Create the first product." |

## 6. Every action you can take here

There are only two, and both are links — this page writes nothing.

| Control | Where it goes |
| --- | --- |
| "+ New Product" | `/admin/products/new` (`products/page.tsx:45`) — Screen 17 in create mode |
| "Manage Price fields" | `/admin/tiers` (`products/page.tsx:42`) — Screen 18 |
| any table row | `/admin/products/<id>` (`products/page.tsx:56`) — Screen 17 in edit mode |
| the "Pricelists" tile | `/admin/tiers` (`products/page.tsx:53`, `StatTile href`) |

Because there is no form here, there is no Zod schema, no service call and no audit row from this page. Every write lives on Screen 17. The `percent`/`rupees` conversion behaviour of `EntityForm` is documented in Screen 17 §6, since that is where the forms are.

## 7. Scenarios

These eight walkthroughs cover this screen group (16, 17, 18, 18b). Each names the code path.

### Scenario 1 — Creating a product

1. `/admin/products` → "+ New Product" → `/admin/products/new`.
2. `getProductEditor(null)` runs (`admin.service.ts:291-312`). `product` is `null`, so the form gets defaults: `{ kind: "GOOD", unit: "Each", taxBp: 1800, categoryId: categories[0].id, extraPrice: 0 }` (`products/[id]/page.tsx:67`).
3. You type: name `Laptop 13"`, SKU `HW-LAP-13`, category `Hardware`, Price `52000`, Cost `36000`, Unit `Each`, Tax `18`.
4. On submit, `toInput` (`entity-form.tsx:52-64`) converts: `listPrice` `"52000"` → `5200000` paise (`:59`, ×100), `cost` → `3600000`, `taxBp` `"18"` → `1800` (`:59`, the same ×100 because bp is percent×100).
5. `saveProduct` action (`actions/admin.ts:75-77`) → `run()` (`:30-47`) → `parseInput(productSchema, …)` (`validation/admin.ts:72-87`) → `requireActionUser(BACKEND_ROLES)` → `admin.saveProduct` (`admin.service.ts:172-197`).
6. `saveRow` (`admin.service.ts:25-48`) opens a transaction, sees `input.id` is undefined, calls `tx.product.create`, then `audit(tx, { entityType: "Product", action: "CREATE", … })` in the **same** transaction (`:37-45`). One commit; if the insert fails the audit row rolls back too.
7. `revalidatePath("/admin/products")` and `/admin` (`actions/admin.ts:52,42`), then the form redirects to `/admin/products/<newId>` (`products/[id]/page.tsx:72`).
8. The product now appears in the rep's product picker on the next quote page load (`quotes/[publicId]/page.tsx:88`).

### Scenario 2 — Adding a variant

1. Open `Laptop 14"` (`/admin/products/1`). Because it has no `parentId`, the "Product Variants" card renders (`products/[id]/page.tsx:78`).
2. The inline form has five visible fields: Attribute value, SKU, Extra price, Price, Cost (`products/[id]/page.tsx:39-45`). Everything else is **hidden** and copied from the parent (`:120`): `parentId`, `kind`, `categoryId`, `unit`, `taxBp`, `name: "Laptop 14\" variant"`, `isPromoted: false`.
3. You type value `16 inch`, SKU `HW-LAP-16`, Extra price `15000`, Price `75000`, Cost `52500`.
4. Same `saveProduct` action. A **new `product` row** is inserted, with `parent_id = 1`, `variant_label = "16 inch"`, `extra_price = 1500000`.
5. It appears in the parent's Variants table (`products/[id]/page.tsx:97-109`) and as its own row on Screen 16.
6. Its name is literally `Laptop 14" variant` until you open it and rename it — the page tells you so (`products/[id]/page.tsx:126`).

**The important point:** `extraPrice` is decoration. `listPrice` is the price. Nothing anywhere adds `extraPrice` to `listPrice` — `addLine` reads `product.listPrice` only (`quotation.service.ts:150`). Grep confirms `extraPrice` appears only in the admin pages, the schema, and the seed. See Screen 17 §10.

### Scenario 3 — A product-scoped price rule beating a category rule

Setup on the Gold tier (`customer_tier.id = 3`, ceiling 1500 bp):

- Rule A, tier-wide: `tierId=3, categoryId=null, productId=null, discountBp=500` (5%).
- Rule B, category: `tierId=3, categoryId=1 (Hardware), productId=null, discountBp=1000` (10%).
- Rule C, product: `tierId=3, categoryId=null, productId=1 (Laptop 14"), discountBp=1500` (15%).

Rules B and C are added on Screen 17 (product-scoped, `categoryId` forced to null at `products/[id]/page.tsx:141,144`); a category-scoped rule has no admin form and would have to be seeded or inserted directly — see Screen 17 §10.

Now a rep adds `Laptop 14"` for a Gold customer. `bestPricelistRule` runs (`quotation.service.ts:413-419`):

```ts
const rules = await tx.pricelistRule.findMany({
  where: { tierId, OR: [{ productId }, { productId: null, categoryId }, { productId: null, categoryId: null }] },
});
const rank = (r) => (r.productId ? 0 : r.categoryId ? 1 : 2);
return rules.sort((a, b) => rank(a) - rank(b))[0] ?? null;
```

All three match. Rank: C = 0, B = 1, A = 2. Sorted ascending, **C wins**.

Worked numbers: `applyDiscount(6000000, 1500)` (`src/domain/money.ts:124`) = `6000000 - pct(6000000, 1500)` = `6000000 - 900000` = `5100000` paise = **₹51,000**, written to `quotation_line.unit_price` (`quotation.service.ts:180`), and `pricelist_rule_id` = C's id (`:185`).

Delete C and re-add the line: B wins, `6000000 - 600000` = `5400000` = ₹54,000. Delete B too: A wins, ₹57,000. Delete all three: `rule` is `null`, so `unitPrice = product.listPrice` = ₹60,000 (`quotation.service.ts:150`).

The seed only ships product-scoped rules on `Training Day`: Gold 10% and Silver 5% (`prisma/seed/a-catalogue.ts:55-60`), so Gold pays `1500000 - 150000 = 1350000` = **₹13,500** for a ₹15,000 training day. Bronze has no rule and pays list.

Two things `bestPricelistRule` does **not** do: it ignores `currency` entirely (the column exists, defaults `"INR"`, `prisma/schema.prisma:362`, and is never read), and ties within the same rank are broken by whatever order Postgres returned — `Array.prototype.sort` is stable, so effectively the lowest id wins, but nothing enforces uniqueness.

### Scenario 4 — Raising a category ceiling and re-rating a quote

Start: `Services` category ceiling is 1000 bp (10%). A Gold customer (tier ceiling 1500) has a quote with `Setup Service` at a 12% line discount. The line's `ceiling_bp` was snapshotted as `min(1500, 1000) = 1000` (`quotation.service.ts:151-152`). Overage = `1200 - 1000` = 200 bp, so `needsReview` is true (`src/domain/route.ts:7-9`) and the quote routes to a Sales Manager.

You go to `/admin/tiers` and raise the Services ceiling to 15% (typed `15` → `1500` bp by `entity-form.tsx:59`).

**What happens next is the part people get wrong.** The existing line does **not** re-rate. `recompute` reads `ceilingBp` from the line, not from the category (`quotation.service.ts:364`). So the quote still shows a 200 bp overage even after you edited it, and re-confirming still routes it to a manager.

Two things do re-snapshot the ceiling:

- **Removing and re-adding the line** — `addLine` recomputes it (`quotation.service.ts:151`).
- **Changing the customer** — `setCustomer` loops every line and rewrites `ceilingBp` (`quotation.service.ts:106-111`). Re-selecting the *same* customer works: `setCustomer` does not short-circuit when the customer is unchanged.

After either, `ceiling_bp` becomes `min(1500, 1500) = 1500`, the 12% discount is inside the limit, `needsReview` returns false, and `routeApproval` returns `[]` (`src/domain/route.ts:29`) — the next confirm approves straight away.

Contrast this with the risk weights and the approval rules, which **are** read live on every recompute (Scenario 5). Ceilings are snapshotted; routing is not.

### Scenario 5 — Adding an approval rule and watching the chain lengthen

Seeded rules (`prisma/seed/b-governance.ts:85-97`):

| seq | name | minScore | maxWorstOverageBp | maxOrderTotal | chain |
| --- | --- | --- | --- | --- | --- |
| 1 | Over limit | 1 | null | null | `["SALES_MANAGER"]` |
| 2 | High risk or large order | 50 | 1000 | 100000000 (₹10,00,000) | `["SALES_MANAGER","FINANCE"]` |

A quote scores 30 with a worst overage of 400 bp and a total of ₹3,00,000. `ruleFires` (`src/domain/route.ts:12-18`): rule 1 fires (`30 >= 1`); rule 2 does not (`30 < 50`, `400 <= 1000`, `30000000 <= 100000000`). `routeApproval` takes the **longest** chain among the fired rules (`src/domain/route.ts:33`) → `["SALES_MANAGER"]`. One approval step.

Now on `/admin/tiers` you add rule 3: name "Any overage needs Finance too", `minScore` 1, chain `Sales manager` + `Finance`, Active ticked. `saveApprovalRule` (`admin.service.ts:76-95`) writes `chain` as a JSON array (`prisma/schema.prisma:401`).

Re-open the quote and touch a line. `recompute` calls `loadRoutingRules(tx)` (`quotation.service.ts:362`), which is:

```ts
const rows = await tx.approvalRule.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } });
```

(`quotation.service.ts:428-437`.) It reads the table **on every recompute and every confirm**. No cache, no module-level constant, no server restart. Rule 3 fires, its chain has length 2, so it beats rule 1's length 1, and the chain becomes `["SALES_MANAGER","FINANCE"]`. Confirm now creates two `approval_step` rows instead of one.

**This is the concrete proof of the spec's "nothing is hard-coded" requirement** (docs/DealFlow360.txt:117-127). The only hardcoded chain in the codebase is a safety net for when an admin has deleted every rule: `FALLBACK_CHAIN = ["SALES_MANAGER"]` at `src/domain/route.ts:21`, used only if an over-limit quote finds no chain at all (`:34`).

### Scenario 6 — Risk weights that do not sum to 100

On `/admin/tiers`, the Risk configuration card. You set `wWorst` 60, `wBlended` 40, `wMargin` 10 (= 110) and press Save.

Two guards catch it, in this order:

1. **Zod, in the action.** `riskConfigSchema` ends with `.refine((v) => v.wWorst + v.wBlended + v.wMargin === 100, { path: ["wWorst"], message: "Weights must add up to 100" })` (`validation/admin.ts:42`). `parseInput` (`contract.ts:86-95`) turns that into `fieldErrors: { wWorst: ["Weights must add up to 100"] }`, the action returns before any database call (`actions/admin.ts:37-38`), and `EntityForm` paints the message red under the first weight field (`entity-form.tsx:100-103,211`).
2. **Postgres, if you ever bypass the form.** `ALTER TABLE "risk_config" ADD CONSTRAINT "risk_config_weights_sum_100" CHECK ("w_worst" + "w_blended" + "w_margin" = 100)` (`prisma/migrations/20260905095100_init/migration.sql:1047`). If it fires, `fromDatabaseError` (`contract.ts:146-150`) matches the constraint name suffix `weights_sum_100` against `CHECK_MESSAGES` (`contract.ts:128`) and returns the friendly "Risk weights must add up to 100" instead of a raw Postgres error.

There is a sibling constraint keeping the table a singleton: `CHECK ("id" = 1)` (`migration.sql:1046`). `saveRiskConfig` upserts on `id: 1` unconditionally (`admin.service.ts:98-103`), so there can only ever be one row.

### Scenario 7 — Setting on-hand below reserved

`Laptop 14"` at `Main Warehouse`: `on_hand = 6`, `reserved = 4` (4 units held by an accepted fulfilment plan). Available shows `2` (`warehouses/page.tsx:82`, computed as `s.onHand - s.reserved`).

You type `3` into On hand and save.

`saveStockLevel` (`admin.service.ts:120-148`) reads the existing row first and checks:

```ts
if (before && input.onHand < before.reserved) {
  throw new ValidationError("On hand cannot go below the quantity already reserved",
    { onHand: [`${before.reserved} units are reserved for confirmed orders`] });
}
```

(`admin.service.ts:124-126`.) `toActionError` (`contract.ts:158`) turns it into a field error, and the red text appears under the On hand input.

Type `5` instead and it succeeds. Then, in the same transaction (`admin.service.ts:127-145`):

- the `stock_level` row is upserted to `on_hand = 5`;
- `delta = 5 - 6 = -1`, so a `stock_move` row is written with `type: "ADJUST"`, `qty: 1`, `note: "Admin set on hand to 5"`, `createdById: <you>` (`admin.service.ts:132-137`);
- an audit row is written with before `{ onHand: 6, reorderPoint: 4, leadDays: 7 }` and after `{ warehouseId, productId, onHand: 5, … }` (`:138-145`).

A positive delta writes `type: "RECEIPT"` instead. **Every level in the grid is explained by the ledger** — that is the whole point of writing a move on an admin edit rather than just updating the number.

Postgres backs this up independently: `CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand")` (`migration.sql:1036`), mapped to the friendly message at `contract.ts:125`.

### Scenario 8 — Creating a plan and attaching it to a subscription product

1. `/admin/plans` → the "Add plan" row. Name `Half-yearly`, Cycle `Quarterly`, Schedule periods `2`, Proration `Day based`, Bill the change day ticked, Cancellation `End of period`, Refund as `Credit note`, Limited to product `Support Pro`.
2. `savePlan` (`actions/admin.ts:72-74` → `admin.service.ts:150-170`) inserts a `recurring_plan` row through `saveRow`, with the audit row in the same transaction.
3. The `productId` select only offers subscription products — `getPlans()` filters `kind: "SUBSCRIPTION"` (`admin.service.ts:260`).
4. Now a rep adds `Support Pro` to a quote. `addLine` sees `kind === "SUBSCRIPTION"` (`quotation.service.ts:136`) and resolves a plan in this order (`:139-145`): the plan the rep explicitly picked → else `product.plans[0]` (plans whose `productId` points at this product, lowest id first, `quotation.service.ts:132`) → else the lowest-id plan with `productId: null` (a plan not restricted to any product). If none of those exist, it throws "Pick a recurring plan for this subscription product".
5. `planId` is stored on the line (`quotation.service.ts:175`) and `line_type` becomes `RECURRING` (`:176`).
6. On confirm, `billing.service.ts:67` calls `buildSchedule(today, line.plan.interval, line.plan.periods, line.net, line.taxBp)` — your `QUARTER` and `2` become two `billing_schedule` rows, and the first period is invoiced immediately (`billing.service.ts:97-100`).
7. Later, a mid-cycle quantity change reads `sub.plan.prorationMode` and `sub.plan.billChangeDay` (`subscription.service.ts:38-39`), and a cancellation reads `sub.plan.cancelPolicy` (`:146`) and `sub.plan.refundMethod` (`:158`).

### Scenario 9 — Changing a user's role

1. `/admin/users`. This page alone is `requireUser(["ADMIN"])` (`users/page.tsx:15`) — a Sales Manager who reaches `/admin` cannot open it and is redirected to `/dashboard?forbidden=1` (`auth/internal.ts:78`).
2. Change `Riya Rao` from `Sales Rep` to `Sales Manager`, press Save.
3. `setUserRole` action (`actions/admin.ts:81-83`) — note the last argument: `["ADMIN"]`, overriding the default `BACKEND_ROLES` (`actions/admin.ts:35`). So even the action is Admin-only.
4. `admin.setUserRole` (`admin.service.ts:213-229`) loads the user, refuses self-management (`if (input.managerId === input.userId)` → "A user cannot be their own manager", `:217`), updates `role` and `manager_id`, and writes an audit row with `action: "ROLE_CHANGE"`, before `{ role, managerId }`, after `{ role, managerId }` (`:219-226`).
5. Riya's very next click uses the new role: the middleware re-reads `user.role` from the database per request (`src/middleware.ts:47`), and so does `getSessionUser`. She does not have to log out.

## 8. Schema behind this screen

`prisma/schema.prisma:320-354`:

```prisma
model Product {
  id           Int         @id @default(autoincrement())
  sku          String      @unique
  name         String
  description  String?
  kind         ProductKind          // GOOD | SERVICE | SUBSCRIPTION
  categoryId   Int         @map("category_id")
  unit         String      @default("Each")
  listPrice    Int         @map("list_price")   // paise, per unit (per period for subscriptions)
  cost         Int                              // paise, per unit
  taxBp        Int         @default(1800) @map("tax_bp")
  isPromoted   Boolean     @default(false) @map("is_promoted")
  parentId     Int?        @map("parent_id")    // variant of this product
  variantLabel String?     @map("variant_label")
  extraPrice   Int         @default(0) @map("extra_price")
  archivedAt   DateTime?   @map("archived_at")
  ...
}
```

Table name is `product` (`@@map`). Indexes on `category_id` and `parent_id` (`:350-351`). `sku` is unique — a duplicate SKU comes back through Prisma error `P2002` and is turned into "A record with this value already exists" with a field error on `sku` (`contract.ts:140-143`).

CHECK constraints on this table (`prisma/migrations/20260905095100_init/migration.sql:1017-1018`):

```sql
ALTER TABLE "product" ADD CONSTRAINT "product_tax_bp_range"        CHECK ("tax_bp" BETWEEN 0 AND 10000);
ALTER TABLE "product" ADD CONSTRAINT "product_prices_non_negative" CHECK ("list_price" >= 0 AND "cost" >= 0 AND "extra_price" >= 0);
```

Self-relation for variants: `parent Product? @relation("ProductVariant", fields: [parentId], references: [id])` and `variants Product[] @relation("ProductVariant")` (`schema.prisma:340-341`). There is **no** depth limit — nothing stops a variant of a variant, though the editor only offers top-level products as parents (`admin.service.ts:308`, `where: { parentId: null }`).

## 9. How this screen connects to the others

- **→ Screen 17** (`/admin/products/[id]`): clicking any row. The list is read; the detail is write.
- **→ Screen 18** (`/admin/tiers`): the "Manage Price fields" button and the Pricelists tile. The `category` shown in this table is defined there, with its ceiling and min-margin.
- **→ Screen 4, the quote builder**: the product picker is the same catalogue, filtered to `archivedAt: null` (`quotes/[publicId]/page.tsx:88`). Everything a product row holds is copied onto the line by `addLine` (`quotation.service.ts:127-197`).
- **→ Screen 4, the upsell rail**: `isPromoted` and the category's `minMarginBp` decide what appears (`upsell.service.ts:56,76,80`).
- **→ Screen 7/8, fulfillment**: only `kind === "GOOD"` lines need stock (`fulfillment.service.ts:33`).
- **→ Screen 9/10, subscriptions**: only `kind === "SUBSCRIPTION"` lines create a `Subscription` (`billing.service.ts:66`).
- **→ Screen 18b** (`/admin/warehouses`): the stock grid is keyed by these products, filtered to `kind: "GOOD"` (`admin.service.ts:252`).

## 10. Gotchas

1. **Nothing here archives a product.** `archivedAt` is displayed (`products/page.tsx:32`) and filtered on in six queries, but grep finds no code that ever *sets* it. There is no Archive button and no delete. To retire a product today you would have to update the row by hand in SQL. The Status column will therefore always read "Active" in the running app.

2. **The "1 currency (INR)" caption is a literal string** (`products/page.tsx:53`), not a query. `pricelist_rule.currency` exists and defaults to `"INR"` (`schema.prisma:362`) but is never read by any code path — `bestPricelistRule` does not filter on it (`quotation.service.ts:414-415`). The mockup's "USD / USD/EUR" columns are not implemented; the app is single-currency.

3. **The Variants count in the tile counts child products, not attribute values.** The mockup's "340 SKUs across all products" and "3(size)" style captions imply an attribute matrix. The code has none — see Screen 17 §10.

4. **`admin.service.ts` has no role guard of its own.** Read the file top to bottom: not one function checks `user.role`. Every export takes a `SessionUser` and trusts it. Enforcement is entirely at the middleware (`src/middleware.ts:25`), the layout (`admin/layout.tsx:7`), the page (`products/page.tsx:14`) and the action (`actions/admin.ts:40`). If anything ever calls `admin.saveProduct(input, salesRepSession)` directly — another service, a script, a future API route — it succeeds and writes an audit row attributing the change to that Sales Rep. Compare `subscription.service.ts:17`, which *does* guard in the service (`if (!OPS_ROLES.includes(user.role)) throw new ForbiddenError(...)`). The admin service is the inconsistent one.

5. **Products created here are immediately live.** There is no draft or publish step. The moment `saveProduct` commits, the product is in every rep's picker on the next page load.

6. **The dev database is polluted.** Counts on this screen will not match the seed: earlier test runs left ~44 products, extra categories (`CatA adm…`), tiers (`TierT adm…`, `Platinum mtom…`) and warehouses (`MX Depot`, `Smoke Depot`). Only rows from `prisma/seed/` are trustworthy examples.
