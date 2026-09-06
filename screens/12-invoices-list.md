# Screen 12 — Invoices List

Route: `/invoices`
File: `src/app/(internal)/invoices/page.tsx`
Mockup: `docs/mockup/12-invoices-list.png`, `docs/MOCKUP_SCREENS.md:155-165`
Spec: `docs/DealFlow360.txt:260` (B7)

---

## 1. What this screen is

Every invoice in the system, in one table, with three summary tiles above it. No filters, no
search, no pagination.

There is no "Create Invoice" button anywhere in DealFlow360. Invoices are only ever created by
code, in exactly two places:

1. **`onConfirmed`** (`src/services/billing.service.ts:21`), running inside the transaction that
   confirms a quotation. It creates **one** `ONE_TIME` invoice covering all one-time lines of the
   order (`:33-60`), plus **one** `RECURRING` invoice per recurring line, for period one only
   (`:100-132`).
2. **`changeQuantity`** (`src/services/subscription.service.ts:52-74`), when a mid-period quantity
   increase prorates to a positive net. That creates a `PRORATION` invoice.

The empty state says it plainly: "Invoices are posted the moment an order is confirmed."
(`src/app/(internal)/invoices/page.tsx:38`).

After a fresh seed this screen is **empty** — `prisma/seed/a-quotes.ts:49-55` sets the invoice
counter to 0 and creates no invoice rows. The first invoice appears when somebody confirms an
order.

---

## 2. Who can open it, and who enforces that

| Role | Can open `/invoices`? | Enforced where |
|---|---|---|
| ADMIN | Yes | `src/middleware.ts:21-32`, then `src/app/(internal)/invoices/page.tsx:13` |
| FINANCE | Yes | same |
| SALES_MANAGER | Yes | same |
| SALES_REP | Yes | same |
| Not logged in | No — `/login?next=/invoices` | `src/middleware.ts:35-42`; `requireUser(undefined, "/invoices")` at `:13` (`src/lib/auth/internal.ts:75-80`) |
| Portal contact | No | `src/middleware.ts:17-20` |

`requireUser` is called with `roles = undefined` (`:13`), so the role check at
`src/lib/auth/internal.ts:78` never fires. **Every internal role sees every invoice of every
customer, including totals and amounts paid.** No ownership filter exists in the query (`:14`).

The result of `requireUser` is not even assigned to a variable here (`await requireUser(...)` on
`:13`), because nothing on this screen is role-dependent. Compare screen 09, which keeps `user` for
the Admin-only button.

The nav tab "Invoices" is visible to all four roles — `src/lib/nav.ts:14` declares no `roles`, and
`visibleNavItems` only filters items that do (`src/lib/nav.ts:21-23`).

**Nothing on this screen is an action.** Record Payment lives on screen 13 and is `OPS_ROLES` only
(`src/app/(internal)/invoices/[publicId]/page.tsx:34`, `src/lib/contract.ts:65`). Modify and Cancel
Subscription live on screen 10 and are also `OPS_ROLES` only. A SALES_REP browsing here can read
everything and change nothing.

---

## 3. Everything on the screen, and where each value comes from

One query feeds the whole page (`src/app/(internal)/invoices/page.tsx:14`). Examples use the
seeded demo order `Q-2026-0004` (Beta Industries: `Laptop 14"` ×2 at 5 % off + `Support Pro` ×2
monthly, `prisma/seed/a-quotes.ts:69-79`) confirmed on 2026-09-05.

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Title "Invoices" | Invoices | `:32`; tab title at `:7` | — | Hard-coded |
| Description | "Every invoice generated from one-time and recurring orders. Click a row to record a payment." | `:32` | — | Hard-coded, from the mockup (`docs/MOCKUP_SCREENS.md:158,164`) |
| **Unpaid** tile | `2` | `:15,34` — counted in JS over the fetched rows: `status === "POSTED" \|\| status === "PARTIAL"` | `invoice.status` | `POSTED` is the column default (`prisma/schema.prisma:830`), applied when `onConfirmed` created the row. `PARTIAL` was derived by `applyPayment` (`src/lib/state/invoice.machine.ts:19-22`) when a payment covered less than the total |
| Unpaid caption | "posted or partially paid" | `:34` | — | Hard-coded |
| **Paid** tile | `0` | `:16,35` — `status === "PAID"` | `invoice.status` | Derived, never typed. `statusAfterPayment` returns `PAID` when `paidAmount >= total` (`src/lib/state/invoice.machine.ts:21`), and `recordPayment` writes it at `src/services/billing.service.ts:167` |
| **Balance due** tile | `₹1,36,880.00` | `:17,36` — `invoices.reduce((s,i) => s + (i.total - i.paidAmount), 0)` | `invoice.total`, `invoice.paid_amount` | `total` was summed from the order lines at `src/services/billing.service.ts:42` (one-time) or copied from the schedule row at `:110` (recurring). `paid_amount` starts at 0 (`prisma/schema.prisma:834`) and only moves through `recordPayment` (`src/services/billing.service.ts:167`) |
| **Invoice #** column | `INV-2026-0001` | `:21` | `invoice.number` | `nextNumber(tx, "invoice", "INV")` (`src/services/support.ts:19-22`) — an atomic `upsert` + `increment` on the `counter` row keyed `"invoice"`, inside the same transaction, formatted `PREFIX-YEAR-0000` by `formatNumber` (`src/lib/ids.ts:21-23`). The seed initialises the counter at 0 (`prisma/seed/a-quotes.ts:52`), so the first invoice is `INV-2026-0001` |
| **Customer** column | `Beta Industries` | `:22`, joined by `include: { customer: true }` at `:14` | `customer.name` via `invoice.customer_id` | Copied from the quotation at `src/services/billing.service.ts:38` (one-time), `:105` (recurring), or from the subscription at `src/services/subscription.service.ts:57` (proration) |
| **Type** column | `One-time` / `Recurring` / `Proration` | `:23`, map at `:10` | `invoice.kind` | Set literally: `"ONE_TIME"` at `src/services/billing.service.ts:37`, `"RECURRING"` at `:104`, `"PRORATION"` at `src/services/subscription.service.ts:56` |
| **Amount** column | `₹1,34,520.00` | `:24` → `Money` (`src/components/shared/money.tsx:5-12`) → `formatMoney` (`src/lib/format.ts:34-36`) | `invoice.total` | Integer paise. One-time: `sum(line.total)` (`src/services/billing.service.ts:42`). Recurring: `schedule[0].total` (`:110`). Proration: `net + chargeTax - creditTax` (`src/services/subscription.service.ts:62`) |
| **Paid** column | `₹0.00`, then `₹30,000.00`, then `₹1,34,520.00` | `:25` | `invoice.paid_amount` | Only ever written at `src/services/billing.service.ts:167` as `invoice.paidAmount + amount` computed by `applyPayment` (`src/lib/state/invoice.machine.ts:35`) |
| **Status** column | `Unpaid` / `Partially Paid` / `Paid` | `:26` → `StatusBadge` | `invoice.status` | Labels are deliberately friendlier than the enum: `POSTED` renders as **"Unpaid"** and `PARTIAL` as **"Partially Paid"** (`src/components/shared/status-badge.tsx:48-49`); `PAID` renders as "Paid" (`:41`) |
| **Due date** column | `20 Sept 2026` | `:27` → `formatDate` (`src/lib/format.ts:64-70`) | `invoice.due_date` | `parseISODate(addDays(today, DUE_DAYS))` with `DUE_DAYS = 15` (`src/services/billing.service.ts:14,25,44`). Proration invoices use a hard-coded `addDays(today, 15)` at `src/services/subscription.service.ts:64` — the same number, written twice |
| Row click target | `/invoices/Nq3xW-2pKdVr` | `:38` — `rowHref` | `invoice.public_id` | 12 random URL-safe characters from `publicId()` (`src/lib/ids.ts:8-13`), assigned at `src/services/billing.service.ts:35`, `:102`, `src/services/subscription.service.ts:54` |
| Empty state | "No invoices yet / Invoices are posted the moment an order is confirmed." | `:38`, rendered by `DataTable` when there are no rows (`src/components/shared/data-table.tsx:39`) | — | — |

### Row order

`orderBy: [{ status: "asc" }, { dueDate: "asc" }]` (`:14`). `status` is a Postgres enum and sorts in
**declaration order**, which is `POSTED, PARTIAL, PAID, VOID` (`prisma/schema.prisma:150-155`). So
unpaid invoices float to the top, then partially paid, then settled — and within each band, the
most overdue first. That is a genuinely useful default for a finance user, and it is not
alphabetical.

---

## 4. The queries this page runs

Three reads, no writes.

1. **Middleware session lookup** — `src/middleware.ts:47`.
2. **Page session lookup** — `requireUser()` at `:13`.
3. **The one page query** — `:14`:

```
prisma.invoice.findMany({
  include: { customer: true },
  orderBy: [{ status: "asc" }, { dueDate: "asc" }],
})
```

That is it. One `SELECT` over `invoice` plus the customer join. The three tiles are computed in
JavaScript from the same array (`:15-17`), not with three `count` / `sum` queries — so the tiles
can never disagree with the table.

`export const dynamic = "force-dynamic"` (`:8`) — no caching, every visit re-queries. Combined with
the `revalidatePath("/invoices")` that `recordPayment` fires
(`src/app/(internal)/actions/billing.ts:17`) and that `changeQuantity` fires
(`src/app/(internal)/actions/subscription.ts:15`), the list is always current.

**No `take`, no `skip`, no `where`.** Every invoice row in the database is loaded on every page
view.

---

## 5. Every condition on this page

| Condition | Where | Effect |
|---|---|---|
| No valid `df_session` | `src/middleware.ts:21-42`, `:13` | Redirect to `/login?next=/invoices`; a stale cookie is deleted (`src/middleware.ts:41`) |
| Session expired or user deactivated | `src/middleware.ts:47-48` | Same redirect |
| `status === "POSTED" \|\| status === "PARTIAL"` | `:15` | Counts toward the Unpaid tile |
| `status === "PAID"` | `:16` | Counts toward the Paid tile |
| (any status) | `:17` | Contributes `total - paidAmount` to Balance due. A `PAID` invoice contributes 0 by arithmetic, so the "across all open invoices" caption is true in effect |
| `invoices.length === 0` | `src/components/shared/data-table.tsx:39` | Empty state replaces the table |
| `i.kind` is `ONE_TIME` / `RECURRING` / `PRORATION` | `:23`, map at `:10` | "One-time" / "Recurring" / "Proration" |
| `i.status` is in the badge map | `src/components/shared/status-badge.tsx:73` | Mapped label and tone; otherwise the raw enum string, neutral |

There are no other conditions. No form, no server action, no `searchParams`, no error banner, no
optimistic locking.

Note what is **absent**: there is no overdue highlight. An invoice whose `due_date` is in the past
looks identical to one due next month. The only date logic on this screen is the sort.

---

## 6. Every action you can take here

Exactly one, and it writes nothing.

**Click a row → open the invoice detail.**

- Button: the whole table row (`ClickableRow`, `src/components/shared/data-table.tsx:69`).
- Target: `/invoices/${i.publicId}` (`src/app/(internal)/invoices/page.tsx:38`).
- Server action: none. Plain navigation.
- Zod schema: none.
- Service: none.
- Guards: only the ones on screen 13.
- Tables written: none.
- Audit row: none.
- What changes on screen: you land on screen 13, where **Record Payment** is available to
  `OPS_ROLES` on an invoice that is still `POSTED` or `PARTIAL`
  (`src/app/(internal)/invoices/[publicId]/page.tsx:34`).

**What you cannot do here:** create an invoice, void an invoice, record a payment, issue a credit
note, export, filter or search. There is no "Export PDF" button on this screen — the print
export exists only on screen 13 ("Download Summary",
`src/app/(internal)/invoices/[publicId]/_components/print-button.tsx`) and on the reports screen
("Export PDF", `src/components/reports/print-button.tsx`). Both are `window.print()`, not generated
files. See screen 13 §10.

---

## 7. Scenarios

Money is integer paise throughout. `Laptop 14"` list `6000000` paise (₹60,000),
`Support Pro` list `100000` paise (₹1,000), tax 18 % (`tax_bp = 1800`, `prisma/schema.prisma:330`).

### 7.1 An order with only one-time lines — exactly one row appears

Rep quotes `Laptop 14"` ×2 at 5 % off. On confirm, `onConfirmed` runs the one-time block once
(`src/services/billing.service.ts:31-60`):

```
gross    = 6000000 * 2                 = 12000000
discount = pct(12000000, 500)          =   600000
net      = 11400000                     → invoice.subtotal   (:40, sum of line.net)
tax      = pct(11400000, 1800)         =  2052000 → invoice.tax_total (:41)
total    = 13452000                     → invoice.total      (:42)   = ₹1,34,520.00
```

One row: `INV-2026-0001 | Beta Industries | One-time | ₹1,34,520.00 | ₹0.00 | Unpaid | 20 Sept 2026`.
Tiles: Unpaid 1, Paid 0, Balance due ₹1,34,520.00.

**Note it is one invoice for all one-time lines, not one per line.** Ten laptops, three docks and a
setup service on the same order still produce a single `ONE_TIME` invoice with ten, three and one
`invoice_line` rows (`:46-57`).

### 7.2 An order with only a subscription — exactly one row, kind Recurring

`Support Pro` ×2 monthly, nothing else. `oneTime.length === 0`, so the block at
`src/services/billing.service.ts:31` is skipped entirely — **no one-time invoice**. The recurring
loop (`:65-136`) creates the subscription, 12 schedule rows, and one invoice for **period one
only**:

```
schedule row 1: net 200000, tax pct(200000,1800) = 36000, total 236000
invoice.subtotal = 200000 (:108), tax_total = 36000 (:109), total = 236000 (:110)
invoice.period_start = 2026-09-05, period_end = 2026-10-04 (:113-114)
```

One row: `INV-2026-0001 | … | Recurring | ₹2,360.00 | ₹0.00 | Unpaid | 20 Sept 2026`.

Periods 2 to 12 produce **no invoices at all**, now or ever — nothing in this repo bills them
later. See §10.

### 7.3 A mixed order — two rows, numbered in a fixed order

The seeded `Q-2026-0004`. Both branches run in the same transaction and both call `nextNumber`
(`src/services/support.ts:19-22`), which increments the same `counter` row. The one-time block
runs first (`src/services/billing.service.ts:31`), so:

- `INV-2026-0001` `ONE_TIME` ₹1,34,520.00
- `INV-2026-0002` `RECURRING` ₹2,360.00

Both `POSTED`, both due 2026-09-20. Tiles: Unpaid 2, Paid 0, Balance due ₹1,36,880.00. Pinned by
the test at `src/services/__tests__/billing.service.db.test.ts:53-58`.

Two separate invoices, deliberately: the one-time goods and the first subscription period settle
independently. Screen 13 explains this in a footnote (`src/app/(internal)/invoices/[publicId]/page.tsx:146`).

### 7.4 A partial payment — the row changes, the tiles rebalance

Finance records `3000000` paise (₹30,000) against `INV-2026-0001` (total `13452000`).
`applyPayment` (`src/lib/state/invoice.machine.ts:28-39`):

```
due        = 13452000 - 0 = 13452000
amount 3000000 > 0 ✓, ≤ due ✓
paidAmount = 3000000
status     = paidAmount < total → "PARTIAL"        (:21)
due        = 10452000
```

The row becomes `… | ₹1,34,520.00 | ₹30,000.00 | Partially Paid | …`. Tiles: Unpaid stays 2 (a
`PARTIAL` invoice still counts as unpaid, `:15`), Paid stays 0, Balance due drops to
₹1,06,880.00. Pinned at `src/services/__tests__/billing.service.db.test.ts:70-72`.

### 7.5 A full payment — the row moves down the table

A second payment of `10452000` settles it. `paidAmount = 13452000`, `status = "PAID"` (`:21`),
`paid_at = now()` (`src/services/billing.service.ts:167`).

The row's badge reads `Paid`, its Paid column equals its Amount, and — because the sort is
`status asc` (`:14`) and `PAID` comes after `POSTED` and `PARTIAL` in the enum declaration
(`prisma/schema.prisma:150-155`) — **the row physically moves to the bottom of the table.** That
re-ordering is the most visible feedback this screen gives.

Tiles: Unpaid 1, Paid 1, Balance due ₹2,360.00.

### 7.6 A duplicate submit of the payment form — nothing changes twice

Screen 13 renders a hidden `clientRef` generated once per page render
(`src/app/(internal)/invoices/[publicId]/page.tsx:225`, `newRef(16)` = `publicId(16)`). A
double-click, a browser retry, or a back-and-resubmit sends the **same** `clientRef`.

`recordPayment` looks it up first (`src/services/billing.service.ts:153`), finds the existing
payment, and returns `{ ..., duplicate: true }` at `:155-156` **before creating anything**. No
second `payment` row, no second `invoice` update, no second audit row.

On this screen: absolutely nothing changes on the second submit. Pinned at
`src/services/__tests__/billing.service.db.test.ts:74-77` (`payment.count` stays 1).

The database backs this up independently: `payment.client_ref` is `@unique`
(`prisma/schema.prisma:906`), so even a race that got past the read would fail the insert.

### 7.7 An overpayment attempt — refused three times over

Somebody tries to pay `20000000` paise against an invoice with `13452000` due.

1. **In the browser**: the amount input carries `max={(due / 100).toFixed(2)}`
   (`src/app/(internal)/invoices/[publicId]/page.tsx:228`), so the form will not submit.
2. **In the service**: `applyPayment` throws
   `ValidationError("Amount exceeds the balance due", { amount: ["At most 13452000 paise is due"] })`
   at `src/lib/state/invoice.machine.ts:34`, **before** any row is written. The action converts it
   (`src/lib/contract.ts:157-159`) and the form redirects back with `?error=…`
   (`src/app/(internal)/actions/billing.ts:35-36`).
3. **In the database**: `ALTER TABLE "invoice" ADD CONSTRAINT "invoice_paid_within_total" CHECK
   ("paid_amount" >= 0 AND "paid_amount" <= "total")`
   (`prisma/migrations/20260905095100_init/migration.sql:1040`). Even a hand-written `UPDATE`
   cannot make an invoice overpaid. If that constraint ever did fire, `fromDatabaseError`
   recognises the suffix `paid_within_total` and turns it into the friendly "Payment cannot exceed
   the invoice total" (`src/lib/contract.ts:126,135-147`).

On this screen: nothing changes. The refused attempt leaves no row behind. Pinned at
`src/services/__tests__/billing.service.db.test.ts:79`.

### 7.8 A quantity increase mid-period — a third row appears, kind Proration

Beta goes 2 → 3 seats. `changeQuantity` prorates and, because `net > 0`, posts a `PRORATION`
invoice (`src/services/subscription.service.ts:48-76`). With the change on day one of a 30-day
period:

```
credit    = divRound(100000 * 2 * 30, 30) = 200000
charge    = divRound(100000 * 3 * 30, 30) = 300000
net       = 100000
chargeTax = pct(300000, 1800) = 54000
creditTax = pct(200000, 1800) = 36000
subtotal  = 100000, tax_total = 54000 - 36000 = 18000, total = 118000   → ₹1,180.00
```

A new row: `INV-2026-0003 | … | Proration | ₹1,180.00 | ₹0.00 | Unpaid | …`. It sorts to the top of
the `POSTED` band by due date. Tiles: Unpaid +1, Balance due +₹1,180.00. Pinned at
`src/services/__tests__/billing.service.db.test.ts:125-128`.

The invoice's two lines (positive charge, negative credit) are only visible on screen 13.

### 7.9 A quantity decrease mid-period — no row appears at all

3 → 1 seats. `net = -200000`, so `changeQuantity` takes the credit-note branch
(`src/services/subscription.service.ts:77-89`) and creates a `credit_note` row, **not** an
invoice. `/invoices` is unchanged: no new row, no tile movement, no balance change.

The credit note (`amount = 200000 + pct(200000,1800) = 236000`, pinned at
`src/services/__tests__/billing.service.db.test.ts:132-135`) is not visible anywhere in the
application. There is no credit-note screen. See screen 10 §10.6.

### 7.10 Cancel with `IMMEDIATE_PRORATED_REFUND` and `refundMethod = CREDIT_NOTE`

`cancelSubscription` writes a `credit_note` (`src/services/subscription.service.ts:159-169`) and
cancels the future schedule rows. **No invoice row is created or modified**, so this screen does
not move at all. The already-posted `RECURRING` invoice for the current period keeps its status and
its balance.

### 7.11 Cancel with `IMMEDIATE_PRORATED_REFUND` and `refundMethod = REFUND_PAYMENT` on a paid invoice

A `credit_note` with `status = "REFUNDED"` plus a `payment` row with `kind = "REFUND"`
(`src/services/subscription.service.ts:171-176`). **`invoice.paid_amount` is not touched** — no
`invoice.update` runs in that branch. So on this screen the invoice still shows `Paid` with the
full amount in the Paid column, and Balance due is still 0 for it. The money leaving the business
is invisible from `/invoices`.

### 7.12 Cancel with `END_OF_PERIOD` or `NO_REFUND`

Neither writes anything to `invoice`, `payment` or `credit_note` (the `if` at
`src/services/subscription.service.ts:152` is false for both). This screen is unchanged under both
policies.

### 7.13 Paying every invoice while the goods are still unshipped

Both invoices of the mixed order are paid in full. Both rows show `Paid`, tiles read Unpaid 0,
Paid 2, Balance due ₹0.00.

But the **order** does not become `PAID`. `recordPayment` checks two things after the last invoice
settles (`src/services/billing.service.ts:180-191`): no invoice of the order still `POSTED` or
`PARTIAL` (`:181`), **and** nothing still waiting — no `RESERVED` shipment on an `ACCEPTED` plan and
no `PROPOSED` fulfillment plan (`:183-185`). With the laptops still in the warehouse, `waiting > 0`,
so the quotation stays `CONFIRMED`. `/quotes` and `/pipeline` still show it as in progress while
`/invoices` shows everything settled.

The flip happens later, from the other side: `ship()` re-runs the same two counts after the last
shipment leaves (`src/services/fulfillment.service.ts:235-241`) and promotes the quotation to
`PAID` then. Pinned at `src/services/__tests__/billing.service.db.test.ts:86-93`.

### 7.14 The mockup's "nothing is billed before it ships" is not what the code does

`docs/MOCKUP_SCREENS.md:177` says "Partial invoicing stays reconciled with partial delivery,
nothing is billed before it ships." In this implementation **everything is invoiced at
confirmation**, before a single item is picked (`src/services/billing.service.ts:21`, called from
`src/services/portal-hooks.ts:10` inside the confirm transaction). Trust the code. What the code
does guarantee is the reverse direction: an order is not *completed* until both the money is in and
the goods are out.

---

## 8. Schema behind this screen

**`invoice`** — `prisma/schema.prisma:822-856`, SQL table `invoice`.

| Column | Type | Written by | Notes |
|---|---|---|---|
| `id` (`:823`) | serial PK | Postgres | Never in a URL |
| `public_id` (`:824`) | unique text | `publicId()` at `src/services/billing.service.ts:35,102`, `src/services/subscription.service.ts:54` | What `rowHref` uses |
| `number` (`:825`) | unique text | `nextNumber` (`src/services/support.ts:19-22`) | `INV-2026-0001`. Unique index means a duplicate number is impossible even under concurrency; the counter `upsert` is atomic inside the transaction |
| `kind` (`:826`) | enum `ONE_TIME\|RECURRING\|PRORATION` (`:144-148`) | literals at `src/services/billing.service.ts:37,104` and `src/services/subscription.service.ts:56` | |
| `customer_id` (`:827`) | FK | `:38,105`, `src/services/subscription.service.ts:57` | |
| `quotation_id` (`:828`) | nullable FK | `:39,106`, `src/services/subscription.service.ts:58` | Nullable because a subscription may outlive its quotation reference |
| `subscription_id` (`:829`) | nullable FK | `:107`, `src/services/subscription.service.ts:59` | Null on `ONE_TIME` invoices |
| `status` (`:830`) | enum `POSTED\|PARTIAL\|PAID\|VOID` (`:150-155`), default `POSTED` | **only** `src/services/billing.service.ts:167` | **Derived from `paid_amount`, never set by hand.** See below |
| `subtotal`, `tax_total`, `total` (`:831-833`) | int paise | `:40-42`, `:108-110`, `src/services/subscription.service.ts:60-62` | `CHECK total >= 0` (`migration.sql:1041`) |
| `paid_amount` (`:834`) | int paise, default 0 | **only** `src/services/billing.service.ts:167` | `CHECK paid_amount >= 0 AND paid_amount <= total` (`migration.sql:1040`) |
| `issue_date`, `due_date` (`:835-836`) | `@db.Date` | `:43-44`, `:111-112`, `src/services/subscription.service.ts:63-64` | Due = issue + 15 days |
| `period_start`, `period_end` (`:837-838`) | nullable `@db.Date` | `:113-114`, `src/services/subscription.service.ts:65-66` | Null on `ONE_TIME` invoices |
| `paid_at` (`:839`) | nullable timestamp | `src/services/billing.service.ts:167` | Set when the status reaches `PAID`, reset to null otherwise |

Indexes: `@@index([quotationId])`, `@@index([customerId])`, `@@index([status])`
(`prisma/schema.prisma:852-854`). The status index is what makes this page's `orderBy status` cheap.

### Status is derived, and overpayment is impossible at the storage layer

This is the single most important invariant on this screen. Nothing anywhere in `src/` sets
`invoice.status` from user input. The chain is:

```
statusAfterPayment(total, paidAmount)      src/lib/state/invoice.machine.ts:19-22
  paidAmount <= 0     → "POSTED"
  paidAmount < total  → "PARTIAL"
  otherwise           → "PAID"
```

`applyPayment` (`:28-39`) computes the new `paidAmount` and calls that function, then asserts the
transition is legal (`:37`) against `INVOICE_TRANSITIONS` (`:6-11`). `recordPayment` writes both
columns together in **one** `updateMany` (`src/services/billing.service.ts:165-168`), so they can
never drift apart.

Underneath, the CHECK constraint
`invoice_paid_within_total: paid_amount >= 0 AND paid_amount <= total`
(`prisma/migrations/20260905095100_init/migration.sql:1040`) makes an overpaid invoice
unrepresentable. Not "validated against" — **unrepresentable**. And
`payment_amount_positive: amount > 0` (`migration.sql:1042`) makes a zero or negative payment
unrepresentable too.

**`customer`** — read only, for the name.

**`payment`** (`prisma/schema.prisma:900-916`) and **`invoice_line`**
(`prisma/schema.prisma:858-877`) are **not** read by this page. Their contents are on screen 13.

---

## 9. How this screen connects to the others

- **Screen 4 / screen 11 → here.** Confirming a quotation, from the workspace
  (`src/services/order.service.ts:39-51`) or from the customer portal
  (`src/services/portal.service.ts:153`), runs `onConfirmedHooks`
  (`src/services/portal-hooks.ts:9-13`) → `onConfirmed`, and that is what puts rows on this screen.
- **Here → screen 13** by clicking any row. That is the only navigation out.
- **Screen 10 → here.** A Modify with a positive net posts a `PRORATION` invoice
  (`src/services/subscription.service.ts:52`) that appears here. The billing schedule on screen 10
  links its `INVOICED` period straight to that invoice's detail page.
- **Screen 13 → here.** After Record Payment, `revalidatePath("/invoices")`
  (`src/app/(internal)/actions/billing.ts:17`) means this list is fresh on the next visit.
- **Screens 3 / 7 (Quotations, Fulfillment).** A quotation only reaches `PAID` when both this
  screen shows every one of its invoices settled **and** fulfillment has nothing outstanding
  (`src/services/billing.service.ts:180-191`, mirrored in
  `src/services/fulfillment.service.ts:235-241`).
- **Screen 15 (Reports)** aggregates over the same `invoice` rows through
  `src/services/reports.service.ts`.

---

## 10. Gotchas

1. **Only period one of any subscription is ever invoiced.** `onConfirmed` invoices
   `schedule[0]` and stops (`src/services/billing.service.ts:98-133`). There is no scheduler, cron
   or background job in this repository. Periods 2 to 12 sit at `SCHEDULED` forever and will never
   appear on this list. A demo that says "and next month it bills again" is describing intent, not
   behaviour.

2. **`InvoiceStatus.VOID` is never written.** It exists in the enum
   (`prisma/schema.prisma:154`) and in the transition table (`POSTED: ["PARTIAL","PAID","VOID"]`,
   `src/lib/state/invoice.machine.ts:7`) and it has a badge label
   (`src/components/shared/status-badge.tsx:50`), but no service voids an invoice. There is no
   Void button. Grep for `"VOID"` in `src/` and the only non-test hit is the transition table. The
   status filter on this screen therefore has three live values, not four.

3. **`CreditNoteStatus.APPLIED` is never written either**, and `credit_note.applied_to_invoice_id`
   (`prisma/schema.prisma:888`) is never set. Credit notes are created `OPEN`
   (`src/services/subscription.service.ts:79-87`) or `REFUNDED` (`:166`) and stay that way. There
   is no "apply this credit note to that invoice" feature, and credit notes are invisible on every
   screen in the app.

4. **Amount and Paid look reconciled but a refund is not subtracted.** A `REFUND` payment
   (`src/services/subscription.service.ts:172-174`) does not decrease `invoice.paid_amount`. A
   refunded invoice still reads `Paid` here, with its full amount in the Paid column, and
   contributes 0 to Balance due.

5. **Balance due sums every invoice, not only open ones.** `invoices.reduce(...)` at `:17` has no
   filter. Paid invoices contribute `total - total = 0`, so the number is right, but the caption
   "across all open invoices" (`:36`) describes the intent rather than the code.

6. **No overdue indicator.** An invoice 60 days past its `due_date` is styled exactly like one due
   next week. Only the sort order hints at it.

7. **No pagination and no filter.** `findMany` with no `take` (`:14`). The dev database at the time
   of writing holds several hundred leftover invoices from earlier automated test runs — the tile
   numbers you see in the running app are polluted test data, not seed truth. After a clean
   `prisma db seed` this screen is empty.

8. **A SALES_REP sees every customer's invoices and balances.** `requireUser(undefined, …)` at
   `:13`, no ownership filter in the query.

9. **"Unpaid" is the label; `POSTED` is the value.** If you go looking in the database for a status
   called "Unpaid" you will not find it. The friendly names are only in
   `src/components/shared/status-badge.tsx:48-49`.

10. **The row-click hint "Click a row to record a payment" (`:32`) over-promises for a SALES_REP.**
    They can open the detail, but the Record Payment card is not rendered for them
    (`src/app/(internal)/invoices/[publicId]/page.tsx:34,216`).
