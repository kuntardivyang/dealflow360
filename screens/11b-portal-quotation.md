# Screen 11b — Customer Portal Negotiation Screen

## 1. What this screen is

| | |
|---|---|
| Route | `/portal/q/[publicId]` |
| Page file | `src/app/portal/(customer)/q/[publicId]/page.tsx` |
| Frame | `src/app/portal/(customer)/layout.tsx` (header, nav, sign out) inside `src/app/portal/layout.tsx` (teal theme) |
| Client form | `src/components/portal/negotiation-form.tsx` |
| Server actions | `submitRequest` — `src/app/portal/actions.ts:43`; `confirm` — `:56` |
| Service | `src/services/portal.service.ts` |
| DTO | `src/lib/dto/portal.ts` |
| Mockup | Screen 11, `docs/mockup/11-customer-portal.png` |
| Spec | B8 "Customer Portal Negotiation Screen"; section 5 "If terms change beyond thresholds during negotiation, the quote re-enters the approval flow automatically"; section 9 step 7 |

This is the screen the whole spec is really about. A customer, logged in with their own credentials, sees **their** quotation, comments on a line, asks for a change, or counters a discount — and if that counter breaks a limit, the quotation re-enters the internal approval flow **by itself**, with no salesperson clicking anything.

`(customer)` is a route group: the parentheses keep it out of the URL, so the file `portal/(customer)/q/[publicId]/page.tsx` serves `/portal/q/<publicId>`.

`publicId` is a 12-character opaque id (`prisma/schema.prisma:441`, `Quotation.publicId String @unique`), not the row's integer `id`. The customer never sees a database primary key in a URL.

---

## 2. Who can open it, and who enforces that

| Who | What happens | Enforced where |
|---|---|---|
| Not logged in at all | Redirect to `/portal/login?next=/portal/q/<publicId>` | `src/middleware.ts:14,17,19-20,37-39` |
| Valid `df_portal`, quotation belongs to their customer, and it was sent | Page renders | `src/services/portal.service.ts:42-47` |
| Valid `df_portal`, quotation belongs to **another** customer | **404 Not Found** (not 403) | `portal.service.ts:43` (`customerId` in the `where`), `:46` throws `NotFoundError`, page catches at `q/[publicId]/page.tsx:28` and calls `notFound()` |
| Valid `df_portal`, own quotation but still `DRAFT` / `APPROVED` / `REJECTED` / `CANCELLED` | **404** | `portal.service.ts:43` — `status: { in: PORTAL_VISIBLE_STATUSES }` (`src/lib/contract.ts:368-375`) |
| Valid `df_portal`, own quotation, status is visible but `sent_at` is null | **404** | `portal.service.ts:43` — `sentAt: { not: null }` |
| **Internal user** (`df_session` only) | Redirect to `/portal/login` | `src/middleware.ts:17` picks `df_portal` and only `df_portal`; see Screen 11a §2 |
| Second contact at the same customer | Sees the same quotation, can act on it | Scoping is by `customer_id` (`portal.service.ts:43`), not by `contact_id`. `customer_contact.is_primary` exists (`prisma/schema.prisma:263`) but **no code reads it** |
| A sales rep wanting to see this view | Cannot, without a contact's password | There is no "impersonate" or "preview as customer" path anywhere. The rep sees the URL printed at `src/app/(internal)/quotes/[publicId]/page.tsx:245` and nothing more |

### The single most important function in the portal

```ts
// src/services/portal.service.ts:41-48
async function loadForCustomer(tx: Tx, publicId: string, customerId: number) {
  const q = await tx.quotation.findFirst({
    where: { publicId, customerId, sentAt: { not: null }, status: { in: [...PORTAL_VISIBLE_STATUSES] } },
    include: PORTAL_INCLUDE,
  });
  if (!q) throw new NotFoundError("Quotation not found");
  return q;
}
```

Four things at once, and every one matters:

1. **`publicId`** — what the URL asked for.
2. **`customerId`** — taken from the session, never from the request. It arrives as `portal.customerId` from `getPortalUser()` (`src/lib/auth/portal.ts:51`), which read it from `portal_session → customer_contact.customer_id`. The browser cannot influence it.
3. **`sentAt: { not: null }`** — a quotation the rep is still drafting is invisible even to its own customer. `sent_at` is stamped exactly once, by `sendToCustomer` (`src/services/order.service.ts:28`).
4. **`status: { in: PORTAL_VISIBLE_STATUSES }`** — `SENT`, `UNDER_NEGOTIATION`, `PENDING_APPROVAL`, `CONFIRMED`, `FULFILLMENT`, `PAID` (`src/lib/contract.ts:368-375`). Deliberately excludes `DRAFT`, `APPROVED`, `REJECTED`, `CANCELLED`. `APPROVED` is excluded because "approved internally but not yet sent" is an internal state the customer has no business seeing.

**Every** portal read and write goes through this one function: `getPortalQuotation` (`:51`), `submitRequest` (`:71` and again at `:118` to build the response), `confirmFromPortal` (`:128`, `:145`, `:163`). There is no second path to a quotation row from the portal.

### Why 404 and not 403

`loadForCustomer` throws `NotFoundError` (`:46`), which the page turns into Next's 404 (`q/[publicId]/page.tsx:28`) and the server actions turn into `{ ok: false, code: "NOT_FOUND" }` (`src/lib/contract.ts:104-106`, `:158-163`).

A `403 Forbidden` would be an information leak: it tells the caller *the record exists, it is just not yours*. Guess enough public ids and you learn how many live quotations a competitor has. A `404` says nothing at all. The same response comes back whether the id is a rival's quotation, your own unsent draft, or complete gibberish. The comment at `portal.service.ts:40` says exactly this: *"Not yours or not sent = 404, never 403."* The behaviour is pinned by a test: `src/services/__tests__/portal.service.db.test.ts:65` — `getPortalQuotation(q.publicId, betaBuyer)` rejects with `NotFoundError`.

---

## 3. Everything on the screen, and where each value comes from

Rendering is one call: `getPortalQuotation(publicId, user)` (`q/[publicId]/page.tsx:26`) → `loadForCustomer` → `toPortalQuotation` (`src/lib/dto/portal.ts:29`). Nothing else on this page touches Prisma.

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| "Quotation Q-2026-0326" | `Q-2026-0326` | `page.tsx:38` ← `dto.number` ← `portal.ts:33` | `quotation.number` | Allocated by the counter `counter{key:"quotation"}` when the rep created the quote (`src/services/quotation.service.ts`, `nextNumber`) |
| "for Acme Corp" | `Acme Corp` | `page.tsx:38` ← `dto.customerName` ← `portal.ts:34` (`q.customer?.name ?? ""`) | `customer.name` | Seeded by `prisma/seed/a-customers.ts:24`, or typed by an Admin on the Customers screen. `customer_id` is nullable on `quotation` (`prisma/schema.prisma:443`), hence the `?? ""` |
| Status pill "Sent" / "Under Negotiation" / "Awaiting internal approval" / "Confirmed" | `Sent` | `page.tsx:42` ← `dto.status` ← `portalStatusLabel` (`src/lib/contract.ts:377-382`) | `quotation.status` | Set by the rep sending (`order.service.ts:28`), by your own request (`portal.service.ts:106`), by the rep's answer (`:204`), or by an approver (`approval.service.ts:96`) |
| Line "Laptop 14\"" | `Laptop 14"` | `page.tsx:62` ← `dto.lines[].name` ← `portal.ts:38` (`l.description`) | `quotation_line.description` | Snapshotted from `product.name` when the rep added the line. The comment at `prisma/schema.prisma:487` explains why: *"Every price input is snapshotted on the line so history survives catalogue edits."* Renaming the product later does not change this quotation |
| Qty `4` | `4` | `page.tsx:63` ← `portal.ts:39` | `quotation_line.qty` | Typed by the rep |
| Unit price `₹60,000.00` | `6000000` paise | `page.tsx:65` ← `portal.ts:40` | `quotation_line.unit_price` | Snapshot of `product.list_price` **after** the pricelist rule for the customer's tier was applied (`quotation.service.ts:109-111`, re-applied by `setCustomer`) |
| Discount `10.00%` | `1000` bp | `page.tsx:67` ← `portal.ts:41` | `quotation_line.discount_bp` | Typed by the rep, **or written by your own accepted counter** (`portal.service.ts:190` when the rep accepts, `approval.service.ts:124` when an approver approves) |
| Line total `₹2,54,880.00` | `25488000` paise | `page.tsx:69` ← `portal.ts:42` (`l.total`) | `quotation_line.total` | Computed by `computeTotals` and persisted by `recompute` (`quotation.service.ts:355-360`). Includes tax |
| "incl. 18.00% tax" | `1800` bp | `page.tsx:70` ← `portal.ts:43` | `quotation_line.tax_bp` | Snapshot of `product.tax_bp` at add time |
| Customer Comment cell | "Can this be 15% off instead of 10%?" | `page.tsx:75` ← `latestForLine(l.id)` (`:31`) over `dto.requests` | `portal_request.message` | Typed by you on this screen; written at `portal.service.ts:79-89` |
| Comment status chip | `Open` / `Accepted` / `Declined` | `page.tsx:76` ← `dto.requests[].status` | `portal_request.status` | `OPEN` on insert (schema default, `prisma/schema.prisma:931`); changed by the rep (`portal.service.ts:183`) or by approval settlement (`approval.service.ts:128`) |
| Subtotal | `₹2,31,200.00` | `page.tsx:89` ← `dto.netTotal` ← `portal.ts:45` | `quotation.net_total` | `recompute` (`quotation.service.ts:374`) — after discounts, before tax |
| Tax | `₹41,616.00` | `page.tsx:92` ← `dto.taxTotal` ← `portal.ts:46` | `quotation.tax_total` | `recompute` (`:375`) |
| Total | `₹2,72,816.00` | `page.tsx:95` ← `dto.total` ← `portal.ts:47` | `quotation.total` | `recompute` (`:376`) — net + tax |
| "Ask, change or counter" card | static, with three tabs | `negotiation-form.tsx:94,100-121` | — | Hardcoded |
| Line dropdown | "Laptop 14\" (current discount 10.00%)" | `negotiation-form.tsx:133-137` ← `dto.lines` | `quotation_line.id`, `.description`, `.discount_bp` | Same DTO as the table |
| Counter Discount % field | you type `15` | `negotiation-form.tsx:144-156` | → `portal_request.proposed_discount_bp` = `Math.round(15 * 100)` = `1500` (`:53`) | Your input, converted from percent to basis points client-side |
| Requested Delivery Date | you pick `2026-10-01` | `negotiation-form.tsx:162` | → `portal_request.requested_delivery_date` (`portal.service.ts:87`) | Your input. **Write-only from your side** — see Gotcha 4 |
| Message textarea | you type it | `negotiation-form.tsx:168-175` | → `portal_request.message` | Your input, trimmed; empty becomes `NULL` (`portal.service.ts:85`) |
| "Submit Request" button | — | `negotiation-form.tsx:179-181` | — | Disabled when `!canRequest` (status is Awaiting/Confirmed) or a call is in flight |
| "Confirm Quotation" card copy | four different sentences | `negotiation-form.tsx:189-195` | — | Chosen from `confirmed` / `awaiting` / `openCounter` / else |
| "Confirm Quotation" button | — | `negotiation-form.tsx:199` | — | Disabled unless `dto.canConfirm` (`src/lib/dto/portal.ts:58`) |
| "Your requests" list | one row per request | `page.tsx:102-126` ← `dto.requests` | `portal_request.*` | Every request you ever submitted on this quotation, newest first (`portal.service.ts:37`, `orderBy: { createdAt: "desc" }`) |
| "Reply: Dates are fixed" | — | `page.tsx:118` ← `dto.requests[].responseNote` | `portal_request.response_note` | Typed by the rep in the note box on the internal quotation screen (`src/app/(internal)/quotes/[publicId]/page.tsx:314`), or copied from the approver's note by `settleCounterOffers` (`approval.service.ts:129`) |

### The whitelist DTO — every key it returns

`toPortalQuotation` (`src/lib/dto/portal.ts:29-61`) builds its result by **explicit field pick**. There is no `...q`, no `...line`, nowhere in the file. That is the entire security model of what a customer can see: if a key is not written out by hand, it cannot escape.

**Top level (11 keys)** — `src/lib/contract.ts:389-411`:

| Key | Source line | From |
|---|---|---|
| `publicId` | `portal.ts:32` | `quotation.public_id` |
| `number` | `:33` | `quotation.number` |
| `customerName` | `:34` | `customer.name` (own customer only) |
| `status` | `:35` | `portalStatusLabel(quotation.status)` — **relabelled**, see below |
| `lines` | `:36-44` | `quotation_line[]`, seven keys each |
| `netTotal` | `:45` | `quotation.net_total` |
| `taxTotal` | `:46` | `quotation.tax_total` |
| `total` | `:47` | `quotation.total` |
| `requests` | `:48-57` | `portal_request[]`, eight keys each |
| `canConfirm` | `:58` | computed: `(status === "SENT" \|\| status === "UNDER_NEGOTIATION") && !openCounter` |
| `confirmedAt` | `:59` | `quotation.confirmed_at`, ISO string or null |

**Each line (7 keys)** — `portal.ts:37-43`: `id`, `name` (← `description`), `qty`, `unitPrice`, `discountBp`, `lineTotal` (← `total`), `taxBp`.

**Each request (8 keys)** — `portal.ts:49-56`: `id`, `type`, `lineId`, `message`, `proposedDiscountBp`, `status`, `responseNote`, `createdAt`.

### What is deliberately excluded

The service loads the **full** row — `PORTAL_INCLUDE` at `portal.service.ts:34-38` pulls `lines` with every column, and `customer` with `tierId`. All of the following is present in memory on the server and is dropped by the mapper:

| Excluded | Column that exists but never leaves | Why |
|---|---|---|
| Cost | `quotation.cost_total`, `quotation_line.unit_cost` | What you pay your supplier |
| Margin | `quotation.margin_bp` | Your profit on this deal |
| Risk score | `quotation.risk_score` | How nervous this deal makes you |
| Risk breakdown | `quotation.risk_breakdown` (JSON: worst overage, blended overage, margin penalty, per-line detail) | Reveals ceilings by arithmetic |
| Discount ceilings | `quotation_line.ceiling_bp`, `customer_tier.discount_ceiling_bp` | Telling the customer the ceiling is 15 % guarantees every counter is exactly 15 % |
| Overage | `risk_breakdown.lines[].overageBp` | Same |
| Effective discount | `quotation_line.effective_discount_bp` | Compounded line+order discount, an internal number |
| Gross / discount amount | `quotation.gross_total`, `.discount_total`, `quotation_line.gross`, `.discount_amount`, `.net` | Would let you reverse-engineer the discount structure |
| Approval chain and steps | `approval_request.chain`, `.risk_score`, `.risk_breakdown`, `.version`, `approval_step.required_role`, `.acted_by_id`, `.note` | Who approves what, and at which level, is internal governance. **`approvalRequests` is not even in `PORTAL_INCLUDE`** — the rows are never loaded |
| Approval version | `quotation.approval_version` | Internal round counter |
| Negotiation flag | `quotation.negotiation_pending` | Internal |
| Rep identity | `quotation.rep_user_id`, `app_user.name` | The customer sees "your sales representative", never a name or a role |
| Who answered a request | `portal_request.responded_by_id`, `.responded_at` | The note text is shown; the person is not |
| Warehouse | `fulfillment_plan`, `fulfillment_plan_line.warehouse_id`, `stock_level` | Where you actually hold stock |
| Internal notes | `quotation.notes` | Free text the rep writes to themselves |
| Tier | `customer.tier_id`, `customer_tier.name` | Not on this screen (it *is* on the Profile page — see Screen 11c) |
| Product id, plan id, line type, source, sort order | `quotation_line.product_id`, `.plan_id`, `.line_type`, `.source`, `.sort_order` | Internal plumbing |
| Requested delivery date | `portal_request.requested_delivery_date` | You send it, you never get it back |
| Contact id | `portal_request.contact_id` | Which colleague at your company asked |

### The test that guards the key list

`src/lib/dto/__tests__/portal.test.ts` feeds the mapper a row that **deliberately carries internal fields** (`:5-28`: `repUserId: 4`, `costTotal`, `marginBp: 2017`, `riskScore: 42`, `riskBreakdown`, `approvalVersion`, per-line `unitCost`, `effectiveDiscountBp`, `ceilingBp`, `customer.tierId`) and then asserts three things:

1. **Exact key lists** — `:37-41`. Top level must equal those 11 names, sorted. Line keys must equal those 7. Request keys must equal those 8. Add a key to the DTO and this test fails until you have thought about it.
2. **A forbidden-word sweep** — `:32` defines `/cost|margin|risk|approval|rep|warehouse|internal|ceiling|overage/i`, and `:42` walks **every key at every depth** via `collectKeys` (`src/lib/dto/portal.ts:64-69`) asserting none matches.
3. **A value sweep and an inline snapshot** — `:43` asserts the serialised DTO contains none of `42000` (a unit cost), `2017` (the margin), `"riskScore"`, `repUserId`, `ceilingBp`; `:56-101` pins the whole customer-facing shape as an inline snapshot. A snapshot mismatch is the loudest possible signal that the customer-facing contract changed.

A second, database-level check repeats it against real data: `src/services/__tests__/portal.service.db.test.ts:64` — `expect(JSON.stringify(dto)).not.toMatch(/cost|margin|risk|ceiling/i)`.

### `portalStatusLabel` — the four words a customer may see

```ts
// src/lib/contract.ts:377-382
if (s === "SENT") return "Sent";
if (s === "UNDER_NEGOTIATION") return "Under Negotiation";
if (s === "PENDING_APPROVAL") return "Awaiting internal approval";
return "Confirmed";
```

Ten internal statuses collapse to four labels. Two renames matter:

* **`PENDING_APPROVAL` → "Awaiting internal approval".** Neutral on purpose. It does not say *who* is approving, at which step, or how many steps remain. The internal label for the same status is "Pending Approval" (`src/lib/contract.ts:356`), and the internal approvals screen shows the chain, the roles and the names. The customer gets four words and no names. Combined with `approvalRequests` never being loaded (`PORTAL_INCLUDE`, `portal.service.ts:34-38`), there is nothing on the wire to reverse-engineer.
* **`FULFILLMENT` and `PAID` → "Confirmed"** (the fallthrough at `:381`). Once you have confirmed, the portal stops narrating. Pinned at `portal.test.ts:51`.

`CANCELLED` would also fall through to "Confirmed", but it can never get here: it is not in `PORTAL_VISIBLE_STATUSES`, so `loadForCustomer` 404s first.

---

## 4. The queries this page runs

**Render (server component, `q/[publicId]/page.tsx`):**

1. `requirePortal()` (`:23`) → `getPortalUser()` → `SELECT … FROM portal_session JOIN customer_contact JOIN customer WHERE token = $1` (`src/lib/auth/portal.ts:49`).
2. `getPortalQuotation(publicId, user)` (`:26`) → `loadForCustomer` (`portal.service.ts:42`) — **one** `findFirst` on `quotation` with `include: PORTAL_INCLUDE` (`:34-38`), i.e. joined `customer` (name + tierId), all `quotation_line` ordered by `sort_order`, all `portal_request` ordered by `created_at desc`.
3. `toPortalQuotation` (`src/lib/dto/portal.ts:29`) — pure mapping, no I/O.

That is it. Two queries plus the middleware's own `portalSessionValid` (`src/middleware.ts:52`), which is a third.

**Submit Request** — `submitRequest` (`portal.service.ts:69`), all inside one `prisma.$transaction` (`:70`):

| # | Query | Line |
|---|---|---|
| 1 | `loadForCustomer` | `:71` |
| 2 | `portalRequest.create` | `:79` |
| 3 | *(counter only)* `loadRiskWeights` + `loadRoutingRules` in parallel | `:238` inside `previewProposal` |
| 4 | *(chain non-empty only)* `approvalRequest.updateMany` → SUPERSEDED | `:244` |
| 5 | *(chain non-empty only)* `approvalRequest.findUnique` loop to find a free version | `:246` |
| 6 | *(chain non-empty only)* `approvalRequest.create` with nested `approval_step` rows | `:247` |
| 7 | `quotation.update` (status, version+1, approvalVersion, negotiationPending) | `:104` |
| 8 | `auditLog.create` + `quotation.update` for `lastActivityAt` | `:108` → `src/lib/audit.ts:26,42` |
| 9 | `loadForCustomer` again, to return the fresh DTO | `:118` |

**Confirm Quotation** — `confirmFromPortal` (`:126`), one transaction (`:127`):

| # | Query | Line |
|---|---|---|
| 1 | `loadForCustomer` | `:128` |
| 2 | `recompute` — re-prices every line and rewrites quotation totals, margin, risk | `:136` → `quotation.service.ts:349-384` |
| 3 | `approvalRequest.findFirst` for an APPROVED request at the current `approval_version` | `:140` |
| 4a | *(safety net)* `openApprovalRound` + `quotation.update` + audit + reload | `:142-145` |
| 4b | *(normal)* `quotation.update` → CONFIRMED | `:149` |
| 5 | `onConfirmedHooks` → invoices, subscriptions, fulfillment split | `:153` → `src/services/portal-hooks.ts:9` |
| 6 | `auditLog.create` | `:154` |
| 7 | `loadForCustomer` again | `:163` |

After either action the client calls `router.refresh()` (`negotiation-form.tsx:73,87`) and the actions call `revalidatePath` on `/portal/q/<publicId>` and `/portal` (`src/app/portal/actions.ts:48-49,61-62`), so the list screen's open-request count updates too.

---

## 5. Every condition on this page

### Visibility

| # | Condition | Where | Effect |
|---|---|---|---|
| 1 | Valid `df_portal` session | `src/middleware.ts:20`, then `requirePortal()` at `page.tsx:23` | else redirect to login |
| 2 | `quotation.public_id = :publicId` | `portal.service.ts:43` | else 404 |
| 3 | `quotation.customer_id = session.customerId` | `:43` | else 404 |
| 4 | `quotation.sent_at IS NOT NULL` | `:43` | else 404 |
| 5 | `quotation.status IN (SENT, UNDER_NEGOTIATION, PENDING_APPROVAL, CONFIRMED, FULFILLMENT, PAID)` | `:43` + `src/lib/contract.ts:368` | else 404 |
| 6 | Status label collapses to one of four strings | `src/lib/contract.ts:377` | never shows an internal status name |

### Whether you can submit a request

| # | Condition | Where | Effect |
|---|---|---|---|
| 7 | UI: `canRequest = !awaiting && !confirmed` | `negotiation-form.tsx:41` | tabs, dropdown, fields and button all disabled |
| 8 | Server: actor must be a `CONTACT` | `assertActor(actor, "PORTAL_REQUEST")` — `portal.service.ts:73`, table at `src/lib/state/quotation.machine.ts:35` (`PORTAL_REQUEST: ["CONTACT"]`) | `ForbiddenError` |
| 9 | Server: status must be `SENT` or `UNDER_NEGOTIATION` | `assertTransition` — `portal.service.ts:74`, table at `quotation.machine.ts:17` | `ConflictError` (409). **This is what stops a second request while the quote is out for approval** |
| 10 | If `lineId` was sent, that line must belong to this quotation | `portal.service.ts:76-77` | `ValidationError` "That line is not on this quotation" |

### Zod, per request type — the `superRefine`

`portalRequestSchema` (`src/lib/validation/portal.ts:8-25`). The base object is permissive; the `superRefine` at `:17-25` is what makes each type demand different fields:

| Type | Required | Optional | Rule |
|---|---|---|---|
| `COMMENT` | `message`, trimmed length ≥ 2 | `lineId`, `requestedDeliveryDate` | `:22-24` — the `else` branch |
| `CHANGE_REQUEST` | `message`, trimmed length ≥ 2 | `lineId`, `requestedDeliveryDate` | same `else` branch |
| `COUNTER_DISCOUNT` | `lineId` **and** `proposedDiscountBp` | `message`, `requestedDeliveryDate` | `:18-21` — two separate `addIssue` calls, so you can be told about both missing fields at once |

Note the asymmetry: a counter needs **no message** (`negotiation-form.tsx:167` even labels it "Message (optional)"), because the number is the message. A comment or change request needs no line — `lineId` may be omitted and the request attaches to the whole order (`negotiation-form.tsx:132` offers a "Whole quotation" option for those two types only).

Field-level rules from `src/lib/validation/common.ts`: `publicId` must match `/^[A-Za-z0-9_-]{12}$/` (`:21`); `lineId` is a positive integer (`:19`); `proposedDiscountBp` is an integer 0–10000, i.e. 0–100 % (`:7-11`); `requestedDeliveryDate` must be `YYYY-MM-DD` **and a real calendar date** (`:24-30` — the `refine` rejects `2026-02-30`); `message` is trimmed, max 2000 chars (`:35`).

### Whether you can confirm

| # | Condition | Where | Effect |
|---|---|---|---|
| 11 | `canConfirm` in the DTO: status is SENT or UNDER_NEGOTIATION **and** no OPEN counter | `src/lib/dto/portal.ts:30,58` | button disabled |
| 12 | Server: actor is `CONTACT` (or `ADMIN`, for "confirm on behalf") | `portal.service.ts:130`, `quotation.machine.ts:37` | `ForbiddenError` |
| 13 | Server: status ∈ {SENT, UNDER_NEGOTIATION} | `portal.service.ts:131`, `quotation.machine.ts:19` | `ConflictError` |
| 14 | Server: no `portal_request` of type `COUNTER_DISCOUNT` with status `OPEN` | `portal.service.ts:132-134` | `ConflictError` "Your counter-offer is still being reviewed…" |
| 15 | Safety net: after `recompute`, if the routing chain is non-empty **and** there is no APPROVED `approval_request` at the current `approval_version` | `portal.service.ts:140-141` | Confirmation is converted into a new approval round instead |
| 16 | `fullName` must be ≥ 2 characters after trim | `zName`, `common.ts:33`, via `portalConfirmSchema` (`validation/portal.ts:27`); UI also gates at `negotiation-form.tsx:220` | `ValidationError` |

---

## 6. Every action you can take here

### A. Submit Request

**Button** "Submit Request" (`negotiation-form.tsx:180`) → `submit()` (`:44`) → server action `submitRequest` (`src/app/portal/actions.ts:43`) → `parseInput(portalRequestSchema, …)` (`:44`) → `requirePortalAction()` (`:47`) → `portal.submitRequest(...)` (`src/services/portal.service.ts:69`).

**Guards, in order** (all inside one transaction opened at `:70`):

1. `loadForCustomer` — ownership + sent + visible status (`:71`); 404 if not.
2. `assertActor(actor, "PORTAL_REQUEST")` (`:73`) — only a `CONTACT`.
3. `assertTransition(q.status, "PORTAL_REQUEST")` (`:74`) — only from `SENT` or `UNDER_NEGOTIATION`.
4. Line-belongs-to-quotation check (`:76-77`).

**Tables written:**

| Table | What | Line |
|---|---|---|
| `portal_request` | INSERT: `quotation_id`, `line_id` (or null), `contact_id` (from the session), `type`, `message` (trimmed, empty→null), `proposed_discount_bp` (**forced to null unless type is COUNTER_DISCOUNT**, `:86`), `requested_delivery_date` (parsed as UTC midnight, `:87`), `status` defaults to `OPEN` | `:79-89` |
| `approval_request` | *(counter over a limit only)* previous PENDING/APPROVED rows → `SUPERSEDED`; one new row with `version`, `risk_score`, `risk_breakdown`, `chain` | `:244-256` |
| `approval_step` | *(same)* one row per role in the chain, `step_no` 1..n | `:254` |
| `quotation` | UPDATE `status`, `version + 1`, `approval_version`, and `negotiation_pending = true` when the new status is PENDING_APPROVAL | `:104-107` |
| `audit_log` | one row | `:108-117` |
| `quotation` (again) | `last_activity_at = now()` | `src/lib/audit.ts:42` |

**Audit row** (`:108-117`): `entity_type = "PortalRequest"`, `entity_id` = the new request id, `quotation_id`, `action` = `PORTAL_COUNTER` / `PORTAL_CHANGE_REQUEST` / `PORTAL_COMMENT` (`:112`), `actor_type = "CONTACT"`, `actor_id` = your contact id, `actor_name` = `"Nisha Acme (Acme Corp)"` (`src/lib/contract.ts:183`), `reason` = your message, `before_json` = `{ status, line, discountBp }`, `after_json` = `{ status, proposedDiscountBp, chain, approvalVersion }`. Note `chain` **is** stored in the audit row — the audit trail is an internal screen, not a portal one.

**What changes on screen:** the action returns the fresh DTO; the client shows a toast (`negotiation-form.tsx:65-69`) whose wording depends on whether the status came back as "Awaiting internal approval", clears the message/counter/date fields (`:70-72`), and calls `router.refresh()`.

### B. THE KEY BEHAVIOUR — a counter-discount that re-enters approval by itself

This is the mechanism the spec asks for at `docs/DealFlow360.txt:312-314` and in Quick Test step 7. Read `portal.service.ts:95-102` line by line:

```ts
if (input.type === "COUNTER_DISCOUNT" && line && input.proposedDiscountBp !== undefined) {
  const proposed = await previewProposal(tx, q, line.id, input.proposedDiscountBp);   // :96
  chain = proposed.chain;                                                             // :97
  if (chain.length > 0) {                                                             // :98
    approvalVersion = await openApprovalRound(tx, q.id, q.approvalVersion, proposed,  // :99
      `Customer counter: ${line.description} to ${input.proposedDiscountBp / 100}%`);
    nextStatus = "PENDING_APPROVAL";                                                  // :100
  }
}
```

**Step 1 — score it as a what-if, before writing anything.** `previewProposal` (`:227-240`) never touches the database's line rows. It builds an in-memory array where **one** line's `discountBp` is swapped for the proposed value (`:232`: `discountBp: l.id === lineId ? proposedBp : l.discountBp`), runs `computeTotals` (`:236`), pairs each result with the line's stored `ceilingBp` (`:237`), loads the risk weights and routing rules (`:238`), and returns `riskPreview(scoreLines(...), totals.total, rules)` (`:239`).

So the counter is judged on the order **as it would be**: the compounded effective discount, the new order margin, the new order total. Every ceiling is per line — `quotation_line.ceiling_bp` is the stricter of the customer tier's ceiling and the product category's, snapshotted when the line was added (`quotation.service.ts:109-111,151,184`; formula at `src/domain/risk.ts:20`).

**Step 2 — the verdict is the chain, not the score.** `routeApproval` (`src/domain/route.ts:28-35`) returns `[]` **if and only if** `needsReview` is false, and `needsReview` (`:7-9`) is true when *any* of these holds:

* `worstOverageBp > 0` — some line is over its own ceiling;
* `blendedOverageBp > 0` — the value-weighted overage across the order is above zero;
* `marginPenaltyBp > 0` — the order margin fell below `risk_config.floor_margin_bp` (seeded at 2000 bp = 20 %).

The last one is the one people miss: **you can break nothing but the margin floor and still trigger approval.** Every line inside its ceiling, but the blend of discounts drags the order's margin under 20 % → `penalty > 0` → `needsReview` → a chain.

Which chain? The **longest** among the routing rules that fire (`route.ts:33`), where a rule fires on score, on worst overage, or on order total (`:12-18`). With the seeded rules — "Over limit" (minScore 1, chain `[SALES_MANAGER]`, sequence 1) and "High risk or large order" (minScore 50, maxWorstOverageBp 1000, maxOrderTotal ₹10,00,000, chain `[SALES_MANAGER, FINANCE]`, sequence 2) — a small overage gets a manager, a big one gets manager **then** finance. If a violation exists but no rule fires, the lowest-sequence rule takes it anyway (`:32`), so nothing slips through unreviewed.

**Step 3 — `openApprovalRound` (`:243-258`), if and only if the chain is non-empty.**

1. `approvalRequest.updateMany` — every request on this quotation with status `PENDING` **or** `APPROVED` becomes `SUPERSEDED`, with `resolved_at = now()` and `reason` = the human sentence built at `:99` (`:244`). Superseding an *approved* request is the important half: an approval granted for the old terms must not silently cover the new ones.
2. `version = currentVersion + 1`, incremented further while a row already exists at that `(quotationId, version)` (`:245-246`) — the pair is unique in the schema (`prisma/schema.prisma`, `@@unique([quotationId, version])`).
3. `approvalRequest.create` (`:247-256`) with `riskScore`, the full `riskBreakdown` JSON, the `chain` array, and nested `approval_step` rows — one per role, `stepNo` 1..n (`:254`).
4. Returns the new version, which the caller writes to `quotation.approval_version` (`:106`).

**Step 4 — the quotation update (`:104-107`):** `status = PENDING_APPROVAL`, `version + 1`, the new `approval_version`, and `negotiation_pending = true`.

**No internal user was involved.** No rep clicked "request approval". The chain was computed from configuration rows (`risk_config`, `approval_rule`) and the customer's own number.

**The line itself is untouched.** `quotation_line.discount_bp` still holds the old value. The proposed number lives only in `portal_request.proposed_discount_bp` until somebody approves. Pinned by `src/services/__tests__/portal.service.db.test.ts:115-116`.

### C. What `negotiationPending` causes later, in `approval.service.ts`

The flag is a note left for the approval flow: *"this round exists because of a customer, so when you finish, send it back to the customer, not to the rep."*

Three places read it, all in `decide` (`src/services/approval.service.ts:30`):

1. **On rejection** (`:75`): `nextStatus = q.negotiationPending ? "SENT" : "REJECTED"`. A normally rejected quote dies; a rejected *counter* just puts the quotation back in front of the customer at the original terms.
2. **On final approval** (`:83`): `nextStatus = q.negotiationPending ? "SENT" : "APPROVED"`. Normally an approved quote sits in `APPROVED` waiting for the rep to press Send. A counter-driven approval **skips that** and goes straight to `SENT` — back to the portal, no rep step.
3. **On either resolution** (`:89-91`):
   ```ts
   if (resolved && q.negotiationPending) {
     await settleCounterOffers(tx, q.id, requestStatus === "APPROVED", user.id, note);
     if (requestStatus === "APPROVED") await recompute(tx, q.id);
   }
   ```

`settleCounterOffers` (`:120-131`) finds every `portal_request` on the quotation with `type = COUNTER_DISCOUNT` and `status = OPEN`, and for each:

* if approved **and** it has a `line_id` **and** a `proposed_discount_bp`: `quotationLine.update({ discountBp: proposedDiscountBp })` (`:124`) — **this is the moment the customer's number is written onto the line**;
* marks the request `ACCEPTED` or `DECLINED`, stamps `responded_by_id` = the approver's user id, `responded_at`, and copies the approver's note into `response_note` (`:126-129`).

Then `recompute` (`:91`) re-prices everything with the new discount and rewrites `net_total`, `tax_total`, `total`, `cost_total`, `margin_bp`, `risk_score`, `risk_breakdown`.

Finally `:96-101` clears the flag: `negotiation_pending = false` once the request is resolved.

The customer's next page load therefore shows: status "Sent", the line's discount changed to what they asked for, and their request marked Accepted with the approver's note as the reply — with no name attached (`responded_by_id` is not in the DTO).

**A middle step is not "resolved".** If the chain is `[SALES_MANAGER, FINANCE]` and only the manager has approved, `remaining.length > 0` (`:76-78`) → status stays `PENDING_APPROVAL`, `resolved` is false, nothing settles, the flag stays set. The customer keeps seeing "Awaiting internal approval".

**A "Return for revision" is different again.** `RETURN` (`:57-63`) sends the quotation to `DRAFT` and bumps `approval_version` (`:100`). `DRAFT` is not in `PORTAL_VISIBLE_STATUSES` — so from the customer's point of view the quotation *disappears from the portal* until the rep fixes and re-sends it. That is abrupt, but it is not a leak.

### D. Confirm Quotation

**Button** "Confirm Quotation" (`negotiation-form.tsx:199`) → opens a dialog (`:205-226`) → you type your full name → "Confirm Quotation" in the dialog footer (`:220`) → `doConfirm()` (`:76`) → server action `confirm` (`src/app/portal/actions.ts:56`) → `parseInput(portalConfirmSchema)` (`:57`) → `requirePortalAction()` (`:60`) → `confirmFromPortal` (`portal.service.ts:126`).

**Guards, in order** (one transaction, `:127`):

1. `loadForCustomer` (`:128`) — ownership, sent, visible status.
2. `assertActor(actor, "PORTAL_CONFIRM")` (`:130`) — `CONTACT` or `ADMIN` (`quotation.machine.ts:37`; the ADMIN entry is the "confirm on behalf" demo fallback used by the internal screen, not by this page).
3. `assertTransition(q.status, "PORTAL_CONFIRM")` (`:131`) — `SENT` or `UNDER_NEGOTIATION` only (`quotation.machine.ts:19`). From `PENDING_APPROVAL` this throws `ConflictError`: *"Illegal transition: cannot portal confirm a quotation that is pending approval"* (`src/lib/state/machine.ts:16`).
4. **Open-counter block** (`:132-134`): any `COUNTER_DISCOUNT` request with status `OPEN` → `ConflictError` "Your counter-offer is still being reviewed. Wait for the answer before confirming." You cannot lock in terms while asking for better ones.
5. `recompute` (`:136`) — re-derives totals, margin and risk from the lines **as they are right now**.
6. **The safety net** (`:140-141`):
   ```ts
   const covered = await tx.approvalRequest.findFirst({
     where: { quotationId: q.id, version: q.approvalVersion, status: "APPROVED" } });
   if (view.risk.chain.length > 0 && !covered) { … }
   ```
   Two questions: *do the current terms need approval at all?* and *is there an APPROVED approval request at this exact `approval_version`?* Only if the answer is "yes, and no" does confirmation turn into an approval round. Because every edit and every counter already opens a round, this should never fire in normal use — the comment at `:137-139` says exactly that. It exists so that a bug elsewhere cannot produce a confirmed order at unapproved terms. When it fires: `openApprovalRound` (`:142`), then `quotation.update` → `PENDING_APPROVAL`, new `approval_version`, `negotiation_pending = true`, `version + 1` (`:143`), an audit row with `action = "PORTAL_CONFIRM"` and `after = { status: PENDING_APPROVAL, chain }` (`:144`), and the DTO comes back with status "Awaiting internal approval" — the client toasts "Confirmation received. The final terms need an internal approval first." (`negotiation-form.tsx:86`).

**The normal path — tables written:**

| Table | What | Line |
|---|---|---|
| `quotation` | `status = CONFIRMED`, `confirmed_at = now()`, `confirmed_by_contact_id` = your contact id, `confirmed_name` = the name you typed, `version + 1` | `:149-152` |
| `invoice` + `invoice_line` | one ONE_TIME invoice for all non-recurring lines, numbered `INV-…`, `due_date = issue + DUE_DAYS` | `src/services/billing.service.ts:32-57` via `onConfirmedHooks` (`portal-hooks.ts:10`) |
| `subscription` + `subscription_schedule` | one per RECURRING line, status ACTIVE, with the full billing schedule | `billing.service.ts:65-95` |
| `invoice` (again) | one RECURRING invoice for each subscription's first period | `billing.service.ts:99+` |
| `fulfillment_plan` + `fulfillment_plan_line` | the proposed warehouse split, plus backorder rows with expected dates; any previous PROPOSED plan is SUPERSEDED first | `src/services/fulfillment.service.ts:57-84` via `portal-hooks.ts:11` |
| `audit_log` | `entity_type = "Quotation"`, `action = "PORTAL_CONFIRM"`, `before = { status }`, `after = { status: "CONFIRMED", confirmedName, total, invoicesCreated, planProposed }` | `portal.service.ts:154-162` |
| `quotation` (again) | `last_activity_at` | `src/lib/audit.ts:42` |

**All of it is one transaction.** `portal-hooks.ts:3` states the consequence: if the fulfillment split or an invoice fails, the confirmation itself rolls back. You never get a CONFIRMED quotation with no invoice.

**What changes on screen:** status pill becomes "Confirmed"; `canConfirm` is now false (status is no longer SENT/UNDER_NEGOTIATION, `dto.ts:58`); the request card shows "This quotation is confirmed." (`negotiation-form.tsx:96`) and every input is disabled; the Confirm card shows "Confirmed on <date>. Your order is being prepared." (`:190`).

**Honest note on "one click".** The spec says the customer *"confirms final terms with one click"* (B8's "Confirm Quotation" button; `docs/DealFlow360.txt` section 5). The build requires **two** clicks and a typed name: the button opens a dialog (`negotiation-form.tsx:199` → `setConfirmOpen(true)`), and the dialog's own button stays disabled until `fullName.trim().length >= 2` (`:220`), with the server enforcing the same via `zName` (`common.ts:33`). The reason is real — `confirmed_name` and `confirmed_by_contact_id` are the evidence of who accepted these terms, stored on `quotation` (`prisma/schema.prisma:464-465`) — but it is not one click, and the docs should not pretend otherwise.

---

## 7. Scenarios

Assume Nisha (`acme@test.com`, contact id 1, customer id 1, Acme Corp, **Gold, ceiling 15 %**) is logged in, on a `SENT` Acme quotation with two lines: Laptop 14" ×4 at 10 % (line ceiling 15 %) and Setup Service ×2 at 5 % (category ceiling 10 % beats the tier's 15 %, so `ceiling_bp = 1000`). Seeded config: `risk_config.floor_margin_bp = 2000`; rules "Over limit" → `[SALES_MANAGER]`, "High risk or large order" → `[SALES_MANAGER, FINANCE]`.

**1. A plain comment.**
Type "Is the Laptop available in 32GB RAM at this price?", leave the tab on Comment, pick the Laptop line, Submit. Zod: type COMMENT → the `else` branch at `validation/portal.ts:22` requires a message ≥ 2 chars ✓. Service: loaded ✓, actor CONTACT ✓, status SENT is allowed for PORTAL_REQUEST ✓, line belongs ✓. INSERT `portal_request` (type COMMENT, `line_id` = laptop, `proposed_discount_bp` forced to NULL by `:86`, status OPEN). `quotation.status` → `UNDER_NEGOTIATION`, `version + 1`. Audit `PORTAL_COMMENT`. **`canConfirm` stays true** — a comment does not block confirming (`dto.ts:30` only looks at COUNTER_DISCOUNT); pinned at `portal.service.db.test.ts:75`. The comment appears in the Laptop row's "Customer Comment" cell and in "Your requests".

**2. A change request with a delivery date.**
Tab "Change request", line "Whole quotation" (`negotiation-form.tsx:132` offers it for non-counter types), date `2026-10-01`, message "Can we push this to next month?". Zod: `requestedDeliveryDate` must be `YYYY-MM-DD` and a real date (`common.ts:24-30`); message required. INSERT with `line_id = NULL` and `requested_delivery_date = 2026-10-01T00:00:00Z` (`portal.service.ts:87`). Status → UNDER_NEGOTIATION, audit `PORTAL_CHANGE_REQUEST`. **You will never see that date again on the portal** — it is not a DTO key. The rep sees it on the internal quotation screen (`src/app/(internal)/quotes/[publicId]/page.tsx:304`, "Requested delivery 01 Oct 2026").

**3. A counter within every ceiling and above the margin floor.**
Setup Service 5 % → 9 %. Ceiling is 10 %, so no overage; the order margin stays above 20 %. `previewProposal` (`:96`) → `needsReview` false (`route.ts:7-9`) → `chain = []` → the `if` at `:98` is skipped. Status → `UNDER_NEGOTIATION`, `approval_version` unchanged, `negotiation_pending` stays false. The request sits `OPEN`, so `canConfirm` is now **false** (`dto.ts:30,58`) and the Confirm card explains why (`negotiation-form.tsx:194`). Nothing internal happened beyond a row and an audit line; the rep must answer. Pinned at `portal.service.db.test.ts:84-97`.

**4. A counter that breaks a ceiling.**
Setup Service 5 % → **25 %** against a 10 % ceiling. `previewProposal` → `overageBp = 1500`, score well above zero → both rules fire → the longest chain wins → `[SALES_MANAGER, FINANCE]`. Because `chain.length > 0`: `openApprovalRound` supersedes the existing PENDING/APPROVED request, creates `approval_request` v2 with `risk_score`, `risk_breakdown`, `chain`, and two `approval_step` rows (SALES_MANAGER step 1, FINANCE step 2), with `reason = "Customer counter: Setup Service to 25%"`. `quotation`: `status = PENDING_APPROVAL`, `approval_version = 2`, `negotiation_pending = true`. **`quotation_line.discount_bp` is still 500.** The customer sees "Awaiting internal approval", every input disabled (`canRequest` false, `:41`), Confirm disabled. This whole scenario is asserted at `portal.service.db.test.ts:99-120`, including that a further comment and a confirm both throw `ConflictError`.

**5. A counter that breaks only the margin floor.**
Laptop 10 % → 14 %. 14 % is under the 15 % ceiling, so `worstOverageBp = 0` and `blendedOverageBp = 0`. But the extra discount pulls the order margin under `floor_margin_bp` (2000), so `marginPenaltyBp > 0` (`src/domain/risk.ts:44`) → `needsReview` true (`route.ts:8`) → a chain. The score may still be low, so possibly no rule's `minScore` is met — then `route.ts:32` falls back to the lowest-sequence rule, "Over limit", and the chain is `[SALES_MANAGER]`. Same machinery as scenario 4: one approval step, `PENDING_APPROVAL`, `negotiation_pending = true`. **Nothing was over a ceiling and the quote still needs a manager** — that is the point of the blended score.

**6. Confirming while a counter is still open.**
The button is already disabled (`dto.canConfirm` false). If you replay the action anyway — a stale tab, a scripted POST — the server rejects at `portal.service.ts:132-134` with `ConflictError`, message "Your counter-offer is still being reviewed. Wait for the answer before confirming." The client shows it in the dialog and calls `router.refresh()` on a CONFLICT (`negotiation-form.tsx:82`). Nothing is written. Pinned at `portal.service.db.test.ts:90`.

**7. Confirming after the counter is approved.**
Manager approves step 1, Finance approves step 2. On the final approval: `remaining.length === 0` → request `APPROVED` (`approval.service.ts:80-82`) → `nextStatus = q.negotiationPending ? "SENT" : "APPROVED"` → **SENT** (`:83`) → `settleCounterOffers(accepted = true)` writes `discount_bp = 2500` onto the Setup Service line (`:124`) and marks the request `ACCEPTED` with the approver's note as `response_note` (`:126-129`) → `recompute` (`:91`) rewrites totals and risk → `negotiation_pending = false` (`:99`). Nisha reloads: status "Sent", Setup Service shows 25.00 %, her request shows Accepted with the reply, `canConfirm` is true again (SENT, no OPEN counter). She confirms; `recompute` at `:136` finds a chain (25 % is still over the ceiling) **but** `covered` at `:140` finds the APPROVED request at `approval_version = 2` — so the safety net does not fire, and the order is CONFIRMED at the discounted terms.

**8. Confirming after the counter is rejected.**
An approver rejects: request `REJECTED` (`approval.service.ts:73`), `nextStatus = q.negotiationPending ? "SENT" : "REJECTED"` → **SENT** (`:75`). `settleCounterOffers(accepted = false)` (`:90`) leaves `quotation_line.discount_bp` alone and marks the request `DECLINED` with the rejector's note (`:126-129`). `negotiation_pending = false`. Nisha sees the original 5 %, her request marked Declined with the note, status "Sent", and Confirm enabled again (no OPEN counter). Confirming now: `recompute` produces an empty chain (everything is inside its ceiling) so `view.risk.chain.length > 0` is false and the safety net at `:141` never asks about coverage. CONFIRMED at the original terms.

**9. Reading another customer's quotation by publicId.**
Rahul (`beta@test.com`, customer 2) pastes Acme's `/portal/q/PNSv0xq2Vvd0`. Middleware passes — he has a valid `df_portal`. `requirePortal()` gives `customerId = 2`. `loadForCustomer` runs `WHERE public_id = 'PNSv0xq2Vvd0' AND customer_id = 2 AND …` → no row → `NotFoundError` (`:46`) → `page.tsx:28` → `notFound()` → Next's 404 page. **He gets the same response as for a made-up id.** He learns nothing: not that the quotation exists, not who it belongs to, not its status. Pinned at `portal.service.db.test.ts:65,67` (it is also absent from his `listPortalQuotations`).

**10. Opening a quotation that was never sent.**
Nisha guesses the id of an Acme `DRAFT` the rep is still building. `customer_id` matches — but `sentAt: { not: null }` fails **and** `DRAFT` is not in `PORTAL_VISIBLE_STATUSES`. Two independent reasons, same 404. Same for an `APPROVED`-but-not-yet-sent quotation: approved internally is still not "shown to the customer". `sent_at` is stamped only by `sendToCustomer` (`order.service.ts:28`), which itself requires status `APPROVED` (`quotation.machine.ts:16`).

**11. An internal cookie against a portal URL.**
Riya, the sales rep, is logged into the workspace (`df_session`, path `/`). She opens `/portal/q/PNSv0xq2Vvd0`. Her browser sends `df_session` (path `/` matches). Middleware `:14` → `portal = true`; `:15` → not an open path; `:17` → `cookieName = "df_portal"`; `req.cookies.get("df_portal")` → `undefined`; `:19-20` cannot pass; `:35-42` redirect to `/portal/login?next=%2Fportal%2Fq%2FPNSv0xq2Vvd0`. `:41` runs only `if (token)` and `token` is undefined, so her `df_session` survives. At the login form her workspace credentials are useless — `authenticatePortal` looks in `customer_contact`, and `riya@test.com` is an `app_user`. **A rep cannot see the customer view of their own quotation.** The only thing they get is the URL, printed as text at `src/app/(internal)/quotes/[publicId]/page.tsx:245`.

**12. Two contacts at the same company, at once.**
Suppose Acme has a second contact. Both see the same quotation — scoping is by `customer_id`, not `contact_id` (`portal.service.ts:43`). Contact A submits a counter; the quote goes `PENDING_APPROVAL`. Contact B's next request hits `assertTransition` (`:74`) and gets a 409, because `PORTAL_REQUEST` is only legal from `SENT`/`UNDER_NEGOTIATION` (`quotation.machine.ts:17`). `portal_request.contact_id` records which of them asked (`:82`), and the audit row's `actor_name` is `"<contact> (<customer>)"` (`src/lib/contract.ts:183`) — but the portal never shows either.

**13. Two browser tabs, same contact, both confirm.**
Both pass their guards optimistically; both enter `prisma.$transaction`. The first commits `status = CONFIRMED`. The second re-reads inside its own transaction — `loadForCustomer` at `:128` still finds the row (CONFIRMED is in `PORTAL_VISIBLE_STATUSES`), but `assertTransition(CONFIRMED, "PORTAL_CONFIRM")` (`:131`) throws `ConflictError`, because `PORTAL_CONFIRM` is only legal from SENT/UNDER_NEGOTIATION. No double invoices. Pinned at `portal.service.db.test.ts:131`.

**14. A counter on a line that is not on this quotation.**
Someone edits the request payload to another quotation's `lineId`. Zod passes (it is a positive integer). `portal.service.ts:76` looks the id up in `q.lines` — the array from *this* quotation only — finds nothing, and `:77` throws `ValidationError` "That line is not on this quotation" with `fieldErrors.lineId = ["Pick a line from this quotation"]`. Note the ordering: the line check happens **after** `loadForCustomer`, so cross-quotation ids are already impossible.

**15. A counter of 0 %.**
`proposedDiscountBp = 0` passes `zBp` (min 0). At `:95` the condition is `input.proposedDiscountBp !== undefined`, not truthiness, so a genuine zero is scored correctly rather than silently skipped. `previewProposal` with a *lower* discount produces a smaller (or empty) chain, so the quote goes `UNDER_NEGOTIATION` and waits for the rep. Asking for less never triggers approval.

---

## 8. Schema behind this screen

```
customer ──< customer_contact ──< portal_session          (who you are)
    │                │
    └──< quotation ──┼──< quotation_line
             │       └──< portal_request >── (line_id, nullable)
             ├──< approval_request ──< approval_step      (never sent to the portal)
             ├──< invoice, subscription, fulfillment_plan (created on confirm)
             └──< audit_log
```

| Table | Columns this screen depends on | Where |
|---|---|---|
| `quotation` | `public_id` (URL), `customer_id` (scoping), `sent_at` (visibility), `status` (visibility + label), `net_total`, `tax_total`, `total` (shown), `confirmed_at`, `confirmed_by_contact_id`, `confirmed_name` (written on confirm), `approval_version`, `negotiation_pending`, `version` (internal), `cost_total`, `margin_bp`, `risk_score`, `risk_breakdown`, `rep_user_id`, `notes` (**loaded, never shown**) | `prisma/schema.prisma:439-485` |
| `quotation_line` | `description`, `qty`, `unit_price`, `discount_bp`, `tax_bp`, `total` (shown); `unit_cost`, `effective_discount_bp`, `ceiling_bp`, `gross`, `discount_amount`, `net`, `product_id`, `plan_id`, `line_type`, `source` (**loaded, never shown**) | `prisma/schema.prisma:488-…` |
| `portal_request` | `quotation_id`, `line_id` (nullable, `onDelete: SetNull`), `contact_id`, `type`, `message`, `proposed_discount_bp`, `requested_delivery_date`, `status` (default OPEN), `response_note`, `responded_by_id`, `responded_at`, `created_at`. Indexed `[quotation_id, status]` | `prisma/schema.prisma:922-943` |
| `approval_request` | `quotation_id`, `version` (unique per quotation), `status`, `risk_score`, `risk_breakdown`, `chain`, `reason`, `resolved_at` | written by `openApprovalRound` (`portal.service.ts:247`), **never read by the portal** |
| `approval_step` | `step_no`, `required_role`, `status`, `acted_by_id`, `note` | same |
| `audit_log` | `entity_type`, `entity_id`, `quotation_id`, `action`, `actor_type`, `actor_id`, `actor_name`, `actor_role`, `reason`, `before_json`, `after_json` | `src/lib/audit.ts:26-40` |
| `risk_config` | `w_worst`, `w_blended`, `w_margin`, `norm_*`, `floor_margin_bp` | read by `previewProposal` (`:238`); seeded 50/40/10, floor 2000 bp |
| `approval_rule` | `min_score`, `max_worst_overage_bp`, `max_order_total`, `chain`, `sequence` | read by `previewProposal` (`:238`); seeded rules "Over limit" and "High risk or large order" |

Enums: `PortalRequestType = COMMENT | CHANGE_REQUEST | COUNTER_DISCOUNT`; `PortalRequestStatus = OPEN | ACCEPTED | DECLINED`; `QuotationStatus` has ten values of which six are portal-visible.

*(Read-only check of the live database: `portal_request` rows 101–112 exist for contact 1, including an ACCEPTED counter at 4000 bp on quotation 554. Those were produced by earlier automated test runs, not by the seed — treat them as noise. **A freshly seeded database has zero portal-visible quotations**: `prisma/seed/a-quotes.ts` creates Q-2026-0001 and Q-2026-0004 as `DRAFT` only, so the portal list is empty until a rep approves and sends something.)*

---

## 9. How this screen connects to the others

* **Screen 11a** (`/portal/login`) — where you came from; supplies the `customerId` that scopes everything here.
* **Screen 11c** (`/portal`) — the list that links here (`portal/(customer)/page.tsx:33`, `rowHref`), and `/portal/messages`, which is this screen's request list flattened across every quotation.
* **Screen 05, Quotation Builder** (`/quotes/[publicId]`) — the internal mirror. Same quotation, opposite policy: it shows cost, margin, risk score, the approval chain, the rep, the warehouse plan, and the portal URL (`:245`). It is also where the rep answers your request, via `respondToRequestForm` (`src/app/(internal)/actions/quotation.ts:203`) → `respondToRequest` (`portal.service.ts:168`).
* **Screen 06, Approvals** — receives the `approval_request` your counter created. When the last step is approved, `approval.service.ts:83` sends the quotation back to `SENT` and `settleCounterOffers` (`:120`) writes your discount onto the line.
* **Screens 12–14, Invoices / Subscriptions / Fulfillment** — all three get their rows the instant you press Confirm, inside the same transaction (`portal-hooks.ts:9-12`).
* **Screen 09, Deal Health** — reads `quotation.last_activity_at`, which every one of your requests bumps via `src/lib/audit.ts:42`. Negotiating keeps a deal off the "stalled" list.
* **Audit trail** — every portal action appears with `actor_type = "CONTACT"` and `actor_name = "Nisha Acme (Acme Corp)"`, so an internal reviewer can see exactly which customer action started an approval round.

---

## 10. Gotchas

1. **The DTO is the security boundary, and it is one function.** `src/lib/dto/portal.ts:29-61`. If anyone ever writes `return { ...q }` there, cost, margin, risk score, risk breakdown and the rep's id all ship to the customer in one commit. The forbidden-word test (`portal.test.ts:32,42`) and the inline snapshot (`:56`) are the tripwires. Do not update the snapshot without reading what changed.
2. **The *page* is safe; the *profile page* is the seam.** Every portal route goes through the DTO except `src/app/portal/(customer)/profile/page.tsx:10`, which queries Prisma directly. See Screen 11c, Gotcha 1.
3. **"Awaiting internal approval" is load-bearing wording.** `src/lib/contract.ts:379`. Changing it to "Waiting for Sales Manager" would tell the customer the shape of your approval chain — exactly what excluding `approvalRequests` from `PORTAL_INCLUDE` was meant to prevent.
4. **`requestedDeliveryDate` is write-only.** You can type it (`negotiation-form.tsx:162`) and it is stored (`portal.service.ts:87`), but it is not a DTO key, so the portal never echoes it back. Only the internal screen shows it (`quotes/[publicId]/page.tsx:304`). It also has **no effect on anything** — no service reads it, nothing schedules against it.
5. **The counter is a proposal, not a change.** Until an approver or the rep accepts, `quotation_line.discount_bp` is untouched and the totals on screen are the old ones. Customers who expect the numbers to move when they submit a counter will be confused; the toast at `negotiation-form.tsx:67` is the only explanation they get.
6. **`PENDING_APPROVAL` freezes the portal completely.** `canRequest` is false (`:41`) *and* `assertTransition` refuses `PORTAL_REQUEST` (`portal.service.ts:74`). If an approval is never actioned, the customer has no way to withdraw or amend the counter — there is no "cancel my request" action anywhere. The only exits are an approver's decision or a rep's edit.
7. **A "Return for revision" makes the quotation vanish from the portal.** `RETURN` sends it to `DRAFT` (`approval.service.ts:62`), which is not portal-visible, so the customer's link 404s until the rep re-approves and re-sends. Not a leak, but a jarring experience with no message.
8. **"One click" is two clicks and a typed name** (`negotiation-form.tsx:199,213,220`). Deliberate — `confirmed_name` is the evidence — but it does not match the spec's wording.
9. **`canConfirm` blocks only on an open `COUNTER_DISCOUNT`.** An open COMMENT or CHANGE_REQUEST does not block confirming (`dto.ts:30`), so you can confirm an order while your "can we push delivery to next month?" question is still unanswered — and the delivery date you asked for changes nothing (see 4).
10. **The `ADMIN` entry in `PORTAL_CONFIRM`** (`quotation.machine.ts:37`) means an internal Admin can confirm on the customer's behalf. That is a demo fallback exposed on the internal screen, not here; the live database shows it was used (`confirmed_name = "Acme Corp (confirmed by Admin)"` on Q-2026-0090). Worth knowing before you claim only customers can confirm.
11. **The safety net at `:140-141` is version-scoped, not term-scoped.** It asks "is there an APPROVED request at `approval_version = N`", not "were these exact numbers approved". That is sound only because every path that changes terms also bumps `approval_version` (`quotation.service.ts:398` for edits, `openApprovalRound` for counters). If a future code path edits a line without bumping the version, the net silently stops catching.
12. **Nothing rate-limits requests.** A customer can submit unlimited comments; each writes a `portal_request` row, an `audit_log` row and bumps `last_activity_at`.
13. **The Customer Comment column shows the *latest* request touching that line, whatever its type.** `latestForLine` (`page.tsx:31`) takes the first match in a list already sorted newest-first (`portal.service.ts:37`). A counter with no message renders as "Counter 25.00%" (`page.tsx:75`), not as blank.
