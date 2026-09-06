# Screen 09 — Subscriptions List

Route: `/subscriptions`
File: `src/app/(internal)/subscriptions/page.tsx`
Mockup: `docs/mockup/09-subscriptions-list.png`, `docs/MOCKUP_SCREENS.md:114-125`
Spec: `docs/DealFlow360.txt:143` (A5), `docs/DealFlow360.txt:260` (B7)

---

## 1. What this screen is

One flat table of every recurring subscription in the whole system. Not per customer, not per
order — everything. Each row is one `subscription` table row.

A subscription is never created by a human. There is no "New Subscription" button anywhere in
the app. A subscription row exists because a quotation that had a `RECURRING` line was
confirmed, and `onConfirmed` in `src/services/billing.service.ts:65-96` created it inside the
confirming transaction. That is the only place in the codebase that writes to the `subscription`
table on creation (`src/services/billing.service.ts:68`).

The page header says so in plain words (`src/app/(internal)/subscriptions/page.tsx:34`): "Every
recurring plan across every customer, regardless of which order it came from."

The empty state (`src/app/(internal)/subscriptions/page.tsx:48`) says "A confirmed order with a
recurring line starts one." That is literally true. After a fresh `prisma db seed` this screen is
**empty**, because the seed creates no subscriptions at all — `prisma/seed/a-quotes.ts` only
creates two DRAFT quotations (`Q-2026-0001` empty, `Q-2026-0004` hybrid). The first row appears
the moment somebody confirms `Q-2026-0004`.

---

## 2. Who can open it, and who enforces that

| Role | Can open `/subscriptions`? | Enforced where |
|---|---|---|
| ADMIN | Yes | `src/middleware.ts:21-32` (valid `df_session`), then `src/app/(internal)/subscriptions/page.tsx:16` |
| FINANCE | Yes | same |
| SALES_MANAGER | Yes | same |
| SALES_REP | Yes | same |
| Not logged in | No — redirected to `/login?next=/subscriptions` | `src/middleware.ts:35-42`, and again `src/app/(internal)/subscriptions/page.tsx:16` calling `requireUser(undefined, "/subscriptions")` (`src/lib/auth/internal.ts:75-80`) |
| Portal contact (customer) | No | `src/middleware.ts:17-20` — a portal visitor carries `df_portal`, not `df_session`, and `/subscriptions` is not a `/portal/*` path |

`requireUser` is called with `roles = undefined` (`src/app/(internal)/subscriptions/page.tsx:16`),
so the role list check at `src/lib/auth/internal.ts:78` is skipped. **Any logged-in internal user,
including a SALES_REP, sees every subscription of every customer.** There is no ownership filter
in the query (`src/app/(internal)/subscriptions/page.tsx:17-20`). That is a deliberate simplification,
not an accident, but it is worth knowing.

The nav tab "Subscriptions" is visible to all four roles because `src/lib/nav.ts:13` has no
`roles` key on that item, and `visibleNavItems` (`src/lib/nav.ts:21-23`) only filters items that
declare one.

### What is role-gated on this screen

Only one thing: the **"+ New Plan (Admin)"** button in the header
(`src/app/(internal)/subscriptions/page.tsx:36-41`). It renders only when
`user.role === "ADMIN"`, and it is not an action — it is a `Link` to `/admin/plans`.

Modify Subscription and Cancel Subscription are **not on this screen**. They live one click away
on screen 10 and are `OPS_ROLES` only (`src/lib/contract.ts:65` = `["ADMIN", "FINANCE",
"SALES_MANAGER"]`). A SALES_REP can open a subscription's billing detail and read it, but the
Modify and Cancel cards are not rendered for them at all
(`src/app/(internal)/subscriptions/[publicId]/page.tsx:22` computes `canChange`, lines 62 and 88
gate the two cards on it), and the services refuse them a second time at
`src/services/subscription.service.ts:17` and `:135`.

---

## 3. Everything on the screen, and where each value comes from

The whole page is fed by exactly one query
(`src/app/(internal)/subscriptions/page.tsx:17-20`). Every value below comes out of that one
result set. Example values use the seeded demo order `Q-2026-0004` (Beta Industries, `Laptop 14"`
×2 at 5 % off + `Support Pro` ×2 on the Monthly plan, `prisma/seed/a-quotes.ts:69-79`) confirmed
on 2026-09-05.

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Page title "Subscriptions" | Subscriptions | `src/app/(internal)/subscriptions/page.tsx:33` | — | Hard-coded string. Also the browser tab title via `metadata` (`:10`). |
| Description line | "Every recurring plan across every customer…" | `src/app/(internal)/subscriptions/page.tsx:34` | — | Hard-coded. Copied from the mockup (`docs/MOCKUP_SCREENS.md:117`). |
| "+ New Plan (Admin)" button | shown only to ADMIN | `src/app/(internal)/subscriptions/page.tsx:36-41` | `user.role` from the session | The role is re-read from `user.role` on every request (`src/lib/auth/session.ts` via `getSessionUser`), never from the cookie. |
| **Active** tile number | `1` | `src/app/(internal)/subscriptions/page.tsx:21,44` — `count("ACTIVE")` counted in JavaScript over the rows already fetched | `subscription.status` | Written as the literal `"ACTIVE"` at `src/services/billing.service.ts:80` when the subscription was created. Nothing else ever sets it back to ACTIVE. |
| **Paused** tile number | `0`, always | `src/app/(internal)/subscriptions/page.tsx:45` | `subscription.status` | **Permanently zero.** `SubscriptionStatus.PAUSED` exists in the enum (`prisma/schema.prisma:126-130`) and in the state machine (`src/lib/state/subscription.machine.ts:6`), but no service anywhere writes it. Grep for `"PAUSED"` in `src/` and the only two hits are this tile and the transition table. There is no Pause button. See §10. |
| **Cancelled** tile number | `0`, or `1` after a cancellation | `src/app/(internal)/subscriptions/page.tsx:46` | `subscription.status` | Set to `"CANCELLED"` by `cancelSubscription` at `src/services/subscription.service.ts:181`. That is the only writer. |
| **Customer** column | `Beta Industries` | `src/app/(internal)/subscriptions/page.tsx:24`, joined by `include: { customer: true }` at `:18` | `customer.name` via `subscription.customer_id` | `customerId` was copied from the quotation at `src/services/billing.service.ts:71` (`customerId: q.customerId!`). The customer row itself came from `prisma/seed/a-customers.ts`. |
| **Plan** column | `Support Pro × 2` | `src/app/(internal)/subscriptions/page.tsx:25` — `` `${s.product.name} × ${s.qty}` `` | `product.name` + `subscription.qty` | `productId` snapshotted from the quotation line at `src/services/billing.service.ts:74`; `qty` at `:76`. Note this column shows the **product**, not the plan name, despite the header. The plan name (`Monthly`) is on screen 10. |
| **Cycle** column | `Monthly` | `src/app/(internal)/subscriptions/page.tsx:26` — `CYCLE[s.plan.interval]`, map at `:13` | `recurring_plan.interval` | The plan was chosen on the quotation line (`quotation_line.plan_id`) and copied to `subscription.plan_id` at `src/services/billing.service.ts:75`. The Monthly plan row is seeded at `prisma/seed/a-plans.ts:6` with `interval: "MONTH", periods: 12`. |
| **Next bill** column | `05 Oct 2026` | `src/app/(internal)/subscriptions/page.tsx:27`, fed by the nested query at `:18` (`schedule: { where: { status: "SCHEDULED" }, orderBy: { billDate: "asc" }, take: 1 }`) | `billing_schedule.bill_date` | The 12 schedule rows were computed by `buildSchedule` (`src/domain/prorate.ts:28-38`) and written in the same `subscription.create` at `src/services/billing.service.ts:84-93`. Row 1 was then flipped to `INVOICED` at `:133`, so the earliest still-`SCHEDULED` row is row 2 — period 2026-10-05 to 2026-11-04, billed on its first day. Rendered through `formatDate` (`src/lib/format.ts:64-70`). |
| **Next bill** = `–` | for a cancelled subscription | same line, `s.schedule[0]` is undefined | — | `cancelSubscription` sets every `SCHEDULED` row to `CANCELLED` (`src/services/subscription.service.ts:180`), so the `where: { status: "SCHEDULED" }` filter returns nothing. |
| **Status** column | `Active` badge, green | `src/app/(internal)/subscriptions/page.tsx:28` → `StatusBadge` | `subscription.status` | Label and colour from the one status map at `src/components/shared/status-badge.tsx:61-62` (`ACTIVE` → "Active"/success, `PAUSED` → "Paused"/warning) and `:42` (`CANCELLED` → "Cancelled"/neutral). |
| Row click target | `/subscriptions/ywRpFzrY0UtY` | `src/app/(internal)/subscriptions/page.tsx:48` — `rowHref` | `subscription.public_id` | Generated by `publicId()` (`src/lib/ids.ts:8-13`, 12 random URL-safe characters) at creation time, `src/services/billing.service.ts:70`. The integer primary key never appears in a URL. |
| Empty state | "No subscriptions yet / A confirmed order with a recurring line starts one." | `src/app/(internal)/subscriptions/page.tsx:48` | — | Rendered by `DataTable` when `rows.length === 0` (`src/components/shared/data-table.tsx:39`). |

### Row order

`orderBy: [{ status: "asc" }, { id: "desc" }]` (`src/app/(internal)/subscriptions/page.tsx:19`).
`status` is a Postgres enum, and enums sort in **declaration order**, not alphabetically. The
declaration is `ACTIVE, PAUSED, CANCELLED` (`prisma/schema.prisma:126-130`). So: active ones
first, then paused (never any), then cancelled — and within each group, newest first.

---

## 4. The queries this page runs

Three round trips to the database, in this order:

1. **Session lookup** — `requireUser()` at `src/app/(internal)/subscriptions/page.tsx:16` calls
   `getSessionUser()`, which reads the `df_session` cookie and joins `session` → `user`. The role
   comes from the `user` row every single request, so an Admin demoting somebody takes effect
   immediately.
2. **Middleware session lookup** — `src/middleware.ts:47` already did a similar read before the
   page even started rendering. Yes, that is two reads; the comment at `src/lib/auth/internal.ts:72-74`
   calls it "the belt to its braces".
3. **The one page query** — `src/app/(internal)/subscriptions/page.tsx:17-20`:

```
prisma.subscription.findMany({
  include: {
    customer: true,
    product: true,
    plan: true,
    schedule: { where: { status: "SCHEDULED" }, orderBy: { billDate: "asc" }, take: 1 },
  },
  orderBy: [{ status: "asc" }, { id: "desc" }],
})
```

That is one `SELECT` over `subscription` plus Prisma's joins/sub-selects for `customer`,
`product`, `plan` and the single next `billing_schedule` row per subscription.

`export const dynamic = "force-dynamic"` (`src/app/(internal)/subscriptions/page.tsx:11`) means
Next.js never caches this page — every visit re-runs the query. That is why a payment recorded on
screen 13 shows up here on the next load.

**No pagination, no filter, no search.** Every subscription row in the table is fetched on every
page view. Fine for a demo, and it is the reason the tile counts are computed in JavaScript
(`:21`) rather than with three `count` queries.

---

## 5. Every condition on this page

| Condition | Where | What happens when true | What happens when false |
|---|---|---|---|
| No valid `df_session` cookie | `src/middleware.ts:21-32`, `src/lib/auth/internal.ts:77` | Redirect to `/login?next=/subscriptions`; the stale cookie is deleted (`src/middleware.ts:41`) | Page renders |
| Session expired or user deactivated | `src/middleware.ts:47-48` — `s.expiresAt > new Date() && s.user.isActive` | Treated as no session; redirect | Page renders |
| `user.role === "ADMIN"` | `src/app/(internal)/subscriptions/page.tsx:36` | "+ New Plan (Admin)" link to `/admin/plans` is rendered | `actions` is `null`, header shows no button |
| `subs.length === 0` | `src/components/shared/data-table.tsx:39` | The `EmptyState` replaces the whole table | The table renders |
| A subscription has at least one `SCHEDULED` schedule row | `src/app/(internal)/subscriptions/page.tsx:18,27` | "Next bill" shows that row's `billDate` | Shows `–` |
| `s.status === "ACTIVE"` / `"PAUSED"` / `"CANCELLED"` | `:21` | Increments the matching tile | — |
| Status value is missing from the badge map | `src/components/shared/status-badge.tsx:73` | Falls back to the raw enum string, neutral tone | Uses the mapped label and tone |

That is the complete list. This screen has no forms, no server actions, no optimistic locking, no
error banner and no `searchParams`.

---

## 6. Every action you can take here

There are only two, and neither writes anything.

**1. Click a row → open the billing detail.**

- Button: the whole table row (`ClickableRow`, `src/components/shared/data-table.tsx:69`).
- Target: `/subscriptions/${s.publicId}` (`src/app/(internal)/subscriptions/page.tsx:48`).
- Server action: none. Plain navigation.
- Zod schema: none.
- Service: none.
- Guards: only the ones on the destination page.
- Tables written: none.
- Audit row: none.
- What changes on screen: you land on screen 10.

**2. Click "+ New Plan (Admin)" (ADMIN only) → open the plan admin.**

- Button: `src/app/(internal)/subscriptions/page.tsx:37-40`.
- Target: `/admin/plans`.
- Server action: none — it is a `Link`, not a form.
- Guards: `user.role === "ADMIN"` to render it (`:36`); then `/admin/*` is gated for
  `BACKEND_ROLES` in `src/middleware.ts:25-30`.
- Tables written: none by this click.
- Audit row: none by this click.
- What changes on screen: you leave for the admin area, where you can create a
  `recurring_plan` row (interval, `periods`, proration mode, cancel policy, refund method) that a
  future quotation line can point at.

**What you cannot do here:** modify a subscription, cancel one, pause one, create one, record a
payment, or issue a credit note. All of that is on screen 10 or screen 13, or nowhere.

---

## 7. Scenarios

Money is written in integer paise, exactly as stored. ₹1,000 = `100000` paise.

### 7.1 An order with only one-time lines — nothing appears here

A rep quotes `Laptop 14"` ×2 at 5 % off and nothing else. On confirm, `onConfirmed`
(`src/services/billing.service.ts:21`) runs:

- `oneTime.length > 0`, so one aggregate invoice is created (`:31-60`): subtotal
  `11400000`, tax `2052000`, total `13452000`.
- The `RECURRING` loop at `:65` iterates over an empty array. `subscriptionsCreated` stays 0.

`/subscriptions` shows the empty state, or is unchanged. **A one-time-only order never touches
this screen.** This is the single most common source of the question "where is my subscription".

### 7.2 An order with only a subscription — exactly one row appears

Quote `Support Pro` ×2 on the Monthly plan, nothing else. On confirm:

- `oneTime.length === 0`, so the block at `src/services/billing.service.ts:31` is skipped — **no
  one-time invoice at all**.
- The loop at `:65` runs once. `buildSchedule(today, "MONTH", 12, 200000, 1800)` returns 12
  periods (`src/domain/prorate.ts:28-38`). One `subscription` row + 12 `billing_schedule` rows are
  written in one `create` (`:68-96`).
- One `RECURRING` invoice for period one (`:100-132`), then schedule row 1 → `INVOICED` (`:133`).

`/subscriptions` now shows one row: `Acme Corp | Support Pro × 2 | Monthly | 05 Oct 2026 | Active`.
Active tile = 1.

### 7.3 A mixed order — one row here, two invoices on screen 12

The seeded `Q-2026-0004`. Both branches of `onConfirmed` run:

- `INV-2026-0001` `ONE_TIME`, total `13452000` (the laptops).
- One `subscription`, 12 schedule rows, and `INV-2026-0002` `RECURRING`, total `236000` (the
  first month of Support Pro).

`/subscriptions` gains exactly **one** row — the laptops are not a subscription. `/invoices` gains
**two**. The numbers are assigned in that order because `nextNumber` (`src/services/support.ts:19-22`)
increments the `counter` row keyed `"invoice"` inside the same transaction, and the one-time block
runs before the recurring loop.

### 7.4 Two recurring lines on one order — two rows here

`Support Basic` ×5 monthly and `Support Pro` ×2 monthly on the same quotation. The loop at
`src/services/billing.service.ts:65` runs **twice**: two `subscription` rows, two schedules, two
`RECURRING` invoices (`INV-…-0002` and `INV-…-0003`), each with its own schedule row 1 flipped to
`INVOICED`. `/subscriptions` shows two rows with the same customer and the same order behind them.
There is no grouping — the list is per subscription, not per order.

### 7.5 A quotation line with `lineType = RECURRING` but no plan — the confirm is refused

`src/services/billing.service.ts:66`: `if (!line.plan) throw new ConflictError(...)`. Because
`onConfirmed` runs **inside** the confirming transaction (`src/services/portal-hooks.ts:9-13`,
called from `src/services/order.service.ts:48`), the throw rolls back the entire confirm. The
quotation stays `SENT`, no invoice is created, no subscription appears here, and the customer sees
a 409-shaped error. Nothing half-happened.

### 7.6 A partial payment on the recurring invoice — this screen does not move

Finance records `100000` paise against `INV-2026-0002` (total `236000`). `applyPayment`
(`src/lib/state/invoice.machine.ts:28-39`) returns `paidAmount 100000`, `status "PARTIAL"`. The
`invoice` row changes; the `subscription` row does not. `/subscriptions` is **byte-for-byte
identical**. Payment state lives on screens 12 and 13 only.

### 7.7 A quantity increase mid-period — the row's "Plan" column changes, "Next bill" does not

Beta goes from 2 to 3 seats effective 2026-09-06 inside the period 2026-09-05..2026-10-04.
`changeQuantity` (`src/services/subscription.service.ts:16`) posts a `PRORATION` invoice, re-prices
every `SCHEDULED` row (`:94`) and sets `subscription.qty = 3` (`:95`).

On this screen: the Plan cell flips from `Support Pro × 2` to `Support Pro × 3`
(`src/app/(internal)/subscriptions/page.tsx:25` reads `s.qty`). "Next bill" is unchanged — the
`billDate` of the next scheduled period is a calendar fact and proration never moves it. The
status stays `Active`. The tiles do not move.

### 7.8 A quantity decrease mid-period — same visible effect

3 seats down to 1. A credit note is issued instead of an invoice
(`src/services/subscription.service.ts:77-89`), future scheduled rows are re-priced down (`:94`),
`qty` becomes 1 (`:95`). This screen shows `Support Pro × 1`. **The credit note is invisible from
here** — there is no credit-note column, no tile and no `/credit-notes` route anywhere in the app.
You only see it as a line in the Proration history table on screen 10.

### 7.9 Cancel with `END_OF_PERIOD` — status flips now, even though billing runs to period end

`src/services/subscription.service.ts:147`: `cancelEffective = periodEnd`. But `:181` sets
`status: "CANCELLED"` and `cancelledAt: new Date()` **immediately**, and `:180` cancels every
`SCHEDULED` row right away.

So on this screen, the instant the form is submitted: Status → `Cancelled`, Next bill → `–`, the
Active tile drops by one and the Cancelled tile rises by one. The `cancelEffective` date (the end
of the current period) is stored in `subscription.cancel_effective` but **is not shown on this
screen at all**. A reader looking only at screen 9 cannot tell an end-of-period cancellation from
an immediate one.

### 7.10 Cancel with `IMMEDIATE_PRORATED_REFUND` — identical row, different money

The seeded plans all use this policy (it is the schema default,
`prisma/schema.prisma:122`, and `prisma/seed/a-plans.ts:6-8` overrides nothing). Unused days of
the current period are credited (`src/services/subscription.service.ts:152-177`). On this screen
the row looks exactly like 7.9: `Cancelled`, next bill `–`. The credit note is not shown here.

### 7.11 Cancel with `NO_REFUND` — again identical

`policy === "NO_REFUND"` skips the `if` at `src/services/subscription.service.ts:152` entirely,
so `credit` stays 0 and no credit note is written. Schedule rows are still cancelled (`:180`),
status still flips (`:181`). **All three policies produce the same-looking row on screen 9.** The
difference is only visible on screen 10 (Proration history, credit column) and on screen 12 (a new
`PRORATION` invoice or none).

### 7.12 Cancel twice — the second attempt is refused

Second submit: `assertSubscriptionTransition("CANCELLED", "CANCELLED")`
(`src/services/subscription.service.ts:139`) hits `CANCELLED: []` in the table
(`src/lib/state/subscription.machine.ts:7`) and throws `ConflictError` "subscription cannot go from
cancelled to cancelled" (`src/lib/state/machine.ts:22-24`). In practice you never see it from the
UI, because screen 10 only renders the Cancel card when `sub.status === "ACTIVE"`
(`src/app/(internal)/subscriptions/[publicId]/page.tsx:88`) — but the guard is there for a
hand-crafted POST. Verified by the test at `src/services/__tests__/billing.service.db.test.ts:153`.

---

## 8. Schema behind this screen

Four tables are touched by the single query.

**`subscription`** (`prisma/schema.prisma:743-777`, SQL table `subscription`)

| Column | Type | Where it comes from |
|---|---|---|
| `id` | serial PK | Postgres |
| `public_id` | unique text | `publicId()` at `src/services/billing.service.ts:70` — this is what the URL uses |
| `customer_id` | FK → `customer` | copied from the quotation, `:71` |
| `quotation_id` | nullable FK | the originating order, `:72` |
| `quotation_line_id` | nullable **unique** FK | the originating line, `:73` — the unique index means one line can only ever spawn one subscription |
| `product_id` | FK | snapshot, `:74` |
| `plan_id` | FK → `recurring_plan` | snapshot, `:75` |
| `qty` | int, `CHECK qty > 0` (`prisma/migrations/20260905095100_init/migration.sql:1032`) | snapshot `:76`, later overwritten only by `changeQuantity` (`src/services/subscription.service.ts:95`) |
| `unit_price` | int paise per unit per period | snapshot `:77` — frozen at confirmation, so a later catalogue price change never re-prices a live subscription |
| `discount_bp` | int, `CHECK BETWEEN 0 AND 10000` (`migration.sql:1025`) | snapshot of `quotation_line.effective_discount_bp`, `:78` |
| `tax_bp` | int | snapshot `:79` |
| `status` | enum `ACTIVE\|PAUSED\|CANCELLED` (`prisma/schema.prisma:126-130`) | `"ACTIVE"` at `:80`, `"CANCELLED"` at `src/services/subscription.service.ts:181`. `PAUSED` is never written. |
| `anchor_date`, `current_period_start`, `current_period_end` | `@db.Date` | `:81-83`; `CHECK current_period_end >= current_period_start` (`migration.sql:1048`) |
| `cancelled_at`, `cancel_effective` | nullable | only by `cancelSubscription`, `:181` |

Indexes: `@@index([customerId])`, `@@index([status])` (`prisma/schema.prisma:774-775`). The status
index is why the `orderBy: [{ status: "asc" }]` on this page is cheap.

**`billing_schedule`** (`prisma/schema.prisma:779-796`) — read here only through
`where: { status: "SCHEDULED" }, take: 1` for the "Next bill" cell. Full description on screen 10.

**`customer`** and **`product`** and **`recurring_plan`** (`prisma/schema.prisma:723-741`) — read
only, for the display names, the `qty` multiplier and the `interval`.

Note what is **not** in this query: `invoice`, `payment`, `credit_note`, `subscription_change`.
This screen knows nothing about money owed or money received.

---

## 9. How this screen connects to the others

- **Screen 4 (Quotation detail) → here.** A quotation line whose product is a `SUBSCRIPTION` kind
  gets `lineType = RECURRING` and a `plan_id`. Confirming that quotation is what creates the row
  you see here.
- **Screen 11 (Customer portal) → here.** The customer's own "Confirm Quotation" click runs
  `confirmOrder` (`src/services/order.service.ts:39-51`) → `onConfirmedHooks`
  (`src/services/portal-hooks.ts:9-13`) → `onConfirmed`. The subscription is created by the
  customer's click, not by an internal user's.
- **Here → screen 10** by clicking any row. That is the only navigation out of this table.
- **Screen 10 → screen 13** — the schedule table on screen 10 links each `INVOICED` period to its
  invoice.
- **Screen 12 (Invoices list)** shows the `RECURRING` invoice that `onConfirmed` posted for period
  one, sitting next to the `ONE_TIME` invoice of the same order.
- **Admin → plans.** The "+ New Plan (Admin)" button goes to `/admin/plans`, which edits
  `recurring_plan` rows. Changing a plan there changes `interval`, `periods`, `proration_mode`,
  `cancel_policy` and `refund_method` for **future** confirmations and for the *cancel* path of
  existing subscriptions (because `cancelSubscription` reads `sub.plan` live at
  `src/services/subscription.service.ts:137`), but it does **not** re-price or re-schedule anything
  already created.

---

## 10. Gotchas

1. **The "Paused" tile is permanently 0.** `SubscriptionStatus.PAUSED` is declared
   (`prisma/schema.prisma:128`) and the state machine allows `ACTIVE → PAUSED`
   (`src/lib/state/subscription.machine.ts:6`), but nothing in `src/` ever writes it. There is no
   pause action, no pause button, no pause service. The tile is rendered
   (`src/app/(internal)/subscriptions/page.tsx:45`) purely because the mockup shows "2 Paused"
   (`docs/MOCKUP_SCREENS.md:118`). If you are demoing, say so — do not wait for it to fill in.

2. **The "Plan" column shows the product, not the plan.** `` `${s.product.name} × ${s.qty}` ``
   (`:25`). The plan name (`Monthly`, `Quarterly`, `Yearly`) only appears as the derived Cycle in
   the next column. The mockup's "Care Plan 2yr" would be a plan name; the code shows
   "Support Pro × 2".

3. **A SALES_REP sees every customer's subscriptions.** No ownership filter (`:17-20`), no role
   argument to `requireUser` (`:16`).

4. **No pagination.** `findMany` with no `take`. With a few hundred rows this is fine; the dev
   database at the time of writing has dozens of leftover rows from earlier test runs, which is why
   its tile counts look inflated — treat any number you see in the running dev app as polluted, not
   as seed truth.

5. **"Next bill" is not a promise that anything will happen on that date.** There is no scheduler,
   no cron, no background job in this repo. Nothing bills period 2 automatically when
   2026-10-05 arrives. The `billing_schedule` row will sit at `SCHEDULED` forever. Only period one
   is ever invoiced, at confirmation time (`src/services/billing.service.ts:133`). This is the
   single biggest honest caveat about the recurring feature.

6. **A cancelled subscription's "Next bill" showing `–` is doing double duty.** It means either
   "the schedule is exhausted" or "the schedule was cancelled". You cannot tell which from this
   screen.

7. **The tiles count rows, the table shows rows, and both come from the same fetch.** If you ever
   see the tiles disagree with the table, it is a rendering bug, not a stale cache — there is only
   one query (`:17`) and the page is `force-dynamic` (`:11`).

8. **`unit_price` is a snapshot.** Change `Support Pro`'s list price in the admin catalogue
   tomorrow and every existing subscription keeps billing at the old price, because
   `subscription.unit_price` was copied at `src/services/billing.service.ts:77` and is never
   re-read from `product`. This is correct behaviour for billing, but it surprises people.
