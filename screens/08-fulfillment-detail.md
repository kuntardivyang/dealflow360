# Screen 08 — Fulfillment Detail (warehouse split for one order)

Route: `/fulfillment/[publicId]`
File: `src/app/(internal)/fulfillment/[publicId]/page.tsx`
Spec: `docs/DealFlow360.txt` B6 (line 239). Mockup: `docs/MOCKUP_SCREENS.md` section "8. Fulfillment Detail", image `docs/mockup/08-fulfillment-detail.png`.

---

## 1. What this screen is

One confirmed order, and the answer to a single question: **which warehouse ships which units?**

The page shows a recommended split that the system already computed and stored, the estimated shipment count and cost, any quantity that could not be covered (a backorder), and two buttons: **Accept Suggested Split** and **Manual Override**. Once the split is accepted, each warehouse gets a **Mark shipped** button.

The critical thing to understand before anything else: **the split you are looking at was not computed when you opened this page.** It was computed and written to the database at the moment the order was confirmed. This screen only reads it back.

`export const dynamic = "force-dynamic"` (`page.tsx:15`) — no caching.

---

## 2. Who can open it, and who enforces that

| Who | Can open the page? | Sees Accept / Override enabled? | Sees Mark shipped? | Enforced at |
| --- | --- | --- | --- | --- |
| Not logged in | No — redirect to `/login?next=/fulfillment/<publicId>` | – | – | `src/middleware.ts:35-42`, then `requireUser` at `page.tsx:20` → `src/lib/auth/internal.ts:77` |
| SALES_REP who owns the quote (`user.id === q.repUserId`) | Yes | Yes | **No** | `canAct` at `page.tsx:44`; `canShip` at `page.tsx:45` |
| SALES_REP who does **not** own it | Yes | Buttons render `disabled` | No | `page.tsx:44` — `canAct` is false |
| SALES_MANAGER | Yes | Yes | Yes | `OPS_ROLES` (`src/lib/contract.ts:65`) |
| FINANCE | Yes | Yes | Yes | same |
| ADMIN | Yes | Yes | Yes | same |

```ts
// page.tsx:44-45
const canAct  = OPS_ROLES.includes(user.role) || user.id === q.repUserId;
const canShip = OPS_ROLES.includes(user.role);
```

**The quirk, stated plainly: a Sales Rep may accept a warehouse split but may never mark a shipment shipped.** That is not a UI accident — it is two different rows of the same table:

```ts
// src/lib/state/quotation.machine.ts:38-39
ACCEPT_SPLIT: ["FINANCE", "SALES_MANAGER", "ADMIN", "SALES_REP"],
SHIP:         ["FINANCE", "SALES_MANAGER", "ADMIN"],
```

`assertActor` (`quotation.machine.ts:66-71`) reads that table and throws `ForbiddenError` — "A sales rep cannot ship" — for the second one. The service checks are at `src/services/fulfillment.service.ts:113` (accept) and `:219` (ship).

**Two honest caveats about the UI checks:**

1. `disabled={!canAct}` on the Accept button (`page.tsx:210`) and the Apply override button (`page.tsx:179`) is **presentation only**. The server actions `acceptSplit` and `overrideSplit` call `requireActionUser()` with **no role list** (`src/app/(internal)/actions/fulfillment.ts:28, 40`), and the only server-side guard is `assertActor(actor, "ACCEPT_SPLIT")`, which allows *any* `SALES_REP`. So a Sales Rep who does not own the quote can still accept its split by submitting the form directly. There is no ownership check in the accept path at all — compare `assertOwnerOrAdmin` used in `src/services/order.service.ts:24`, which the fulfillment service never calls.
2. The **Manual Override** link uses `aria-disabled={!canAct}` (`page.tsx:219`), which is an accessibility hint, not a block. The link still navigates.

---

## 3. Everything on the screen, and where each value comes from

Everything on this page comes from **one** query: `prisma.quotation.findUnique({ where: { publicId }, include: {...} })` at `page.tsx:21-32`, plus a second query for warehouses that runs *only* in override mode (`page.tsx:34`).

### Header

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Title | "Q-2026-0325 · Acme Corp" | `page.tsx:62`, from the `findUnique` at `page.tsx:21` and its `customer: true` include | `quotation.number`, `customer.name` | Number assigned when the quotation was created; customer picked on the quotation form |
| Sub-line | "Opened from the Fulfillment list · recommended split from live stock · 2 shipments" | `page.tsx:63` | `fulfillment_plan.is_manual`, `fulfillment_plan.shipment_count` | `is_manual` is `false` for the automatic proposal (`fulfillment.service.ts:64-83` never sets it, so the schema default `false` applies — `prisma/schema.prisma:646`) and `true` for an override (`fulfillment.service.ts:193`). `shipment_count` is written by the planner (`fulfillment.service.ts:68` ← `src/domain/split.ts:77`). |
| Status badge | "Fulfillment" | `page.tsx:66` | `quotation.status` | Set to `CONFIRMED` on confirm, then to `FULFILLMENT` by `acceptInTx` (`fulfillment.service.ts:149`) |
| "Open quotation" link | → `/quotes/<publicId>` | `page.tsx:67` | `quotation.public_id` | Generated when the quotation was created |
| Red error strip | "Stock changed since the split was proposed. A new split has to be proposed." | `page.tsx:73` reads `searchParams.error` | – | Put into the URL by `acceptSplitForm` / `shipForm` / `overrideSplitForm` via `errorQuery` (`actions/fulfillment.ts:76, 82, 106`; `src/lib/contract.ts:165-168`) |

### "Warehouse split" table (`page.tsx:82-139`)

Rows are built in memory at `page.tsx:47-53` by grouping the plan's `fulfillment_line` rows by warehouse.

| What you see | Example value (seed) | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Warehouse | "Main Warehouse" | `page.tsx:29` include `lines.warehouse`, grouped at `page.tsx:50`, rendered `page.tsx:97` | `warehouse.name` via `fulfillment_line.warehouse_id` | The planner chose it (`src/domain/split.ts:45`) and `proposePlan` wrote it (`fulfillment.service.ts:73`) |
| Qty fulfilled | "6 × Laptop 14"" and "10 × Docking Station" | `page.tsx:51`, rendered `page.tsx:99-103` | `fulfillment_line.qty` + `quotation_line.description` | Quantities come from the greedy allocation (`split.ts:39-43`); the description is copied from the quotation line, loaded via `quotationLine: { include: { product: true } }` (`page.tsx:29`) |
| Est. shipments | `1` | **Hard-coded `1`** at `page.tsx:105` | – | Not read from any column. It is always the literal `1`, because the design is one shipment per warehouse (`prisma/schema.prisma:664`). The plan-wide count is in the right-hand card instead. |
| Cost | "₹500.00" | `page.tsx:50` (`l.warehouse.shipCostWeight`), rendered `page.tsx:106` | `warehouse.ship_cost_weight` | Seeded ₹500 for Main, ₹800 for East (`prisma/seed/a-stock.ts:9-10`); editable at `/admin/warehouses`. Rendered by `Money` as integer paise ÷ 100 in INR (`src/components/shared/money.tsx:5`, `src/lib/format.ts:34`). Note this is the *warehouse's current* cost, not the `shipment.ship_cost` snapshot taken at acceptance. |
| Last column | "Mark shipped" button, or "Shipped 12 Sept" badge, or "Reserved" badge, or blank | `page.tsx:94` finds the matching shipment; branches at `page.tsx:108-122` | `shipment.status`, `shipment.shipped_at` | Shipment rows are created only at acceptance (`fulfillment.service.ts:140`). Before acceptance there is no shipment, so the cell is blank. |

### Backorder rows (`page.tsx:127-137`)

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Warehouse column reads "Backorder" (orange) | "Backorder" | `page.tsx:54` filters `l.isBackorder`, rendered `page.tsx:129` | `fulfillment_line.is_backorder = true` **and** `fulfillment_line.warehouse_id IS NULL` | Written by `proposePlan` (`fulfillment.service.ts:74-80`) for whatever the greedy pass could not place (`split.ts:70-72`) |
| Qty | "1 × Laptop 14"" | `page.tsx:131` | `fulfillment_line.qty` | The residual `remaining` quantity (`split.ts:72`) |
| Est. shipments | "–" | Hard-coded, `page.tsx:133` | – | A backorder has no shipment |
| Cost column shows a date | "expected 16 Sept 2026" | `page.tsx:134` | `fulfillment_line.expected_date` (a `@db.Date`) | `todayISO()` in Asia/Kolkata plus the product's **worst** lead days — see below |
| Static sentence below the table | "A "Consolidate Remaining Backorder" prompt appears here when stock arrives at a warehouse already in this plan." | Hard-coded `<p>`, `page.tsx:141` | – | **This is a printed sentence, not a feature.** See §10. |

**Where `expected_date` comes from, exactly.**

```ts
// src/services/fulfillment.service.ts:44 — inside loadStock
for (const r of rows) leadDays.set(r.productId, Math.max(leadDays.get(r.productId) ?? 0, r.leadDays));
// src/services/fulfillment.service.ts:79 — inside proposePlan
expectedDate: parseISODate(addDays(today, leadDays.get(b.productId) ?? 7)),
```

- `today` is `todayISO()` (`fulfillment.service.ts:63`), which is the **Asia/Kolkata** calendar date, not UTC (`src/domain/dates.ts:31-35`).
- The lead time is the **maximum** `stock_level.lead_days` across every non-archived warehouse that has a row for that product — the pessimistic estimate. For Laptop 14" that is `max(Main 7, East 10) = 10` (`prisma/seed/a-stock.ts:13-14`).
- If the product has **no stock row anywhere**, `leadDays.get()` is `undefined` and the fallback `?? 7` applies.
- `addDays` is plain calendar arithmetic — no weekends, no holidays (`src/domain/dates.ts:37-39`).
- **A manual override never sets `expected_date`** (`fulfillment.service.ts:202-204` creates the backorder line with only `quotationLineId`, `warehouseId: null`, `qty`, `isBackorder: true`). So after an override the backorder row shows "–" (`page.tsx:134`).

### Right-hand summary card (`page.tsx:187-203`)

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Shipments | `2` | `page.tsx:191` | `fulfillment_plan.shipment_count` | `plan.shipments.length` from the planner (`split.ts:77`), stored at `fulfillment.service.ts:68`; for an override it is the count of distinct warehouse ids in the submitted matrix (`fulfillment.service.ts:196`) |
| Estimated shipping cost | "₹1,300.00" | `page.tsx:195` | `fulfillment_plan.est_cost` | Sum of each chosen warehouse's `ship_cost_weight`, one flat charge per shipment (`split.ts:78`, stored at `fulfillment.service.ts:69`). For an override, the same sum over distinct warehouses (`fulfillment.service.ts:197`). |
| Plan | badge "Split Pending" / "Accepted" / "Superseded" | `page.tsx:199` | `fulfillment_plan.status` | `PROPOSED` on creation, `ACCEPTED` at `fulfillment.service.ts:120`, `SUPERSEDED` at `fulfillment.service.ts:60` (a re-confirm) or `:185` (an override). Labels from `src/components/shared/status-badge.tsx:43, 40, 33`. |
| "Override reason: …" | "East Depot closes early on Fridays" | `page.tsx:201` | `fulfillment_plan.reason` | Only ever set by an override (`fulfillment.service.ts:194`); null for automatic plans |

### Manual Override card (`page.tsx:147-186`, only when `?override=1`)

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| One fieldset per order line | "Laptop 14" · need 10" | `demand` map built at `page.tsx:36-42`, rendered `page.tsx:157-159` | `quotation_line.description`; qty is the **sum of every fulfillment line** for that quotation line, shipment lines and backorder lines together | Because `proposePlan` places every unit somewhere — a warehouse or a backorder — the sum equals the ordered quantity |
| One number input per warehouse | "Main Warehouse (6 available) [6]" | Warehouses from `page.tsx:34`; availability computed at `page.tsx:163`; input at `page.tsx:169` | `stock_level.on_hand`, `stock_level.reserved` | `available = Σ(onHand - reserved)` over that warehouse's stock rows for the product. Because `(warehouse_id, product_id)` is unique (`schema.prisma:621`) that sum is one row, or 0 when the warehouse has never stocked the product. |
| The prefilled number | `6` | `defaultValue={d.proposed.get(w.id) ?? 0}`, `page.tsx:169` | `fulfillment_line.qty` for that (line, warehouse) | The current proposal (`page.tsx:40`). Warehouses the proposal did not use start at 0. |
| The input's name | `alloc.42.1` | `page.tsx:169` | – | `alloc.<quotationLineId>.<warehouseId>`; parsed back out by the regex at `actions/fulfillment.ts:98` |
| Reason field | free text | `page.tsx:177` | `fulfillment_plan.reason` | `required minLength={3}` in the browser; enforced server-side by `zReason` (min 3, max 500, trimmed — `src/lib/validation/common.ts:34`) |

**Note the availability number in the override form is computed differently from the split itself.** The form uses `sl.onHand - sl.reserved` summed in JavaScript over every stock row of that warehouse (`page.tsx:163`); the service uses `r.onHand - r.reserved` per row (`fulfillment.service.ts:46`). They agree, but they are two separate pieces of code doing the same subtraction.

### When there is no plan (`page.tsx:230-233`)

The whole split card is replaced by one sentence: **"This order has only services or subscriptions, so nothing ships."** — hard-coded at `page.tsx:232`.

---

## 4. The queries this page runs

1. **The order and its current plan** — `page.tsx:21-32`.
   ```ts
   prisma.quotation.findUnique({
     where: { publicId },
     include: {
       customer: true,
       fulfillmentPlans: {
         where: { status: { not: "SUPERSEDED" } },
         orderBy: { id: "desc" },
         take: 1,
         include: {
           lines: { include: { warehouse: true, quotationLine: { include: { product: true } } } },
           shipments: { include: { warehouse: true }, orderBy: { id: "asc" } },
         },
       },
     },
   })
   ```
   `notFound()` at `page.tsx:33` if the `publicId` matches nothing. `take: 1` on `id desc` means **only the newest non-superseded plan is ever shown**; the superseded automatic proposal that an override replaced is invisible on this screen (it is still in the database and in the audit log).
2. **Warehouses with stock, only in override mode** — `page.tsx:34`:
   `overriding ? prisma.warehouse.findMany({ where: { archivedAt: null }, orderBy: { priority: "asc" }, include: { stockLevels: true } }) : []`. Note `stockLevels: true` pulls *every* stock row of every warehouse; the page then filters by product in JS (`page.tsx:163`).

There is **no status filter on the quotation**. You can open `/fulfillment/<publicId>` for a `DRAFT` or `PAID` order; the page renders, and the action buttons simply do not appear because of the conditions in §5.

---

## 5. Every condition on this page

| Condition | Where | Effect |
| --- | --- | --- |
| No session | `middleware.ts:35`, `internal.ts:77` | Redirect to login with `?next=` |
| `publicId` not found | `page.tsx:33` | Next.js 404 |
| `sp.override === "1"` | `page.tsx:19` | Warehouse query runs (`:34`) and the override card can render |
| `q.fulfillmentPlans[0]` missing | `page.tsx:43, 75` | Whole split UI replaced by "This order has only services or subscriptions, so nothing ships." (`:232`) |
| `l.warehouse` is null | `page.tsx:49` | The line is skipped when grouping by warehouse — backorders never appear as a warehouse row |
| `l.isBackorder` | `page.tsx:54` | The line becomes an orange Backorder row (`:127-137`) |
| `backorders.length > 0` | `page.tsx:140` | The static "Consolidate Remaining Backorder" sentence prints (`:141`) |
| A shipment exists for that warehouse | `page.tsx:94, 108` | Otherwise the action cell is empty |
| `shipment.status === "SHIPPED"` | `page.tsx:109` | Green "Shipped <date>" badge instead of a button |
| `canShip` (OPS role) | `page.tsx:111` | "Mark shipped" button; otherwise a plain "Reserved" badge (`:120`) |
| `overriding && plan.status === "PROPOSED" && q.status === "CONFIRMED"` | `page.tsx:147` | The Manual Override card renders |
| `plan.status === "PROPOSED" && q.status === "CONFIRMED"` | `page.tsx:204` | Accept button + Manual Override / Cancel override link + "Accepting reserves the stock in one locked transaction." |
| `plan.status === "ACCEPTED"` | `page.tsx:225` | "Stock is reserved. Mark each shipment as shipped when it leaves the warehouse." |
| `!canAct` | `page.tsx:179, 210` | Buttons render but `disabled` (client-side only — see §2) |
| `plan.reason` present | `page.tsx:201` | "Override reason: …" line |
| `sp.error` present | `page.tsx:73` | Red strip |

---

## 6. Every action you can take here

### A. Accept Suggested Split

```
button "Accept Suggested Split" (page.tsx:210)
  → acceptSplitForm(formData)          (src/app/(internal)/actions/fulfillment.ts:73)
  → acceptSplit(input)                 (actions/fulfillment.ts:24)
  → Zod acceptSplitSchema              (src/lib/validation/fulfillment.ts:5) — { quotationId: zId, planId: zId }
  → requireActionUser()                (actions/fulfillment.ts:28) — no role list
  → fulfillment.acceptPlan             (src/services/fulfillment.service.ts:163)
  → acceptInTx                         (src/services/fulfillment.service.ts:111)
```

Hidden inputs `quotationId`, `planId`, `publicId` come from `page.tsx:207-209`.

**Guards, in the exact order `acceptInTx` runs them:**

| # | Guard | Line | Failure |
| --- | --- | --- | --- |
| 1 | `assertActor(actor, "ACCEPT_SPLIT")` | `:113` | `ForbiddenError` — only ADMIN / FINANCE / SALES_MANAGER / SALES_REP (`quotation.machine.ts:38`) |
| 2 | Quotation exists | `:114-115` | `NotFoundError` |
| 3 | `assertTransition(q.status, "ACCEPT_SPLIT")` | `:116` | `ConflictError` — the order must be `CONFIRMED` (`quotation.machine.ts:20`) |
| 4 | Plan exists and belongs to this quotation | `:117-118` | `NotFoundError` |
| 5 | `assertPlanTransition(plan.status, "ACCEPTED")` | `:119` | `ConflictError` — only `PROPOSED → ACCEPTED` (`src/lib/state/fulfillment.machine.ts:8-12`) |
| 6 | Optimistic claim: `updateMany({ where: { id, status: "PROPOSED" } })` must affect exactly 1 row | `:120-121` | `ConflictError` "This split was already accepted" — this is what stops two people clicking Accept at the same time |
| 7 | Every (warehouse, product) still has a `stock_level` row | `:127-131` | `ConflictError` "A warehouse in this plan no longer stocks the product" |
| 8 | `reserveStock` — the row lock and the conditional update | `:101-109` | `ConflictError` "Stock changed since the split was proposed. A new split has to be proposed." (HTTP-equivalent 409) |

**The locking, precisely.** This is the heart of the screen:

```ts
// src/services/fulfillment.service.ts:101-109
const ids = [...new Set(allocations.map((a) => a.stockLevelId))].sort((a, b) => a - b);
await tx.$queryRaw`SELECT id FROM stock_level WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
for (const a of allocations) {
  const n = await tx.$executeRaw`UPDATE stock_level SET reserved = reserved + ${a.qty}, updated_at = now()
                                 WHERE id = ${a.stockLevelId} AND on_hand - reserved >= ${a.qty}`;
  if (n !== 1) throw new ConflictError("Stock changed since the split was proposed. A new split has to be proposed.");
}
```

- Ids are **de-duplicated and sorted ascending in JavaScript**, and the SQL adds `ORDER BY id` too. Two concurrent accepts therefore take the same row locks in the same order, so they queue instead of deadlocking.
- `FOR UPDATE` holds those rows until the transaction commits or rolls back.
- The `UPDATE` carries its own precondition, `on_hand - reserved >= qty`. If someone else reserved the stock between proposal and acceptance, the `WHERE` matches nothing, `n` is `0`, and the whole transaction rolls back — the plan is *not* left `ACCEPTED`.
- `updated_at = now()` is written by hand because raw SQL bypasses Prisma's `@updatedAt`.
- The isolation level is `ReadCommitted` (`fulfillment.service.ts:164`); correctness comes from the explicit locks, not from the isolation level.

**Tables written, in order:**

| Table | What | Line |
| --- | --- | --- |
| `fulfillment_plan` | `status = ACCEPTED`, `accepted_at = now()`, `accepted_by_id = user.id` | `:120` |
| `stock_level` | `reserved += qty` for each allocated line | `:106` |
| `shipment` | **one row per distinct warehouse** — `plan_id`, `warehouse_id`, `status = 'RESERVED'`, `ship_cost` = that warehouse's current `ship_cost_weight` (a snapshot) | `:140` |
| `fulfillment_line` | `shipment_id` back-filled on each line of that warehouse | `:142` |
| `stock_move` | one row per fulfillment line — `type = 'RESERVE'`, `qty`, `quotation_id`, `shipment_id`, `created_by_id` | `:144-146` |
| `quotation` | `status = 'FULFILLMENT'` | `:149` |
| `audit_log` | see below | `:150-158` |

**Audit row** (`fulfillment.service.ts:150-158`): `entityType: "FulfillmentPlan"`, `entityId: plan.id`, `quotationId`, `action:` **`SPLIT_ACCEPTED`** for an automatic plan or **`SPLIT_OVERRIDE_ACCEPTED`** when `plan.isManual`, `after: { shipments: <count>, backorders: [...] }`. Because `quotationId` is set, `audit()` also bumps `quotation.last_activity_at` (`src/lib/audit.ts:41-43`), which feeds the Deal Health screen.

**What changes on screen:** `refresh()` revalidates `/fulfillment` and `/quotes` (`actions/fulfillment.ts:21-22`), then `acceptSplitForm` redirects to `/fulfillment/<publicId>` (`:76`). The header badge flips to "Fulfillment", the plan badge to "Accepted", each warehouse row grows a "Mark shipped" button (or a "Reserved" badge for a Sales Rep), and the Accept / Override buttons disappear because `plan.status` is no longer `PROPOSED` (`page.tsx:204`).

### B. Manual Override

```
link "Manual Override" (page.tsx:219) → /fulfillment/<publicId>?override=1  [no server call]
button "Apply override" (page.tsx:180)
  → overrideSplitForm(formData)        (actions/fulfillment.ts:94)
  → overrideSplit(input)               (actions/fulfillment.ts:36)
  → Zod overrideSplitSchema            (src/lib/validation/fulfillment.ts:7-14)
  → requireActionUser()                (actions/fulfillment.ts:40)
  → fulfillment.overridePlan           (src/services/fulfillment.service.ts:168)
  → ... then acceptInTx                (src/services/fulfillment.service.ts:209)
```

**The matrix, and how the form is decoded.** The card renders one fieldset per order line (`page.tsx:157`) and, inside it, one number input per non-archived warehouse (`page.tsx:162-172`), named `alloc.<lineId>.<warehouseId>`. `overrideSplitForm` walks every form entry and matches `/^alloc\.(\d+)\.(\d+)$/` (`actions/fulfillment.ts:98`), **skipping blank and zero values** (`:100`). So a warehouse you set to 0 simply does not appear in the payload.

**Zod** (`validation/fulfillment.ts:7-14`): `{ quotationId: zId, planId: zId, reason: zReason, allocations: array({ lineId: zId, warehouseId: zId, qty: zQty }).min(1, "Allocate at least one line") }`. Two consequences: the reason is mandatory (min 3 characters after trim, `common.ts:34`), and **an all-zero matrix is rejected** by `.min(1)` — you cannot override an order into a total backorder.

**The three rules in `validateOverride`** (`src/domain/split.ts:83-103`), called at `fulfillment.service.ts:179`:

| # | Rule | Line | Message |
| --- | --- | --- | --- |
| 1 | Every allocation quantity must be positive | `split.ts:88` | `Line 42: quantity must be positive` — unreachable from this form, because `zQty` already demands ≥ 1 and the form drops zeros |
| 2 | Per order line, total allocated must not **exceed** the ordered quantity | `split.ts:93-96` | `Line 42: allocated 14, ordered 10` |
| 3 | Per (warehouse, product), total allocated must not exceed `available` | `split.ts:97-102` | `Warehouse 2, product 1: allocated 8, available 5` |

**Under-allocating is allowed on purpose.** There is no rule "allocated must equal ordered". The unallocated remainder is turned into a backorder line by the service:

```ts
// src/services/fulfillment.service.ts:202-204
...demand.filter((d) => d.qty - (placed.get(d.lineId) ?? 0) > 0)
         .map((d) => ({ quotationLineId: d.lineId, warehouseId: null, qty: d.qty - (placed.get(d.lineId) ?? 0), isBackorder: true })),
```

That is the point of the feature — an operator who knows a warehouse is closed can deliberately hold units back. The page even says so (`page.tsx:182`): "Anything left unallocated becomes a backorder."

Note what is missing there compared with `proposePlan`: **no `expectedDate`**. An override's backorder rows always render "–" in the date column.

**Guards, in order (`overridePlan`, `fulfillment.service.ts:168-213`):**

1. Zod parse (`actions/fulfillment.ts:37`).
2. `requireActionUser()` — session only, no role list (`actions/fulfillment.ts:40`).
3. Every `lineId` must belong to this quotation's **goods** lines: `productOf.get(a.lineId)` (`:173-177`), else `ValidationError` "A line in the override does not belong to this order". This is also how each allocation gets its `productId` — the form never sends one.
4. `validateOverride(...)` — the three rules above; all failures are joined into one message (`:179-180`).
5. The plan being replaced must exist and belong to the quotation (`:182-183`).
6. `assertPlanTransition(current.status, "SUPERSEDED")` (`:184`) — a `PROPOSED` plan may be superseded; an already-`ACCEPTED` one may not (`fulfillment.machine.ts:8-12`), so you get `ConflictError` "Illegal transition: fulfillment plan cannot go from accepted to superseded".
7. Then the whole `acceptInTx` chain from §A runs on the new plan (`:209`), including `assertActor`, `assertTransition`, the row lock and the conditional reserve.

**Tables written** (all inside **one** transaction, `fulfillment.service.ts:169`):

| Table | What | Line |
| --- | --- | --- |
| `fulfillment_plan` | old plan → `status = SUPERSEDED` | `:185` |
| `fulfillment_plan` | **new** plan → `status = PROPOSED`, `is_manual = true`, `reason`, `shipment_count` = distinct warehouses, `est_cost` = Σ their `ship_cost_weight`, `created_by_id` | `:190-198` |
| `fulfillment_line` | one row per submitted allocation, plus one `warehouse_id = NULL, is_backorder = true` row per short line | `:199-206` |
| then everything `acceptInTx` writes | plan → ACCEPTED, `stock_level.reserved`, `shipment`, `stock_move` RESERVE, quotation → FULFILLMENT | `:209` |

**So the override supersedes the proposal and then immediately accepts it.** There is no intermediate state where you can review the manual split before it reserves stock — despite the helper text at `page.tsx:182` ("The new split replaces the suggestion and still needs Accept"), which is **wrong**. Trust the code: `acceptInTx` is called on line 209 of the same function.

**Audit row:** because the new plan has `isManual: true`, `acceptInTx` logs `action: "SPLIT_OVERRIDE_ACCEPTED"` with `reason` attached (`fulfillment.service.ts:154-156`). The superseding of the old plan is **not** separately audited.

**What changes on screen:** on success `overrideSplitForm` redirects to `/fulfillment/<publicId>` with no query string (`actions/fulfillment.ts:108`), so the override card closes. The split table now shows the manual allocation, the sub-line reads "manual split", and "Override reason: …" appears in the summary card. On failure it redirects with `?error=<message + every field error>` (`actions/fulfillment.ts:104-107`) and the override card is gone (because `override=1` is dropped) — you have to click Manual Override again and retype everything.

### C. Mark shipped

```
button "Mark shipped" (page.tsx:115)
  → shipForm(formData)                 (actions/fulfillment.ts:79)
  → ship(input)                        (actions/fulfillment.ts:48)
  → Zod shipSchema { shipmentId: zId }  (src/lib/validation/fulfillment.ts:16)
  → requireActionUser()                (actions/fulfillment.ts:52) — no role list
  → fulfillment.ship                   (src/services/fulfillment.service.ts:216)
```

**Guards, in order:**

| # | Guard | Line | Failure |
| --- | --- | --- | --- |
| 1 | `assertActor(actor, "SHIP")` | `:219` | `ForbiddenError` "A sales rep cannot ship" (`quotation.machine.ts:39`) — this is the real enforcement of the Sales-Rep quirk |
| 2 | Shipment exists | `:220-221` | `NotFoundError` |
| 3 | `assertShipmentTransition(shipment.status, "SHIPPED")` | `:222` | `ConflictError` — only `RESERVED → SHIPPED` (`fulfillment.machine.ts:14-17`) |
| 4 | `assertTransition(q.status, "SHIP")` | `:224` | `ConflictError` — the order must be `FULFILLMENT` (`quotation.machine.ts:21`) |
| 5 | A `stock_level` row exists for (warehouse, product) | `:226-227` | `ConflictError` "Stock row missing for this shipment" |
| 6 | Conditional decrement affects exactly 1 row | `:228-229` | `ConflictError` "Reserved stock no longer matches this shipment" |

**What changes on stock** (`fulfillment.service.ts:228`):

```sql
UPDATE stock_level SET on_hand = on_hand - $qty, reserved = reserved - $qty, updated_at = now()
WHERE id = $id AND reserved >= $qty AND on_hand >= $qty
```

Both counters fall by the same amount, so **`available` is unchanged by shipping** — it was already reduced when the split was accepted. The goods physically leave; the reservation is consumed, not released.

**Tables written:** `stock_level` (per line, `:228`), `stock_move` with `type = 'SHIP'` (`:230`), `shipment.status = 'SHIPPED'` + `shipped_at` (`:232`), and possibly `quotation.status = 'PAID'` (`:239`).

**Audit rows:** `entityType: "Shipment"`, `action: "SHIP"`, `after: { warehouseId, lines: [{ lineId, qty }] }` (`:233`); plus a second row `entityType: "Quotation"`, `action: "PAID"` if the order completes (`:240`).

**The exact condition under which the order flips to PAID** (`fulfillment.service.ts:235-241`):

```ts
const stillReserved = await tx.shipment.count({ where: { plan: { quotationId: q.id, status: "ACCEPTED" }, status: "RESERVED" } });
const openInvoices  = await tx.invoice.count({ where: { quotationId: q.id, status: { in: ["POSTED", "PARTIAL"] } } });
if (stillReserved === 0 && openInvoices === 0) { ... status: "PAID" ... }
```

Both must be zero: **no shipment of any accepted plan still `RESERVED`**, and **no invoice still unpaid or part-paid**. A `VOID` invoice does not block it. The mirror rule lives in billing — recording the last payment flips the order to `PAID` only if no shipment is `RESERVED` *and* no plan is still `PROPOSED` (`src/services/billing.service.ts:181-189`). Whichever of the two events happens last does the flip.

### D. Cancel override

A plain link back to `/fulfillment/<publicId>` (`page.tsx:215`). No server call, nothing is written.

---

## 7. Scenarios

Seeded stock and costs (`prisma/seed/a-stock.ts`, `prisma/seed/a-catalogue.ts`):

| Warehouse | ship_cost_weight | Laptop 14" | Laptop 16" | Docking Station | Monitor 27" |
| --- | --- | --- | --- | --- | --- |
| Main Warehouse (priority 1) | ₹500 = 50000 paise | 6 (lead 7) | 3 (lead 14) | 20 (lead 5) | 2 (lead 7) |
| East Depot (priority 2) | ₹800 = 80000 paise | 5 (lead 10) | 0 (lead 14) | 0 (lead 5) | 10 (lead 7) |

List prices in paise: Laptop 14" 6,000,000; Laptop 16" 7,500,000; Docking Station 600,000; Monitor 27" 1,800,000. **`DemandLine.unitPrice` is `quotation_line.unit_price`** (`fulfillment.service.ts:37`) — the price after any *pricelist rule*, **not** after the line discount. The split is value-weighted on that number.

---

**1 — One warehouse covers everything.**
Order: 5 × Laptop 14". `totalValue = 5 × 6,000,000 = 30,000,000`.
Warehouses sorted by `shipCostWeight, priority, id` (`split.ts:12, 26`) → [Main ₹500, East ₹800].
`coverValue(Main) = min(5, 6) × 6,000,000 = 30,000,000 === totalValue` → the shortcut at `split.ts:49` fires on the **first, cheapest** matching warehouse.
Result: 1 shipment from Main, `estCost = 50000` (₹500), no backorder. Screen shows one row "Main Warehouse | 5 × Laptop 14" | 1 | ₹500.00", Shipments 1, Estimated shipping cost ₹500.00.

**2 — A genuine two-warehouse split.**
Order: 10 × Laptop 14" + 10 × Docking Station. `totalValue = 60,000,000 + 6,000,000 = 66,000,000`.
`coverValue(Main) = min(10,6)×6,000,000 + min(10,20)×600,000 = 36,000,000 + 6,000,000 = 42,000,000`.
`coverValue(East) = min(10,5)×6,000,000 + min(10,0)×600,000 = 30,000,000`.
Neither equals 66,000,000, so the shortcut does **not** fire and the greedy loop (`split.ts:54-66`) runs.
- Round 1: Main (42,000,000) beats East (30,000,000) → `take(Main)`: 6 laptops + 10 docks. Remaining: 4 laptops. Main's laptop availability is now 0 in the working map (`split.ts:43`).
- Round 2: `coverValue(Main) = 0`, `coverValue(East) = min(4,5)×6,000,000 = 24,000,000` → `take(East)`: 4 laptops. Remaining: none.
`shipmentCount = 2`, `estCost = 50000 + 80000 = 130000` = **₹1,300.00**. This is exactly the assertion in `src/domain/__tests__/split.test.ts:27-36`.
On acceptance: Main/Laptop 6/6/0, Main/Dock 20/10/10, East/Laptop 5/4/1; two `shipment` rows; three `stock_move` RESERVE rows (one per fulfillment line).

**3 — A partial backorder.**
Order: 12 × Laptop 14". Main takes 6, East takes 5, 1 remains.
`split.ts:70-72` emits one backorder allocation `{ lineId, productId, qty: 1 }`.
`proposePlan` writes it as `fulfillment_line { warehouse_id: NULL, qty: 1, is_backorder: true, expected_date: today + max(7, 10) = today + 10 }` (`fulfillment.service.ts:74-80`).
Screen: two warehouse rows plus an orange "Backorder | 1 × Laptop 14" | – | expected 16 Sept 2026" row, and the static Consolidate sentence. `shipmentCount` is still 2 and `estCost` ₹1,300 — **the backorder costs nothing and counts as no shipment**. See `split.test.ts:38-42`.

**4 — A total backorder.**
Order: 3 × a `GOOD` that has no `stock_level` row anywhere (a product an Admin just created). `demand.length === 1` so `proposePlan` does not bail at line 59. `loadStock` returns zero rows, `avail` is empty, `coverValue` is 0 for every warehouse, `totalValue > 0`, so the shortcut fails; in the greedy loop `bestValue` never exceeds 0, `best` stays `null`, and `split.ts:64` breaks out immediately.
Result: `shipments = []`, `shipmentCount = 0`, `estCost = 0`, one backorder line with `expected_date = today + 7` (the `?? 7` fallback at `fulfillment.service.ts:79`).
Screen: no warehouse rows at all, one orange Backorder row, Shipments 0, Estimated shipping cost ₹0.00, Accept still available.
Accepting it: `shipped` is empty (`:123`), `reserveStock` returns immediately (`:103`), **no shipment and no stock move are created**, but the quotation still moves to `FULFILLMENT` (`:149`). That order can now never reach `PAID` through shipping (there is no shipment to ship) — only through recording the final payment (`billing.service.ts:181-189`), which will pass because `stillReserved` is 0 and no plan is `PROPOSED`.

**5 — Accepting when stock changed underneath (the 409).**
Two orders for 6 × Laptop 14" are both confirmed. Both plans propose "Main 6". Alice accepts hers: Main/Laptop becomes on_hand 6, reserved 6, available 0. Bob clicks Accept.
Bob's transaction: guards 1-7 pass (his plan is still `PROPOSED`, the quotation is `CONFIRMED`, the stock row exists). Then `reserveStock` locks the row and runs `UPDATE ... WHERE id = 1 AND on_hand - reserved >= 6` → `6 - 6 = 0 >= 6` is false → `n = 0` → `ConflictError` (`fulfillment.service.ts:107`).
The whole transaction rolls back: Bob's plan is **still `PROPOSED`** (the `ACCEPTED` write on line 120 is undone), no shipment, no stock move, the quotation is still `CONFIRMED`.
`toActionError` maps it to `{ code: "CONFLICT" }` (`contract.ts:159`); `acceptSplitForm` redirects to `/fulfillment/<publicId>?error=Stock%20changed%20since%20the%20split%20was%20proposed...` (`actions/fulfillment.ts:76`) and `page.tsx:73` shows it in red. **Nothing re-proposes automatically** — despite the message saying "A new split has to be proposed", there is no button for that. The only way to get a fresh proposal is to confirm the order again, which is impossible. See §10.

**6 — A valid manual override.**
Order: 10 × Laptop 14". Proposal is Main 6 + East 4. The operator knows Main is closing early, opens `?override=1`, sets Main 0 / East 5, reason "Main warehouse closed Friday".
Form payload after the regex filter (`actions/fulfillment.ts:98-101`): `[{ lineId, warehouseId: 2, qty: 5 }]` — the Main input was 0 and was dropped.
`validateOverride`: rule 2 → placed 5 ≤ ordered 10, fine. Rule 3 → East/Laptop allocated 5 ≤ available 5, fine.
Old plan → `SUPERSEDED`; new plan `is_manual = true`, `reason` stored, `shipment_count = 1`, `est_cost = 80000` (East only); lines = 1 allocation + 1 backorder of qty 5 with **no expected date**; then `acceptInTx` reserves 5 at East, creates one shipment, one RESERVE move, and moves the order to `FULFILLMENT`.
Screen after redirect: one warehouse row "East Depot | 5 × Laptop 14" | 1 | ₹800.00" with a Mark shipped button, one orange "Backorder | 5 × Laptop 14" | – | –" row, sub-line "manual split · 1 shipment", "Override reason: Main warehouse closed Friday".

**7 — An over-allocating override.**
Same order, operator types Main 6 and East 8. Payload sums to 14 for a line ordered 10, and East 8 exceeds East's available 5.
`validateOverride` returns **two** errors (`split.ts:95` and `split.ts:101`), matching `split.test.ts:58-68`. `overridePlan` throws `ValidationError(errors.join(". "), { allocations: errors })` (`fulfillment.service.ts:180`).
`overrideSplitForm` builds the redirect from `r.message` plus every field error (`actions/fulfillment.ts:105-106`), so the red strip reads roughly: *"Line 42: allocated 14, ordered 10. Warehouse 2, product 1: allocated 8, available 5 Line 42: allocated 14, ordered 10 Warehouse 2, product 1: allocated 8, available 5"* — the messages appear twice, because they are in both the message and the field errors. Nothing is written; the old plan is still `PROPOSED`.

**8 — An under-allocating override.**
Same order, operator types Main 6 and leaves East at 0. Payload is one allocation of 6. No rule complains — rule 2 only checks `placed > l.qty`. The service creates the manual plan with one allocation and one backorder line of qty 4 (`fulfillment.service.ts:202-204`), then accepts. This is deliberate: it is how you hold units back.

**9 — Shipping one of two shipments.**
Continuing scenario 2 (Main: 6 laptops + 10 docks; East: 4 laptops). Finance clicks Mark shipped on the Main row.
Two lines are processed (`fulfillment.service.ts:225`): Main/Laptop `on_hand 6→0, reserved 6→0`; Main/Dock `on_hand 20→10, reserved 10→0`. Two `stock_move` rows of type `SHIP`. `shipment.status = SHIPPED`, `shipped_at = now()`.
Then `stillReserved` counts East's shipment → 1 → **no PAID flip**. The quotation stays `FULFILLMENT`.
Screen: the Main row's action cell becomes a green "Shipped 06 Sept 2026" badge (`page.tsx:110`); East still shows its button. The Fulfillment list still shows the order (status derived as "Reserved", `07-fulfillment-list.md` §3).

**10 — Shipping the last one when the invoices are already paid.**
Same order, the customer paid the `ONE_TIME` invoice created at confirmation (`src/services/billing.service.ts:31-62`), so that invoice is `PAID`. Finance ships East.
East/Laptop `on_hand 5→1, reserved 4→0`; one `SHIP` move; shipment `SHIPPED`.
`stillReserved = 0` and `openInvoices = 0` → `assertTransition(q.status, "RECORD_PAYMENT")` passes (`FULFILLMENT` is allowed, `quotation.machine.ts:22`) → `quotation.status = 'PAID'` plus a second audit row `action: "PAID"` (`fulfillment.service.ts:238-240`).
Screen: the status badge in the header reads "Paid". The order **vanishes from `/fulfillment`**, because that list only queries `CONFIRMED` and `FULFILLMENT` — but this detail page is still reachable by URL and still renders the split.

**11 — An order of services only.**
Order: 2 × Training Day (`kind: SERVICE`) + 5 × Support Pro (`kind: SUBSCRIPTION`). On confirmation `onConfirmedHooks` runs `proposePlan` (`src/services/portal-hooks.ts:11`), which calls `loadDemand` with `where: { quotationId, product: { kind: "GOOD" } }` (`fulfillment.service.ts:32-34`), gets zero rows, and returns `null` at line 59. **No `fulfillment_plan` row is created — not an empty one, none at all.**
This page renders `page.tsx:230-233`: a single card reading "This order has only services or subscriptions, so nothing ships." No buttons, no table, no summary card. The invoices and subscriptions were still created by the billing half of the same hook (`portal-hooks.ts:10`).

**12 — A mixed order.** 2 × Laptop 14" + 1 × Setup Service. Only the laptop line is in `demand`; the service line is invisible to the entire fulfillment subsystem. Main covers 2 → one shipment, ₹500. The Setup Service appears on the invoice, never here.

**13 — Two order lines of the same product.** A quotation can hold two separate lines for Laptop 14" (say 3 and 4). `loadDemand` returns both (`fulfillment.service.ts:35`), and `splitWarehouses` treats them independently, decrementing the shared `avail` entry as it goes (`split.ts:43`). Main (6 available) takes 3 for the first line, then 3 of the 4 for the second; the last unit goes to East. Result: Main 1 shipment with two allocations, East 1 shipment. `reserveStock` then issues **two separate `UPDATE`s against the same Main stock row** (`fulfillment.service.ts:105-108`), which is safe because each carries its own `on_hand - reserved >= qty` precondition and the row is already locked.

---

## 8. Schema behind this screen

`prisma/schema.prisma`; DDL in `prisma/migrations/20260905095100_init/migration.sql`.

**`fulfillment_plan`** (`schema.prisma:642-663`, migration line 424)

| Column | Meaning |
| --- | --- |
| `quotation_id` | the order |
| `status` | `PROPOSED \| ACCEPTED \| SUPERSEDED` (`schema.prisma:109-113`). Transitions: `PROPOSED → ACCEPTED \| SUPERSEDED`; both terminal states go nowhere (`src/lib/state/fulfillment.machine.ts:8-12`) |
| `is_manual` | `false` for the automatic proposal, `true` for an override (`fulfillment.service.ts:193`) |
| `shipment_count` | denormalised count, written at creation, never recomputed |
| `est_cost` | denormalised paise, `Σ ship_cost_weight` over the chosen warehouses |
| `reason` | required for an override (`zReason`), null otherwise |
| `created_by_id` | the user who confirmed the order, or **null** when a customer contact confirmed from the portal (`fulfillment.service.ts:70`: `actor.type === "USER" ? actor.id : null`) |
| `accepted_by_id`, `accepted_at` | set by `acceptInTx` (`:120`) |

**`fulfillment_line`** (`schema.prisma:683-701`, migration line 454) — the row that answers "which warehouse, how many".

| Column | Meaning |
| --- | --- |
| `plan_id`, `quotation_line_id`, `qty` | what and how many |
| `warehouse_id` | **nullable — `NULL` means backorder** (`schema.prisma:682` comment) |
| `shipment_id` | null until the plan is accepted, then back-filled per warehouse (`fulfillment.service.ts:142`) |
| `is_backorder` | boolean, default false. Set together with `warehouse_id: null` |
| `expected_date` | `@db.Date`. Set by `proposePlan` only; **never** by an override |

The pair `warehouse_id IS NULL` + `is_backorder = true` is written in one place for proposals (`fulfillment.service.ts:74-80`) and one place for overrides (`:202-204`). Nothing in the schema enforces that the two agree — there is no CHECK constraint tying them together. The list screen keys off `warehouse_id` (`07` §3) while the detail screen keys off `is_backorder` (`page.tsx:54`), so a row with one but not the other would render inconsistently.

**`shipment`** (`schema.prisma:665-681`, migration line 441) — "One shipment per warehouse per accepted plan" (the comment on line 664 is the design rule; nothing in the database enforces uniqueness of `(plan_id, warehouse_id)`). `status` is `RESERVED | SHIPPED` (`schema.prisma:115-118`); `ship_cost` is a snapshot of the warehouse's weight at acceptance time (`fulfillment.service.ts:140`) — the table on screen shows the *live* weight instead (`page.tsx:50`), so the two can drift if an Admin edits the warehouse afterwards.

**`stock_level`** — covered in `07-fulfillment-list.md` §8. The one thing to repeat: the CHECK at migration line 1036 (`reserved <= on_hand`) is the last line of defence behind the conditional `UPDATE`s.

**`stock_move`** (`schema.prisma:625-640`) — the ledger. This screen produces `RESERVE` (`fulfillment.service.ts:144-146`) and `SHIP` (`:230`) rows. `RELEASE` and `ADJUST` exist in the enum and are **never written by any code in `src/`**.

**`fulfillment_prompt` + `PromptStatus`** (`schema.prisma:703-717`, enum at `:120-124`, migration line 468) — see §10.

---

## 9. How this screen connects to the others

**Upstream — when a plan is created at all.** This is the single most misunderstood point on the screen, so here is the whole chain:

```
Customer clicks Confirm in the portal        (src/services/portal.service.ts:153)
   — or an Admin confirms on behalf          (src/services/order.service.ts:48)
      → confirmOrder sets quotation.status = 'CONFIRMED'   (order.service.ts:44-47)
      → onConfirmedHooks(tx, quotationId, actor)           (src/services/portal-hooks.ts:9)
           → onConfirmed  — invoices + subscriptions       (portal-hooks.ts:10)
           → proposePlan  — the warehouse split            (portal-hooks.ts:11)
```

- **The plan is proposed on CONFIRMATION, not on approval.** Approving a quotation (Screen 06) writes nothing to `fulfillment_plan`. A quotation can sit `APPROVED` or `SENT` for weeks with no plan.
- It runs **inside the confirming transaction** (`portal-hooks.ts` doc comment, lines 1-3), so if the split fails the confirmation itself rolls back.
- It runs **once**. Nothing calls `proposePlan` again — `grep` finds exactly two callers, both `onConfirmedHooks`. The `updateMany(... status: "PROPOSED" → "SUPERSEDED")` at `fulfillment.service.ts:60` exists for a re-confirm that cannot currently happen.
- **Only `GOOD` lines are planned** (`fulfillment.service.ts:32-34`). A `SERVICE` or `SUBSCRIPTION` line is never split, never reserved, never shipped, and never appears on this screen.

**The split algorithm end to end** (`src/domain/split.ts`, a pure function — no database, no I/O):

1. **Normalise.** Demand lines with `qty > 0`, sorted by `lineId` ascending (`:25`). Warehouses sorted by `shipCostWeight`, then `priority`, then `id` (`:26` with the comparator at `:11-13`). `avail` is a flat map keyed `"warehouseId:productId"`, floored at 0 (`:29`). This sorting is what makes the plan **deterministic**: the same stock always yields the same plan regardless of the order the rows came back from the database (`split.test.ts:44-48`).
2. **The single-warehouse shortcut** (`:49-51`). `ordered.find(w => coverValue(w, ...) === totalValue && totalValue > 0)`. Because `ordered` is cheapest-first, the first match is the cheapest warehouse that can cover everything, and it wins outright. One shipment, done.
3. **The greedy fallback** (`:54-66`). While anything remains: score every warehouse by `coverValue` — the **remaining order value** it can still cover, `Σ min(need, have) × unitPrice` (`:16-22`) — and take the highest scorer. Ties are broken by the cheapest-first ordering of `ordered`, since `v > bestValue` is strict. `take()` (`:34-46`) allocates greedily line by line and pushes one shipment with `estCost = w.shipCostWeight`. Loop exits when nothing remains, or when no warehouse can place anything (`best === null`, `:64`).
4. **Backorders** (`:70-72`). Every line with a positive remainder becomes one backorder allocation.
5. **`estCost` is a flat per-shipment charge.** Line 45 sets `estCost: w.shipCostWeight` — the warehouse's weight, unchanged, regardless of how many units or how many products are in that shipment. Line 78 sums them. So a shipment of 1 dock and a shipment of 200 laptops from Main both "cost" ₹500. It is a shipment-count proxy, not a real freight quote.

**Downstream:**

- **Screen 07** (`/fulfillment`) — this page's parent; the back link is at `page.tsx:58`. Its Status column is derived from what this screen writes.
- **Screen 04** (`/quotes/<publicId>`) — the "Open quotation" link at `page.tsx:67`. The audit trail there shows the plan events, since every audit row here carries `quotationId`.
- **Screens 12/13 (Invoices)** — the `PAID` flip is shared between `fulfillment.service.ts:237` and `billing.service.ts:187`; whichever completes last performs it.
- **Deal Health** — each audit row bumps `quotation.last_activity_at` (`src/lib/audit.ts:41-43`), and the seeded "slippage" fixture (`prisma/seed/b-history.ts:112-133`) is precisely an accepted plan with a backorder past its promised date.

---

## 10. Gotchas

**1. The "Consolidate Remaining Backorder" prompt does not exist.**
This is the clearest gap between the spec and the build. `docs/DealFlow360.txt` B6 says: *"If stock arrives mid fulfillment, a 'Consolidate Remaining Backorder' prompt appears automatically."* The schema was built for it — `model FulfillmentPrompt` (`prisma/schema.prisma:703-717`) with `type` defaulting to `"CONSOLIDATE_BACKORDER"`, a `message`, a `payload` JSON column, and `enum PromptStatus { OPEN ACCEPTED DISMISSED }` (`schema.prisma:120-124`) — and the table exists in the database (migration line 468).

**No code reads or writes either of them.** Grepping `src/` for `FulfillmentPrompt` and `PromptStatus` returns hits only inside `src/generated/prisma/` (the auto-generated Prisma client). `receiveStock` writes `stock_level` and `stock_move` and returns (`fulfillment.service.ts:250-260`); its own doc comment on line 246 says "Backorder consolidation prompts come later". The dev database has 0 rows in `fulfillment_prompt`.

What the page actually does is print a static sentence:

```tsx
// src/app/(internal)/fulfillment/[publicId]/page.tsx:140-142
{backorders.length > 0 ? (
  <p className="mt-3 text-xs text-muted-foreground">A &quot;Consolidate Remaining Backorder&quot; prompt appears here when stock arrives at a warehouse already in this plan.</p>
) : null}
```

That paragraph is unconditional prose whenever a backorder exists. It describes a feature that was never built. `src/lib/contract.ts:447` reinforces the illusion by declaring `receiveStock` returns `promptIds: number[]`, which the real action never returns.

**2. The greedy branch is not shipment-minimal.**
The file's own header comment claims the objective is "the fewest shipments, then the lowest shipping cost" (`split.ts:1-2`). The greedy pass does not guarantee that. It maximises *value covered per step*, which is not the same as minimising the number of warehouses used — the classic set-cover trap.

I verified this rather than taking it on faith. I re-implemented `splitWarehouses` verbatim in a scratch script and compared it against a brute-force optimum (the smallest set of warehouses whose combined availability covers every line) over 200,000 random satisfiable cases with 2-4 warehouses and 1-3 products: **622 cases, 0.37%, used more shipments than necessary.** Concrete failure found by the sweep:

- 3 lines: A ×8 @ price 10, B ×5 @ price 1000, C ×1 @ price 10. Warehouses W1 (A:0, B:7, C:7), W2 (A:4, B:3, C:4), W3 (A:5, B:2, C:4), W4 (A:6, B:0, C:0).
- W1 wins round 1 on value (B is worth 1000 a unit), but W1 has no A at all. The algorithm then needs two more warehouses to finish A. **Greedy: 3 shipments. Optimal: 2** (W2 + W3 covers everything).

The rate is distribution-dependent — the exact figure depends on how you generate cases, so treat 0.37% as "a fraction of a percent", in the same ballpark as the ~1% previously reported. Two mitigations worth knowing:

- With **exactly two warehouses** — the seeded configuration — the same sweep found **zero** non-minimal cases out of 134,408. With two warehouses, "optimal = 1" means a single warehouse covers everything, which is precisely what the shortcut at `split.ts:49` detects. So the seeded demo can never hit this bug. It only becomes reachable once someone adds a third warehouse.
- The Manual Override exists exactly for the cases where an operator can see a better split than the algorithm.

**3. The single-warehouse shortcut compares VALUE, so a zero-priced line is invisible to it.**
`coverValue` multiplies by `unitPrice` (`split.ts:20`). A line with `unitPrice = 0` contributes 0 to both `coverValue` and `totalValue`, so it cannot affect the equality test at `split.ts:49`. A warehouse that cannot supply that line at all still "covers everything" as far as the shortcut is concerned.

Demonstrated with seeded numbers: order 5 × Laptop 14" (₹60,000) plus 3 × Docking Station **priced at 0**. Main has 6 laptops and 0 docks; East has 5 laptops and 20 docks (inverting the seed's dock row for the illustration).
`totalValue = 30,000,000 + 0 = 30,000,000`. `coverValue(Main) = min(5,6)×6,000,000 + min(3,0)×0 = 30,000,000` — equal. The shortcut fires, Main is chosen alone, and **all 3 docks are backordered even though East had 20 sitting on the shelf**. I ran this through the real algorithm: `{ shipmentCount: 1, backorders: 3 }`.

Is a zero price reachable? `unitPrice` is copied from `product.list_price` possibly discounted by a pricelist rule (`src/services/quotation.service.ts:150`), and `zMoney` permits 0 (`src/lib/validation/common.ts:5`). A free-with-purchase item or a 100%-discount pricelist rule would do it. It is a latent bug, not a daily one — but it is real, and the greedy branch does not have the problem in the same way (a zero-value line still gets placed by `take()`, it just never *drives* the choice).

**4. "Est. shipments" is a hard-coded `1`.**
`page.tsx:105` renders the literal `1` in every warehouse row. It is not read from any column. The plan-level count is `plan.shipment_count` in the right-hand card (`page.tsx:191`).

**5. The override's help text is wrong.**
`page.tsx:182` says "The new split replaces the suggestion and still needs Accept." It does not. `overridePlan` calls `acceptInTx` on line 209 of the same transaction — the override reserves stock and creates shipments immediately. There is no second confirmation step. Trust the code.

**6. An override cannot produce a total backorder.**
`allocations.min(1, "Allocate at least one line")` (`validation/fulfillment.ts:13`) plus the zero-stripping in the form parser (`actions/fulfillment.ts:100`) means an all-zero matrix fails Zod validation with "Allocate at least one line". You can hold back *most* of an order, but not all of it.

**7. An override's backorders have no expected date.**
`proposePlan` computes `expectedDate` (`fulfillment.service.ts:79`); `overridePlan` does not (`:204`). The date column shows "–" (`page.tsx:134`). Same table, same screen, two code paths, one of which forgot the column.

**8. There is no "re-propose" button.**
When acceptance fails with "Stock changed since the split was proposed. A new split has to be proposed", nothing in the UI can propose a new one. `proposePlan` is only ever reachable through `onConfirmedHooks`, and an order that is already `CONFIRMED` cannot be confirmed again (`assertTransition` at `order.service.ts:43` only allows `SENT`/`UNDER_NEGOTIATION`). The stale plan sits there permanently. The practical workaround is a Manual Override, which builds a fresh plan from live stock.

**9. `disabled` is not authorisation.**
`disabled={!canAct}` (`page.tsx:179, 210`) is markup. The accept and override actions call `requireActionUser()` with **no role list** (`actions/fulfillment.ts:28, 40`), and `assertActor(actor, "ACCEPT_SPLIT")` permits every `SALES_REP` (`quotation.machine.ts:38`). No ownership check runs anywhere in the accept path. Any logged-in Sales Rep can accept any order's split by posting the form. The ship path is genuinely protected, by `assertActor(actor, "SHIP")` at `fulfillment.service.ts:219`.

**10. The audit trail mislabels these events.**
The service writes actions `SPLIT_PROPOSED` (`:89`), `SPLIT_ACCEPTED` and `SPLIT_OVERRIDE_ACCEPTED` (`:154`). The audit-trail renderer's dictionary has keys `ACCEPT_SPLIT` and `OVERRIDE_SPLIT` instead (`src/components/shared/audit-trail.tsx:39-40`). They never match, so the fallback at `audit-trail.tsx:124` kicks in and the quotation's history reads "split accepted this quotation" rather than "accepted the warehouse split for this quotation". Cosmetic, but it means the dictionary entries are dead code.

**11. Shipping does not change Available.**
`on_hand` and `reserved` fall by the same amount (`fulfillment.service.ts:228`), so `on_hand - reserved` is unchanged. Availability drops at **acceptance**, not at shipment. This surprises people watching the stock table on Screen 07.

**12. The seeded "slippage" order cannot be shipped.**
`prisma/seed/b-history.ts:125-133` creates an `ACCEPTED` plan with a `RESERVED` shipment for 3 × Laptop 16" at Main, but it never touches `stock_level` — Main/Laptop 16" is seeded `on_hand 3, reserved 0` (`a-stock.ts:15`). Clicking Mark shipped on that fixture runs `UPDATE ... WHERE reserved >= 3` against `reserved = 0`, matches nothing, and throws `ConflictError` "Reserved stock no longer matches this shipment" (`fulfillment.service.ts:229`). It is a display fixture for the Deal Health slippage card, not a shippable order.

**13. The dev database is not the seed.**
`stock_level` currently holds rows for warehouses called "MX Depot mxul2hi", "Smoke Depot mtom7xvt", "WhA fmtomo1w3" and similar, left over from earlier automated runs — including a Laptop 14" row with `on_hand = 3498`. Seeded rows have drifted too (Main/Laptop 14" reads 4 / 4 instead of 6 / 0). Every number in §7 above comes from `prisma/seed/a-stock.ts`, not from the live table. If you open the override form today you will see those junk warehouses listed, because `page.tsx:34` filters only on `archivedAt: null`.
