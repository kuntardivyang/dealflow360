# Screen 18b — Warehouses, plans and users (`/admin/warehouses`, `/admin/plans`, `/admin/users`)

## 1. What this screen is

The three remaining cards on the `/admin` hub, grouped here because each is a single small page with one purpose:

- **`/admin/warehouses`** — spec A4. Where you ship from, what a shipment from there costs, and how many units are sitting on each shelf. The auto-split algorithm reads these rows live.
- **`/admin/plans`** — spec A5. Billing interval, how many periods, proration, cancellation and refund behaviour for recurring products.
- **`/admin/users`** — the internal user list. Role and reporting manager. **Admin only.**

Nothing on these pages is cosmetic. Every field is consumed by a named function in the order path, and this file names each one.

## 2. Who can open it, and who enforces that

| Page | ADMIN | SALES_MANAGER | FINANCE | SALES_REP | Enforced where |
| --- | --- | --- | --- | --- | --- |
| `/admin/warehouses` | Yes | Yes | Yes | No | `src/middleware.ts:25`, `admin/layout.tsx:7`, `admin/warehouses/page.tsx:22` |
| `/admin/plans` | Yes | Yes | Yes | No | `src/middleware.ts:25`, `admin/layout.tsx:7`, `admin/plans/page.tsx:13` |
| `/admin/users` | **Yes** | **No** | **No** | No | `src/app/(internal)/admin/users/page.tsx:15` — `requireUser(["ADMIN"])` |

`BACKEND_ROLES = ["ADMIN", "SALES_MANAGER", "FINANCE"]` (`src/lib/contract.ts:63`) — wider than the spec's role table, which puts the whole A-series configuration area with the Admin. Warehouses and plans follow the wide list; users is the one page in the entire admin area that is narrowed.

The narrowing is doubled up. The page guard is `requireUser(["ADMIN"])` (`users/page.tsx:15`), which **redirects** a Sales Manager to `/dashboard?forbidden=1` (`src/lib/auth/internal.ts:78`). The action guard is separate: `setUserRole` passes `["ADMIN"]` as `run`'s fifth argument (`src/app/(internal)/actions/admin.ts:82`), overriding the default at `:35`, and `requireActionUser` **throws** `ForbiddenError` (`auth/internal.ts:88`) so a replayed POST returns `{ ok: false, code: "FORBIDDEN" }`. Note the middleware does **not** special-case `/admin/users` (`src/middleware.ts:25` only checks `BACKEND_ROLES`), so the page guard is the first line of defence there, not the second.

## 3. Everything on the screen, and where each value comes from

### 3.1 `/admin/warehouses`

One query: `getWarehousesWithStock()` at `src/services/admin.service.ts:245-255`.

**Card "Warehouses"** (`warehouses/page.tsx:39-52`), fields at `:14-19`.

| What you see | Example (seed) | Which query | table.column | FORWARD trace |
| --- | --- | --- | --- | --- |
| Warehouse | `Main Warehouse`, `East Depot` | `admin.service.ts:247-250` | `warehouse.name` | shown on the fulfillment plan and on each shipment |
| City | `Ahmedabad`, `Kolkata` | same | `warehouse.city` (nullable) | display only — nothing reads it |
| Ship cost weighting (₹) | `500` shown / `50000` paise stored; East `800` / `80000` | same | `warehouse.ship_cost_weight` | **the primary sort key of the split** (`src/domain/split.ts:12`), the per-shipment `estCost` (`split.ts:45`), and the value copied to `shipment.ship_cost` (`fulfillment.service.ts:140`) |
| Priority | `1`, `2` | same | `warehouse.priority` | **the tie-break** when two warehouses have the same ship cost (`split.ts:12`) |
| the footer line | "Ship cost weightings in the seed: Main Warehouse ₹500.00, East Depot ₹800.00" | hardcoded `<Money paise={50000} />` / `{80000}` (`warehouses/page.tsx:113`) | — | a static reminder, not a query — it will not update if you change the values |

**Card "Stock levels"** (`warehouses/page.tsx:54-111`), fields at `:25-31`.

| Column | Example (seed) | Which query | table.column | How it is produced |
| --- | --- | --- | --- | --- |
| Warehouse | `Main Warehouse` | `admin.service.ts:250` (`stockLevels` nested in each warehouse) | `warehouse.name` | |
| Product | `Laptop 14"` | same (`product: { id, name, sku }`) | `product.name` | |
| In Stock | `6` | same | `stock_level.on_hand` | editable |
| Reserved | `4` | same | `stock_level.reserved` | **read-only, greyed out** (`warehouses/page.tsx:81`). No admin form writes it. |
| Available | `2` | **not a column** — computed in the page: `{s.onHand - s.reserved}` (`warehouses/page.tsx:82`) | — | the same expression the split uses: `available: r.onHand - r.reserved` (`fulfillment.service.ts:46`) |
| Edit | inline form: On hand, Reorder point, Lead days | `stockFields(true)` minus `productId` (`warehouses/page.tsx:86`) | `on_hand`, `reorder_point`, `lead_days` | |
| the "Add or set a stock level" row | includes a Warehouse and a Product select | `stockFields(false)` (`:103`) | | product options are **goods only** (`admin.service.ts:252`, `kind: "GOOD"`) |

Who writes `reserved`, then? Two raw SQL statements in the fulfilment path:

```sql
-- reserving, when a split plan is accepted (fulfillment.service.ts:106)
UPDATE stock_level SET reserved = reserved + $qty WHERE id = $id AND on_hand - reserved >= $qty
-- shipping (fulfillment.service.ts:228)
UPDATE stock_level SET on_hand = on_hand - $qty, reserved = reserved - $qty
  WHERE id = $id AND reserved >= $qty AND on_hand >= $qty
```

Both are conditional updates that return an affected-row count, so a concurrent order cannot double-reserve the same unit. That is why the admin grid must never let you edit `reserved` by hand — it belongs to the order path.

**Seed values worth remembering** (`prisma/seed/a-stock.ts:20-33`): `Laptop 14"` is Main 6 / East 5, so a quote for 10 splits across both warehouses and a quote for 12 backorders 1. `Laptop 16"` is Main 3 / East 0. `Docking Station` is Main 20 / East 0. `Monitor 27"` is Main 2 / East 10.

### 3.2 `/admin/plans`

One query: `getPlans()` at `src/services/admin.service.ts:257-263`. Fields at `plans/page.tsx:15-63`.

| Field | Example (seed) | table.column | **The exact behaviour it drives, and the function that reads it** |
| --- | --- | --- | --- |
| Plan | `Monthly`, `Quarterly`, `Yearly` | `recurring_plan.name` (`@unique`) | label only |
| Cycle | `Monthly` / `MONTH` | `recurring_plan.interval` | the length of a billing period. Read by `buildSchedule(today, line.plan.interval, ...)` and `periodEnd(today, line.plan.interval)` at `src/services/billing.service.ts:67,83`, which set `subscription.current_period_end` and every `billing_schedule` row's `period_start`/`period_end`. |
| Schedule periods | `12`, `4`, `1` | `recurring_plan.periods` | how many `billing_schedule` rows are materialised on confirm — `buildSchedule(..., line.plan.periods, ...)` (`billing.service.ts:67`), then `schedule.map(...)` creates one row each (`billing.service.ts:84-92`). `Monthly` = 12 rows, `Yearly` = 1. |
| Proration | `Day based` / `DAY_BASED` | `recurring_plan.proration_mode` | passed as `mode` into `prorate(...)` for a mid-cycle quantity change (`subscription.service.ts:38`) and for a cancellation credit (`:153`). `DAY_BASED` charges/credits the remaining calendar days of the real period; `NONE` produces no proration at all. |
| Bill the change day | ticked | `recurring_plan.bill_change_day` | passed as `billChangeDay` into the same `prorate` calls (`subscription.service.ts:39,153`). Decides whether the day the change happens counts as a billed day. |
| Cancellation | `Immediate, prorated refund` / `IMMEDIATE_PRORATED_REFUND` | `recurring_plan.cancel_policy` | read at `subscription.service.ts:146`. `END_OF_PERIOD` → `cancelEffective = periodEnd`, nothing credited (`:147`). `IMMEDIATE_PRORATED_REFUND` → prorate the unused days and issue a credit (`:152-178`). `NO_REFUND` → stops now, credits nothing. Future scheduled periods are cancelled in every case (`:180`). |
| Refund as | `Credit note` / `CREDIT_NOTE` | `recurring_plan.refund_method` | read at `subscription.service.ts:158`: `const refund = sub.plan.refundMethod === "REFUND_PAYMENT" && paidInvoice;`. With `REFUND_PAYMENT` **and** a paid recurring invoice, a `payment` row of kind `REFUND` is created and the credit note is marked `REFUNDED` (`:162-171`). Otherwise the credit note stays `OPEN`. |
| Limited to product | blank in the seed | `recurring_plan.product_id` (nullable) | read by `addLine`'s plan resolution (`quotation.service.ts:139-145`): the rep's explicit `planId` → else `product.plans[0]` (plans bound to that product) → else the lowest-id plan with `productId: null`. Options are restricted to subscription products (`admin.service.ts:260`). |

### 3.3 `/admin/users`

One query: `getUsers()` at `src/services/admin.service.ts:314-316`.

| Column | Example (seed) | Which query | table.column |
| --- | --- | --- | --- |
| Name | `Riya Rao` | `admin.service.ts:315` | `app_user.name` |
| `inactive` tag | none in the seed | `users/page.tsx:43` | `app_user.is_active` — displayed, **not editable here** |
| Email | `riya@test.com` | same | `app_user.email` (`@unique`) |
| Quotations | `4` | `_count: { select: { quotations: true } }` (`admin.service.ts:315`) | `COUNT(quotation WHERE rep_user_id = user.id)` |
| Role select | `Sales Rep` | same | `app_user.role` — options from `ROLE_LABEL` (`src/lib/labels.ts:3-8`): Admin, Sales Rep, Sales Manager, Finance |
| Reports to select | `Meera Shah` | same, plus `manager: { id, name }` | `app_user.manager_id`. Options are only users whose role is `SALES_MANAGER` or `ADMIN` (`users/page.tsx:17`). Nullable — the blank option is `–` (`entity-form.tsx:182`). |

Seed users (`prisma/seed/b-users.ts:44-52`), all with password `demo1234`: `admin@test.com` (ADMIN), `meera@test.com` (SALES_MANAGER), `farhan@test.com` (FINANCE), `riya@test.com` and `arjun@test.com` (SALES_REP, both managed by Meera).

Ordering is `[{ role: "asc" }, { name: "asc" }]` (`admin.service.ts:315`) — alphabetical on the enum *value*, so ADMIN, FINANCE, SALES_MANAGER, SALES_REP.

### How the split algorithm consumes `shipCostWeight` and `priority`

This is the whole reason those two numbers exist.

**Step 1 — load.** `loadStock` (`fulfillment.service.ts:40-50`) fetches non-archived warehouses `orderBy: [{ shipCostWeight: "asc" }, { priority: "asc" }]` and maps each stock row to `available: r.onHand - r.reserved` (`:46`).

**Step 2 — sort.** `splitWarehouses` sorts again, defensively (`src/domain/split.ts:11-13,26`):

```ts
function byCostThenPriority(a, b) {
  return a.shipCostWeight - b.shipCostWeight || a.priority - b.priority || a.id - b.id;
}
```

Ship cost first. `priority` only matters when two warehouses cost the same. `id` is the final tie-break, which is what makes the plan deterministic.

**Step 3 — one warehouse that covers everything wins outright** (`split.ts:49-51`):

```ts
const whole = ordered.find((w) => coverValue(w, demand, remaining, avail) === totalValue && totalValue > 0);
```

`ordered` is cheapest-first, so `.find` returns the cheapest warehouse that can ship the entire order. Objective 1 is **fewest shipments**; objective 2 is lowest cost.

**Step 4 — otherwise, greedy by value covered** (`split.ts:53-67`): repeatedly pick the warehouse that can cover the most remaining *value* (`coverValue` at `:16-22` multiplies quantity by `unitPrice`), take everything it can, repeat. Because `ordered` is cheapest-first and the comparison is strict `v > bestValue` (`:59`), an exact tie in covered value goes to the cheaper warehouse.

**Step 5 — cost and leftovers.** Each shipment's `estCost` is that warehouse's `shipCostWeight`, flat (`split.ts:45`); the plan's `estCost` is the sum (`:78`). Anything unplaced becomes a backorder (`:70-72`).

**Worked example on the seed.** Order: 10 × `Laptop 14"` at ₹60,000. Main has 6 available, East has 5. No single warehouse covers 10, so step 4 runs. Main covers `min(10,6) × 6000000 = 36,000,000` paise of value; East covers `min(10,5) × 6000000 = 30,000,000`. Main wins, takes 6, leaving 4. East then covers 4, takes them. Result: two shipments, `estCost = 50000 + 80000 = 130000` paise = **₹1,300**.

Now flip the numbers on this screen: set Main's ship cost to ₹900 (`90000`) and leave East at ₹800. The sort order changes to East-first, but step 4 picks by *value covered*, not by order — Main still covers more (6 vs 5), so Main is still chosen first. `estCost` becomes `90000 + 80000 = 170000` = ₹1,700. Where the cost genuinely changes the plan is step 3 and exact ties: if both warehouses had 10 units, step 3 picks the cheaper one and you get **one** shipment.

Priority only ever breaks a tie. In the seed it never fires, because 50000 ≠ 80000.

## 4. The queries these pages run

**`getWarehousesWithStock()`** — `admin.service.ts:245-255`:

```ts
prisma.warehouse.findMany({
  where: { archivedAt: null },
  orderBy: [{ priority: "asc" }, { id: "asc" }],
  include: { stockLevels: { include: { product: { select: { id, name, sku } } }, orderBy: { productId: "asc" } } },
})
prisma.product.findMany({ where: { archivedAt: null, kind: "GOOD" }, orderBy: { name: "asc" }, select: { id, name, sku } })
```

Note the admin list is ordered by **priority**, while the split orders by **ship cost**. Different orderings for different jobs; the screen is not showing you the split's preference order.

**`getPlans()`** — `admin.service.ts:257-263`: non-archived plans by id, with their product; plus non-archived `SUBSCRIPTION` products for the "Limited to product" select.

**`getUsers()`** — `admin.service.ts:314-316`: every user, no filter (inactive users are listed and their role is still editable), with `manager` and a `_count` of quotations.

Revalidation after a save: warehouses revalidate `/admin/warehouses`, **`/fulfillment`** and `/admin` (`actions/admin.ts:50`) — the fulfilment queue is refreshed because a stock change can change what is proposable. Plans revalidate `/admin/plans` and `/admin` (`:51`). Users revalidate `/admin/users` and `/admin` (`:82`).

## 5. Every condition on these pages

| Condition | Where | Effect |
| --- | --- | --- |
| role not in `BACKEND_ROLES` | `middleware.ts:25` | out of the whole `/admin` area |
| role is not ADMIN on `/admin/users` | `users/page.tsx:15` | redirect to `/dashboard?forbidden=1` |
| every warehouse has zero stock rows | `warehouses/page.tsx:60` | EmptyState "No stock yet" instead of the table |
| a warehouse has `archived_at` set | `admin.service.ts:248` | hidden from the admin list **and** from the split (`fulfillment.service.ts:41`). Nothing in the app sets it. |
| on hand < already reserved | `admin.service.ts:124-126` | `ValidationError` — "On hand cannot go below the quantity already reserved", with the reserved count in the field error |
| on hand changed at all (`delta !== 0`) | `admin.service.ts:132-137` | a `stock_move` row is written: `RECEIPT` if positive, `ADJUST` if negative |
| the `(warehouse, product)` pair has no row yet | `admin.service.ts:127-131` | `upsert` creates it; the audit action is `CREATE` instead of `UPDATE` (`:141`) |
| `priority` outside 1..1000 | `validation/admin.ts:49` | rejected by Zod |
| `leadDays` outside 0..365 | `validation/admin.ts:57` | rejected |
| `periods` outside 1..60 | `validation/admin.ts:64`, backed by `CHECK "recurring_plan_periods_positive"` (`migration.sql:1050`) | rejected |
| a plan's product select left blank | `plans/page.tsx:62` (`nullable`) | `null` — the plan works with any subscription product |
| plan `name` duplicated | `recurring_plan.name @unique` (`schema.prisma:725`) | `P2002` → "Already in use" on `name` |
| warehouse `name` duplicated | `warehouse.name @unique` (`schema.prisma:592`) | same |
| user picks themselves as manager | `admin.service.ts:217` | `ValidationError` — "A user cannot be their own manager" / "Pick someone else" |
| user id not found | `admin.service.ts:216` | `NotFoundError` — "User not found" |
| the manager select is left blank | `users/page.tsx:20` (`nullable`) | `managerId: null` |

## 6. Every action you can take here

All forms are `EntityForm` (`src/components/admin/entity-form.tsx:66-222`). The conversions (`entity-form.tsx:52-64`): `percent` and `rupees` both do `Math.round(Number(v) * 100)` (`:59`) — so Ship cost weighting `500` becomes `50000` paise; `number` does `Number(v)` (`:60`) — so Priority `1` stays `1` and Lead days `7` stays `7`; a blank on a `nullable` field becomes `null` (`:58`). Full explanation in `17-admin-product-detail.md` §6.

### 6.1 Save a warehouse

| Step | Path |
| --- | --- |
| button | "Save" per row / "Add warehouse" (`warehouses/page.tsx:46,49`) |
| action | `saveWarehouse` — `actions/admin.ts:66-68` |
| Zod | `warehouseSchema` — `validation/admin.ts:44-50`: `{ id?, name: zName, city: string.max(80).nullish(), shipCostWeight: zMoney, priority: int 1..1000 default 100 }` |
| guards | `parseInput`, then `requireActionUser(BACKEND_ROLES)` (`actions/admin.ts:37,40`). None in the service. |
| service | `admin.saveWarehouse` — `admin.service.ts:106-117`, via `saveRow` |
| tables | `warehouse`, `audit_log` |
| audit | `entityType: "Warehouse"`, before/after `{ name, city, shipCostWeight, priority }` (`:115`), `reason: null` |
| on screen | toast "`East Depot` saved"; `router.refresh()` |
| downstream | the next `proposePlan` call picks it up immediately (`fulfillment.service.ts:41`) — no restart |

### 6.2 Save a stock level

| Step | Path |
| --- | --- |
| button | "Save" per row / "Save stock level" (`warehouses/page.tsx:89,107`) |
| action | `saveStockLevel` — `actions/admin.ts:69-71` |
| Zod | `stockLevelSchema` — `validation/admin.ts:52-58`: `{ warehouseId, productId, onHand: int >= 0, reorderPoint: int >= 0 default 0, leadDays: int 0..365 default 7 }` |
| service | `admin.saveStockLevel` — `admin.service.ts:120-148`. **Not** `saveRow` — it needs the reserved check and the stock move, so it is a hand-written transaction. |
| tables | `stock_level` (upsert on the `(warehouseId, productId)` unique key), **`stock_move`** when the quantity changed, `audit_log` |
| audit | `entityType: "StockLevel"`, before `{ onHand, reorderPoint, leadDays }`, after `{ warehouseId, productId, onHand, reorderPoint, leadDays }` (`:138-145`) |
| on screen | toast "`Laptop 14"` at `Main Warehouse` saved"; the Available column recomputes on refresh |

The stock move (`admin.service.ts:132-137`):

```ts
const delta = input.onHand - (before?.onHand ?? 0);
if (delta !== 0) {
  await tx.stockMove.create({ data: {
    stockLevelId: row.id,
    type: delta > 0 ? "RECEIPT" : "ADJUST",
    qty: Math.abs(delta),
    note: `Admin set on hand to ${input.onHand}`,
    createdById: user.id,
  }});
}
```

All in the same transaction as the level update and the audit row. **This is why the ledger explains every level**: the only other writers of `on_hand` are `ship` (`fulfillment.service.ts:228`) and `receiveStock` (`:247-258`), and both write moves too. Sum the moves for a stock level and you should get its on-hand. There is no code that changes `on_hand` without a move.

`stock_move.qty` is always positive — the direction is carried by `type` (`schema.prisma:629`, and `CHECK "stock_move_qty_positive"` at `migration.sql:1037`).

### 6.3 Save a plan

| Step | Path |
| --- | --- |
| button | "Save" per row / "Add plan" (`plans/page.tsx:77,85`) |
| action | `savePlan` — `actions/admin.ts:72-74` |
| Zod | `planSchema` — `validation/admin.ts:60-70` |
| service | `admin.savePlan` — `admin.service.ts:150-170`, via `saveRow` |
| tables | `recurring_plan`, `audit_log` |
| audit | before/after `{ name, interval, periods, prorationMode, billChangeDay, cancelPolicy, refundMethod }` (`:168`) — `productId` is **not** in the projection, so re-binding a plan to a different product logs as a no-op |
| on screen | toast "`Monthly` saved" |
| downstream | `addLine` resolves plans on the next quote line (`quotation.service.ts:139-145`); confirm materialises the schedule (`billing.service.ts:67`) |

Enum values are fixed by Zod and by the database (`schema.prisma:34-55`): `interval` ∈ WEEK/MONTH/QUARTER/YEAR, `prorationMode` ∈ DAY_BASED/NONE, `cancelPolicy` ∈ END_OF_PERIOD/IMMEDIATE_PRORATED_REFUND/NO_REFUND, `refundMethod` ∈ CREDIT_NOTE/REFUND_PAYMENT.

### 6.4 Change a user's role or manager

| Step | Path |
| --- | --- |
| button | "Save" per row (`users/page.tsx:47`) |
| action | `setUserRole` — `actions/admin.ts:81-83`, **with `["ADMIN"]`** as the role list |
| Zod | `userRoleSchema` — `validation/admin.ts:98`: `{ userId: zId, role: enum(ADMIN|SALES_REP|SALES_MANAGER|FINANCE), managerId: zId.nullable().default(null) }` |
| guards | `parseInput`; `requireActionUser(["ADMIN"])`; then in the service, "user must exist" (`admin.service.ts:216`) and "not your own manager" (`:217`) |
| service | `admin.setUserRole` — `admin.service.ts:213-229`. Hand-written transaction, not `saveRow`, because the audit action is a distinct verb. |
| tables | `app_user`, `audit_log` |
| audit | `entityType: "User"`, **`action: "ROLE_CHANGE"`** (`:222`), before `{ role, managerId }`, after `{ role, managerId }` (`:224-225`). Complete and not lossy. |
| on screen | toast "`Riya Rao` updated" |
| downstream | takes effect on that user's **next request** — the middleware re-reads `user.role` from the row every time (`src/middleware.ts:47`), and so does the session helper. No logout needed. The service comment says exactly this (`admin.service.ts:212`). |

Role changes are therefore ADMIN-only and always audited with a dedicated action name, which makes "who promoted whom, and when" a one-line query against `audit_log` where `entity_type = 'User'`.

## 7. Scenarios

Group scenarios 1-9 are in `16-admin-products.md` §7; numbers 7 (on-hand below reserved), 8 (create a plan and attach it) and 9 (change a user's role) belong to this file. These are the extras.

### S18b-1 — Adding a third warehouse and watching a plan change

Add `West Hub`, city `Mumbai`, ship cost `300` (`30000` paise), priority `1`. Save.

`revalidatePath("/fulfillment")` fires (`actions/admin.ts:50`). The next time `proposePlan` runs for a confirmed order (`fulfillment.service.ts:57`), `loadStock` includes the new warehouse (`:41`) — but it has **no stock rows**, so `coverValue` returns 0 for it (`split.ts:16-22`) and it is never chosen (`split.ts:59` requires `v > bestValue`). Add stock on the stock grid and it starts winning immediately, because its ₹300 ship cost puts it first in `ordered` (`split.ts:12`).

Nothing is cached and there is no restart.

### S18b-2 — Two warehouses with identical ship cost

Set both Main and East to `500`. Now `a.shipCostWeight - b.shipCostWeight` is 0 and `priority` decides (`split.ts:12`): Main (priority 1) sorts before East (priority 2). Where does that actually matter? In step 3 — if both could ship the whole order, the cheapest-first `.find` (`split.ts:49`) now returns Main because the tie-break put it first. Swap the priorities and East wins the single-shipment plan instead.

### S18b-3 — Receiving stock from the fulfilment side, not here

`receiveStock` (`fulfillment.service.ts:247-258`) is the operations counterpart of the admin stock form: it adds units, writes a `stock_move`, and writes an audit row with `action: "STOCK_RECEIPT"` (`:258`). The admin form's audit action is plain `CREATE`/`UPDATE` with `note: "Admin set on hand to N"` on the move (`admin.service.ts:135`). So in the ledger you can always tell a real receipt from an administrative correction — by the move's `note` and by the audit action.

The dev database's audit log shows exactly this: rows with `action = STOCK_RECEIPT` and `after_json = {"qty": 500, "productId": 1, "warehouseId": 23}` from the fulfilment path, alongside `CREATE`/`UPDATE` rows from the admin path.

### S18b-4 — Setting on hand to exactly the reserved quantity

`on_hand = 4`, `reserved = 4`. The guard is `input.onHand < before.reserved` (`admin.service.ts:124`), so `4` is allowed — equal is fine. Available becomes 0, the split can place nothing from that warehouse, and the Postgres CHECK `reserved <= on_hand` (`migration.sql:1036`) is still satisfied. Type `3` and the service refuses before touching the database.

### S18b-5 — A plan with `NONE` proration

Create `Monthly (no proration)` with Proration = `None`. Attach it to a subscription line. On a mid-cycle quantity change, `prorate({ ..., mode: "NONE", ... })` (`subscription.service.ts:38`) returns no credit and no charge, so `result.net === 0` — neither the `if (result.net > 0)` invoice branch nor the `else if (result.net < 0)` credit-note branch runs (`subscription.service.ts:50,84`). The subscription's quantity still changes and every future scheduled period is re-priced at the new quantity (`:91-93`). The customer simply is not billed or credited for the part-period.

Cancellation on the same plan with `IMMEDIATE_PRORATED_REFUND` also produces `credit = 0` (`:153-154`), so no credit note is issued (`:155`).

### S18b-6 — `REFUND_PAYMENT` without a paid invoice

Set a plan's "Refund as" to `Refund payment`, then cancel a subscription whose most recent RECURRING invoice is still unpaid. At `subscription.service.ts:157-158`:

```ts
const paidInvoice = sub.invoices[0]?.status === "PAID" ? sub.invoices[0] : null;
const refund = sub.plan.refundMethod === "REFUND_PAYMENT" && paidInvoice;
```

`paidInvoice` is null, so `refund` is falsy: a credit note is created with status `OPEN` and **no** `payment` row. The setting degrades gracefully rather than failing — but it means "Refund payment" does not guarantee a payment; it guarantees one only when there is a paid invoice to refund against.

### S18b-7 — Demoting the only Admin

Nothing stops you. `setUserRole` checks only that the user exists and is not their own manager (`admin.service.ts:216-217`). There is no "last admin" guard and no self-demotion guard: an Admin can set their own role to `SALES_REP`, at which point `/admin/users` becomes unreachable for them (`users/page.tsx:15`) and, since middleware also blocks non-`BACKEND_ROLES` from `/admin` (`middleware.ts:25`), the entire admin area is gone. Recovery would be a SQL update. Worth knowing before you demo.

### S18b-8 — Making someone their own manager, and manager loops

Picking yourself is blocked with a clear field error (`admin.service.ts:217`). A **cycle** is not: A reports to B, B reports to A is accepted, because the check is a single-hop equality test. `manager_id` is a self-relation (`schema.prisma:200-202`) with no cycle constraint. Nothing today walks the chain recursively, so a loop is inert rather than dangerous — but it is unvalidated.

Also note the manager options list is `role === "SALES_MANAGER" || role === "ADMIN"` computed from the **already-loaded** page data (`users/page.tsx:17`). Promote someone to Sales Manager and they only appear in other rows' manager dropdowns after the page refreshes.

## 8. Schema behind this screen

**Warehouse** — `prisma/schema.prisma:590-605`, table `warehouse`:

```prisma
model Warehouse {
  id             Int       @id @default(autoincrement())
  name           String    @unique
  city           String?
  shipCostWeight Int       @map("ship_cost_weight")  // paise per shipment, used by the split tie-break
  priority       Int       @default(100)
  archivedAt     DateTime? @map("archived_at")
  ...
}
```

**StockLevel** — `prisma/schema.prisma:607-623`, table `stock_level`, with the model comment "available = on_hand - reserved. CHECK constraints keep both non-negative."

```prisma
warehouseId  Int @map("warehouse_id")
productId    Int @map("product_id")
onHand       Int @default(0) @map("on_hand")
reserved     Int @default(0)
reorderPoint Int @default(0) @map("reorder_point")
leadDays     Int @default(7) @map("lead_days")
@@unique([warehouseId, productId])
```

That composite unique is the key `saveStockLevel` upserts on (`admin.service.ts:122`). Both relations are `onDelete: Cascade`.

The constraint that makes `reserved` safe (`prisma/migrations/20260905095100_init/migration.sql:1036`):

```sql
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_non_negative"
  CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand");
```

Friendly message: "Stock cannot go negative or be reserved beyond what is on hand" (`contract.ts:125`).

**StockMove** — `prisma/schema.prisma:625-640`, table `stock_move`. `type` is `StockMoveType`; `qty` is always positive ("signed effect is implied by type", `:629`); optional `quotation_id` and `shipment_id` tie a move to the order that caused it; `created_by_id` records who. Indexed on `(stock_level_id, created_at)` (`:638`) so the ledger for one shelf is a fast ordered read.

**RecurringPlan** — `prisma/schema.prisma:723-741`, table `recurring_plan`:

```prisma
name          String          @unique
interval      BillingInterval
periods       Int             @default(12)   // schedule horizon materialised on confirm
prorationMode ProrationMode   @default(DAY_BASED) @map("proration_mode")
billChangeDay Boolean         @default(true)     @map("bill_change_day")
cancelPolicy  CancelPolicy    @default(IMMEDIATE_PRORATED_REFUND) @map("cancel_policy")
refundMethod  RefundMethod    @default(CREDIT_NOTE) @map("refund_method")
productId     Int?            @map("product_id")  // null = usable with any subscription product
archivedAt    DateTime?       @map("archived_at")
```

CHECK: `recurring_plan_periods_positive` (`migration.sql:1050`), friendly message "A plan needs at least one period" (`contract.ts:131`).

**User** — `prisma/schema.prisma:191-208`, table `app_user`. `email` unique, `role` defaults to `SALES_REP` (`:196`) so a self-signup is always a rep, `managerId` is a self-relation named `"UserManager"` (`:201-202`), `isActive` gates login (`auth/internal.ts:21`) and session validity (`middleware.ts:48`).

## 9. How these screens connect to the others

- **← `/admin`**: three of the six cards (`admin/page.tsx:11,12,14`).
- **← Screen 17**: a non-subscription product's "Quantity on hand" card links here with "Edit stock levels" (`products/[id]/page.tsx:176`); a subscription product's "Recurring" card links to `/admin/plans` (`:163`).
- **→ Screen 7 / 8, Fulfillment**: `proposePlan` reads warehouses and stock live (`fulfillment.service.ts:41-42`); `acceptPlan` reserves against these rows (`:106`); `ship` decrements them (`:228`). A warehouse save revalidates `/fulfillment` (`actions/admin.ts:50`).
- **→ Screen 4, the quote builder**: plan resolution for subscription lines (`quotation.service.ts:139-145`).
- **→ Screen 9 / 10, Subscriptions**: proration, cancellation and refund behaviour all come from the plan row (`subscription.service.ts:38-39,146,158`).
- **→ Screen 12 / 13, Invoices**: `interval` and `periods` produce the schedule and the first invoice (`billing.service.ts:67,84-100`).
- **→ Screen 5 / 6, Approvals**: `app_user.role` decides who can act on an approval step; `manager_id` is who a rep's quotes escalate to.
- **→ Screen 14, Deal Health**: `manager_id` is who gets the nudge (`users/page.tsx:24` states the purpose).

## 10. Gotchas

1. **`reserved` has no admin surface, deliberately — but also no reconciliation.** If a fulfilment transaction ever left a stale reservation, nothing on this screen can clear it, and `saveStockLevel` will then refuse to lower on-hand below it (`admin.service.ts:124`). The only fix would be SQL.

2. **Nothing archives a warehouse or a plan.** Both tables have `archived_at` and six queries filter on it, but no code sets it. Same story as products.

3. **The seed footnote on `/admin/warehouses` is hardcoded.** "Main Warehouse ₹500.00, East Depot ₹800.00" is literal JSX (`warehouses/page.tsx:113`). Change the values above it and the footnote keeps saying 500 and 800.

4. **The plan audit projection drops `productId`.** `admin.service.ts:168` omits it, so re-binding a plan from "any product" to "Support Pro" produces an audit row whose before and after are identical. Same lossiness as the product description on Screen 17.

5. **`recurring_plan.archivedAt` filtering is inconsistent with plan resolution.** `getPlans` and the Screen 17 card filter `archivedAt: null` (`admin.service.ts:259,303`), and so does `addLine` (`quotation.service.ts:140,142`) — but `product.plans` inside `addLine` is loaded with `where: { archivedAt: null }` at `:132`, so an archived plan already attached to an existing subscription keeps working. That is correct behaviour, just not obvious.

6. **A stock level can be created for a product that later becomes a subscription.** The picker filters `kind: "GOOD"` (`admin.service.ts:252`), but the row survives a later kind change and simply becomes unreachable from the grid. See `17-admin-product-detail.md` S17-5.

7. **`admin.service.ts` still has no role guard of its own.** `saveWarehouse` (`:106`), `saveStockLevel` (`:120`), `savePlan` (`:150`) and `setUserRole` (`:213`) all take a `SessionUser` and never check `user.role`. `setUserRole`'s doc comment even says "Admin only (checked by the action)" (`admin.service.ts:212`) — an explicit admission that the guard lives elsewhere. Called directly with a `SALES_REP` session, `setUserRole` would happily promote somebody and log that rep as the actor. Enforcement is `middleware.ts:25`, `admin/layout.tsx:7`, each page's `requireUser`, and `actions/admin.ts:40`. Compare `subscription.service.ts:17,135` and `fulfillment`, which check `OPS_ROLES` inside the service.

8. **Admin saves store `reason: null`.** Every save on these three pages goes through `audit()` without a reason (`admin.service.ts:38-45,101,138,219`; `audit.ts:36`). The spec asks for edits to be logged with a reason (docs/DealFlow360.txt:130-131). Actor and timestamp are recorded; reason is not.

9. **The dev database is polluted.** `/admin/warehouses` currently shows ten warehouses including `MX Depot` (ship cost `1` paisa, priority 1 — it would win every split) and `Smoke Depot`, and a stock row of 3,498 units. `/admin/plans` shows twelve plans with names like `MONTH admmtomntye`. Only `Main Warehouse`, `East Depot`, `Monthly`, `Quarterly`, `Yearly` and the five `@test.com` users come from `prisma/seed/`.
