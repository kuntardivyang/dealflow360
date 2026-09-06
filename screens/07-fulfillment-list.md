# Screen 07 — Fulfillment and Stock (list)

Route: `/fulfillment`
File: `src/app/(internal)/fulfillment/page.tsx`
Spec: `docs/DealFlow360.txt` A4 (line 135) and B6 (line 239). Mockup: `docs/MOCKUP_SCREENS.md` section "7. Fulfillment List", image `docs/mockup/07-fulfillment-list.png`.

---

## 1. What this screen is

Two tables on one page.

1. **Stock** — every `stock_level` row in the database: warehouse, product, In Stock, Reserved, Available. This is the live inventory. Nothing is filtered out, so every warehouse and every product that has ever had a stock row appears.
2. **Orders awaiting fulfillment** — every quotation whose status is `CONFIRMED` or `FULFILLMENT`, with the state of its current fulfillment plan and which warehouses that plan uses. Click a row to open Screen 08.

Between the two, if your role permits, there is a small **Receive stock** form that simulates a delivery arriving at a warehouse.

There is no filter, no search, no pagination, and no sorting control. The page is `export const dynamic = "force-dynamic"` (`page.tsx:12`), so every visit re-reads the database — the stock numbers are never cached.

---

## 2. Who can open it, and who enforces that

| Who | Can open `/fulfillment`? | Sees "Receive stock"? | Enforced at |
| --- | --- | --- | --- |
| Anyone not logged in | No — redirected to `/login?next=/fulfillment` | – | `src/middleware.ts:35-42` (first gate), then `src/lib/auth/internal.ts:75-80` via `requireUser` at `page.tsx:15` |
| SALES_REP | Yes | No | `page.tsx:26` — `OPS_ROLES.includes(user.role)` |
| SALES_MANAGER | Yes | Yes | `src/lib/contract.ts:65` — `OPS_ROLES = ["ADMIN", "FINANCE", "SALES_MANAGER"]` |
| FINANCE | Yes | Yes | same |
| ADMIN | Yes | Yes | same |

Three points worth being precise about.

- **`requireUser` is called with no role list** (`page.tsx:15` passes only the `nextPath`). Look at `src/lib/auth/internal.ts:78`: the role check only runs `if (roles && roles.length > 0)`. There is no list, so the check is skipped. **Every logged-in internal user can open this page**, including a Sales Rep, and every Sales Rep can read every warehouse's stock for every product.
- The middleware (`src/middleware.ts:25-30`) only role-gates `/admin`. `/fulfillment` passes through on any valid session.
- The nav tab "Fulfillment" has no `roles` field (`src/lib/nav.ts:12`), so it is visible to all four roles.

**The quirk you were told to expect:** a SALES_REP may accept a warehouse split but may not mark a shipment shipped. That is enforced on Screen 08, not here, and it comes from two different lists in the same file:

- `src/lib/state/quotation.machine.ts:38` — `ACCEPT_SPLIT: ["FINANCE", "SALES_MANAGER", "ADMIN", "SALES_REP"]`
- `src/lib/state/quotation.machine.ts:39` — `SHIP: ["FINANCE", "SALES_MANAGER", "ADMIN"]`

On *this* screen the same asymmetry shows up as: a Sales Rep sees all the stock but no **Receive stock** form, because `canReceive` (`page.tsx:26`) uses `OPS_ROLES`, which excludes `SALES_REP`.

---

## 3. Everything on the screen, and where each value comes from

### Page header

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Title | "Fulfillment and Stock" | Hard-coded, `page.tsx:71` | – | Copied from the mockup text |
| Sub-line | "Live stock per warehouse, plus every confirmed order that still needs fulfilling." | Hard-coded, `page.tsx:71` | – | Copied from the mockup |
| Red error strip (only after a failed Receive stock) | "Only Finance, a Sales Manager or an Admin can record stock" | `page.tsx:72` reads `searchParams.error` | – | Written into the URL by `receiveStockForm` → `errorQuery` (`src/app/(internal)/actions/fulfillment.ts:87`, `src/lib/contract.ts:165-168`) |

### Stock table

Rows come from one query: `prisma.stockLevel.findMany(...)` at `page.tsx:17`, with `include: { warehouse: true, product: true }` and `orderBy: [{ warehouse: { priority: "asc" } }, { product: { name: "asc" } }]`.

| What you see | Example value (seed) | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Warehouse | "Main Warehouse" | `page.tsx:17` include, cell at `page.tsx:30` | `warehouse.name` | Created by the seed: `prisma/seed/a-stock.ts:9` creates Main Warehouse (Ahmedabad, `shipCostWeight` ₹500, priority 1); `a-stock.ts:10` creates East Depot (Kolkata, ₹800, priority 2). Admins can add more at `/admin/warehouses`. |
| Product | `Laptop 14"` | `page.tsx:17` include, cell at `page.tsx:31` | `product.name` | Seeded at `prisma/seed/a-catalogue.ts:19-20` (`HW-LAP-14`, kind `GOOD`, list price ₹60,000) |
| **In Stock** | `6` | `page.tsx:32` | `stock_level.on_hand` | Three ways only: (a) the seed inserted it — `prisma/seed/a-stock.ts:13` sets Main/Laptop 14" to 6; (b) somebody used **Receive stock** on this page, which does `onHand: { increment: qty }` (`src/services/fulfillment.service.ts:255`); (c) a shipment was marked shipped, which does `on_hand = on_hand - qty` (`fulfillment.service.ts:228`). Nothing else in the codebase writes `on_hand`. |
| **Reserved** | `0` (fresh seed) | `page.tsx:33` | `stock_level.reserved` | Two ways only: (a) somebody accepted a split — `reserved = reserved + qty` (`fulfillment.service.ts:106`); (b) somebody marked a shipment shipped — `reserved = reserved - qty` in the same statement that drops `on_hand` (`fulfillment.service.ts:228`). The seed always leaves `reserved` at its default `0` (`prisma/schema.prisma:612`). |
| **Available** | `6` | Computed in the cell: `{s.onHand - s.reserved}` at `page.tsx:38` | **no column** | Derived, never stored. The same subtraction is done again in the service when it builds the split input (`fulfillment.service.ts:46`: `available: r.onHand - r.reserved`) and in the schema comment (`prisma/schema.prisma:606`). |
| Available shown in orange | `2` for Monitor 27" at Main (reorder point 3) | `page.tsx:38` — `s.onHand - s.reserved <= s.reorderPoint ? "text-warning" : ""` | `stock_level.reorder_point` | Seeded per row (`a-stock.ts:13-20`); editable at `/admin/warehouses`. This is the only place `reorder_point` is used on this screen. |

`lead_days` is on the row but is **not shown** here. It is read only when a backorder is created (Screen 08, `fulfillment.service.ts:44, 79`).

**The invariant behind Available.** The database refuses to let `reserved` exceed `on_hand`:

```sql
-- prisma/migrations/20260905095100_init/migration.sql:1036
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_non_negative"
  CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand");
```

So `available = on_hand - reserved` can never be negative at rest. In practice the constraint almost never fires, because both writing paths guard themselves first: the reserve does `... WHERE id = $1 AND on_hand - reserved >= $2` (`fulfillment.service.ts:106`) and the ship does `... WHERE id = $1 AND reserved >= $2 AND on_hand >= $2` (`fulfillment.service.ts:228`), and each treats "0 rows updated" as a 409. If the CHECK ever did fire, `src/lib/contract.ts:125` turns it into the message "Stock cannot go negative or be reserved beyond what is on hand".

### Receive stock card (`page.tsx:79-108`, only when `canReceive`)

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Warehouse dropdown | "Main Warehouse", "East Depot" | `page.tsx:23` — `warehouse.findMany({ where: { archivedAt: null }, orderBy: { priority: "asc" } })` | `warehouse.name`, `warehouse.id` | Seed (`a-stock.ts:9-10`) plus anything added at `/admin/warehouses`. Archived warehouses are excluded. |
| Product dropdown | `Laptop 14"`, `Laptop 16"`, `Docking Station`, `Monitor 27"` | `page.tsx:24` — `product.findMany({ where: { kind: "GOOD", archivedAt: null } })` | `product.name`, `product.kind` | Only `GOOD` products. Services (`Setup Service`) and subscriptions (`Support Pro`) are absent by design — they have no stock. |
| Quantity | `5` | Hard-coded `defaultValue={5}`, `page.tsx:100` | – | Just a convenient default |
| Helper text | "Simulates a delivery arriving at a warehouse." | Hard-coded, `page.tsx:104` | – | – |

### Orders awaiting fulfillment table

Rows come from `prisma.quotation.findMany(...)` at `page.tsx:18-22`.

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Order | `Q-2026-0325` | `page.tsx:52` | `quotation.number` | Assigned when the quotation was created, from the `number_sequence` counter |
| Customer | "Acme Corp" | `page.tsx:18` include `customer: true`, cell `page.tsx:53` | `customer.name` | Seeded in `prisma/seed/a-customers.ts`; picked on the quotation form |
| Status | "Split Pending" | `page.tsx:56-61` via `stateOf` (`page.tsx:43-50`) then `StatusBadge` | derived — see below | – |
| Warehouses | "Main Warehouse + East Depot" | `page.tsx:65` | `warehouse.name` of each `fulfillment_line.warehouse_id`, de-duplicated | Written when the plan was proposed (`fulfillment.service.ts:73`) or overridden (`fulfillment.service.ts:201`) |

**The Status column is fully derived — there is no status column for it.** `stateOf` (`page.tsx:43-50`) reads the newest non-superseded plan and returns one of five strings:

| Returned | Condition (`page.tsx`) | Rendered as |
| --- | --- | --- |
| `NO_STOCK_LINES` | `!plan` — the order has no fulfillment plan at all (line 45) | plain grey text "Nothing to ship" (line 59) |
| `PROPOSED` | `plan.status === "PROPOSED"` (line 46) | badge **Split Pending** (`src/components/shared/status-badge.tsx:43`) |
| `SHIPPED` | plan has at least one shipment and *every* shipment is `SHIPPED` (line 47) | badge **Shipped** (`status-badge.tsx:45`) |
| `BACKORDER` | any `fulfillment_line.is_backorder` is true (line 48) | badge **Backorder** (`status-badge.tsx:46`) |
| `RESERVED` | everything else — accepted, shipments open, nothing backordered (line 49) | badge **Reserved** (`status-badge.tsx:44`) |

The order of those `if`s matters: an accepted plan with one shipped shipment and a leftover backorder line reports `BACKORDER`, not `SHIPPED`, because line 47 requires *every* shipment shipped and there is still one open.

**"Warehouses" when a line is backordered.** Line 65 maps each fulfillment line to `l.warehouse?.name ?? "Backorder"`. A backordered line has `warehouse_id = NULL`, so the cell reads e.g. "Main Warehouse + Backorder". If a plan is entirely backordered the cell is just "Backorder". If there is no plan at all the `|| "–"` fallback gives a dash.

---

## 4. The queries this page runs

Four queries, fired in parallel with `Promise.all` at `page.tsx:16-25`, after `requireUser` resolves (`page.tsx:15`).

1. **Stock** — `page.tsx:17`
   `prisma.stockLevel.findMany({ include: { warehouse: true, product: true }, orderBy: [{ warehouse: { priority: "asc" } }, { product: { name: "asc" } }] })`
   No `where`. Every stock row in the system, including rows for archived warehouses and archived products. Sorted by warehouse priority, then product name.
2. **Orders** — `page.tsx:18-22`
   `prisma.quotation.findMany({ where: { status: { in: ["CONFIRMED", "FULFILLMENT"] } }, include: { customer: true, fulfillmentPlans: { where: { status: { not: "SUPERSEDED" } }, orderBy: { id: "desc" }, take: 1, include: { lines: { include: { warehouse: true } }, shipments: true } } }, orderBy: { confirmedAt: "desc" } })`
   Note the nested `take: 1` with `orderBy: { id: "desc" }` — only the **newest non-superseded plan** is loaded, so a manual override that superseded the automatic proposal is invisible here. Orders that reached `PAID` or `CANCELLED` drop off this list entirely.
3. **Warehouses** — `page.tsx:23` — non-archived, for the Receive stock dropdown. Loaded even for a Sales Rep who never sees the form.
4. **Goods** — `page.tsx:24` — `kind: "GOOD"`, non-archived, for the same dropdown.

There is no `select` narrowing on the stock query, so `lead_days`, `reorder_point` and `updated_at` all travel to the server component even though only `reorder_point` is used.

---

## 5. Every condition on this page

| Condition | Where | What happens |
| --- | --- | --- |
| No valid `df_session` cookie | `src/middleware.ts:21-33` then `internal.ts:77` | Redirect to `/login?next=%2Ffulfillment` |
| `searchParams.error` present | `page.tsx:72` | Red strip above the tables |
| Stock table has zero rows | `page.tsx:76` | `EmptyState` "No stock rows" |
| `on_hand - reserved <= reorder_point` | `page.tsx:38` | The Available number turns orange (`text-warning`) |
| `OPS_ROLES.includes(user.role)` | `page.tsx:26, 79` | The Receive stock card renders; otherwise it is not in the HTML at all |
| Orders table has zero rows | `page.tsx:117` | `EmptyState` "Nothing to fulfill yet / Confirmed orders appear here with their recommended warehouse split." |
| `o.fulfillmentPlans[0]` is undefined | `page.tsx:45, 59` | Grey "Nothing to ship" instead of a badge |
| Plan is `PROPOSED` | `page.tsx:46` | Badge "Split Pending" |
| Every shipment `SHIPPED` and there is at least one | `page.tsx:47` | Badge "Shipped" |
| Any line `is_backorder` | `page.tsx:48` | Badge "Backorder" |
| Otherwise | `page.tsx:49` | Badge "Reserved" |
| Any row clicked | `page.tsx:116` | Navigate to `/fulfillment/{publicId}` (client-side push in `src/components/shared/clickable-row.tsx:14`, which ignores clicks that land on an `a`, `button`, `input` or `select`) |

---

## 6. Every action you can take here

### A. Click an order row

Not a server action. `rowHref` (`page.tsx:116`) becomes `router.push("/fulfillment/" + publicId)` in `ClickableRow` (`clickable-row.tsx:14`). The URL uses `quotation.public_id` (a 12-character opaque id), never the numeric `id`.

### B. Record receipt (Receive stock)

```
button "Record receipt" (page.tsx:101)
  → form action receiveStockForm            (src/app/(internal)/actions/fulfillment.ts:85)
  → receiveStock(input)                     (actions/fulfillment.ts:60)
  → Zod: stockReceiptSchema                 (src/lib/validation/fulfillment.ts:18)
  → service: fulfillment.receiveStock       (src/services/fulfillment.service.ts:247)
```

**The form fields** (`page.tsx:86-100`) are `warehouseId`, `productId`, `qty`. `receiveStockForm` also hard-codes `note: "Manual receipt"` (`actions/fulfillment.ts:86`).

**Zod schema** (`validation/fulfillment.ts:18`):
`{ warehouseId: zId, productId: zId, qty: zQty, note: string().max(200).optional() }` where `zId` is a coerced positive integer (`validation/common.ts:19`) and `zQty` is a coerced integer 1..100000 (`common.ts:18`). A blank or zero qty fails here and never reaches the service.

**Guards, in the order they run:**

1. `parseInput(stockReceiptSchema, input)` — `actions/fulfillment.ts:61`. Failure → `{ ok:false, code:"VALIDATION" }`.
2. `requireActionUser(["ADMIN", "FINANCE", "SALES_MANAGER"])` — `actions/fulfillment.ts:64`. No session → `UnauthenticatedError`; wrong role → `ForbiddenError` "You do not have access to this area" (`internal.ts:66, 89`).
3. `OPS_ROLES.includes(user.role)` again inside the service — `fulfillment.service.ts:248`, message "Only Finance, a Sales Manager or an Admin can record stock". Belt and braces: the service is safe even if some other caller skips step 2.
4. Integer/positive re-check — `fulfillment.service.ts:249`.

**Tables written** (one transaction, `fulfillment.service.ts:250`):

- `stock_level` — `upsert` on the unique `(warehouse_id, product_id)` key (`fulfillment.service.ts:252-256`). If the row exists: `on_hand` incremented. If it does not exist: a new row is created with `on_hand = qty`, and `reserved`, `reorder_point` default to 0 and `lead_days` to 7 (`prisma/schema.prisma:612-615`).
- `stock_move` — one row, `type = 'RECEIPT'`, `qty`, `note`, `created_by_id` (`fulfillment.service.ts:257`). `quotation_id` and `shipment_id` stay null: a receipt belongs to no order.

**Audit row** — `audit_log` with `entityType: "StockLevel"`, `action: "STOCK_RECEIPT"`, `after: { warehouseId, productId, qty }` (`fulfillment.service.ts:258`). Note there is **no `quotationId`**, so this event does not appear on any quotation's audit trail and does not bump `quotation.last_activity_at` (`src/lib/audit.ts:41-43`).

**What changes on screen:** `refresh()` calls `revalidatePath` for `/fulfillment` and `/quotes` (`actions/fulfillment.ts:21-22`), then `receiveStockForm` redirects back to `/fulfillment` (`actions/fulfillment.ts:87`). The In Stock and Available numbers for that row go up by `qty`. Reserved does not move. No fulfillment plan anywhere is recalculated — see Gotchas.

---

## 7. Scenarios

All arithmetic below uses the **seeded** stock (`prisma/seed/a-stock.ts:13-20`), because the dev database currently holds leftovers from earlier test runs:

| Warehouse | Product | on_hand | reserved | available | reorder_point | lead_days |
| --- | --- | --- | --- | --- | --- | --- |
| Main Warehouse (ship cost ₹500, priority 1) | Laptop 14" | 6 | 0 | 6 | 4 | 7 |
| East Depot (ship cost ₹800, priority 2) | Laptop 14" | 5 | 0 | 5 | 2 | 10 |
| Main Warehouse | Laptop 16" | 3 | 0 | 3 | 1 | 14 |
| East Depot | Laptop 16" | 0 | 0 | 0 | 1 | 14 |
| Main Warehouse | Docking Station | 20 | 0 | 20 | 5 | 5 |
| East Depot | Docking Station | 0 | 0 | 0 | 5 | 5 |
| Main Warehouse | Monitor 27" | 2 | 0 | 2 | 3 | 7 |
| East Depot | Monitor 27" | 10 | 0 | 10 | 3 | 7 |

1. **A Sales Rep opens the page.** `requireUser` (`page.tsx:15`) passes because no role list is given. All 8 stock rows render. `canReceive` is false (`page.tsx:26`), so the Receive stock card is absent from the HTML. Every confirmed order is still listed and clickable.
2. **Fresh seed, nothing confirmed yet.** The orders query (`page.tsx:18`) returns the seeded `FULFILLMENT` order plus any confirmed ones; on a bare `a-*` seed the orders list can be empty and shows "Nothing to fulfill yet".
3. **Monitor 27" at Main shows orange.** `on_hand 2 - reserved 0 = 2`, `reorder_point 3`, so `2 <= 3` and `page.tsx:38` adds `text-warning`. East Depot's Monitor row (10 available, reorder 3) stays black. Nothing else happens — this is a colour, not an alert; no reorder is created anywhere in the codebase.
4. **An order for 10 Laptop 14" plus 10 Docking Stations is confirmed.** The confirm transaction proposes a plan (`src/services/portal-hooks.ts:11`). Nothing on this screen changes yet except that the order appears with **Split Pending** and Warehouses "Main Warehouse + East Depot". Reserved is still 0 everywhere — a *proposal reserves nothing*.
5. **The split is accepted on Screen 08.** Now the stock table changes: Main/Laptop 14" becomes on_hand 6, reserved 6, available 0 (turns orange, `0 <= 4`); Main/Docking Station becomes 20 / 10 / 10; East/Laptop 14" becomes 5 / 4 / 1 (orange, `1 <= 2`). The order's badge flips from "Split Pending" to **Reserved** (`page.tsx:49`), because the plan is now `ACCEPTED` with two open shipments and no backorder lines.
6. **The Main shipment is marked shipped.** `on_hand` and `reserved` both fall by the shipped quantities (`fulfillment.service.ts:228`): Main/Laptop 14" 0 / 0 / 0, Main/Docking Station 10 / 0 / 10. The order badge stays **Reserved**, because `stateOf` line 47 needs *every* shipment shipped and East's is still open.
7. **The East shipment is marked shipped too.** East/Laptop 14" becomes 1 / 0 / 1. Now `plan.shipments.every(s => s.status === "SHIPPED")` is true and the badge reads **Shipped** — but only if the order is still `CONFIRMED` or `FULFILLMENT`. If the shipping also flipped it to `PAID` (`fulfillment.service.ts:237-239`), the `where` at `page.tsx:19` no longer matches and **the order disappears from this list entirely**.
8. **An order for 12 Laptop 14".** Main covers 6, East covers 5, one unit has nowhere to go. The plan gets a `fulfillment_line` with `warehouse_id = NULL` and `is_backorder = true`. The Warehouses cell reads "Main Warehouse + East Depot + Backorder" (`page.tsx:65`). After acceptance the badge is **Backorder** (line 48 wins over line 49).
9. **An order for services only** (e.g. 2 × Training Day). `proposePlan` loads only `kind: "GOOD"` lines (`fulfillment.service.ts:32-34`), finds none, and returns `null` at line 59 — **no `fulfillment_plan` row is ever created**. The order still appears in this list because its status is `CONFIRMED`, and the Status cell shows plain grey "Nothing to ship" (`page.tsx:59`) with "–" under Warehouses.
10. **Finance records a receipt of 5 Docking Stations at East Depot.** East/Docking Station goes from on_hand 0 to 5, available 0 to 5, and the orange styling clears only if 5 > reorder_point 5 — it is not, so `5 <= 5` and the cell **stays orange**. A `stock_move` row of type `RECEIPT` is written (`fulfillment.service.ts:257`). Existing backorders for docks are **not** re-planned and no prompt appears anywhere.
11. **A Sales Rep POSTs the Receive stock form anyway** (the card is not rendered, but a crafted request is possible). `requireActionUser(["ADMIN","FINANCE","SALES_MANAGER"])` at `actions/fulfillment.ts:64` throws `ForbiddenError`; `toActionError` turns it into `{ code: "FORBIDDEN" }` (`contract.ts:159-160`); `receiveStockForm` redirects to `/fulfillment?error=You%20do%20not%20have%20access%20to%20this%20area` (`actions/fulfillment.ts:87`) and `page.tsx:72` prints it in red.
12. **Receiving a product into a warehouse that has never stocked it.** The `upsert` (`fulfillment.service.ts:252`) has no matching `(warehouse_id, product_id)` row, so it **creates** one with `lead_days = 7` (the schema default, `prisma/schema.prisma:615`) and `reorder_point = 0`. A brand-new row appears in the stock table on the next render.

---

## 8. Schema behind this screen

`prisma/schema.prisma`, tables created in `prisma/migrations/20260905095100_init/migration.sql`.

**`warehouse`** (`schema.prisma:590-604`, migration line 382)

| Column | Notes |
| --- | --- |
| `name` | unique |
| `city` | nullable |
| `ship_cost_weight` | integer paise **per shipment**. Seeded ₹500 for Main, ₹800 for East. Used to order warehouses in the split (`src/domain/split.ts:12`) and as the entire cost estimate (`split.ts:45`). |
| `priority` | default 100; the tie-break after cost (`split.ts:12`) and the sort order of the stock table (`page.tsx:17`) |
| `archived_at` | nullable; archived warehouses are excluded from the dropdown (`page.tsx:23`) and from planning (`fulfillment.service.ts:41`) but their stock rows still show in the stock table |

**`stock_level`** (`schema.prisma:607-623`, migration line 395)

| Column | Notes |
| --- | --- |
| `warehouse_id`, `product_id` | `@@unique([warehouseId, productId])` — one row per pair, which is what makes the `upsert` in `receiveStock` safe |
| `on_hand` | default 0 |
| `reserved` | default 0 |
| `reorder_point` | default 0 |
| `lead_days` | default 7 — read only when a backorder date is computed |
| `updated_at` | `@updatedAt`; the raw SQL updates set `updated_at = now()` by hand (`fulfillment.service.ts:106, 228`) because raw SQL bypasses Prisma's `@updatedAt` |
| CHECK `stock_level_non_negative` | migration line 1036 — `on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand` |

There is **no `available` column.** Every appearance of "Available" in the app is `on_hand - reserved` computed at read time.

**`stock_move`** (`schema.prisma:625-640`, migration line 409) — an append-only ledger. `type` is `RESERVE | RELEASE | SHIP | RECEIPT | ADJUST` (`schema.prisma:101-107`). The sign is implied by the type, never stored. **`RELEASE` and `ADJUST` are never written by any code in `src/`** — I grepped; only `RESERVE`, `SHIP` and `RECEIPT` are produced.

**`fulfillment_plan`**, **`shipment`**, **`fulfillment_line`** — described in full on Screen 08. This screen touches only `fulfillment_plan.status`, `shipment.status`, `fulfillment_line.warehouse_id` and `fulfillment_line.is_backorder`.

---

## 9. How this screen connects to the others

- **Comes from** Screen 04 (Quotation detail) / Screen 11 (customer portal). A quotation becomes visible here the instant it turns `CONFIRMED`, because the confirm transaction both sets the status and calls `onConfirmedHooks` (`src/services/order.service.ts:48` for confirm-on-behalf, `src/services/portal.service.ts:153` for the customer portal).
- **Goes to** Screen 08 (`/fulfillment/{publicId}`) on a row click.
- **Feeds Screen 12/13 (Invoices)**: marking the last shipment shipped can flip the quotation to `PAID` when every invoice is already settled (`fulfillment.service.ts:235-241`), which removes the row from this list. The mirror-image rule lives in billing: recording the final payment flips the order to `PAID` only when no shipment is still `RESERVED` and no plan is still `PROPOSED` (`src/services/billing.service.ts:183-189`).
- **Admin screen `/admin/warehouses`** is where `ship_cost_weight`, `priority`, `reorder_point` and `lead_days` are edited — the numbers this screen displays and the split algorithm consumes.
- **`/quotes`** is revalidated alongside `/fulfillment` after every fulfillment action (`actions/fulfillment.ts:21`).

---

## 10. Gotchas

1. **Any logged-in user can read the whole inventory.** `requireUser()` here is called without a role list (`page.tsx:15`); the role branch at `internal.ts:78` is skipped when the list is empty. A Sales Rep sees every warehouse's stock and every confirmed order in the system, not just their own.
2. **"Available" is not stored.** If you go looking for a column called `available` you will not find one. Both the page (`page.tsx:38`) and the service (`fulfillment.service.ts:46`) compute `on_hand - reserved` independently. If one of them ever drifted from the other, the screen and the planner would disagree.
3. **The dev database is polluted.** Right now `stock_level` holds rows for warehouses named "MX Depot mxul2hi", "Smoke Depot mtom7xvt", "WhA fmtomo1w3" and so on, plus a Laptop 14" row with `on_hand = 3498`, all left behind by earlier automated test runs. Seeded Main Warehouse / East Depot rows have also drifted (Main/Laptop 14" reads 4 on_hand / 4 reserved instead of the seeded 6 / 0). Trust `prisma/seed/a-stock.ts` for the "real" numbers, not the current table. The service test even re-pins these values before asserting (`src/services/__tests__/fulfillment.service.db.test.ts:22-32`).
4. **A receipt never re-plans anything.** `receiveStock` writes `stock_level` and `stock_move` and stops (`fulfillment.service.ts:250-259`). No existing `PROPOSED` plan is recalculated, no backorder is filled, no prompt is raised. The doc comment on line 246 says "Backorder consolidation prompts come later" — they never arrived. See Screen 08 §10.
5. **`src/lib/contract.ts:447` lies.** The declared interface says `receiveStock` returns `{ stockLevelId: number; promptIds: number[] }`. The real action returns only `{ stockLevelId }` (`actions/fulfillment.ts:59`, `fulfillment.service.ts:259`). The interface is documentation of an intent that was never built; the code is the truth.
6. **The stock table has no `where`.** Archived warehouses and archived products still show their stock rows (`page.tsx:17` has no filter, unlike lines 23 and 24 which both filter `archivedAt: null`). On a long-lived database this table only grows.
7. **The status badge can lag the order's real state.** `stateOf` reads only the newest non-superseded plan (`page.tsx:20` `take: 1`). If a plan was superseded by a manual override the superseded one is invisible, which is correct — but it also means an order whose only plan was superseded and whose replacement was deleted would show "Nothing to ship".
8. **"Split Pending" is the label for `PROPOSED`.** The database enum value is `PROPOSED` (`schema.prisma:109-113`); the words "Split Pending" come from `src/components/shared/status-badge.tsx:43`. If you grep the database for "Split Pending" you will find nothing.
