# Screen 13 — Invoice Detail

Route: `/invoices/[publicId]`
File: `src/app/(internal)/invoices/[publicId]/page.tsx`
Mockup: `docs/mockup/13-invoice-detail.png`, `docs/MOCKUP_SCREENS.md:167-177`
Spec: `docs/DealFlow360.txt:260` (B7)

---

## 1. What this screen is

One invoice, completely: a four-step progress stepper for the order behind it, the other invoices
of that same order, the invoice lines with their money breakdown, the payments received so far, and
the **Record Payment** form.

This is the only screen in the application where money is received. `recordPayment`
(`src/services/billing.service.ts:149`) is the single writer to the `payment` table for
`kind = "PAYMENT"`, and the single writer to `invoice.paid_amount` and `invoice.status` anywhere in
`src/`.

It is also where a paper invoice comes from — the "Download Summary" button — with the honest
caveat in §10 that it is a browser print dialog, not a generated PDF file.

---

## 2. Who can open it, and who enforces that

| Role | Open the page? | See Record Payment? | Enforced where |
|---|---|---|---|
| ADMIN | Yes | Yes, when the invoice is `POSTED` or `PARTIAL` | open: `:21`; render: `:34,216`; action: `src/app/(internal)/actions/billing.ts:16`; service: `src/services/billing.service.ts:152` |
| FINANCE | Yes | Yes, same condition | same |
| SALES_MANAGER | Yes | Yes, same condition | same |
| **SALES_REP** | **Yes — read only** | **No, never** | `canPay = OPS_ROLES.includes(user.role) && …` at `:34`; `OPS_ROLES = ["ADMIN","FINANCE","SALES_MANAGER"]` (`src/lib/contract.ts:65`) |
| Not logged in | No | — | `src/middleware.ts:21-42`, then `requireUser(undefined, "/invoices/<id>")` at `:21` |
| Portal contact | No | — | `src/middleware.ts:17-20` |

A SALES_REP sees the stepper, the related-invoices card, every line, the totals, the payments
already received, and the Download Summary button. They do not see the Record Payment card at all
(`:216` gates the whole `<Card>` on `canPay`).

### Three layers behind the button

1. **Render** — `canPay` at `:34`, requiring both an OPS role and a payable status.
2. **Action** — `requireActionUser(["ADMIN","FINANCE","SALES_MANAGER"])` at
   `src/app/(internal)/actions/billing.ts:16`, throwing `ForbiddenError`
   (`src/lib/auth/internal.ts:64-68`).
3. **Service** — `assertActor(actor, "RECORD_PAYMENT")` at `src/services/billing.service.ts:152`,
   which checks `QUOTATION_ACTORS.RECORD_PAYMENT = ["FINANCE","SALES_MANAGER","ADMIN"]`
   (`src/lib/state/quotation.machine.ts:40`) and throws `ForbiddenError` "A sales rep cannot record
   payment" (`src/lib/state/quotation.machine.ts:66-71`).

Pinned by the test at `src/services/__tests__/billing.service.db.test.ts:98`.

Note that **Modify Subscription and Cancel Subscription are not on this screen** — they live on
screen 10 and are also `OPS_ROLES` only, not rendered for a SALES_REP
(`src/app/(internal)/subscriptions/[publicId]/page.tsx:22,62,88`).

---

## 3. Everything on the screen, and where each value comes from

One query feeds everything (`:22-31`). Examples use the seeded demo order `Q-2026-0004` (Beta
Industries: `Laptop 14"` ×2 at 5 % off + `Support Pro` ×2 monthly, `prisma/seed/a-quotes.ts:69-79`)
confirmed on 2026-09-05, looking at `INV-2026-0001`, the one-time invoice.

### Header and print block

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Back link "Invoices" | — | `:47-49` | — | Hard-coded |
| Title | `INV-2026-0001 · Beta Industries` | `:52` | `invoice.number`, `customer.name` | `number` from `nextNumber` (`src/services/support.ts:19-22`), an atomic counter increment inside the confirming transaction. `customer_id` copied from the quotation at `src/services/billing.service.ts:38` |
| Description | `One-time invoice · issued 05 Sept 2026 · due 20 Sept 2026 · order Q-2026-0004` | `:53` | `invoice.kind`, `issue_date`, `due_date`, `quotation.number` | `kind` set literally at `src/services/billing.service.ts:37`; issue = confirmation day (`:24,43`); due = issue + `DUE_DAYS` where `DUE_DAYS = 15` (`:14,25,44`) |
| Description, recurring variant | `Recurring invoice · Monthly · issued …` | `:53` | + `recurring_plan.name` via `subscription: { include: { plan: true } }` at `:30` | The plan the subscription points at |
| Status badge | `Unpaid` | `:56` | `invoice.status` | **Derived from `paid_amount`** — see §6. `POSTED` renders as "Unpaid" (`src/components/shared/status-badge.tsx:48`) |
| "Download Summary" button | — | `:57` → `src/app/(internal)/invoices/[publicId]/_components/print-button.tsx:9` | — | Calls `window.print()`. Not a file. See §10 |
| Print-only letterhead | `DealFlow360 Demo Pvt. Ltd. · Bengaluru, India · GSTIN 29ABCDE1234F1Z5` | `:61-71` | — | **Hard-coded strings**, not a company/settings table. There is no seller record in the schema |
| Print-only "Bill to" | `Beta Industries` | `:75` | `customer.name` | |
| Print-only Issue / Due / Order | `05 Sept 2026`, `20 Sept 2026`, `Q-2026-0004` | `:79,83,87` | `issue_date`, `due_date`, `quotation.number` | When there is no quotation, that third cell shows `Paid`/`Unpaid` instead (`:86-87`) |
| Error banner | `Amount exceeds the balance due At most 13452000 paise is due` | `:91` reading `searchParams.error` | — | Put in the URL by `recordPaymentForm` via `errorQuery` (`src/app/(internal)/actions/billing.ts:35-36`, `src/lib/contract.ts:165-168`) |

### The stepper — `:38-43`, rendered at `:93-110`

Four nodes, each a boolean. This is the mockup's `Order Confirmed | Shipped | Invoiced | Paid`
(`docs/MOCKUP_SCREENS.md:171`).

| Node | Reads | Example | Source of the value |
|---|---|---|---|
| **Order Confirmed** | `!!inv.quotation?.confirmedAt` (`:39`) | green | `quotation.confirmed_at`, written by `confirmOrder` at `src/services/order.service.ts:46` in the same transaction that created this invoice. So for any invoice with a quotation it is **always** green |
| **Shipped** | `inv.quotation?.fulfillmentPlans.some(p => p.shipments.length > 0 && p.shipments.every(s => s.status === "SHIPPED"))` (`:35`) | grey until goods leave | `shipment.status`, set to `SHIPPED` by `ship()` at `src/services/fulfillment.service.ts:232`. The plans are pre-filtered to `status: "ACCEPTED"` in the query (`:28`) |
| **Invoiced** | `done: true`, **hard-coded** (`:41`) | always green | You are looking at an invoice, so it exists. No column is read |
| **Paid** | `inv.status === "PAID"` (`:42`) | grey until settled | `invoice.status`, derived from `paid_amount` by `applyPayment` (`src/lib/state/invoice.machine.ts:19-22`) and written at `src/services/billing.service.ts:167` |

A green node shows a check mark, a grey one shows its index (`:103`), and the connector to the next
node is green only when the **next** node is done (`:107`).

### Related invoices card — `:112-149`, only when the order has more than one invoice

| Column | Example | Where | table.column | Source |
|---|---|---|---|---|
| Invoice # | `INV-2026-0001` (plain, current) / `INV-2026-0002 (Recurring)` (link) | `:130-137`, label suffix map at `:36` | `invoice.number`, `kind`, `public_id` | From `quotation: { include: { invoices: { orderBy: { id: "asc" } } } }` at `:28`. The current invoice is rendered as text, the others as links |
| Amount | `₹1,34,520.00` | `:139` | `invoice.total` | `src/services/billing.service.ts:42` / `:110` / `src/services/subscription.service.ts:62` |
| Status | `Unpaid` / `Paid` | `:140` | `invoice.status` | Derived |
| Due date | `20 Sept 2026` | `:141` | `invoice.due_date` | issue + 15 days |
| Footnote | "One-time and recurring lines of the same order are billed separately; each invoice settles on its own." | `:146` | — | Hard-coded, and accurate |

### Invoice lines card — `:152-196`

One row per `invoice_line`, ordered by `sort_order` (`:26`).

| Column | Example (one-time) | Where | table.column | Source |
|---|---|---|---|---|
| Description | `Laptop 14"` | `:172` | `invoice_line.description` | Copied verbatim from `quotation_line.description` at `src/services/billing.service.ts:48`. On a `RECURRING` invoice it is composed: `"Support Pro · Monthly · 2026-09-05 to 2026-10-04"` (`:119`). On a `PRORATION` invoice: `"Support Pro · 3 seats from 2026-09-06 (29 of 30 days)"` and `"Credit: Support Pro · 2 seats already billed for the same days"` (`src/services/subscription.service.ts:69-70`) |
| Qty | `2` | `:173` | `invoice_line.qty` | `src/services/billing.service.ts:49`; `CHECK qty > 0` (`migration.sql:1033`) |
| Unit | `₹60,000.00` | `:174` | `invoice_line.unit_price` | `:50` — the price the customer agreed to, frozen |
| Discount | `5%` | `:175` → `formatBp` (`src/lib/format.ts:46-49`) | `invoice_line.discount_bp` | Copied from `quotation_line.effective_discount_bp` (`:51`) — the **effective** one, already folding in any order-level discount |
| Net | `₹1,14,000.00` | `:176` | `invoice_line.net` | `:52`. May be **negative** on a proration credit line (`prisma/schema.prisma:866`) |
| Tax | `₹20,520.00` | `:177` | `invoice_line.tax` | `:54` |
| Total | `₹1,34,520.00` | `:178` | `invoice_line.total` | `:55` |
| Subtotal | `₹1,14,000.00` | `:185` | `invoice.subtotal` | `oneTime.reduce((s,l) => s + l.net, 0)` (`:40`) — the header total is the sum of its lines by construction, not a separate calculation |
| Tax | `₹20,520.00` | `:187` | `invoice.tax_total` | `:41` |
| Total | `₹1,34,520.00` | `:189` | `invoice.total` | `:42` |
| Paid | `₹0.00` | `:191` | `invoice.paid_amount` | Default 0 (`prisma/schema.prisma:834`), only ever changed at `src/services/billing.service.ts:167` |
| Balance due | `₹1,34,520.00` | `:193` | computed at `:33`: `inv.total - inv.paidAmount` | Not stored anywhere |

### Payments card — `:199-215`

| What you see | Example | Where | table.column | Source |
|---|---|---|---|---|
| "No payments yet." | when empty | `:204` | — | `invoice.payments.length === 0` |
| One line per payment | `05 Sept, 14:30 · bank transfer · UTR12345` + `₹30,000.00` | `:205-213` | `payment.received_at`, `method`, `reference`, `amount` | `received_at` defaults to `now()` (`prisma/schema.prisma:909`); `method`, `reference` and `amount` come straight from the form (`src/services/billing.service.ts:162`); shown in Asia/Kolkata by `formatDateTime` (`src/lib/format.ts:73-76`) |

Ordered by `receivedAt` asc (`:27`) — oldest first.

### Record Payment card — `:216-251`, only when `canPay`

| Field | Example | Where | Notes |
|---|---|---|---|
| Hidden `invoiceId` | `1` | `:223` | The integer PK |
| Hidden `publicId` | `Nq3xW-2pKdVr` | `:224` | Used to redirect back here |
| Hidden `clientRef` | `aB3-x9Qk_2LmZq7T` | `:225` — `newRef(16)` = `publicId(16)` (`src/lib/ids.ts:8-13`) | **Generated once per page render.** This is the idempotency key. See §6 |
| Amount (₹) | label "Amount (₹), balance 134520.00", prefilled with the full balance, `min="0.01"`, `max` = the balance, `step="0.01"` | `:227-228` | Rupees in the browser, paise on the server |
| Method | `Bank transfer` default, plus UPI / Card / Cheque / Cash | `:232-238` | Matches the Zod enum at `src/lib/validation/billing.ts:10` |
| Reference (optional) | `UTR12345` | `:242` | Free text, max 120 chars (`src/lib/validation/billing.ts:11`) |
| Footnote | "Partial payments allowed; more than the balance is refused." | `:247` | Accurate — see §7.7 |

### Bottom notes

| What you see | Where | Truth |
|---|---|---|
| "Partial invoicing stays reconciled with partial delivery: the stepper above tracks shipment against payment for this order." | `:252-254` | The stepper does track both, but **billing happens at confirmation, before shipping**, so "nothing is billed before it ships" (`docs/MOCKUP_SCREENS.md:177`) is not what the code does |
| "Computer-generated invoice · payment terms 15 days." | `:257`, print only | The 15 comes from `DUE_DAYS` (`src/services/billing.service.ts:14`) and from the hard-coded `addDays(today, 15)` at `src/services/subscription.service.ts:64` |

---

## 4. The queries this page runs

Three reads on render, plus one transaction on submit.

1. **Middleware session lookup** — `src/middleware.ts:47`.
2. **Page session lookup** — `requireUser()` at `:21`.
3. **The one page query** — `:22-31`:

```
prisma.invoice.findUnique({
  where: { publicId },
  include: {
    customer: true,
    lines:    { orderBy: { sortOrder: "asc" } },
    payments: { orderBy: { receivedAt: "asc" } },
    quotation: { include: {
      fulfillmentPlans: { where: { status: "ACCEPTED" }, include: { shipments: true } },
      invoices:         { orderBy: { id: "asc" } },
    }},
    subscription: { include: { plan: true } },
  },
})
```

`notFound()` at `:32` for an unknown `publicId`.
`export const dynamic = "force-dynamic"` (`:17`) — never cached.

**On submit**, `recordPayment` opens one `prisma.$transaction`
(`src/services/billing.service.ts:150`) containing, in order: the `clientRef` lookup (`:153`), the
invoice read (`:158`), the `payment` insert (`:161`), the conditional `invoice.updateMany`
(`:165`), the audit insert (`:170`) — plus, when the invoice just reached `PAID`, an invoice count
(`:181`), a shipment count and a plan count (`:184-185`), a quotation read (`:186`) and possibly a
quotation update and a second audit row (`:189-190`). One commit, or none of it.

Then `revalidatePath` for `/invoices`, `/quotes` and `/subscriptions`
(`src/app/(internal)/actions/billing.ts:17`), and a redirect back to this page
(`:36`).

---

## 5. Every condition on this page

| Condition | Where | Effect |
|---|---|---|
| No valid session | `src/middleware.ts:21-42`, `:21` | Redirect to `/login?next=/invoices/<id>` |
| `publicId` does not resolve | `:32` | `notFound()` → 404 |
| `OPS_ROLES.includes(user.role)` | `:34` | Half of `canPay` |
| `inv.status === "POSTED" \|\| "PARTIAL"` | `:34` | The other half. A `PAID` invoice shows no form to anybody |
| `inv.quotation?.confirmedAt` set | `:39` | Stepper node 1 green |
| Some accepted plan has shipments and all of them are `SHIPPED` | `:35` | Stepper node 2 green |
| (always) | `:41` | Stepper node 3 green |
| `inv.status === "PAID"` | `:42` | Stepper node 4 green |
| `related.length > 1` | `:112` | The "Invoices on order …" card renders |
| `r.id === inv.id` | `:129,131` | The current invoice is bold and not a link |
| `inv.payments.length === 0` | `:204` | "No payments yet." |
| `p.reference` present | `:209` | Appended after the method |
| `searchParams.error` present | `:91` | Red banner |
| `inv.quotation` present | `:53,86-87,115` | Order number in the description, in the print block and in the related card title; otherwise omitted |
| `inv.kind` | `:53,36` | Wording in the description and the `(Recurring)` / `(Proration)` suffix in the related card |

### Server-side conditions the form cannot express

| Condition | Where | Error |
|---|---|---|
| Amount is not a positive integer | `zod` `z.coerce.number().int().positive()` (`src/lib/validation/billing.ts:8`), then again `src/lib/state/invoice.machine.ts:33` | `VALIDATION` "Amount must be more than zero" |
| `clientRef` shorter than 8 or longer than 64 | `src/lib/validation/billing.ts:9` | `VALIDATION` |
| Method not in the enum | `src/lib/validation/billing.ts:10` | `VALIDATION` |
| Caller is not FINANCE / SALES_MANAGER / ADMIN | `src/app/(internal)/actions/billing.ts:16`, then `src/services/billing.service.ts:152` | `FORBIDDEN` |
| `clientRef` already used **on a different invoice** | `src/services/billing.service.ts:154` | `CONFLICT` "This payment reference was already used on another invoice" |
| `clientRef` already used on **this** invoice | `:155-156` | Not an error — returns `duplicate: true` |
| Invoice not found | `:158-159` | `NOT_FOUND` |
| Invoice is `PAID` or `VOID` | `src/lib/state/invoice.machine.ts:29-30` → `assertInvoiceTransition` | `CONFLICT` "Illegal transition: cannot record payment on an invoice that is paid" |
| `amount > due` | `src/lib/state/invoice.machine.ts:34` | `VALIDATION` "Amount exceeds the balance due / At most N paise is due" |
| Another payment landed between the read and the write | `src/services/billing.service.ts:169` | `CONFLICT` "Another payment was recorded on this invoice just now. Refresh and try again." |
| `paid_amount` would exceed `total` at the storage layer | `migration.sql:1040` | `VALIDATION` "Payment cannot exceed the invoice total" (`src/lib/contract.ts:126`) |

---

## 6. Every action you can take here

### Action A — Record Payment

**Button** `:244-246` → **form action** `recordPaymentForm`
(`src/app/(internal)/actions/billing.ts:24-37`) → **`recordPayment` action** (`:12-22`) →
**Zod** `recordPaymentSchema` (`src/lib/validation/billing.ts:6-13`) → **service** `recordPayment`
(`src/services/billing.service.ts:149-195`).

**Rupees become paise in the form handler**, before Zod:
`amount = Math.round(rupees * 100)` (`src/app/(internal)/actions/billing.ts:26-27`). `₹1,345.20`
becomes `134520`. Everything below that line is integer paise.

**Guards, in the order they actually run:**

1. `parseInput(recordPaymentSchema, input)` — `src/app/(internal)/actions/billing.ts:13`.
2. `requireActionUser(["ADMIN","FINANCE","SALES_MANAGER"])` — `:16`.
3. Transaction opens — `src/services/billing.service.ts:150`.
4. `assertActor(actor, "RECORD_PAYMENT")` — `:152`.
5. **`clientRef` lookup** — `:153`. If it exists on a different invoice → `ConflictError` (`:154`).
   If it exists on this invoice → return early with `duplicate: true` (`:155-156`), writing
   nothing.
6. Invoice exists — `:158-159`.
7. `applyPayment(invoice, amount)` — `:160`, which itself:
   - refuses a non-payable status (`src/lib/state/invoice.machine.ts:29-30`),
   - refuses a non-positive amount (`:33`),
   - refuses `amount > due` (`:34`),
   - computes `paidAmount` and derives `status` via `statusAfterPayment` (`:35-36`),
   - asserts the resulting transition is legal (`:37`).

**Then the two writes:**

```
payment.create { invoiceId, kind: "PAYMENT", amount, method, clientRef,
                 reference, note, createdById }                     :161-163

invoice.updateMany
  where { id, paidAmount: <the value we read>, status: <the value we read> }
  data  { paidAmount: next.paidAmount, status: next.status,
          paidAt: next.status === "PAID" ? new Date() : null }       :165-168
if (locked.count !== 1) throw ConflictError                          :169
```

**Why `updateMany` with the old values in the `where`.** Two cashiers recording payments at the
same instant both read `paid_amount = 0`. Both compute their new totals. The first update matches
`paid_amount = 0` and succeeds. The second update finds no row matching `paid_amount = 0` any more,
`count` is 0, and `:169` throws — rolling back that transaction including its `payment` insert.
This is compare-and-swap done with a `WHERE` clause. Without it, the second write would silently
overwrite the first and one payment would vanish from `paid_amount` while still existing as a
`payment` row.

**Status is never chosen by a human.** `statusAfterPayment` (`src/lib/state/invoice.machine.ts:19-22`)
is a pure function of `total` and `paidAmount`, and `paid_amount` and `status` are written in the
same statement (`:167`), so they cannot drift. Underneath,
`CHECK paid_amount >= 0 AND paid_amount <= total`
(`prisma/migrations/20260905095100_init/migration.sql:1040`) makes overpayment
**unrepresentable in storage**, not merely rejected in code.

**Audit row:** `entityType "Invoice"`, `action "RECORD_PAYMENT"`,
`before { status, paidAmount }`, `after { status, paidAmount, amount, method }`
(`src/services/billing.service.ts:170-178`). It carries `quotationId`, so `audit`
(`src/lib/audit.ts:41-43`) also bumps `quotation.lastActivityAt`, which is what the Deal Health
"stalled deal" alert reads.

**Then, only when this payment made the invoice `PAID`** (`:180-191`):

```
open    = count(invoice where quotationId = X and status in (POSTED, PARTIAL))     :181
waiting = count(shipment where plan.quotationId = X and plan.status = ACCEPTED
                             and shipment.status = RESERVED)                        :184
        + count(fulfillmentPlan where quotationId = X and status = PROPOSED)        :185
if (open === 0 && waiting === 0 && q.status in (CONFIRMED, FULFILLMENT))            :187
   → assertTransition(q.status, "RECORD_PAYMENT")                                   :188
   → quotation.status = "PAID"                                                      :189
   → audit "PAID"                                                                   :190
```

**That is the exact condition under which the order flips to PAID:** every invoice of the order
settled **and** nothing still reserved in a warehouse **and** no fulfillment split still awaiting
acceptance. If goods are still waiting, the order stays where it is, and the promotion happens
later from `ship()` instead, which re-runs the same two counts
(`src/services/fulfillment.service.ts:235-241`).

**Tables written:** `payment`, `invoice`, `audit_log`, `quotation` (`lastActivityAt`, and possibly
`status`).

**What changes on screen:** `redirect('/invoices/<publicId>')`
(`src/app/(internal)/actions/billing.ts:36`) — no `?ok=` parameter, so **there is no success
banner**. The evidence of success is that the Payments card gained a line, Paid and Balance due
changed, the status badge changed, and — when the balance reached zero — the Record Payment card
disappeared entirely (`:34,216`) and the Paid node of the stepper turned green.

**Important: the redirect re-renders the page, which mints a brand-new `clientRef`** (`:225`).
Idempotency protects a retry of the *same rendered form*; it does not stop a user from deliberately
paying twice.

### Action B — Download Summary

**Button** `:57` → `src/app/(internal)/invoices/[publicId]/_components/print-button.tsx:9`:
`onClick={() => window.print()}`.

- Server action: **none**.
- Zod schema: none. Service: none. Guards: none.
- Tables written: **none**. Audit row: **none**.
- What changes on screen: the browser's print dialog opens. The print stylesheet
  (`src/app/globals.css:273-300`) hides everything marked `data-print-hide` (the back link `:47`,
  the stepper `:93`, the Record Payment card `:217`, the yellow note `:252`, and the nav header at
  `src/app/(internal)/layout.tsx:18`), hides the `PageHeader` via `className="print:hidden"`
  (`:51`), and reveals the `hidden print:block` letterhead (`:61`) and the footer line (`:257`).

**It does not produce a file.** The user gets whatever their browser's "Save as PDF" does. See §10.

### Action C — click a related invoice

`:134` is a plain `Link` to `/invoices/<publicId>`. No action, no write.

### Action D — click the back link

`:47` → `/invoices`. No write.

**What you cannot do here:** void an invoice, edit a line, delete a payment, refund from the UI,
apply a credit note, or change a due date. None of those actions exist in the codebase.

---

## 7. Scenarios

Integer paise throughout. `Laptop 14"` list `6000000` (₹60,000), `Support Pro` list `100000`
(₹1,000), tax 18 % (`tax_bp = 1800`, `prisma/schema.prisma:330`).

### 7.1 An order with only one-time lines — one invoice, no related card

Confirm `Laptop 14"` ×2 at 5 % off. `onConfirmed` runs the one-time block once
(`src/services/billing.service.ts:31-60`):

```
line: gross 12000000, discount pct(12000000,500) = 600000, net 11400000,
      tax pct(11400000,1800) = 2052000, total 13452000
invoice: subtotal 11400000 (:40), tax_total 2052000 (:41), total 13452000 (:42)
```

`related.length === 1`, so the "Invoices on order …" card does not render (`:112`). Stepper: Order
Confirmed green, Shipped grey (nothing shipped yet), Invoiced green, Paid grey. One line in the
Invoice lines table. Balance due ₹1,34,520.00.

### 7.2 An order with only a subscription — one invoice, one composed line

`Support Pro` ×2 monthly. No one-time invoice at all (`:31` is false). One `RECURRING` invoice for
period one: subtotal `200000`, tax `36000`, total `236000`, `period_start 2026-09-05`,
`period_end 2026-10-04` (`:108-114`). Its single line reads
`Support Pro · Monthly · 2026-09-05 to 2026-10-04` (`:119`).

The description at the top reads `Recurring invoice · Monthly` (`:53`, using
`inv.subscription.plan.name` from the include at `:30`).

Stepper: **Shipped stays grey forever** — there is nothing to ship, so no `ACCEPTED` fulfillment
plan with shipments exists and `:35` is permanently false. See §10.

### 7.3 A mixed order — the related card appears

The seeded `Q-2026-0004`. `INV-2026-0001` (`ONE_TIME`, ₹1,34,520.00) and `INV-2026-0002`
(`RECURRING`, ₹2,360.00), created in that order because the one-time block runs before the
recurring loop and both draw from the same `counter` row (`src/services/support.ts:20`).

Opening either one shows the related card (`related.length === 2 > 1`, `:112`) listing both, the
current one bold and unlinked (`:131-132`), the other a link with a `(Recurring)` suffix (`:36`).
Footnote: "each invoice settles on its own" (`:146`). Verified at
`src/services/__tests__/billing.service.db.test.ts:53-58`.

### 7.4 A partial payment

Finance records ₹30,000 against `INV-2026-0001`. The form sends `amountRupees = 30000`;
`recordPaymentForm` converts it to `3000000` paise
(`src/app/(internal)/actions/billing.ts:26-27`).

```
applyPayment: due = 13452000 - 0 = 13452000
              3000000 > 0 ✓, ≤ 13452000 ✓
              paidAmount = 3000000
              status = 3000000 < 13452000 → "PARTIAL"       invoice.machine.ts:21
              due = 10452000
```

One `payment` row (`:161`), one conditional `invoice` update setting `paid_amount = 3000000`,
`status = "PARTIAL"`, `paid_at = null` (`:167`). The `if` at `:180` is false, so nothing touches
the quotation.

On screen: Payments card gains "05 Sept, 14:30 · bank transfer · ₹30,000.00". Paid ₹30,000.00,
Balance due ₹1,04,520.00. Badge `Partially Paid`. The Record Payment card **stays**, now prefilled
with `104520.00` (`:228`). Stepper Paid node still grey. Pinned at
`src/services/__tests__/billing.service.db.test.ts:70-72`.

### 7.5 A full payment on that same invoice

A second payment of `10452000`. `paidAmount = 13452000`, `status = "PAID"`, `paid_at = now()`
(`:167`).

On screen: badge `Paid`, Balance due ₹0.00, **the Record Payment card is gone** (`canPay` is false
at `:34` because the status is no longer payable), stepper Paid node green with a check mark.

The order does **not** become `PAID` yet — see 7.8.

### 7.6 A duplicate submit of the payment form

Double-click "Record Payment", or press Back and resubmit. The hidden `clientRef` (`:225`) is the
same value both times, because it was minted once when the page rendered.

`recordPayment` finds it at `src/services/billing.service.ts:153`, and at `:155-156` returns
`{ invoiceId, status, paidAmount, due, duplicate: true }` — **before** `payment.create` and before
the invoice update. Nothing is written. No second payment row, no doubled `paid_amount`, no second
audit row.

The redirect brings you back to a page that looks exactly as it did after the first submit. Pinned
at `src/services/__tests__/billing.service.db.test.ts:74-77` (`payment.count` stays 1).

Defence in depth: `payment.client_ref` is `@unique` (`prisma/schema.prisma:906`), so even a race
that beat the read would fail on insert.

**And the deliberate-misuse case:** reusing a `clientRef` that belongs to a *different* invoice
throws `ConflictError` "This payment reference was already used on another invoice" (`:154`) —
pinned at `src/services/__tests__/billing.service.db.test.ts:95`.

### 7.7 An overpayment attempt

Try to pay ₹2,00,000 against an invoice with ₹1,34,520 due.

1. **Browser** — the input's `max` (`:228`) blocks the submit.
2. **Service** — if it gets through (scripted POST), `applyPayment` throws
   `ValidationError("Amount exceeds the balance due", { amount: ["At most 13452000 paise is due"] })`
   at `src/lib/state/invoice.machine.ts:34`, before `payment.create` runs. `toActionError`
   (`src/lib/contract.ts:157-159`) turns it into
   `{ ok: false, code: "VALIDATION", message, fieldErrors }`, and `errorQuery`
   (`src/lib/contract.ts:165-168`) folds message and field error into one query string. You land
   back here with the red banner at `:91`.
3. **Database** — `CHECK paid_amount <= total` (`migration.sql:1040`) makes it impossible even by
   hand; if it ever fired, `fromDatabaseError` maps the constraint suffix `paid_within_total` to
   "Payment cannot exceed the invoice total" (`src/lib/contract.ts:126,135-147`).

Nothing is written in any of the three cases. Pinned at
`src/services/__tests__/billing.service.db.test.ts:79`.

### 7.8 Paying an invoice while the goods are still unshipped

The mixed order. Both invoices are paid in full. On the second full payment,
`src/services/billing.service.ts:180` is true, so:

```
open    = 0     (both invoices PAID)                        :181
waiting = count(RESERVED shipments on ACCEPTED plans)        :184
        + count(PROPOSED fulfillment plans)                  :185
```

At confirmation, `onConfirmedHooks` also called `proposePlan`
(`src/services/portal-hooks.ts:11`), which created a `PROPOSED` fulfillment plan. Nobody has
accepted it yet, so `waiting = 1`. The `if` at `:187` is false. **The quotation stays `CONFIRMED`.**

Then Finance accepts the split and ships. `ship()` (`src/services/fulfillment.service.ts:216`)
re-runs the same two counts after marking the last shipment `SHIPPED`
(`src/services/fulfillment.service.ts:235-237`): `stillReserved = 0`, `openInvoices = 0` → the
quotation becomes `PAID` (`:239`).

On this screen, the change is visible in the stepper: the **Shipped** node turns green (`:35`),
because now some `ACCEPTED` plan has shipments and every one of them is `SHIPPED`. Pinned at
`src/services/__tests__/billing.service.db.test.ts:86-93`.

### 7.9 Paying the one-time invoice but not the recurring one

`open` at `:181` counts the still-`POSTED` recurring invoice, so `open = 1` and the quotation stays
`CONFIRMED` no matter what fulfillment says. Pinned at
`src/services/__tests__/billing.service.db.test.ts:84`. On this screen, the related card shows one
`Paid` and one `Unpaid` row side by side — the clearest picture in the app of "one order, two
independent settlements".

### 7.10 Two cashiers pay at the same instant

Both transactions read `paid_amount = 0` (`:158`). Both insert a `payment` row (`:161`). The first
`updateMany` matches `where { paidAmount: 0, status: "POSTED" }` and sets the new values. The
second finds nothing matching and returns `count = 0`, so `:169` throws
`ConflictError("Another payment was recorded on this invoice just now. Refresh and try again.")`
and **its whole transaction rolls back, including its payment row**.

The loser sees the red banner and refreshes. No money is lost, no money is double-counted.

### 7.11 Opening a PRORATION invoice

Created by a quantity increase on screen 10 (`src/services/subscription.service.ts:52-74`). Its
lines table shows two rows, one of them **negative**. For a 2 → 3 change with 29 of 30 days
remaining:

```
credit    = divRound(100000 * 2 * 29, 30) = 193333
charge    = divRound(100000 * 3 * 29, 30) = 290000
net       = 96667
chargeTax = pct(290000, 1800) = 52200
creditTax = pct(193333, 1800) = 34800

line 1  "Support Pro · 3 seats from 2026-09-06 (29 of 30 days)"
        qty 3, net  290000, tax  52200, total  342200
line 2  "Credit: Support Pro · 2 seats already billed for the same days"
        qty 2, net -193333, tax -34800, total -228133

subtotal 96667, tax 17400, total 114067 → ₹1,140.67 = 342200 - 228133 ✓
```

`invoice_line.net` has no non-negative CHECK precisely so line 2 can exist
(`prisma/schema.prisma:866`). The description says `(Proration)` in the related card (`:36`), and
the header description reads "Proration invoice" (`:53`).

### 7.12 Opening an invoice attached to a cancelled subscription

Cancelling does not touch invoices at all (`src/services/subscription.service.ts:180-181` only
touches `billing_schedule` and `subscription`). The `RECURRING` invoice for the current period
remains exactly as it was — same status, same balance, still payable if it is `POSTED`. Recording a
payment on it still works. There is no "this subscription is cancelled" notice on this screen.

### 7.13 A REFUND payment appears in the Payments card, indistinguishable from a receipt

A cancel under `IMMEDIATE_PRORATED_REFUND` with `refundMethod = REFUND_PAYMENT` on a paid invoice
writes `payment { kind: "REFUND", amount, method: "BANK_TRANSFER",
clientRef: "refund-CN-2026-0001" }` (`src/services/subscription.service.ts:172-174`).

The Payments card renders `p.method` and `p.amount` (`:208-211`) and **never `p.kind`**. So a
₹1,180.00 refund shows as a positive ₹1,180.00 line that looks exactly like money coming in. The
invoice still reads `Paid` with `paid_amount` unchanged, because that branch never updates the
invoice. This is the most misleading display in the billing area.

### 7.14 Print an invoice for a customer

Click "Download Summary". The nav, back link, stepper, payment form and yellow note vanish; the
letterhead and "TAX INVOICE" heading appear; the lines table, totals and payments print in black on
white (`src/app/globals.css:274-300`). `thead { display: table-header-group }` (`:295-297`) repeats
the column headers across page breaks, and cards get `break-inside: avoid` (`:290`).

What you cannot do: get a `.pdf` on disk from the application. It is `window.print()`
(`src/app/(internal)/invoices/[publicId]/_components/print-button.tsx:9`). The identical mechanism
is labelled "Export PDF" on the reports screen (`src/components/reports/print-button.tsx:10`).

---

## 8. Schema behind this screen

**`invoice`** — `prisma/schema.prisma:822-856`. Fully tabulated in screen 12 §8. The invariant that
matters most here: `status` is derived from `paid_amount` by
`statusAfterPayment` (`src/lib/state/invoice.machine.ts:19-22`) and both columns are written in the
same statement (`src/services/billing.service.ts:167`), guarded by
`CHECK paid_amount >= 0 AND paid_amount <= total` (`migration.sql:1040`).

**`invoice_line`** — `prisma/schema.prisma:858-877`, SQL `invoice_line`.

| Column | Written by | Notes |
|---|---|---|
| `invoice_id` (`:860`) | nested `create` inside the invoice insert | `onDelete: Cascade` (`:872`) |
| `quotation_line_id` (`:861`) | `src/services/billing.service.ts:47`, `:118` | Nullable — **proration lines leave it null** (`src/services/subscription.service.ts:69-70` set no such field), because they correspond to no order line |
| `description` (`:862`) | copied (`:48`) or composed (`:119`, `src/services/subscription.service.ts:69-70`) | |
| `qty` (`:863`) | `:49`, `:120` | `CHECK qty > 0` (`migration.sql:1033`) — which is why a proration credit line carries the **old positive quantity** and puts the minus sign on the money, not on the count |
| `unit_price` (`:864`) | `:50`, `:121` | |
| `discount_bp` (`:865`) | `:51`, `:122` | Sourced from `quotation_line.effective_discount_bp` |
| `net` (`:866`) | `:52`, `:123` | **"may be negative on proration credit lines"** — the schema says so, and there is no CHECK forbidding it |
| `tax_bp`, `tax`, `total` (`:867-869`) | `:53-55`, `:124-126` | `tax` and `total` also go negative on credit lines |
| `sort_order` (`:870`) | `:56` (`i + 1`), `:127` (`1`), `src/services/subscription.service.ts:69-70` (`1` and `2`) | Drives the display order (`:26`) |

**`payment`** — `prisma/schema.prisma:900-916`, SQL `payment`. Append-only: no code anywhere
updates or deletes a payment row.

| Column | Written by | Notes |
|---|---|---|
| `invoice_id` (`:902`) | `src/services/billing.service.ts:162` | |
| `kind` (`:903`) | `"PAYMENT"` at `:162`; `"REFUND"` at `src/services/subscription.service.ts:173` | Enum at `prisma/schema.prisma:157-160`. **Never displayed on this screen** |
| `amount` (`:904`) | `:162` | `CHECK amount > 0` (`migration.sql:1042`) — a refund is a positive number with a different `kind`, not a negative payment |
| `method` (`:905`) | `:162` from the form; hard-coded `"BANK_TRANSFER"` on a refund | Plain `String`, not an enum in the database; the Zod enum (`src/lib/validation/billing.ts:10`) is the only constraint |
| `client_ref` (`:906`) | `:162` from the hidden field; `"refund-<CN number>"` on a refund | **`@unique`** — the idempotency guarantee |
| `reference`, `note` (`:907-908`) | `:162` | Optional free text |
| `received_at` (`:909`) | column default `now()` | Not settable from the form |
| `created_by_id` (`:910`) | `:162`, `user.id` | Who took the money. Not displayed on this screen either |

**`fulfillment_plan`** (`prisma/schema.prisma:642-662`) and **`shipment`**
(`prisma/schema.prisma:665-681`) — read only, and only to light up the Shipped node (`:28,35`) and
to decide the order-complete condition (`src/services/billing.service.ts:184-185`).

**`quotation`** — read for `confirmed_at` (stepper node 1), `number` (labels), and updated to
`PAID` under the condition at `:187`. Also has `lastActivityAt` bumped by every audit call
(`src/lib/audit.ts:41-43`).

**`audit_log`** (`prisma/schema.prisma:564-588`) — one row per successful payment
(`src/services/billing.service.ts:170-178`), plus one more when the order flips to `PAID` (`:190`).
Written with the transaction client, so a rolled-back payment logs nothing and a committed one
always logs.

---

## 9. How this screen connects to the others

- **Screen 12 → here** by clicking a row. The only entrance from the invoices side.
- **Screen 10 → here** twice: "Invoiced as INV-…" under the one-time lines
  (`src/app/(internal)/subscriptions/[publicId]/page.tsx:185`) and the Invoice column of the
  billing schedule (`:255`).
- **Here → screen 13** again, laterally, through the related-invoices card (`:134`).
- **Here → screens 3 and 7.** A payment that settles the last invoice may flip the quotation from
  `CONFIRMED`/`FULFILLMENT` to `PAID` (`src/services/billing.service.ts:187-190`), which is what
  moves the card in the Quotations pipeline and closes the loop on the Fulfillment screen. The
  `revalidatePath` calls at `src/app/(internal)/actions/billing.ts:17` refresh `/invoices`,
  `/quotes` and `/subscriptions` so those screens are not stale.
- **Screen 7 (Fulfillment) → here** in the other direction: shipping the last shipment can flip the
  same quotation to `PAID` when the invoices were already settled
  (`src/services/fulfillment.service.ts:235-241`), and it turns this screen's Shipped node green.
- **Screen 14 (Deal Health).** Every payment writes an audit row carrying `quotationId`, which
  bumps `quotation.lastActivityAt` (`src/lib/audit.ts:41-43`) — the field the "stalled deal" alert
  measures.
- **Screen 15 (Reports)** reads the same `invoice` and `payment` rows in aggregate.

---

## 10. Gotchas

1. **"Download Summary" is `window.print()`, not a generated PDF.**
   `src/app/(internal)/invoices/[publicId]/_components/print-button.tsx:9`. The same is true of
   "Export PDF" on the reports screen (`src/components/reports/print-button.tsx:9-10`). There is no
   PDF library in `package.json`, no server-side rendering of documents, and no file is written or
   downloaded. The comment in `src/app/globals.css:273` is explicit: "used by 'Export PDF' and
   'Download Summary' (window.print)". Say this out loud in a demo before someone asks where the
   file went.

2. **The letterhead is hard-coded.** "DealFlow360 Demo Pvt. Ltd.", the Bengaluru address and the
   GSTIN at `:64-65` are string literals. There is no seller/company table in the schema. Change
   the file to change the invoice.

3. **The "Shipped" node is grey forever on a subscription-only order.** `:35` requires an
   `ACCEPTED` fulfillment plan with shipments, and a subscription-only order has no physical lines
   to ship, so `proposePlan` produces nothing to accept. The stepper permanently shows three of
   four nodes green. Not a bug you can fix by paying.

4. **The "Invoiced" node is hard-coded `true`** (`:41`). It reads no column. It is green even on an
   invoice that was created a second ago and paid nothing.

5. **The mockup's promise is wrong for this build.** "nothing is billed before it ships"
   (`docs/MOCKUP_SCREENS.md:177`, echoed in the yellow note at `:252-254`) — but `onConfirmed` posts
   every invoice at confirmation time (`src/services/billing.service.ts:21`, called inside the
   confirm transaction at `src/services/portal-hooks.ts:10`), long before a warehouse is involved.
   Trust the code.

6. **There is no success banner after a payment.** `recordPaymentForm` redirects without an `?ok=`
   parameter (`src/app/(internal)/actions/billing.ts:35-36`), and the page only renders
   `searchParams.error` (`:91`). Compare screen 10, which does render an `ok` banner. Users
   sometimes submit twice because they see no confirmation — which is exactly what the `clientRef`
   idempotency is there for.

7. **The `clientRef` is per page render, not per invoice.** `newRef(16)` at `:225` runs on every
   server render. Resubmitting the *same* rendered form is a no-op
   (`src/services/billing.service.ts:155-156`); reloading the page and paying again is a second,
   perfectly valid payment. Idempotency protects against network retries, not against a determined
   double payment.

8. **A REFUND payment is displayed as if it were money received.** `:208-211` never reads
   `p.kind`. See §7.13.

9. **`payment.created_by_id` is stored (`:162`) and never shown.** The Payments card gives no
   answer to "who recorded this". The audit log has it (`:170-178`), but this screen does not link
   to the audit log.

10. **`InvoiceStatus.VOID` is never written.** It is in the enum
    (`prisma/schema.prisma:154`), in the transition table (`src/lib/state/invoice.machine.ts:7`),
    and it has a badge (`src/components/shared/status-badge.tsx:50`), but no service voids an
    invoice and there is no Void button. Likewise `CreditNoteStatus.APPLIED`
    (`prisma/schema.prisma:164`) is never written, and `credit_note.applied_to_invoice_id`
    (`:888`) is never set — there is no way to apply a credit note to an invoice.

11. **A `PAID` invoice can never be reopened.** `INVOICE_TRANSITIONS.PAID = []`
    (`src/lib/state/invoice.machine.ts:9`), and `applyPayment` asserts the transition before writing
    (`:29-30,37`). No refund path decreases `paid_amount`. Once settled, settled.

12. **`sub.invoices` on screen 10 and `inv.quotation.invoices` here look similar but are different
    sets.** Here, `:28` fetches every invoice of the **quotation** (one-time + recurring +
    proration), which is what the related card lists. On screen 10, `:30` fetches every invoice of
    the **subscription**, and the page never uses it.

13. **The related card hides itself when there is only one invoice** (`:112`), so a one-time-only
    order shows no invoice table at all above the lines — which is correct but can read as "missing
    section" to someone comparing against the mockup, where two rows are always drawn.
