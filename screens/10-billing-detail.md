# Screen 10 — Billing Detail

Route: `/subscriptions/[publicId]`
File: `src/app/(internal)/subscriptions/[publicId]/page.tsx`
Mockup: `docs/mockup/10-billing-detail.png`, `docs/MOCKUP_SCREENS.md:127-140`
Spec: `docs/DealFlow360.txt:143` (A5), `docs/DealFlow360.txt:260` (B7)

---

## 1. What this screen is

Everything about **one** subscription: where it came from, what it costs, what its calendar of
future billing periods looks like, what has already been invoiced, what has been changed, and the
two controls that change it — Modify and Cancel.

This is the screen the spec asks for in B7 (`docs/DealFlow360.txt:260-265`): one-time and recurring
lines of the same order shown separately, the upcoming billing schedule, mid-cycle proration on a
quantity change, and cancel/modify with an automatic refund or credit note.

Everything on this page was created by one of exactly three moments:

1. **`onConfirmed`** (`src/services/billing.service.ts:21`) — created the subscription, its whole
   billing schedule, and the invoice for period one. Ran inside the confirming transaction.
2. **`changeQuantity`** (`src/services/subscription.service.ts:16`) — a Modify from this screen.
3. **`cancelSubscription`** (`src/services/subscription.service.ts:134`) — a Cancel from this screen.

Nothing else writes to any table this page reads.

---

## 2. Who can open it, and who enforces that

| Role | Open the page? | See Modify / Cancel? | Enforced where |
|---|---|---|---|
| ADMIN | Yes | Yes | open: `src/app/(internal)/subscriptions/[publicId]/page.tsx:21`; render: `:22,50,62,88`; action: `src/app/(internal)/actions/subscription.ts:14,37`; service: `src/services/subscription.service.ts:17,135` |
| FINANCE | Yes | Yes | same |
| SALES_MANAGER | Yes | Yes | same |
| **SALES_REP** | **Yes — read only** | **No** | `canChange = OPS_ROLES.includes(user.role)` at `:22`; `OPS_ROLES` is `["ADMIN","FINANCE","SALES_MANAGER"]` (`src/lib/contract.ts:65`) |
| Not logged in | No | — | `src/middleware.ts:21-42`, then `requireUser(undefined, "/subscriptions/<id>")` at `:21` |
| Portal contact | No | — | `src/middleware.ts:17` — wrong cookie, wrong path prefix |

### The SALES_REP case, precisely

For a SALES_REP, `canChange` is `false`, so:

- the "Cancel Subscription" anchor in the header is not rendered (`:50-54`),
- the **Modify Subscription card is not rendered at all** (`:62`),
- the **Cancel Subscription card is not rendered at all** (`:88`).

They still see the header, the proration history, the one-time lines, the recurring line, and the
full billing schedule. It is a read-only view, not a stripped one.

### Three independent layers of enforcement

Hiding the form is not the security boundary. If a SALES_REP hand-crafts the POST:

1. **Server action guard** — `requireActionUser(["ADMIN","FINANCE","SALES_MANAGER"])` at
   `src/app/(internal)/actions/subscription.ts:14` for Modify. It throws `ForbiddenError`
   (`src/lib/auth/internal.ts:64-68, 86-91`).
2. **Service guard** — `if (!OPS_ROLES.includes(user.role)) throw new ForbiddenError(...)` at
   `src/services/subscription.service.ts:17` (change) and `:135` (cancel). This one runs even if
   the service is called from a script or a test.
3. **State guard** — `assertSubscriptionChangeable` (`:21`) / `assertSubscriptionTransition` (`:139`).

Cancel has an asymmetry worth knowing: the **cancel action** calls `requireActionUser()` with **no
role list** (`src/app/(internal)/actions/subscription.ts:37`), unlike change (`:14`). So the action
layer lets any logged-in user through, and it is `src/services/subscription.service.ts:135` that
actually refuses a SALES_REP. Two layers instead of three. The outcome is the same
(`FORBIDDEN`), but the defence is thinner. Verified by the test at
`src/services/__tests__/billing.service.db.test.ts:140`.

---

## 3. Everything on the screen, and where each value comes from

All of it comes from **one** query (`src/app/(internal)/subscriptions/[publicId]/page.tsx:23-34`).
Examples use the seeded demo order `Q-2026-0004` (Beta Industries: `Laptop 14"` ×2 at 5 % off,
`Support Pro` ×2 on the Monthly plan — `prisma/seed/a-quotes.ts:69-79`) confirmed on 2026-09-05.

### Header

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Back link "Subscriptions" | — | `:41-43` | — | Hard-coded `Link` to `/subscriptions` |
| Title | `Beta Industries · Support Pro` | `:45` | `customer.name`, `product.name` | `customer_id` copied from the quotation at `src/services/billing.service.ts:71`; `product_id` from the quotation line at `:74` |
| Description | `Monthly · 2 × Seat / month · current period 05 Sept 2026 to 04 Oct 2026 · from order Q-2026-0004` | `:46` | `recurring_plan.interval` (via the `CYCLE` map at `:17`), `subscription.qty`, `product.unit`, `subscription.current_period_start` / `current_period_end`, `quotation.number` | `qty` snapshotted at `src/services/billing.service.ts:76`; `unit` is the catalogue value (`prisma/seed/a-catalogue.ts:51`, `"Seat / month"`); the period dates were written at `src/services/billing.service.ts:82-83` — start = confirmation day, end = `periodEnd(today, interval)` (`src/domain/prorate.ts:23-25`) |
| Status badge | `Active` | `:49` | `subscription.status` | `"ACTIVE"` at `src/services/billing.service.ts:80`. Labels/colours: `src/components/shared/status-badge.tsx:61-62,42` |
| "Cancel Subscription" anchor | shown for OPS roles on an ACTIVE sub | `:50-54` | — | An in-page `#cancel` anchor, not an action |
| Green success banner | `Prorated: credit 200000 paise, charge 300000 paise, invoice INV-2026-0003 posted for the difference` | `:60` reading `searchParams.ok` | — | Written into the URL by `changeQuantityForm` (`src/app/(internal)/actions/subscription.ts:29-30`) or `cancelSubscriptionForm` (`:49-52`) |
| Red error banner | `Effective date must fall inside the current period 2026-09-05 to 2026-10-04 Outside the current period` | `:59` reading `searchParams.error` | — | `src/app/(internal)/actions/subscription.ts:26-27` (change) or `:48` via `errorQuery` (`src/lib/contract.ts:165-168`) |

### Modify Subscription card (OPS roles, ACTIVE only) — `:62-86`

| What you see | Example value | Where | Source |
|---|---|---|---|
| "New quantity (now 2)" | `2` in the label, `3` prefilled | `:72-73` | `subscription.qty`; the input defaults to `sub.qty + 1` |
| Effective date input | `2026-09-06`, min `2026-09-05`, max `2026-10-04` | `:77` | default `todayISO()` (`src/domain/dates.ts:31-35`, Asia/Kolkata); min/max are `toISODate(sub.currentPeriodStart / currentPeriodEnd)` |
| Explanatory paragraph | "Prorated by calendar day of the current period (05 Sept 2026 to 04 Oct 2026)…" | `:80-82` | Same two date columns |
| Hidden `subscriptionId` | `46` | `:69` | `subscription.id` — the integer PK, only ever in a hidden field, never a URL |
| Hidden `publicId` | `ywRpFzrY0UtY` | `:70` | `subscription.public_id`, used to redirect back here |

### Cancel Subscription card (OPS roles, ACTIVE only) — `:88-114`

| What you see | Example value | Where | Source |
|---|---|---|---|
| Effective date | today, clamped to the current period | `:99` | same as above |
| Reason (required, min 3 chars) | `Customer moved to a competitor` | `:103`, enforced again by `zReason` (`src/lib/validation/common.ts:34`) | typed by the user; stored in `subscription_change.note` and in the audit row |
| Policy sentence | "stops immediately, the unused days of the current period are credited as a credit note" | `:109` | `recurring_plan.cancel_policy` and `recurring_plan.refund_method` — read live from the plan, not snapshotted |

### Proration history card — `:116-152`, rendered only when `sub.changes.length > 0`

Every column is one column of one `subscription_change` row.

| Column | Example | Where | table.column | Written by |
|---|---|---|---|---|
| Effective | `06 Sept 2026` | `:136` | `subscription_change.effective_date` | `src/services/subscription.service.ts:100` (change) or `:183` (cancel — note cancel stores `cancelEffective`, not the raw input) |
| Change | `2 → 3 seats` | `:138` | `old_qty`, `new_qty` | `:101-102`; on cancel, `new_qty` is written as `0` (`:183`) |
| Days | `25/30` | `:141` | `remaining_days` / `days_in_period` | `:103-104`, straight from `prorate()` (`src/domain/prorate.ts:47-49`). **On a cancel row both are null**, so a cancel shows `/` with nothing around it — `cancelSubscription` does not persist them (`:183`) |
| Credit | `₹1,666.67` | `:143` | `subscription_change.credit` | `:105` / `:183` |
| Charge | `₹2,500.00` | `:144` | `subscription_change.charge` | `:106`; always 0 on a cancel row |
| Net | `+₹833.33` | `:145`, `signed` (`src/components/shared/money.tsx:5-6`) | `subscription_change.net` | `:107`; on cancel it is `-credit` (`:183`) |

Ordered `createdAt` desc (`:31`) — newest change first.

### One-time lines card — `:155-192`

| What you see | Example | Where | table.column | Source |
|---|---|---|---|---|
| Product | `Laptop 14"` | `:174` | `quotation_line.description` | Fetched through `quotation: { include: { lines: { where: { lineType: "ONE_TIME" } } } }` (`:32`). This is the **quotation line**, not an invoice line — the original order line |
| Qty | `2` | `:175` | `quotation_line.qty` | Typed by the rep on screen 4 |
| Amount | `₹1,34,520.00` | `:176` | `quotation_line.total` (= net + tax) | Computed by the quote engine when the line was added |
| "Invoiced as INV-2026-0001 [Unpaid]" | link | `:182-190` | `invoice.number`, `invoice.public_id`, `invoice.status` | The `ONE_TIME` invoice for this order, from `invoices: { where: { kind: "ONE_TIME" } }` at `:32`. Created at `src/services/billing.service.ts:33-60` |
| "No one-time lines on this order." | when the order was subscription-only | `:161` | — | `sub.quotation.lines.length === 0` |

This card is exactly the mockup's "One-Time Lines (from originating order)"
(`docs/MOCKUP_SCREENS.md:131`).

### Recurring lines card — `:194-224`

One row. This screen is one subscription, so there is exactly one recurring line here, even though
the mockup draws two.

| What you see | Example | Where | table.column | Source |
|---|---|---|---|---|
| Plan | `Support Pro × 2` | `:210-212` | `product.name`, `subscription.qty` | snapshots at `src/services/billing.service.ts:74,76` |
| Cycle | `Monthly` | `:213` | `recurring_plan.interval` | `prisma/seed/a-plans.ts:6` |
| Next bill date | `05 Oct 2026` | `:214` | `billing_schedule.bill_date` of `next` | `next = sub.schedule.find(s => s.status === "SCHEDULED")` at `:36` — the first row that is still scheduled, which after confirmation is period **2** |
| Amount | `₹2,360.00` | `:215` | `billing_schedule.total` of **row 1** | `perPeriod = sub.schedule[0]?.total ?? 0` at `:37`. See §10 gotcha 1 — this is period one's total, not the next period's |
| Policy footnote | "Proration: by calendar day of the real period, the change day is billed. Cancellation: immediate prorated refund, refunds as credit note." | `:219-222` | `recurring_plan.proration_mode`, `bill_change_day`, `cancel_policy`, `refund_method` | Plan defaults at `prisma/schema.prisma:120-123`; the seed overrides none (`prisma/seed/a-plans.ts:6-8`) |

### Billing schedule card — `:227-267`

One row per `billing_schedule` row, ordered by `period_start` (`:29`).

| Column | Example (row 1 / row 2) | Where | table.column | Source |
|---|---|---|---|---|
| `#` | `1` / `2` | `:246` | — | The array index + 1, not a stored column |
| Period | `05 Sept 2026 to 04 Oct 2026` / `05 Oct 2026 to 04 Nov 2026` | `:247-249` | `period_start`, `period_end` | `buildSchedule` (`src/domain/prorate.ts:28-38`), written at `src/services/billing.service.ts:86-87` |
| Bill date | `05 Sept 2026` / `05 Oct 2026` | `:250` | `bill_date` | Always equal to `period_start` (`src/domain/prorate.ts:34`) |
| Amount | `₹2,360.00` | `:251` | `billing_schedule.total` | `net + tax`, `src/domain/prorate.ts:33-34` |
| Status | `Invoiced` / `Scheduled` | `:252` | `billing_schedule.status` | Row 1 was flipped to `INVOICED` at `src/services/billing.service.ts:133`; every other row keeps the column default `SCHEDULED` (`prisma/schema.prisma:788`) |
| Invoice | `INV-2026-0002 [Unpaid]` / `–` | `:253-261` | `invoice.number`, `public_id`, `status` via `billing_schedule.invoice_id` | Set on row 1 only, at `src/services/billing.service.ts:133` |

`StatusBadge` is called with an explicit `label` for schedule rows (`:252`), because `SCHEDULED`,
`INVOICED` and `CANCELLED`-as-a-schedule-status are not in the badge map
(`src/components/shared/status-badge.tsx:32-70`) — without the explicit label they would fall back
to the raw enum string (`:73`). Their tone is therefore always neutral grey.

---

## 4. The queries this page runs

Two reads on render, then whatever a form submission triggers.

1. **Session** — `requireUser(undefined, "/subscriptions/<publicId>")` at `:21`.
2. **The one page query** — `:23-34`:

```
prisma.subscription.findUnique({
  where: { publicId },
  include: {
    customer: true,
    product: true,
    plan: true,
    schedule:  { orderBy: { periodStart: "asc" }, include: { invoice: true } },
    invoices:  { orderBy: { issueDate: "asc" } },
    changes:   { orderBy: { createdAt: "desc" } },
    quotation: { include: {
      lines:    { where: { lineType: "ONE_TIME" }, orderBy: { sortOrder: "asc" } },
      invoices: { where: { kind: "ONE_TIME" } },
    }},
  },
})
```

Seven related sets in one call. `notFound()` at `:35` renders the 404 page when the `publicId` does
not resolve — including when somebody guesses a URL, which is the point of the random public id
(`src/lib/ids.ts:8-13`).

`export const dynamic = "force-dynamic"` (`:16`) — never cached.

One oddity: `invoices: { orderBy: { issueDate: "asc" } }` (`:30`) fetches every invoice attached to
this subscription (the `RECURRING` one, plus any `PRORATION` ones), **but the page never renders
that array.** The invoices you see in the schedule table come from `schedule[].invoice` (`:29`)
instead. Dead include; harmless, but do not go looking for where `sub.invoices` is used.

On submit, the two server actions each open their own `prisma.$transaction`
(`src/services/subscription.service.ts:18` and `:136`), then `revalidatePath` for `/subscriptions`,
`/invoices` and `/quotes` (`src/app/(internal)/actions/subscription.ts:15,38`) before redirecting
back here.

---

## 5. Every condition on this page

| Condition | Where | Effect |
|---|---|---|
| No valid session | `src/middleware.ts:21-42`, `:21` | Redirect to `/login?next=…` |
| `publicId` does not resolve | `:35` | `notFound()` → 404 |
| `canChange` (`OPS_ROLES.includes(role)`) | `:22` | Gates the header cancel anchor (`:50`), the Modify card (`:62`) and the Cancel card (`:88`) |
| `sub.status === "ACTIVE"` | `:50,62,88` | Same three elements. A CANCELLED subscription shows no controls to anybody, including an Admin |
| `searchParams.error` present | `:59` | Red banner |
| `searchParams.ok` present | `:60` | Green banner |
| `sub.changes.length > 0` | `:116` | Proration history card renders; otherwise it is absent entirely |
| `!sub.quotation \|\| sub.quotation.lines.length === 0` | `:160` | "No one-time lines on this order." instead of the table |
| `sub.quotation?.invoices` non-empty | `:182` | One "Invoiced as …" line per `ONE_TIME` invoice |
| `next` exists (a `SCHEDULED` row) | `:36,214` | Next bill date, else `–` |
| `s.invoice` on a schedule row | `:254` | Invoice link, else `–` |
| `s.status` is `SCHEDULED` / `INVOICED` / else | `:252` | Label "Scheduled" / "Invoiced" / "Cancelled" |
| `plan.prorationMode === "DAY_BASED"` | `:220` | Footnote wording |
| `plan.billChangeDay` | `:221` | Adds ", the change day is billed" |
| `plan.cancelPolicy` is `END_OF_PERIOD` / `NO_REFUND` / else | `:109` | Three different policy sentences |
| `plan.refundMethod === "REFUND_PAYMENT"` | `:109` | "refund on the paid invoice" vs "credit note" |

### Conditions enforced server-side that the form cannot express

| Condition | Where | Error |
|---|---|---|
| Caller is not an OPS role | `src/services/subscription.service.ts:17`, `:135` | `FORBIDDEN` "Only Finance, a Sales Manager or an Admin can change/cancel a subscription" |
| Subscription not found | `:20`, `:138` | `NOT_FOUND` |
| Subscription not changeable | `:21` → `src/lib/state/subscription.machine.ts:15-16` | `CONFLICT` |
| Subscription already cancelled | `:139` → `src/lib/state/subscription.machine.ts:11-13` | `CONFLICT` "subscription cannot go from cancelled to cancelled" |
| `newQty === sub.qty` | `:22` | `VALIDATION` "Quantity is unchanged" |
| Effective date outside the current period | `:26-28` (change), `:143-145` (cancel) | `VALIDATION` "Effective date must fall inside the current period X to Y" |
| `newQty < 1` or not an integer | `zQty`, `src/lib/validation/common.ts:18` | `VALIDATION` "Quantity must be at least 1" |
| Reason shorter than 3 characters | `zReason`, `src/lib/validation/common.ts:34` | `VALIDATION` |
| Malformed date | `zISODate`, `src/lib/validation/common.ts:24-30` | `VALIDATION` "Use YYYY-MM-DD" / "Not a real calendar date" |

---

## 6. Every action you can take here

### Action A — Modify Subscription ("Apply change")

**Button** `:79` → **form action** `changeQuantityForm` (`src/app/(internal)/actions/subscription.ts:22-31`)
→ **`changeQuantity` action** (`:10-20`) → **Zod** `changeQuantitySchema`
(`src/lib/validation/subscription.ts:5`: `{ subscriptionId: zId, newQty: zQty, effectiveDate: zISODate }`)
→ **service** `changeQuantity` (`src/services/subscription.service.ts:16-124`).

**Guards, in the order they actually run:**

1. `parseInput(changeQuantitySchema, input)` — `src/app/(internal)/actions/subscription.ts:11`. On
   failure it returns before touching the database (`src/lib/contract.ts:86-96`).
2. `requireActionUser(["ADMIN","FINANCE","SALES_MANAGER"])` — `:14`.
3. `OPS_ROLES.includes(user.role)` — `src/services/subscription.service.ts:17`.
4. Transaction opens — `:18`. Everything after this is all-or-nothing.
5. Subscription exists — `:19-20`.
6. `assertSubscriptionChangeable(sub.status)` — `:21`.
7. `newQty !== sub.qty` — `:22`.
8. Effective date inside `[currentPeriodStart, currentPeriodEnd]` — `:26-28`.

**The arithmetic** — `prorate()` (`src/domain/prorate.ts:46-55`):

```
daysInPeriod  = daysInclusive(periodStart, periodEnd)                       // real calendar days
rawRemaining  = diffDays(changeDate, periodEnd) + (billChangeDay ? 1 : 0)
remainingDays = clamp(rawRemaining, 0, daysInPeriod)
perUnit       = applyDiscount(unitPrice, discountBp)                        // unitPrice - pct(unitPrice, discountBp)
credit        = divRound(perUnit * oldQty * remainingDays, daysInPeriod)    // half-up, once
charge        = divRound(perUnit * newQty * remainingDays, daysInPeriod)    // half-up, once
net           = charge - credit
```

`mode === "NONE"` or `remainingDays === 0` short-circuits to `credit = charge = net = 0`
(`src/domain/prorate.ts:50`).

**Then it branches on the sign of `net`:**

- **`net > 0`** (`src/services/subscription.service.ts:48-76`) — post a `PRORATION` invoice.
  `chargeTax = pct(charge, taxBp)`, `creditTax = pct(credit, taxBp)`,
  `subtotal = net`, `taxTotal = chargeTax - creditTax`, `total = net + chargeTax - creditTax`
  (`:60-62`). It carries **two** lines (`:68-71`): line 1 is the positive charge for the new
  quantity, line 2 is a **negative** credit line (`net: -result.credit`, `tax: -creditTax`,
  `total: -(credit + creditTax)`). That negative line is legal only because `invoice_line.net` has
  no non-negative CHECK — the schema comment says so explicitly (`prisma/schema.prisma:858`, field
  `net` at `:866`: "may be negative on proration credit lines"). Due date is issue + 15 days
  (`:64`).
- **`net < 0`** (`:77-89`) — issue a **credit note**, no invoice.
  `amount = -net + pct(-net, taxBp)` (`:78`), status `OPEN` (schema default,
  `prisma/schema.prisma:887`), reason written in words (`:85`).
- **`net === 0`** — neither branch runs. Nothing is billed and nothing is credited. The quantity
  still changes.

**Always, regardless of the branch:**

- Every `SCHEDULED` schedule row is re-priced to the new quantity (`:92-94`):
  `perPeriodNet = applyDiscount(unitPrice * newQty, discountBp)`, `perPeriodTax = pct(net, taxBp)`.
  `INVOICED` and `CANCELLED` rows are untouched — you cannot retroactively re-price a period that
  has already been billed.
- `subscription.qty = newQty` (`:95`).
- One `subscription_change` row of type `QUANTITY` with the full arithmetic preserved (`:96-112`).

**Tables written:** `invoice` + `invoice_line` (when `net > 0`), `credit_note` (when `net < 0`),
`counter` (via `nextNumber`, `src/services/support.ts:20`), `billing_schedule`, `subscription`,
`subscription_change`, `audit_log`, `quotation` (`lastActivityAt` bumped by `audit`,
`src/lib/audit.ts:41-43`).

**Audit row:** `entityType "Subscription"`, `action "SUBSCRIPTION_QTY"`, `before { qty }`,
`after { qty, effectiveDate, credit, charge, net, invoiceNumber, creditNoteId }`
(`src/services/subscription.service.ts:113-121`).

**What changes on screen:** redirect back to `/subscriptions/<publicId>?ok=…`
(`src/app/(internal)/actions/subscription.ts:29-30`). Green banner. The Proration history card
appears (or gains a row). The Recurring lines "Plan" cell shows the new quantity. Every
`Scheduled` row in the billing schedule shows the new amount. The `Invoiced` row does not change.

### Action B — Cancel Subscription

**Button** `:105-107` → **form action** `cancelSubscriptionForm`
(`src/app/(internal)/actions/subscription.ts:45-53`) → **`cancelSubscription` action** (`:33-43`)
→ **Zod** `cancelSubscriptionSchema` (`src/lib/validation/subscription.ts:7`:
`{ subscriptionId: zId, effectiveDate: zISODate.optional(), reason: zReason }`) → **service**
(`src/services/subscription.service.ts:134-197`).

**Guards, in order:** `parseInput` (`:34`) → `requireActionUser()` **with no role list** (`:37`) →
`OPS_ROLES` check (`src/services/subscription.service.ts:135`) → transaction (`:136`) → subscription
exists (`:137-138`) → `assertSubscriptionTransition(status, "CANCELLED")` (`:139`) → effective date
inside the current period (`:143-145`).

**The three policies** (`recurring_plan.cancel_policy`, `prisma/schema.prisma:46-50`):

| Policy | `cancelEffective` | Credit? | Code |
|---|---|---|---|
| `END_OF_PERIOD` | `currentPeriodEnd` | none | `:147` picks `periodEnd`; the `if` at `:152` is false |
| `IMMEDIATE_PRORATED_REFUND` | the effective date you typed (default today) | yes, the unused days | `:152-177` |
| `NO_REFUND` | the effective date you typed | none | `:147` picks `effective`; `:152` false |

**The refund branch, only under `IMMEDIATE_PRORATED_REFUND`** (`:152-177`):

```
r = prorate({ ..., oldQty: sub.qty, newQty: 0 })      // :153 — newQty 0, so charge = 0
credit = r.credit                                      // :154
if (credit > 0) {
  amount = credit + pct(credit, sub.taxBp)             // :156
  paidInvoice = sub.invoices[0]?.status === "PAID" ? sub.invoices[0] : null   // :157
  refund = plan.refundMethod === "REFUND_PAYMENT" && paidInvoice              // :158
  creditNote { amount, invoiceId: paidInvoice?.id, status: refund ? "REFUNDED" : "OPEN" }  // :159-169
  if (refund) payment { kind: "REFUND", amount, method: "BANK_TRANSFER",
                        clientRef: `refund-${note.number}` }                  // :171-176
}
```

`sub.invoices[0]` is the **most recent `RECURRING` invoice** — the include at `:137` is
`{ where: { kind: "RECURRING" }, orderBy: { periodStart: "desc" }, take: 1 }`. So the refund path
only fires when (a) the plan says `REFUND_PAYMENT` **and** (b) that latest recurring invoice is
already fully `PAID`. Otherwise the customer gets an `OPEN` credit note, even on a `REFUND_PAYMENT`
plan.

The `REFUND` payment row has `kind = "REFUND"` (`:173`) and a deterministic `clientRef` of
`refund-<credit note number>`, which makes the refund itself idempotent through the same unique
index that protects normal payments (`prisma/schema.prisma:906`). **It does not reduce
`invoice.paid_amount`** — no `invoice.update` runs in this branch. The invoice stays `PAID` and the
refund shows up only as a negative-in-meaning, positive-in-value row in the Payments card on
screen 13.

**In all three policies** (`:180-181`): every `SCHEDULED` schedule row → `CANCELLED`, and
`subscription.status → CANCELLED` with `cancelledAt = now()` and `cancelEffective` stored.

**Tables written:** `credit_note` (+ `counter`) and `payment` in the refund path;
`billing_schedule`, `subscription`, `subscription_change` (type `CANCEL`, `:182-184`), `audit_log`,
`quotation.lastActivityAt`.

**Audit row:** `action "SUBSCRIPTION_CANCEL"`, `reason` = the typed reason,
`before { status, qty }`, `after { status, policy, cancelEffective, credit, creditNoteId,
refundPaymentId }` (`:185-194`).

**What changes on screen:** redirect with `?ok=` (`src/app/(internal)/actions/subscription.ts:49-52`).
The status badge goes to `Cancelled`. **Both cards disappear** (`:62,88` require `ACTIVE`). Every
schedule row that was `Scheduled` now reads `Cancelled`. Next bill → `–`. A `CANCEL` row appears in
Proration history.

### Action C — click an invoice number

`:185` (the one-time invoice) and `:255` (a schedule row's invoice) are plain `Link`s to
`/invoices/<publicId>`. No action, no write.

---

## 7. Scenarios

All money in integer paise. `Support Pro` = `100000` paise (₹1,000) per seat per month, tax 18 %
(`tax_bp = 1800`, the product default at `prisma/schema.prisma:330`).

### 7.1 A mixed order lands here — the full picture after confirmation

`Q-2026-0004` is confirmed on 2026-09-05. `onConfirmed` runs once, inside the confirm transaction:

- **One-time branch** (`src/services/billing.service.ts:31-60`) — one invoice for **all** one-time
  lines together, not one per line: subtotal `11400000`, tax `2052000`, total `13452000`,
  `INV-2026-0001`, due 2026-09-20 (`DUE_DAYS = 15`, `:14`).
- **Recurring branch** (`:65-136`) — `buildSchedule("2026-09-05", "MONTH", 12, 200000, 1800)`
  produces 12 rows. Row 1: `2026-09-05 .. 2026-10-04`, bill date `2026-09-05`, net `200000`, tax
  `pct(200000,1800) = 36000`, total `236000`. Row 2 starts `2026-10-05` — because
  `nextPeriodStart` uses `addMonths` (`src/domain/prorate.ts:12`) and `periodEnd` is the day before
  (`:23-25`).
- The subscription snapshots `qty 2`, `unitPrice 100000`, `discountBp 0`, `taxBp 1800`, anchor and
  period start `2026-09-05`, period end `2026-10-04` (`src/services/billing.service.ts:76-83`).
- `INV-2026-0002` `RECURRING` for row 1 only, total `236000`, with `periodStart`/`periodEnd` copied
  onto the invoice (`:113-114`) and one line described
  `"Support Pro · Monthly · 2026-09-05 to 2026-10-04"` (`:119`).
- Row 1 → `INVOICED`, `invoice_id` set (`:133`).

This screen then shows: one-time card with the laptops and "Invoiced as INV-2026-0001"; recurring
card with `Support Pro × 2`, Monthly, next bill 05 Oct 2026, ₹2,360.00; a 12-row schedule where row
1 is `Invoiced` and rows 2–12 are `Scheduled`. Verified end to end at
`src/services/__tests__/billing.service.db.test.ts:54-67`.

### 7.2 An order with only a subscription

The one-time card says "No one-time lines on this order." (`:161`), and no "Invoiced as …" line
appears because `quotation.invoices` filtered to `kind: "ONE_TIME"` (`:32`) is empty. Everything
else is identical.

### 7.3 An order with only one-time lines

You never reach this screen — no subscription row exists to open. See screen 09 §7.1.

### 7.4 Quantity increase mid-period: 2 → 3 seats on 2026-09-06

Period `2026-09-05..2026-10-04`. `daysInPeriod = daysInclusive = 30`.
`rawRemaining = diffDays("2026-09-06","2026-10-04") + 1 = 28 + 1 = 29`.

```
perUnit = applyDiscount(100000, 0) = 100000
credit  = divRound(100000 * 2 * 29, 30) = divRound(5800000, 30) = 193333
charge  = divRound(100000 * 3 * 29, 30) = divRound(8700000, 30) = 290000
net     = 290000 - 193333 = 96667
```

`net > 0`, so a `PRORATION` invoice (`src/services/subscription.service.ts:48-76`):

```
chargeTax = pct(290000, 1800) = divRound(522000000, 10000) = 52200
creditTax = pct(193333, 1800) = divRound(347999400, 10000) = 34800
subtotal  = 96667
taxTotal  = 52200 - 34800 = 17400
total     = 96667 + 17400 = 114067          → ₹1,140.67
line 1: qty 3, net  290000, tax  52200, total  342200
line 2: qty 2, net -193333, tax -34800, total -228133
                                     line total sum = 114067 ✓
```

Then rows 2–12 are re-priced to `net 300000, tax 54000, total 354000` (`:92-94`), `qty` becomes 3
(`:95`), and a `QUANTITY` change row is written with `days 29/30, credit 193333, charge 290000, net
96667` (`:96-112`).

The exact same arithmetic with a change on **day one** (`remainingDays = daysInPeriod = 30`) gives
`credit 200000, charge 300000, net 100000, total 118000` — pinned by the test at
`src/services/__tests__/billing.service.db.test.ts:120-130`. And the 25-days-left demo case
(`net = 83333`) is pinned at `src/domain/__tests__/prorate.test.ts:45-49`.

### 7.5 Quantity decrease mid-period: 3 → 2 seats on 2026-09-25

`rawRemaining = diffDays("2026-09-25","2026-10-04") + 1 = 9 + 1 = 10`.

```
credit = divRound(100000 * 3 * 10, 30) = divRound(3000000, 30) = 100000
charge = divRound(100000 * 2 * 10, 30) = divRound(2000000, 30) =  66667
net    = 66667 - 100000 = -33333
```

`net < 0`, so **no invoice** — a credit note (`:77-89`):
`amount = 33333 + pct(33333, 1800) = 33333 + 6000 = 39333` → ₹393.33, status `OPEN`, reason
"Support Pro reduced from 3 to 2 seats on 2026-09-25, 10 of 30 days credited".

Scheduled rows are re-priced down to `236000`, `qty` becomes 2. The Proration history row reads
`10/30 | ₹1,000.00 | ₹666.67 | -₹333.33`.

The 3 → 1 variant on day one gives `net = -200000` and a credit note of `236000` — pinned at
`src/services/__tests__/billing.service.db.test.ts:132-135`.

### 7.6 A change that prorates to exactly zero

Plan with `prorationMode = NONE` (`prisma/schema.prisma:41-44`), or an effective date on the day
after the period end (impossible through this form, which clamps the input at `:77`, but reachable
through the action). `prorate` returns all zeros (`src/domain/prorate.ts:50`). Neither branch runs:
**no invoice, no credit note.** But `qty` still changes (`:95`), the scheduled rows are still
re-priced (`:94`), and a `subscription_change` row is still written with `credit 0, charge 0,
net 0`. The banner reads "Quantity changed; nothing to prorate"
(`src/app/(internal)/actions/subscription.ts:29`).

### 7.7 Same quantity resubmitted

`input.newQty === sub.qty` → `ValidationError("Quantity is unchanged")` at
`src/services/subscription.service.ts:22`, before the transaction does anything. Red banner:
"Quantity is unchanged Pick a different quantity" — the message plus the flattened field error
(`src/app/(internal)/actions/subscription.ts:26-27`).

### 7.8 Cancel under `END_OF_PERIOD`

`cancelEffective = periodEnd` = 2026-10-04 (`src/services/subscription.service.ts:147`). The refund
`if` (`:152`) is skipped: `credit = 0`, `creditNoteId = null`. Rows 2–12 → `CANCELLED` (`:180`).
Subscription → `CANCELLED` **now**, `cancel_effective = 2026-10-04` (`:181`). A `CANCEL` change row
with `credit 0, net 0` (`:183`).

Banner: "Cancelled, effective 2026-10-04" (`src/app/(internal)/actions/subscription.ts:51`).
The customer keeps the service to 2026-10-04 in the business sense, and `INV-2026-0002` for that
period remains payable — nothing about the already-`INVOICED` period is touched.

### 7.9 Cancel under `IMMEDIATE_PRORATED_REFUND` with `refundMethod = CREDIT_NOTE` (the seeded default)

Cancel on 2026-09-05, `qty 1`. `prorate` with `newQty = 0`: `remainingDays = 30`,
`credit = divRound(100000 * 1 * 30, 30) = 100000`, `charge = 0`.
`amount = 100000 + pct(100000, 1800) = 118000` → ₹1,180.00, status `OPEN`
(`refund` is false because the plan says `CREDIT_NOTE`). Pinned at
`src/services/__tests__/billing.service.db.test.ts:144-149`.

Rows 2–12 → `CANCELLED`, subscription → `CANCELLED`, `cancel_effective = 2026-09-05`. Banner:
"Cancelled (immediate prorated refund), credit note issued for the unused days"
(`src/app/(internal)/actions/subscription.ts:49-50`).

Proration history shows the `CANCEL` row with credit ₹1,180.00 — wait, no: it shows
`credit = 100000` (₹1,000.00), the **pre-tax** figure, because `:183` stores `credit: credit` not
`credit: amount`. The tax-inclusive ₹1,180.00 is only on the credit note, which this screen does
not display. See §10 gotcha 5.

### 7.10 Cancel under `IMMEDIATE_PRORATED_REFUND` with `refundMethod = REFUND_PAYMENT`, invoice already paid

`paidInvoice` is the latest `RECURRING` invoice and its status is `PAID`
(`src/services/subscription.service.ts:157`), so `refund` is true (`:158`). Two rows are written:

- `credit_note` with `status = "REFUNDED"` and `invoice_id` pointing at the paid invoice (`:164-166`),
- `payment` with `kind = "REFUND"`, `amount = 118000`, `method = "BANK_TRANSFER"`,
  `clientRef = "refund-CN-2026-0001"` (`:172-174`).

**The invoice stays `PAID` with `paid_amount` unchanged.** Screen 13 will show ₹1,180.00 in the
Payments list with no sign and no "refund" wording — the card only prints `p.method` and
`p.amount` (`src/app/(internal)/invoices/[publicId]/page.tsx:205-213`), never `p.kind`. See screen
13 §10.

### 7.11 Cancel under `IMMEDIATE_PRORATED_REFUND` but the invoice is unpaid

Same plan as 7.10, but `sub.invoices[0].status` is `POSTED`. `paidInvoice` is `null` (`:157`), so
`refund` is false (`:158`) even though the plan says `REFUND_PAYMENT`. The customer gets an `OPEN`
credit note with `invoice_id = null`, and **no** `REFUND` payment. This is deliberate: you cannot
refund money you never received.

### 7.12 Cancel under `NO_REFUND`

`policy !== "IMMEDIATE_PRORATED_REFUND"`, so `:152` is false. `credit = 0`, no credit note, no
refund. `cancelEffective = effective` (today). Rows 2–12 cancelled, subscription cancelled. Banner:
"Cancelled, effective 2026-09-05". The customer loses the remaining days of the period they already
paid for.

### 7.13 A payment recorded on the recurring invoice

Finance pays `INV-2026-0002` in full on screen 13. On this screen, the **Invoice** column of
schedule row 1 changes its badge from `Unpaid` to `Paid` (`:256`, reading `invoice.status`), and the
"Invoiced as INV-2026-0001 [Unpaid]" line under the one-time table changes when that invoice is
paid (`:188`). Nothing else moves. The subscription itself has no payment state.

### 7.14 A partial payment

Same as 7.13 but the badge reads `Partially Paid` (`src/components/shared/status-badge.tsx:49`).
The `PARTIAL` status was derived from `paid_amount`, never typed — see screen 13 §6.

### 7.15 Change, then cancel, on the same subscription

Both write `subscription_change` rows, so Proration history shows two rows, newest first (`:31`).
The `QUANTITY` row has days and charge filled in; the `CANCEL` row has `days` blank and `charge` 0.
The billing schedule shows rows 2–12 first re-priced by the change, then `Cancelled` by the cancel —
the re-priced amounts remain visible on the cancelled rows, because `:180` only updates `status`.

### 7.16 Paying an invoice while the goods are still unshipped

Not visible here, but it explains the schedule badges: paying every invoice of the order does
**not** flip the quotation to `PAID` while a `RESERVED` shipment or a `PROPOSED` plan is
outstanding (`src/services/billing.service.ts:183-187`). The subscription and its schedule are
completely unaffected either way. Full walkthrough on screen 13 §7.

---

## 8. Schema behind this screen

**`subscription`** — `prisma/schema.prisma:743-777`. Fields and their origin are tabulated in
screen 09 §8. The columns this screen reads that screen 09 does not: `unit_price` (`:752`),
`discount_bp` (`:753`), `tax_bp` (`:754`), `current_period_start`/`_end` (`:757-758`),
`cancel_effective` (`:760`).

Why these are snapshotted rather than read live from `quotation_line` and `product`:

- `unit_price` (`:752`) — billing must be reproducible. The catalogue price can change tomorrow.
- `discount_bp` (`:753`) — **copied from `quotation_line.effective_discount_bp`**, not
  `discount_bp` (`src/services/billing.service.ts:78`). The effective one already folds in the
  order-level discount, so the subscription bills what the customer actually agreed to.
- `tax_bp` (`:754`) — the tax rate at the time of sale.
- `qty` (`:751`) — the only snapshot that is ever mutated, and only by `changeQuantity` (`:95`).
- `product_id`, `plan_id` (`:749-750`) — FKs, so the plan's *policies* are read live at cancel
  time while its *interval and periods* were baked into the schedule at confirmation time. That
  split is the reason changing a plan in admin can alter how an existing subscription cancels but
  not how it bills.

**`billing_schedule`** — `prisma/schema.prisma:779-796`, SQL `billing_schedule`.

| Column | Written by | Notes |
|---|---|---|
| `period_start`, `period_end`, `bill_date` (`:782-784`) | `src/services/billing.service.ts:86-88` from `buildSchedule` | `@db.Date`; `CHECK period_end >= period_start` (`migration.sql:1049`) |
| `net`, `tax`, `total` (`:785-787`) | `:89-91` at creation; overwritten for `SCHEDULED` rows only by `src/services/subscription.service.ts:94` | |
| `status` (`:788`) | default `SCHEDULED`; `INVOICED` at `src/services/billing.service.ts:133`; `CANCELLED` at `src/services/subscription.service.ts:180` | enum at `prisma/schema.prisma:132-136` |
| `invoice_id` (`:789`) | only at `src/services/billing.service.ts:133` | nullable — every row except period one has it null forever |

`onDelete: Cascade` on the subscription relation (`:791`) — deleting a subscription takes its
schedule with it.

**`subscription_change`** — `prisma/schema.prisma:798-820`. An append-only ledger of every Modify
and Cancel. `days_in_period` and `remaining_days` are nullable (`:805-806`) precisely because the
cancel path does not fill them.

**`recurring_plan`** — `prisma/schema.prisma:723-741`. `periods` (`:726`, `CHECK periods > 0` at
`migration.sql:1050`) decides how many schedule rows get materialised.
`proration_mode` (`:727`), `bill_change_day` (`:728`), `cancel_policy` (`:729`),
`refund_method` (`:730`) are the four knobs A5 asks for (`docs/DealFlow360.txt:145-147`).

**`credit_note`** — `prisma/schema.prisma:879-897`. `amount` is always positive
(`CHECK amount > 0`, `migration.sql:1043`); the sign lives in the fact that it is a credit note.
`status` (`:887`) is `OPEN` normally and `REFUNDED` on the refund path;
**`APPLIED` is never written by any code in `src/`**, and `applied_to_invoice_id` (`:888`) is never
set. There is no "apply a credit note to an invoice" feature.

**`quotation_line`** (`prisma/schema.prisma:488-518`) and **`invoice`**
(`prisma/schema.prisma:822-856`) are read here for the one-time card and the schedule's invoice
links; both are described on screens 4 and 13.

---

## 9. How this screen connects to the others

- **Screen 09 → here.** The only way in, by clicking a row (`src/app/(internal)/subscriptions/page.tsx:48`).
- **Here → screen 13** twice over: "Invoiced as INV-…" under the one-time table (`:185`) and the
  Invoice column of the billing schedule (`:255`).
- **Here → screen 12** indirectly: a Modify with `net > 0` creates a new `PRORATION` invoice that
  appears at the top of `/invoices` (status `POSTED`, so it sorts first, `src/app/(internal)/invoices/page.tsx:14`).
- **Screen 4 (Quotation detail) → here** through the data: the one-time card literally shows that
  quotation's `ONE_TIME` lines (`:32`).
- **Admin → plans (`/admin/plans`)** decides `cancel_policy` and `refund_method`, which this screen
  reads live at `:109` and `src/services/subscription.service.ts:146,158`.
- **The audit trail** (screen 4's history panel, and `audit_log` generally) receives
  `SUBSCRIPTION_QTY` and `SUBSCRIPTION_CANCEL` rows carrying `quotationId`
  (`src/services/subscription.service.ts:116,188`), so a subscription change also bumps the
  originating quotation's `lastActivityAt` (`src/lib/audit.ts:41-43`) — which is what the Deal
  Health "inactive for N days" alert reads.

---

## 10. Gotchas

1. **The "Amount" in the Recurring lines card is period one's amount, forever.**
   `perPeriod = sub.schedule[0]?.total ?? 0` (`:37`). `changeQuantity` re-prices only `SCHEDULED`
   rows (`src/services/subscription.service.ts:94`), and row 1 is `INVOICED`. So after going 2 → 3
   seats, the schedule table correctly shows rows 2–12 at ₹3,540.00, while the Recurring lines card
   still shows ₹2,360.00. Read the schedule table, not the summary row.

2. **"Next bill date" is not a scheduler.** There is no cron, no queue, no job runner in this repo.
   Nothing will invoice period 2 when 2026-10-05 arrives. Only period one is ever invoiced
   (`src/services/billing.service.ts:133`). Rows 2–12 stay `Scheduled` indefinitely.

3. **A cancelled subscription shows no controls to anyone**, including an Admin (`:62,88` require
   `sub.status === "ACTIVE"`). There is no un-cancel, no reactivate. `CANCELLED: []` in the
   transition table (`src/lib/state/subscription.machine.ts:7`) makes that permanent at the service
   layer too.

4. **The Days column is blank on a cancel row.** `cancelSubscription` writes `subscription_change`
   without `daysInPeriod` / `remainingDays` (`src/services/subscription.service.ts:183`), so the
   cell renders as a bare `/` (`:141`). The information exists — it is inside the credit note's
   `reason` text (`:167`) — but this screen does not show it.

5. **The Credit column is pre-tax; credit notes are tax-inclusive.** `subscription_change.credit`
   stores the net figure (`:105`, `:154`), while `credit_note.amount` adds tax (`:78`, `:156`). A
   cancel showing "₹1,000.00" in Credit issued a credit note for ₹1,180.00. Nothing on this screen
   shows the credit note amount, its number, or its status.

6. **Credit notes are invisible in the entire application.** There is no `/credit-notes` route, no
   list, no detail page, no column. The only evidence a credit note exists is the Proration history
   row and the audit log. If a demo asks "where did the refund go", the honest answer is: into the
   `credit_note` table, queryable only with SQL.

7. **The success banner prints raw paise.** "credit 200000 paise, charge 300000 paise"
   (`src/app/(internal)/actions/subscription.ts:29`) — not formatted through
   `formatMoney` (`src/lib/format.ts:34-36`) like everywhere else. Cosmetic, but it looks like a bug
   to a first-time reader.

8. **The Cancel action's role check is one layer thinner than Modify's.**
   `requireActionUser()` with no arguments at `src/app/(internal)/actions/subscription.ts:37`
   versus the explicit role list at `:14`. The service still refuses
   (`src/services/subscription.service.ts:135`), so the behaviour is correct — but if you are
   auditing the code, that asymmetry is real and it is not a typo you should "fix" without checking
   the tests.

9. **`sub.invoices` is fetched and never used** (`:30`). The invoice links you see come from
   `schedule[].invoice` (`:29`). Do not add code that assumes `sub.invoices` drives the UI.

10. **Two forms, one page, one `publicId` hidden field each** (`:70`, `:96`). Both redirect back to
    the same URL with a query string. There is no optimistic-locking `version` on either form,
    unlike the quotation screens — the protection here comes from the state guards
    (`assertSubscriptionChangeable`, `assertSubscriptionTransition`) and from the fact that both
    services run in a transaction, not from a version number. Two simultaneous Modifies will both
    succeed and both prorate against the same `sub.qty` they each read.

11. **`PAUSED` never appears.** No pause action exists; see screen 09 §10.1.
