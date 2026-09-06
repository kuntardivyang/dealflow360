# Screen 17 — Product and pricelist (`/admin/products/[id]`)

## 1. What this screen is

The one screen in the whole application where a product's price, cost, tax and discount behaviour are actually written. Screen 16 lists; this one edits.

The same route serves two modes:

- `/admin/products/new` — create. `isNew` is true (`src/app/(internal)/admin/products/[id]/page.tsx:19`), only the General Info card renders, and a successful save redirects to the new id (`:72`).
- `/admin/products/17` — edit. Four cards: General Info, Product Variants (top-level products only), Pricelists, and either "Quantity on hand" or "Recurring".

If the id is neither `"new"` nor an integer, or the product does not exist, the page 404s (`:21`, `:23`).

Everything you save here is what a quotation line will be built from tomorrow. See Screen 16 §3 "THE ORIGIN STORY" for the six-column trace; this file explains the forms that produce those values.

## 2. Who can open it, and who enforces that

| Role | Can open? | Enforced where |
| --- | --- | --- |
| ADMIN | Yes | `src/middleware.ts:25`, `src/app/(internal)/admin/layout.tsx:7`, `products/[id]/page.tsx:18` |
| SALES_MANAGER | Yes | same |
| FINANCE | Yes | same |
| SALES_REP | No — `/dashboard?forbidden=admin` | `src/middleware.ts:25-30` |

`BACKEND_ROLES = ["ADMIN", "SALES_MANAGER", "FINANCE"]` (`src/lib/contract.ts:63`).

The two server actions this page calls carry the same list. `run(...)` defaults `roles` to `BACKEND_ROLES` (`src/app/(internal)/actions/admin.ts:35`) and calls `requireActionUser(roles)` (`:40`), which throws `ForbiddenError` rather than redirecting (`src/lib/auth/internal.ts:85-90`). So a Sales Rep who replays the POST gets `{ ok: false, code: "FORBIDDEN" }`, not a product.

**Wider than the spec.** Spec A2 (docs/DealFlow360.txt:110-114) puts product and price-list management in the Admin configuration area. Here a Sales Manager or a Finance user can change any product's list price, cost, tax rate and tier price rules. Nothing in the code narrows it.

## 3. Everything on the screen, and where each value comes from

One query feeds the whole page: `getProductEditor(numericId)` at `src/services/admin.service.ts:291-312`.

### Card 1 — General Info (`products/[id]/page.tsx:59-76`)

Field list at `:26-38`. Initial values at `:67`; hidden values at `:68`.

| What you see | Example value (seed) | Which query produced it | table.column | How it came to exist | FORWARD trace |
| --- | --- | --- | --- | --- | --- |
| Product name | `Laptop 14"` | `admin.service.ts:295` | `product.name` | typed here | → `quotation_line.description` (`quotation.service.ts:178`) |
| SKU | `HW-LAP-14` | same | `product.sku` | typed here; `@unique` | not copied anywhere; used for display in the warehouse picker (`warehouses/page.tsx:24`) |
| Subscription? (a 3-way select) | `No, a physical good` | same | `product.kind` | select at `:29`, options `GOOD` / `SERVICE` / `SUBSCRIPTION` | decides `quotation_line.line_type` (`quotation.service.ts:176`), whether a plan is required (`:136-147`), whether the line needs stock (`fulfillment.service.ts:33`), and whether confirm creates a `Subscription` (`billing.service.ts:66`) |
| Category | `Hardware` | `admin.service.ts:306` (`productCategory.findMany` ordered by `sortOrder`) | `product.category_id` | rows created on Screen 18 | the category's `discount_ceiling_bp` is one half of `quotation_line.ceiling_bp` (`quotation.service.ts:151-152`); its `min_margin_bp` filters upsell suggestions (`upsell.service.ts:80`) |
| Price (₹) | `60,000` shown; `6000000` stored | `admin.service.ts:295` | `product.list_price` (paise) | typed in rupees, ×100 by the form (`entity-form.tsx:59`) | **→ `quotation_line.unit_price`** via `addLine` (`quotation.service.ts:150,180`), after the winning pricelist rule is applied |
| Cost (₹) | `42,000` shown; `4200000` stored | same | `product.cost` | same conversion | **→ `quotation_line.unit_cost`** (`quotation.service.ts:181`), which drives `costTotal`, `marginBp` (`src/domain/totals.ts:27`) and the upsell margin delta (`upsell.service.ts:72`) |
| Unit | `Each` | same | `product.unit` | typed; default `"Each"` | shown in the rep's product picker (`quotes/[publicId]/page.tsx:95`); never stored on a line |
| Tax (%) | `18` shown; `1800` stored | same | `product.tax_bp` | typed as percent, ×100 (`entity-form.tsx:59`) | **→ `quotation_line.tax_bp`** (`quotation.service.ts:182`) |
| "Currently promoted" checkbox | unticked (`Support Pro` is ticked) | same | `product.is_promoted` | checkbox at `:35` | `+5` to the upsell score (`upsell.service.ts:24,76`) |
| Description | `14 inch business laptop` | same | `product.description` | textarea at `:36` | **read by nothing.** Grep finds no consumer. |
| "Variant of" select | only shown when creating, or when the product already has a parent (`:37`) | `admin.service.ts:308` — top-level, non-archived products | `product.parent_id` | — | display only |
| Variant label | `16 inch` | `admin.service.ts:295` | `product.variant_label` | — | shown on Screen 16's Variants column and in the variants table here |
| Extra price (₹) | `15,000` shown; `1500000` stored | same | `product.extra_price` | — | **read by nothing** — see §10 |

Header line: `products/[id]/page.tsx:56` prints `sku · category.name` and, for a variant, `· variant of <parent name>`.

### Card 2 — Product Variants (`products/[id]/page.tsx:78-130`)

Renders only when `product && !product.parentId` — a variant does not get its own variants card.

| What you see | Which query | table.column |
| --- | --- | --- |
| Value column | `admin.service.ts:300` (`variants`, ordered by id) | `product.variant_label`, falling back to `product.name` if null (`:101`) |
| SKU | same | `product.sku` |
| Extra price | same, rendered with `<Money signed />` (`:105`) | `product.extra_price` |
| Price | same | `product.list_price` |
| Status | derived | `product.archived_at IS NULL` |
| the add row | inline `EntityForm`, fields at `:39-45` | writes a new `product` row |

The add row's hidden fields copy the parent (`:120`): `parentId`, `kind`, `categoryId`, `unit`, `taxBp`, `name: "<parent> variant"`, `isPromoted: false`. Its initial values pre-fill Price and Cost from the parent (`:119`).

### Card 3 — Pricelists (`products/[id]/page.tsx:134-147`)

| What you see | Example | Which query | table.column |
| --- | --- | --- | --- |
| Tier select | `Gold` | `admin.service.ts:307` (all tiers, by `sortOrder`) | `pricelist_rule.tier_id` → `customer_tier.name` |
| "Price rule: minus (%)" | `10` shown; `1000` stored | `admin.service.ts:301` (`pricelistRules`, with `tier` name) | `pricelist_rule.discount_bp` |
| Note | `Gold price on training` | same | `pricelist_rule.note` |

One inline form per existing rule (`:140-142`), plus one blank "Add price rule" form (`:144`). Both force `categoryId: null` and `productId: product.id` through hidden fields.

Seed content: two rules, both on `Training Day` (`prisma/seed/a-catalogue.ts:55-60`) — Gold −10%, Silver −5%. `Laptop 14"` has none, so every tier pays list.

### Card 4 — "Quantity on hand" or "Recurring" (`products/[id]/page.tsx:148-181`)

Which one you get depends on `product.kind === "SUBSCRIPTION"` (`:150`).

**Non-subscription — Quantity on hand:**

| What you see | Example | Which query | Derivation |
| --- | --- | --- | --- |
| one line per warehouse | `Main Warehouse` | `admin.service.ts:309` (`warehouse.findMany`, non-archived, by `priority`) | `warehouse.name` |
| `2 available (6 on hand, 4 reserved)` | | `admin.service.ts:302` (`stockLevels` with warehouse name) | available is **computed in the page**: `s.onHand - s.reserved` (`products/[id]/page.tsx:172`). It is not a column. |
| `no stock row` | for a warehouse with no `stock_level` | `.find()` returns undefined (`:168`) | |
| "Edit stock levels" link | → `/admin/warehouses` | | this card is read-only |

**Subscription — Recurring:**

| What you see | Which query | Meaning |
| --- | --- | --- |
| a bullet per plan, `Monthly (month)` | `admin.service.ts:303` — `plans` where `archivedAt: null` | plans whose `recurring_plan.product_id` points at this product |
| "Any plan without a product restriction applies." | rendered when `product.plans.length === 0` (`:163`) | matches `addLine`'s fallback: the lowest-id plan with `productId: null` (`quotation.service.ts:142`) |

**Footer on both variants** (`:179`): `Ceiling for this category: 15%` — from `product.category.discountCeilingBp`, printed by `formatBp` (`src/lib/format.ts:46-49`); the text "tier ceiling" appears when the category ceiling is null, which is exactly the `null` branch of the ceiling rule (`quotation.service.ts:151`).

## 4. The queries this page runs

`getProductEditor(id)` — `src/services/admin.service.ts:291-312`. Five queries in one `Promise.all`:

1. **The product**, when `id !== null`, with five nested includes (`:295-305`): `category` (full row, because the footer needs `discountCeilingBp`), `parent` (id + name), `variants` (ordered by id, with their category name), `pricelistRules` (ordered by id, with the tier name), `stockLevels` (with the warehouse name), and `plans` (non-archived, id/name/interval).
2. `productCategory.findMany` ordered by `sortOrder` — the Category select.
3. `customerTier.findMany` ordered by `sortOrder` — the Tier select on price rules.
4. `product.findMany` where `parentId: null, archivedAt: null` — the "Variant of" select. Only top-level products can be parents. The page then also filters out the product itself (`products/[id]/page.tsx:37`), so you cannot make a product its own parent through the UI.
5. `warehouse.findMany` where `archivedAt: null`, ordered by `priority` — the stock card.

In create mode the first entry is a literal `null` (`:293-294`), so only four queries actually run.

No caching. `revalidatePath("/admin/products")` and `"/admin"` fire after every save (`actions/admin.ts:52`), and `EntityForm` calls `router.refresh()` (`entity-form.tsx:111`) so the page re-runs the query and repaints.

## 5. Every condition on this page

| Condition | Where | Effect |
| --- | --- | --- |
| role not in `BACKEND_ROLES` | `middleware.ts:25`, `page.tsx:18` | redirected out |
| `id === "new"` | `page.tsx:19` | create mode; `numericId = null` |
| id is not an integer | `page.tsx:21` | `notFound()` — 404 |
| product not found | `page.tsx:23` | `notFound()` — 404 |
| create mode | `page.tsx:70,72` | button says "Create product"; on success redirect to `/admin/products/<id>` |
| edit mode | `page.tsx:70` | button says "Save product"; stays put and refreshes |
| create mode **or** the product already has a parent | `page.tsx:37` | the three variant fields (Variant of, Variant label, Extra price) are added to General Info |
| the product has **no** parent, in edit mode | `page.tsx:68` | hidden fields force `parentId: null, extraPrice: 0` on every save |
| `product && !product.parentId` | `page.tsx:78` | the Product Variants card renders |
| `product.variants.length === 0` | `page.tsx:112` | "No variants yet." |
| variant's `variantLabel` is null | `page.tsx:101` | falls back to the variant's `name` |
| `product` exists (edit mode) | `page.tsx:132` | the Pricelists + stock/recurring row renders at all |
| `product.kind === "SUBSCRIPTION"` | `page.tsx:150,152,158` | card title "Recurring", plan list instead of stock |
| `product.plans.length === 0` | `page.tsx:163` | "Any plan without a product restriction applies." + link |
| a warehouse has no stock row | `page.tsx:172` | "no stock row" |
| `product.category.discountCeilingBp === null` | `page.tsx:179` | footer says "tier ceiling" instead of a percentage |
| Zod rejects a field | `entity-form.tsx:100-103`, `:211` | red message under that input; toast only when the error is not field-scoped |

## 6. Every action you can take here

All three forms are the same component: `EntityForm` (`src/components/admin/entity-form.tsx:66-222`).

### How EntityForm converts what you type

This is the mechanism behind every "₹" and "%" on the admin screens.

**Reading a row into the form** — `toRaw` (`entity-form.tsx:39-50`). Values are held as **strings** while you edit. For a `percent` or `rupees` field it divides by 100 (`:46`): `1800` → `"18"`, `6000000` → `"60000"`. A `checkbox` becomes a boolean (`:43`), a `roles` field becomes a string array (`:44`), `null`/`undefined` become `""` (`:45`).

**Writing the form back out** — `toInput` (`entity-form.tsx:52-64`):

| field `type` | conversion | line |
| --- | --- | --- |
| `percent` | `Math.round(Number(v) * 100)` → basis points. `"18"` → `1800`, `"12.5"` → `1250` | `:59` |
| `rupees` | `Math.round(Number(v) * 100)` → paise. `"60000"` → `6000000`, `"999.99"` → `99999` | `:59` (identical code path) |
| `number` | `Number(v)` | `:60` |
| `checkbox` | `Boolean(v)` | `:56` |
| `roles` | the array as-is | `:57` |
| empty string | `null` if the field is marked `nullable`, otherwise `undefined` (so the Zod default applies) | `:58` |
| everything else | the string | `:61` |

`Math.round` means the form never sends a fraction of a paisa. Typing `18.005` percent gives `1801` bp (round-half-up on `1800.5`). Typing `60000.004` rupees gives `6000000` paise.

Hidden values are merged in first (`:53`), so a hidden field always wins over a visible one of the same name.

### Form 1 — General Info

| Element | Path |
| --- | --- |
| **button** | "Create product" / "Save product" (`page.tsx:70`) |
| **server action** | `saveProduct` — `src/app/(internal)/actions/admin.ts:75-77` |
| **Zod schema** | `productSchema` — `src/lib/validation/admin.ts:72-87` |
| **guards** | `parseInput` first (`actions/admin.ts:37`), then `requireActionUser(BACKEND_ROLES)` (`:40`). **No guard inside the service.** |
| **service** | `admin.saveProduct` — `src/services/admin.service.ts:172-197` |
| **tables written** | `product` (insert or update), `audit_log` |
| **audit row** | `entityType: "Product"`, `action: "CREATE"` or `"UPDATE"` (`admin.service.ts:41`), actor from the session (`:42`), before/after from the `summary` projection at `:195`, `reason: null` |
| **on screen** | toast "Product saved"; create redirects to `/admin/products/:id` (`page.tsx:72`), edit calls `router.refresh()` (`entity-form.tsx:111`) |

`productSchema` in full (`validation/admin.ts:72-87`):

```ts
sku:          z.string().trim().min(2).max(40)
name:         zName                      // trim, 2..120  (validation/common.ts:33)
description:  z.string().trim().max(2000).optional()
kind:         z.enum(["GOOD","SERVICE","SUBSCRIPTION"])
categoryId:   zId                        // coerced positive int (common.ts:19)
unit:         z.string().trim().min(1).max(20).default("Each")
listPrice:    zMoney                     // int, 0 .. 2_147_483_647 (common.ts:5)
cost:         zMoney
taxBp:        zBp.default(1800)          // int, 0 .. 10000 (common.ts:7-11)
isPromoted:   z.coerce.boolean().default(false)
parentId:     zId.nullable().default(null)
variantLabel: z.string().trim().max(60).optional()
extraPrice:   zMoney.default(0)
```

`zMoney`'s max of `2_147_483_647` paise is the Postgres `int4` ceiling — about ₹2.14 crore per unit.

### Form 2 — Add variant

Same action, same schema, same service. The difference is entirely in what the page hides (`page.tsx:120`): `parentId: product.id`, `kind`, `categoryId`, `unit`, `taxBp`, `name`, `isPromoted: false` are all copied from the parent, so the five fields you fill in are the only things that differ. It creates a **new `product` row**, not a child table row.

`resetOnSuccess` is set (`page.tsx:124`), so the row blanks itself for the next variant.

### Form 3 — Price rules

| Element | Path |
| --- | --- |
| **button** | "Save" on an existing rule, "Add price rule" for a new one (`page.tsx:141,144`) |
| **server action** | `savePricelistRule` — `actions/admin.ts:78-80` |
| **Zod schema** | `pricelistRuleSchema` — `validation/admin.ts:89-96` |
| **service** | `admin.savePricelistRule` — `admin.service.ts:199-210` |
| **tables written** | `pricelist_rule`, `audit_log` |
| **audit row** | `entityType: "PricelistRule"`, before/after `{ tierId, categoryId, productId, discountBp }` (`admin.service.ts:208`) — the `note` is **not** in the projection |
| **on screen** | toast "Price rule saved" / "Price rule created", then `router.refresh()` |

Schema:

```ts
tierId:     zId
categoryId: zId.nullable().default(null)   // forced to null by the page
productId:  zId.nullable().default(null)   // forced to this product by the page
discountBp: zBp                            // 0..10000
note:       z.string().trim().max(200).nullish()
```

Database backstop: `CHECK ("discount_bp" BETWEEN 0 AND 10000)` (`prisma/migrations/20260905095100_init/migration.sql:1019`), mapped to "Discount must be between 0 and 100 percent" (`contract.ts:119`).

### The one audit helper

Every one of these saves goes through `saveRow` (`admin.service.ts:25-48`):

```ts
return prisma.$transaction(async (tx) => {
  const before = id ? await read(tx, id) : null;
  if (id && !before) throw new NotFoundError(`${entityType} not found`);
  const row = id ? await update(tx, id) : await create(tx);
  await audit(tx, { entityType, entityId: row.id, action: id ? "UPDATE" : "CREATE",
                    actor: actorFromUser(user),
                    before: before ? summary(before) : undefined, after: summary(row) });
  return row;
});
```

The audit write uses the **transaction client** `tx`, not `prisma` (`src/lib/audit.ts:25-40`). So a failed save logs nothing and a committed save always logs. `audit_log.before_json` / `after_json` are `Json?` columns (`schema.prisma:575-576`); `undefined` leaves them null (`audit.ts:37-38`), which is how a CREATE ends up with no before.

## 7. Scenarios

The full nine-scenario walkthrough for this screen group lives in `16-admin-products.md` §7 (create a product, add a variant, product rule beats category rule, raise a ceiling, add an approval rule, weights ≠ 100, on-hand below reserved, create a plan, change a role). These are the ones specific to this screen.

### S17-1 — Editing a top-level product silently clears its variant fields

Open `Laptop 14"`. It has no parent, so the three variant fields are **not** rendered (`page.tsx:37`), but the hidden object still sends `parentId: null, extraPrice: 0` on every save (`page.tsx:68`). Harmless for a product that never had them; but if a row somehow had a `variantLabel`, note that `variantLabel` is *not* in the hidden set and *not* in the field list, so `toInput` never emits it, the schema's `.optional()` lets it through as `undefined`, and `admin.service.ts:185` writes `input.variantLabel ?? null` — **clearing it**. Saving a top-level product wipes any stray variant label.

### S17-2 — Editing a category-scoped price rule through this card converts it to product-scoped

The seed only ships product-scoped rules, but suppose a category rule existed on this product's category. It would not appear in this card at all — `admin.service.ts:301` loads `product.pricelistRules`, i.e. rules whose `product_id` is this product. Category rules are invisible here and have no admin form anywhere. If you added one directly in SQL, the only way to edit it in the app would be to not have one.

Worse, on the rules that *are* listed, the hidden object is `{ id: r.id, productId: product.id, categoryId: null }` (`page.tsx:141`). So re-saving any rule re-asserts product scope and nulls the category. That is fine for rules created here and destructive for anything else.

### S17-3 — Price rule of 0 percent

Type `0` into "Price rule: minus". `zBp` allows 0 (`common.ts:7-11`). The rule is stored with `discount_bp = 0`. `bestPricelistRule` still returns it (it matches the `where`), so `applyDiscount(listPrice, 0)` = `listPrice` (`src/domain/money.ts:124`), and `quotation_line.pricelist_rule_id` records the zero rule. This is how you express the mockup's "Bronze / Price, no adjustment" row explicitly — and it *shadows* any broader rule for that tier, because rank 0 beats rank 1 and 2 (`quotation.service.ts:416`).

### S17-4 — Two rules with the same scope on the same tier

Nothing stops you pressing "Add price rule" twice with tier Gold and 10% then 12%. There is no unique index on `(tier_id, category_id, product_id)` — the only index is `@@index([tierId])` (`schema.prisma:370`). `bestPricelistRule` sorts by rank only (`quotation.service.ts:416`); both have rank 0, `Array.prototype.sort` is stable, so the row Postgres returned first wins — in practice the lower id. Confusing but deterministic. Delete-by-UI does not exist, so the only fix is SQL.

### S17-5 — Turning an existing product into a subscription

Change "Subscription?" from `No, a physical good` to `Yes, recurring` and save. `product.kind` becomes `SUBSCRIPTION`. The page immediately swaps card 4 from stock to plans (`page.tsx:150`). Existing quotation lines are unaffected — `line_type` was snapshotted at `addLine` time (`quotation.service.ts:176`). New lines will require a plan (`quotation.service.ts:139-147`) and will not appear in the warehouse stock picker any more (`admin.service.ts:252` filters `kind: "GOOD"`).

Existing `stock_level` rows for that product are **not** cleaned up. They just stop being reachable from the admin grid.

### S17-6 — Changing the description or the unit produces a phantom audit row

Change the description from `14 inch business laptop` to `14 inch ultrabook` and save. The row updates. The audit row is written with:

```ts
(p) => ({ sku, name, kind, categoryId, listPrice, cost, taxBp, isPromoted, parentId, extraPrice })
```

(`admin.service.ts:195`.) `description`, `unit` and `variantLabel` are **not in the projection**. So `before_json` and `after_json` are byte-for-byte identical, and the audit trail shows an `UPDATE` that appears to change nothing. Somebody reading the log later cannot tell what happened.

The same lossiness applies to `pricelist_rule.note` (`admin.service.ts:208`), `warehouse.city` is included (`:115`) but `approval_rule` and the rest each have their own hand-written projection. There is no test asserting the projection covers every writable column.

### S17-7 — Duplicate SKU

Create a second product with SKU `HW-LAP-14`. Zod passes (it only checks length). `tx.product.create` hits the `@unique` on `sku` (`schema.prisma:322`), Prisma throws `P2002`, `saveRow`'s transaction rolls back — **including the audit row** — and `toActionError` → `fromDatabaseError` (`contract.ts:140-143`) returns `fieldErrors: { sku: ["Already in use"] }`. Red text under the SKU box, nothing written.

### S17-8 — A save function called with a Sales Rep session

`admin.saveProduct(input, salesRepSession)` succeeds. Read `admin.service.ts:172-197`: there is no role check. The transaction commits and the audit row records `actorRole: "SALES_REP"` (`audit.ts:35`, from `actorFromUser` at `contract.ts:182`). Today nothing calls it that way — the only caller is the action, which guards (`actions/admin.ts:40`). But the service is not self-defending, unlike `subscription.service.ts:17` or `fulfillment` paths that check `OPS_ROLES`. Treat `admin.service.ts` as trusted-caller-only.

## 8. Schema behind this screen

**Product** — `prisma/schema.prisma:320-354`, table `product`. Reproduced in `16-admin-products.md` §8. Key points for this screen: `sku` unique; `list_price`, `cost`, `extra_price` are integer paise; `tax_bp` is integer basis points defaulting to 1800; `parent_id` is a self-relation named `"ProductVariant"` (`:340-341`).

**PricelistRule** — `prisma/schema.prisma:356-373`:

```prisma
model PricelistRule {
  id         Int      @id @default(autoincrement())
  tierId     Int      @map("tier_id")
  categoryId Int?     @map("category_id")
  productId  Int?     @map("product_id")
  discountBp Int      @map("discount_bp")
  currency   String   @default("INR")
  note       String?
  createdAt  DateTime @default(now()) @map("created_at")

  tier     CustomerTier     @relation(fields: [tierId], references: [id], onDelete: Cascade)
  category ProductCategory? @relation(fields: [categoryId], references: [id])
  product  Product?         @relation(fields: [productId], references: [id])

  @@index([tierId])
  @@map("pricelist_rule")
}
```

The schema comment above it (`:355`) states the intent exactly: "Scope is the narrowest non-null of product, category, tier." `onDelete: Cascade` on the tier means deleting a tier takes its price rules with it. `currency` is stored and never read.

CHECK: `pricelist_rule_discount_bp_range` (`migration.sql:1019`).

**The line this all feeds** — `QuotationLine`, `prisma/schema.prisma:488-524`. The four snapshot columns and their schema comments:

```prisma
unitPrice  Int  @map("unit_price")  // paise, after pricelist rule
unitCost   Int  @map("unit_cost")
taxBp      Int  @map("tax_bp")
ceilingBp  Int  @map("ceiling_bp")  // min(tier ceiling, category ceiling) at creation
pricelistRuleId Int? @map("pricelist_rule_id")
```

"at creation" is the schema author telling you these are snapshots.

## 9. How this screen connects to the others

- **← Screen 16**: you arrive by clicking a row, or via "+ New Product".
- **→ Screen 18** (`/admin/tiers`): the Category select's options and the "Ceiling for this category" footer both come from rows managed there. The Tier select on the price rules likewise.
- **→ Screen 18b** (`/admin/warehouses`): the "Quantity on hand" card is a read-only mirror; "Edit stock levels" links across.
- **→ Screen 18b** (`/admin/plans`): the "Recurring" card lists plans bound to this product; "Manage plans" links across.
- **→ Screen 4, the quote builder**: `addLine` (`quotation.service.ts:127-197`) copies price, cost, tax, name and ceiling onto the line and records which price rule won.
- **→ Screen 4, the upsell rail**: `isPromoted` and the category's `minMarginBp` (`upsell.service.ts:76,80`).
- **→ Screen 5/6, approvals**: only indirectly — the ceiling this screen's category contributes decides the overage that drives the risk score (`src/domain/risk.ts:60-62,78`).

## 10. Gotchas

1. **Variants are not the mockup's variants.** The mockup (docs/mockup/17-product-details-page.png) draws an Attribute / Values / Extra price matrix: *Color → Blue, Black → 0*; *RAM → 4GB, 8GB → +$30*; *Manufacturer → Dell, HP → +$10/+$30*. That is a three-table design (product → attribute → attribute value) where one product explodes into a grid of combinations.

   The code has **no attribute table and no value table**. A variant is simply another row in `product` with `parent_id` set, plus a free-text `variant_label` and an `extra_price` number (`schema.prisma:328-330`). The `Laptop 16"` seed row is the whole feature (`prisma/seed/a-catalogue.ts:22-34`).

   Consequences: you cannot express "Color × RAM"; each combination is its own product you create by hand. The UI is honest about this — the field is labelled "Attribute value" (`page.tsx:40`) and the card description says "Variants are child products with their own SKU and an extra price on top of the parent" (`page.tsx:82`).

2. **`extraPrice` is stored, displayed, and read by nothing.** Grep for `extraPrice` outside `src/generated`: the two admin pages, the schema, the seed, and `admin.service.ts`. `addLine` prices from `product.listPrice` alone (`quotation.service.ts:150`). So `Laptop 16"` costs ₹75,000 because its own `list_price` says so, not because ₹60,000 + ₹15,000. If you set `extraPrice` and forget to set `listPrice`, the variant sells at the wrong price and nothing warns you.

3. **No delete, no archive, anywhere on this screen.** No button removes a price rule or a variant, and nothing sets `archived_at`. A mistyped price rule stays until somebody edits it to 0 or runs SQL.

4. **The audit projection is lossy.** Description, unit and variant label changes produce identical before/after JSON (`admin.service.ts:195`). See S17-6.

5. **Admin saves store `reason: null`.** `saveRow` never passes a reason (`admin.service.ts:38-45`), so `audit()` writes `reason: e.reason ?? null` → null (`audit.ts:36`). The spec's A3 note says "All approvals, rejections, and edits must be logged with user, timestamp, and reason" (docs/DealFlow360.txt:128-131). User and timestamp are there (`actor_name`, `actor_role`, `at`); reason is not, for any configuration edit. Approval decisions and subscription cancellations *do* carry a reason (`subscription.service.ts:190`), so the column and the plumbing exist — the admin forms simply have no reason box.

6. **Product pairings (spec A6) have no surface here or anywhere.** `ProductPairing` (`schema.prisma:375-391`) holds the historical co-purchase counts that rank upsell suggestions (`upsell.service.ts:35-39`). The only rows in the table are the four from the seed (`prisma/seed/a-catalogue.ts:63-70`). No admin page creates, edits or deletes them; grep finds no `productPairing.create` outside the seed. The two A6 bullets the app *does* implement — "mark products as currently promoted" (the `isPromoted` checkbox here) and "set minimum margin thresholds" (`minMarginBp` on Screen 18) — are configurable; "define product pairings based on historical co-purchase data" is seed-only and read-only. In practice the app compensates by also counting real closed orders at query time (`upsell.service.ts:40-52`), so pairings become less important as history accumulates.

7. **Creating a variant names it `<parent> variant`.** Literally (`page.tsx:120`). You must open the child and rename it, and the page says so in small print (`page.tsx:126`). A catalogue built quickly will be full of rows called `Laptop 14" variant`.

8. **Nothing prevents a variant of a variant in the data.** The parent select only offers top-level products (`admin.service.ts:308`), but the schema and the service accept any `parentId`. A deep chain would render oddly on Screen 16 (the "Variants" column only counts direct children).
