# Screen 04 — Quotation detail (the builder)

URL: `/quotes/<publicId>` — e.g. `/quotes/68Ef0H_WA8wa` (seeded quotation `Q-2026-0004`).

Files this document covers:

| File | What it is |
|---|---|
| `src/app/(internal)/quotes/[publicId]/page.tsx` | the page shell — a server component, 399 lines, runs all the reads |
| `src/app/(internal)/quotes/[publicId]/_components/builder.tsx` | the editable client builder, 372 lines |
| `src/app/(internal)/quotes/[publicId]/_components/risk-card.tsx` | the "Approval preview" card, 50 lines |
| `src/components/quotes/customer-field.tsx` | the Customer + Price List header pair, 101 lines |
| `src/app/(internal)/actions/quotation.ts` | every server action this screen calls |
| `src/services/quotation.service.ts` | where the writes and the recompute actually happen |
| `src/domain/totals.ts`, `src/domain/risk.ts`, `src/domain/route.ts`, `src/domain/money.ts` | the pure arithmetic |
| `src/services/upsell.service.ts` | the suggestion ranking |

Two changes landed on this page just before this document was written and are reflected here:
a second, duplicate Customer/Price List panel was deleted (there is now exactly one, at
`page.tsx:193`), and the tier + ceiling text was removed from the page header description
(`page.tsx:173` now reads only `Rep <name> · Last activity <time>`). The tier and the
ceiling still appear — in the Price List box (`customer-field.tsx:92`).

---

## 1. What this screen is

One quotation, opened by clicking a row on Screen 3 (`/quotes`). It is the only screen in
the app where money is created. Everything downstream — approvals, the portal, warehouse
splits, invoices, subscriptions — is built from rows this screen writes.

It is really two screens sharing one URL, chosen at `page.tsx:354`:

- **Builder** (editable). Rendered when `canEdit` is true. Add products, change quantities,
  type discounts, apply an order discount, take an upsell, then press one button that
  either confirms outright or sends the quote for approval.
- **Read-only view**. Rendered when `canEdit` is false. The same lines as a plain table
  (`page.tsx:128-155`), the same Totals card, the same Approval preview card — no inputs,
  no buttons.

On top of whichever body is shown, the page always draws: the back link, the header with
status badge, the Customer/Price List pair, at most one coloured status banner, the
customer-requests panel (when there are any), and the Lines / Audit trail tabs.

The mockup (`docs/mockup/04-quotation-detail.png`) shows the Product / Qty / Price /
Discount / Limit / Status table, the yellow "Discount is checked against each line's own
limit live" note, the Upsell strip, and `Save Draft | Submit for Approval`. All of it is
here; the implementation adds the Totals card, the Approval preview card, the banners,
the requests panel and the audit tab.

The header description in the mockup ("Opened by clicking a row on the Quotations list…")
is **not** in the code — `page.tsx:173` shows rep and last-activity instead. Trust the code.

---

## 2. Who can open it, and who enforces that

Four layers, each reading the database. No role is ever trusted from the browser.

| Layer | File:line | What it does |
|---|---|---|
| 1. Middleware | `src/middleware.ts:12-43` | Runs before any HTML. Reads the `df_session` cookie, looks the token up in `session` joined to `user` (`middleware.ts:47`), checks `expiresAt > now` and `user.isActive`. No valid session → redirect to `/login?next=/quotes/<publicId>`. Only `/admin/*` has an extra role check here (`middleware.ts:25`), so `/quotes/*` is open to every logged-in role at this layer. |
| 2. Layout guard | `src/app/(internal)/layout.tsx:12` | `requireUser()` — redirects to `/login` if the session vanished between the middleware and the render. Also decides the nav tabs via `visibleNavItems(user.role)` (`src/lib/nav.ts:21`). |
| 3. Page guard | `page.tsx:38` | `requireUser(undefined, "/quotes/<publicId>")` (`src/lib/auth/internal.ts:75`). No role list is passed, so **any logged-in internal user can open any quotation**. The page then derives `canEdit` (`page.tsx:53`), `isOwner` (`page.tsx:55`) and `canRespond` (`page.tsx:57`) to decide what to render. |
| 4. Service guards | `src/services/quotation.service.ts:386-410` (`loadForEdit`) and the per-action calls | The real enforcement. Every write re-checks ownership (`assertOwnerOrAdmin`, `src/services/support.ts:12`), actor role (`assertActor`, `src/lib/state/quotation.machine.ts:66`), status (`assertTransition`, `:193`) and the optimistic version (`lockQuotation`, `support.ts:7`). Hiding a button does nothing; forging the request still fails here. |

Server actions add a fifth check of their own: `requireActionUser()` (`actions/quotation.ts:40`
and every sibling) throws `UnauthenticatedError` rather than redirecting, so the client gets
`{ ok: false, code: "UNAUTHENTICATED" }`.

### Per role

`canEdit = canTransition(q.status, "EDIT_LINES") && (q.repUserId === user.id || user.role === "ADMIN")`
— `page.tsx:53`. `EDIT_LINES` is allowed from `DRAFT, APPROVED, SENT, UNDER_NEGOTIATION`
(`quotation.machine.ts:154`).

| Role | Can open | Sees the builder | Notes |
|---|---|---|---|
| `SALES_REP` — the owner (`q.repUserId === user.id`) | yes | yes, in the four editable statuses | The normal case. Riya Rao (`riya@test.com`) owns both seeded quotations. |
| `SALES_REP` — another rep | yes | **no** | `canEdit` is false at `page.tsx:53`. Gets the read-only table. On a `DRAFT` only, one extra line appears: *"Only the owning rep (Riya Rao) can edit this draft."* — `page.tsx:369`. No Revise button (`page.tsx:177` needs `isOwner`), no Send button (`page.tsx:229`), no Accept/Decline on customer requests (`page.tsx:312` needs `canRespond`). If they POST the action anyway, `assertOwnerOrAdmin` throws `ForbiddenError` → "Only the owning sales rep or an admin can edit this quotation" (`support.ts:14`). |
| `SALES_MANAGER` | yes | no | Same read-only view as another rep. They act on this quote from `/approvals/<publicId>` instead. `assertActor` would reject `EDIT_LINES` for them anyway — `QUOTATION_ACTORS.EDIT_LINES = ["SALES_REP","ADMIN"]` (`quotation.machine.ts:172`). |
| `FINANCE` | yes | no | Same. |
| `ADMIN` | yes | yes | `isOwner` is true for an admin on any quote (`page.tsx:55`), so an admin can edit, confirm, send, revise and answer portal requests on anybody's quotation. Admin also gets the extra **Confirm on behalf** button on `SENT` / `UNDER_NEGOTIATION` (`page.tsx:247`). |
| Customer contact (portal login) | **no** | no | The middleware only accepts `df_portal` on `/portal/*`; an internal path with only a portal cookie redirects to `/login`. The customer's version of this quote is `/portal/q/<publicId>`, which serves a stripped DTO with no cost, margin, risk, ceiling or rep (`src/lib/contract.ts:389`). |

`isOwner` (`page.tsx:55`) is deliberately *not* the same as `canEdit`: `isOwner` ignores the
status. That is why a `REJECTED` quote — where `canEdit` is false, because `EDIT_LINES` is
not allowed from `REJECTED` — still shows the owner a **Revise** button (`page.tsx:177`).

---

## 3. Everything on the screen, and where each value comes from

Reference data below is the seed (`prisma/seed/*.ts`), which is what a judge sees on a fresh
`pnpm db:reset`. The dev database also holds junk from earlier test runs (extra tiers named
`TierT admmtom…`, extra products `Prod A1 …`, quotations up to `Q-2026-0344`); ignore those.

Seeded facts used throughout:

- Tiers (`b-governance.ts:6-8`): Bronze ceiling 500 bp (5 %), Silver 1000 bp (10 %), Gold 1500 bp (15 %).
- Categories (`a-catalogue.ts:9-17`): Hardware ceiling 1500 / min margin 1500, Services ceiling 1000 / min margin 2000, Subscriptions ceiling 1200 / min margin 3000.
- Products (`a-catalogue.ts:19-52`), prices in paise: Laptop 14" 6 000 000 cost 4 200 000; Laptop 16" 7 500 000 / 5 250 000; Docking Station 600 000 / 360 000; Monitor 27" 1 800 000 / 1 260 000; Setup Service 800 000 / 600 000; Training Day 1 500 000 / 1 100 000; Support Basic 50 000 / 20 000; Support Pro 100 000 / 40 000 (`isPromoted = true`). Every product has `taxBp = 1800` (schema default, `prisma/schema.prisma:330`).
- Customers (`a-customers.ts:24-26`): Acme Corp (Ahmedabad, Gold), Beta Industries (Kolkata, Silver), Gamma Retail (Pune, Bronze).
- Price rules (`a-catalogue.ts:55-60`): only two, both on Training Day — Gold 10 % off, Silver 5 % off.
- Risk config (`b-governance.ts:25-40`): wWorst 50, wBlended 40, wMargin 10, normWorst 1000, normBlended 500, normMargin 1000, floorMargin 2000.
- Approval rules (`b-governance.ts:11-23`): seq 1 "Over limit" minScore 1 → `["SALES_MANAGER"]`; seq 2 "High risk or large order" minScore 50, maxWorstOverage 1000, maxOrderTotal 100 000 000 → `["SALES_MANAGER","FINANCE"]`.

Money everywhere is **integer paise**; percentages are **integer basis points** (1250 = 12.50 %).
`src/domain/money.ts:1-3`. Nothing in this app stores a float for money.

### 3.1 Header, banners, tabs

| What you see | Example value | Which query produced it | table.column | How that value came to exist |
|---|---|---|---|---|
| Back link "← Quotations" | — | static | — | `page.tsx:168` |
| Page title | `Q-2026-0004 · Beta Industries` | `page.tsx:39-48` `prisma.quotation.findUnique({ where: { publicId } })` with `include: { customer: … }` | `quotation.number` + `customer.name` | `number` was minted by `nextNumber(tx,"quotation","Q")` — `support.ts:19` upserts the `counter` row for key `"quotation"` and formats `Q-<year>-<0000>`. The seed pre-set that counter to 4 (`a-quotes.ts:38-44`), so the next real quotation you create is `Q-2026-0005`. `customer.name` was typed when the customer was created (seed, or `createCustomer`, `quotation.service.ts:51`). |
| Title when no customer | `Q-2026-0005 · New quotation` | same | `quotation.customerId IS NULL` | `page.tsx:172`. `customerId` is nullable (`schema.prisma:443`) because "+ New Quotation" opens an empty draft first, Odoo style — `createQuotation`, `quotation.service.ts:66`, passes `customerId: customer?.id ?? null` at `:76`. |
| Description `Rep Riya Rao · Last activity 05 Sept, 14:30` | — | same query, `include: { rep: true }` (`page.tsx:43`) | `user.name` (via `quotation.rep_user_id`), `quotation.last_activity_at` | `repUserId` was set to the creating user at `quotation.service.ts:77`. `lastActivityAt` is bumped by **every audit row** that carries a `quotationId` — `src/lib/audit.ts:41-43`. So it moves whenever anything at all happens to the quote. Formatted by `formatDateTime` in Asia/Kolkata (`src/lib/format.ts:73`). |
| Status badge | `Draft` | same query | `quotation.status` | Enum default `DRAFT` (`schema.prisma:445`). Changed only by services: `confirmQuotation` (`:283`/`:309`), `loadForEdit`'s supersede (`:396`), `reviseQuotation` (`:331`), `sendToCustomer` (`order.service.ts:28`), `confirmOrder` (`order.service.ts:44`), `respondToRequest` (`portal.service.ts:202`), and the approval service. Label + colour from `STATUS` in `src/components/shared/status-badge.tsx:20-58`. |
| Red error strip | "Please fix the highlighted fields Required" | `searchParams.error` | — | Only set by the **form** actions, which redirect with `errorQuery(result)` (`contract.ts:165`): `sendToCustomerForm:180`, `confirmOnBehalfForm:186`, `respondToRequestForm:212`, `reviseQuotationForm:146`. Rendered at `page.tsx:191`. The builder's inline actions never use this — they toast instead. |
| Awaiting-approval banner | "Awaiting approval, round 1 · Sales Manager: pending · Blended risk 44." | `page.tsx:45` — `approvalRequests: { orderBy: { version: "desc" }, take: 1, include: { steps: … } }` | `approval_request.version`, `approval_step.required_role`, `approval_step.status`, `approval_request.risk_score` | Created by `confirmQuotation` at `quotation.service.ts:299-308`: one `ApprovalRequest` plus one `ApprovalStep` per role in the routed chain. Shown only when `status === "PENDING_APPROVAL"` (`page.tsx:201`). |
| Rejected banner | "Rejected. Margin too thin. Press Revise…" | same `approvalRequests` | `approval_request.reason` | Written by the approval service when a manager rejects. `page.tsx:216`. |
| Approved banner | "Approved. Routing needed Sales Manager. Send it to the customer…" | same | `approval_request.chain` (JSON `Role[]`) | `chainLabel(request.chain)` at `page.tsx:227` → `risk-card.tsx:10`. When there was no approval request at all, it prints "no approval". |
| Sent / negotiation banner with portal link | `/portal/q/68Ef0H_WA8wa` | the main query | `quotation.public_id` | `publicId()` — 12 random URL-safe chars from `src/lib/ids.ts`, generated at create time (`quotation.service.ts:74`). It is the only quote identifier ever put in a URL; the integer `id` never leaves the server. `page.tsx:245`. |
| Confirmed banner + "Open fulfillment →" | "Order confirmed by Nisha Acme." | the main query | `quotation.confirmed_name` | Set by `confirmOrder` (`order.service.ts:46`) from the portal contact's name, or, for Confirm on behalf, `"<customer> (confirmed by <admin>)"` (`order.service.ts:59`). `page.tsx:261-272`. |
| Tabs "Lines and totals" / "Audit trail" | — | `searchParams.tab` | — | `page.tsx:52` — anything other than `?tab=audit` means lines. `tabLink` at `:157`. |

### 3.2 Customer and Price List (`src/components/quotes/customer-field.tsx`)

| What you see | Example value | Which query produced it | table.column | How that value came to exist |
|---|---|---|---|---|
| Customer dropdown, current selection | `Beta Industries · Kolkata (Silver)` | `page.tsx:50` `prisma.customer.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, include: { tier: true } })` | `customer.name`, `customer.city`, `customer_tier.name` | Every non-archived customer, alphabetical. The **selected** id is `q.customerId` passed at `page.tsx:196`. `customer-field.tsx:33` copies it into local state so the `<select>` is optimistic. |
| Customer as read-only box | `Beta Industries · Kolkata` | same | same | `customer-field.tsx:79-82`, shown when `editable` (i.e. `canEdit`) is false. |
| Warning under the field | "Pick the customer first: prices and discount limits come from their tier." | — | — | `customer-field.tsx:84`, only when `current === null`. Also sets `aria-invalid` on the select (`:65`). |
| "Price List" box | `Silver price list · ceiling 10% · INR` | the same `customers` array, mapped at `page.tsx:198` | `customer_tier.name`, `customer_tier.discount_ceiling_bp` | The tier row is `customer.tierId → customer_tier`. Silver's 1000 bp comes from `b-governance.ts:7`. `formatBp(1000)` → `"10%"` (`format.ts:46`). The literal `INR` is hard-coded at `customer-field.tsx:92` — `quotation.currency` defaults to `"INR"` (`schema.prisma:446`) and is never read here. |
| Price List when no customer | "Filled from the customer's tier" | — | — | `customer-field.tsx:95`. |

This box is the *only* place the tier and the ceiling are shown on this screen. The per-line
Limit column is a different number (see 3.4).

### 3.3 The "Add products" catalogue (builder only)

| What you see | Example value | Which query produced it | table.column | How that value came to exist |
|---|---|---|---|---|
| Category chips `All · Hardware · Services · Subscriptions` | — | derived in the client from the product list — `builder.tsx:70` | `product_category.name` | Ordered by the query's `orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }]` (`page.tsx:88`), so Hardware (sortOrder 1), Services (2), Subscriptions (3). Filtering is pure client state (`builder.tsx:71`) — no round trip. |
| Product name | `Support Pro` | `page.tsx:87-97` `prisma.product.findMany({ where: { archivedAt: null }, include: { category: true } })` — **only when `canEdit`**, otherwise `[]` | `product.name` | Typed in the admin catalogue (`/admin/products`) or seeded. |
| "Promo" badge | on Support Pro | same | `product.is_promoted` | `a-catalogue.ts:51` sets `isPromoted: true`. `builder.tsx:273`. |
| Price under the name | `₹1,000.00 · Seat / month` | same | `product.list_price`, `product.unit` | `listPrice` is paise-per-unit; `formatMoney` divides by 100 and formats en-IN (`format.ts:34`). **This is the list price, not the price you will get** — the tier price rule is applied only when the line is created. |

Nothing about cost, tax or ceiling is in the picker. Those three arrive when you press Add.

### 3.4 The line table — every column

The builder's version is `builder.tsx:149-223`; the read-only version is `page.tsx:128-155`.
Both are fed from `q.lines`, ordered by `sortOrder` (`page.tsx:44`), mapped into `BuilderLine`
at `page.tsx:74-85`.

The single most important idea: **a quotation line is a snapshot.** `schema.prisma:487`
says it out loud — *"Every price input is snapshotted on the line so history survives
catalogue edits."* Price, cost, tax and ceiling are all copied onto the line at the moment
you add it. Change the catalogue tomorrow and this quote does not move.

| Column | Example value | Which query produced it | table.column | How that value came to exist |
|---|---|---|---|---|
| **Product** (name) | `Laptop 14"` | `page.tsx:44` lines include | `quotation_line.description` | Copied from `product.name` at add time — `quotation.service.ts:179` (`description: product.name`). It is a *copy*: rename the product later and this line keeps the old name. |
| Product sub-line (category · plan) | `Hardware` / `Subscriptions · Monthly` | same, `include: { product: { include: { category: true } }, plan: true }` | `product_category.name`, `recurring_plan.name` | Category is followed live through `quotation_line.product_id`, so it is *not* snapshotted. `plan` is null unless `lineType = RECURRING`. `builder.tsx:169-172`. |
| **Qty** | `2` | same | `quotation_line.qty` | Written at add (`:182`), changed by the −/+ buttons (`updateLine`, `:209`). Integer ≥ 1, enforced three times: Zod `zQty` (`validation/common.ts:18`), the service (`:207`), and a DB CHECK named `…qty_positive` (friendly message at `contract.ts:124`). |
| **Price** | `₹60,000.00` | same | `quotation_line.unit_price` | **The interesting one.** At add time (`quotation.service.ts:149-150`): `bestPricelistRule(tx, tier.id, product.categoryId, product.id)` finds the narrowest matching `pricelist_rule` — product-specific beats category beats tier-wide (`:413-419`) — then `unitPrice = applyDiscount(product.listPrice, rule.discountBp)`, else the raw `product.listPrice`. The rule's id is stored in `quotation_line.pricelist_rule_id` (`:185`). With the seed only Training Day has rules, so: Training Day for **Acme (Gold)** = 1 500 000 − 10 % = **1 350 000 paise (₹13,500)**; for **Beta (Silver)** = 1 500 000 − 5 % = **1 425 000 (₹14,250)**; for **Gamma (Bronze)** = full 1 500 000. Every other product is added at list price. |
| **Discount %** (input) | `5` | same | `quotation_line.discount_bp` | What the rep typed, in bp. Default 0 at add (`addLineSchema` default, `validation/quotation.ts:20`). The input shows `line.discountBp / 100` (`builder.tsx:197`). |
| "effective 14.5%" caption under the input | | client state | computed | Shown only when the effective discount differs from the typed one, i.e. when an order discount is in play — `builder.tsx:203`. |
| **Limit** | `10%` | same | `quotation_line.ceiling_bp` | `min(tier ceiling, category ceiling)`, with `null` category ceiling meaning "tier only" — `quotation.service.ts:151-152`, mirrored in `lineCeilingBp` (`risk.ts:45`). Beta is Silver (1000) and Laptop is Hardware (1500), so the seeded line 1 has `ceilingBp = 1000`. For Acme (Gold 1500): Hardware line = 1500, Services line = **1000** (category is stricter), Subscriptions line = 1200. |
| **Status** | `OK` / `Over +8 pt` | derived | — | `overageBp(effective, ceiling) = max(0, effective − ceiling)` (`money.ts:25`). In the read-only table it is recomputed inline (`page.tsx:150`); in the builder it prefers the live risk result returned by the last action, falling back to arithmetic on the props (`builder.tsx:87-88`). `formatPoints(800)` → `"8 pt"` (`format.ts:52`). |
| **Total** | `₹1,34,520.00` | same | `quotation_line.total` | `net + tax`, written by `recompute` (`quotation.service.ts:358`). See the arithmetic below. |
| Trash icon | | — | — | `builder.tsx:215`, calls `removeLine`. |

Two more snapshot columns you never see but that drive everything:

- `quotation_line.unit_cost` ← `product.cost` at add (`:181`). Feeds `costTotal` and therefore the margin. Never shown to a customer (`contract.ts:389`).
- `quotation_line.tax_bp` ← `product.taxBp` at add (`:183`), 1800 for every seeded product.

#### Why the Limit column is a snapshot, not a live lookup

`ceilingBp` is written in exactly two places:

1. `addLine` — `quotation.service.ts:151-152`, when the line is created.
2. `setCustomer` — `quotation.service.ts:109-111`, which loops over **every existing line** and re-derives the ceiling from the new tier.

`recompute()` (`:349-384`) rewrites `effectiveDiscountBp`, `gross`, `discountAmount`, `net`,
`tax`, `total` — but **not** `ceilingBp`. So:

- If an admin raises Silver's ceiling from 10 % to 12 % tomorrow, lines already on this quote keep 1000. Only a new line, or re-picking the customer, picks up 1200.
- That is deliberate: the quote records the limit that applied when the price was agreed, so the approval history stays truthful. It also means the Limit column is *stable* while you type — you are always compared against the same number.

#### The line arithmetic (`src/domain/totals.ts`)

Per line, in this order (`computeLineTotals`, `totals.ts:13-29`):

```
eff            = 10000 − divRound((10000 − lineBp) × (10000 − orderBp), 10000)
gross          = unitPrice × qty
discountAmount = round(gross × eff / 10000)
net            = gross − discountAmount
tax            = round(net × taxBp / 10000)
total          = net + tax
cost           = unitCost × qty
```

Order totals are plain sums of the already-rounded lines (`totals.ts:31-45`), so the total
can never disagree with the rows above it. `divRound` is half-up and sign-symmetric
(`money.ts:7-12`).

Worked, on the seeded `Q-2026-0004` (Beta, Silver): Laptop 14" ×2 at 5 %, Support Pro ×2 at 0 %,
order discount 0.

```
Laptop:  gross 6,000,000 × 2 = 12,000,000
         disc  12,000,000 × 500/10000 = 600,000
         net   11,400,000    tax 11,400,000 × 18 % = 2,052,000    total 13,452,000
Support: gross 100,000 × 2 = 200,000   disc 0   net 200,000   tax 36,000   total 236,000

grossTotal 12,200,000  discountTotal 600,000  netTotal 11,600,000
taxTotal 2,088,000     total 13,688,000       costTotal 8,480,000
marginBp = (11,600,000 − 8,480,000) × 10000 / 11,600,000 = 2690   → "26.9%"
```

Those are the exact values in the database today (`quotation.total = 13688000`,
`margin_bp = 2690`).

### 3.5 Totals card

Builder version reads client state (`builder.tsx:295-310`); read-only version reads the
stored columns (`page.tsx:377-390`). Same numbers, different source.

| What you see | Example | Source in the builder | Stored column | Origin |
|---|---|---|---|---|
| Gross | `₹1,22,000.00` | `view.totals.grossTotal` — from the last action's response | `quotation.gross_total` | `sum(unitPrice × qty)`, `totals.ts:38` |
| Discount | `− ₹6,000.00` | `view.totals.discountTotal` | `quotation.discount_total` | sum of per-line `discountAmount` |
| Discount label suffix `(order 5%)` | | read-only view only, `page.tsx:380` | `quotation.order_discount_bp` | `setOrderDiscount`, `:248` |
| Net | `₹1,16,000.00` | `view.totals.netTotal` | `quotation.net_total` | gross − discount |
| Tax | `₹20,880.00` | `view.totals.taxTotal` | `quotation.tax_total` | sum of per-line tax at each line's own `taxBp` |
| **Total** | `₹1,36,880.00` | `view.totals.total` | `quotation.total` | net + tax |
| Margin | `26.9%` | `view.totals.marginBp` | `quotation.margin_bp` | `marginBp(net, cost)` = `(net − cost) × 10000 / net`, `money.ts:21`. **Null when net is 0** — `formatBp(null)` prints `"n/a"`. Coloured amber below 2000 bp, green at or above — `builder.tsx:307`. Note that 2000 is hard-coded in that one CSS decision, while the risk engine reads `floorMarginBp` from the config row. |

`costTotal` is computed and stored (`quotation.cost_total`) but is never rendered on this screen.

### 3.6 The Approval preview card (`risk-card.tsx`)

The card is the same component on both sides of the page: `page.tsx:393` (read-only, from
`risk`) and `builder.tsx:313` (live, from `view.risk`).

Where `risk` comes from is a two-branch fallback at `page.tsx:59-72`:

```ts
const stored = (q.riskBreakdown as RiskPreview | null) ?? null;
const risk = stored ?? (q.lines.length > 0 ? riskPreview(scoreLines(…), q.total, rules) : null);
```

- **Stored** — `quotation.risk_breakdown`, a JSON blob written by `recompute` on every mutation (`quotation.service.ts:380`).
- **Recomputed** — only when the column is null. The seeded `Q-2026-0004` is exactly this case: the seed writes `riskScore: 0` but never `riskBreakdown` (`a-quotes.ts:123`), so opening it runs `scoreLines` + `riskPreview` live, using `l.effectiveDiscountBp`, `l.ceilingBp` and `l.gross` straight off the line rows plus `q.marginBp`, `q.total`, and two extra queries for the config (`loadRiskWeights`, `loadRoutingRules`).
- **Neither** — no lines and no stored blob → `risk = null` → the card prints "Add lines to see the blended risk score." (`risk-card.tsx:22`). Same text whenever `hasLines` is false, even if a stale blob exists.

The score itself, `scoreLines` (`risk.ts:58-76`), spec section 10:

```
worst    = max overage on any single line, in bp
blended  = Σ(overage_i × gross_i) / Σ(gross_i)      ← value-weighted
penalty  = max(0, floorMarginBp − orderMarginBp)
raw      = 0.50 × worst/1000  +  0.40 × blended/500  +  0.10 × penalty/1000
score    = round(100 × clamp(raw, 0, 1))
```

Every weight and normaliser is read from the `risk_config` row (`quotation.service.ts:421-426`);
the hard-coded numbers in that function are only a fallback for a missing row.

| What you see | Example | Field | Origin |
|---|---|---|---|
| Big number | `44` | `risk.score` | the formula above |
| Band badge | `Medium` | `risk.band` | `riskBand(score)` — ≥ 50 HIGH, > 0 MEDIUM, 0 LOW (`contract.ts:247`) |
| Worst line overage | `8 pt` | `risk.worstOverageBp` | largest `max(0, eff − ceiling)` across lines (`risk.ts:65`) |
| Blended overage | `0.5 pt` | `risk.blendedOverageBp` | gross-weighted mean overage (`risk.ts:66-68`). Weighted by **gross**, not by total — tax and the discount itself do not tilt the weighting. |
| Margin | `19.76%` | `risk.marginBp` | the order margin, same number as the Totals card |
| Margin penalty | `0.24 pt` | `risk.marginPenaltyBp` | `max(0, 2000 − 1976)` (`risk.ts:69`) |
| Routing sentence | "On confirm, routes to: Sales Manager" | `risk.chain` | `routeApproval` (`route.ts:119-126`) — see below. Green "Within every limit: confirm goes straight through." when the chain is empty (`risk-card.tsx:43`). |

`routeApproval` in three steps:

1. `needsReview(r)` — false unless `worst > 0 || blended > 0 || marginPenalty > 0` (`route.ts:98`). If false, return `[]` immediately. **Nothing else is even consulted.**
2. Sort the active `approval_rule` rows by `sequence`, keep the ones that fire. A rule fires if *any* of: `score ≥ minScore`, `worstOverage > maxWorstOverageBp`, `orderTotal > maxOrderTotal` (`route.ts:103-109`).
3. Take the **longest** chain among the firing rules — not the average, not the last (`route.ts:124`). If nothing fires, the lowest-sequence rule is used anyway (`:123`); if that yields nothing, the fallback `["SALES_MANAGER"]` (`:112`).

Worked, on the mockup's own example rebuilt with seeded products for **Acme (Gold)** —
Laptop 14" ×2 at 12 %, Setup Service ×1 at 18 %, order discount 0:

```
ceilings: Laptop = min(1500 Gold, 1500 Hardware) = 1500   → 1200 ≤ 1500, OK
          Setup  = min(1500 Gold, 1000 Services) = 1000   → 1800 − 1000 = 800 over  (8 pt)

gross 12,800,000  disc 1,584,000  net 11,216,000  tax 2,018,880  total 13,234,880
cost 9,000,000    marginBp = 2,216,000 × 10000 / 11,216,000 = 1976

worst   = 800
blended = (0 × 12,000,000 + 800 × 800,000) / 12,800,000 = 50      (0.5 pt)
penalty = 2000 − 1976 = 24

raw   = 0.50 × 800/1000 + 0.40 × 50/500 + 0.10 × 24/1000
      = 0.400 + 0.040 + 0.0024 = 0.4424
score = 44   → band MEDIUM

rules: seq 1 fires (44 ≥ 1). seq 2: 44 ≥ 50? no. 800 > 1000? no. 13,234,880 > 100,000,000? no.
chain = ["SALES_MANAGER"]
```

This is exactly the spec's story: the Gold customer is "allowed 15 %", but the Services line
broke its own stricter 10 % limit, and the whole quotation gets flagged.

### 3.7 Upsell and Cross-Sell panel

Computed on the server by `suggestFor(q.id)` (`page.tsx:99`, `src/services/upsell.service.ts:27`),
only when `canEdit`. It runs its own queries, outside the page's main one.

| What you see | Example | Which query | table.column | Origin |
|---|---|---|---|---|
| Product name | `Docking Station` | `upsell.service.ts:55-58` `prisma.product.findMany({ archivedAt: null, id: { notIn: cart }, OR: [{ id: { in: countedIds } }, { isPromoted: true }] })` | `product.name` | candidate set = "co-purchased with something in the cart" ∪ "promoted", minus anything already on the quote |
| Promo badge | on Support Pro | same | `product.is_promoted` | `builder.tsx:328` |
| Reason line | `Bought with Laptop 14" 14×` | `upsell.service.ts:35` `prisma.productPairing.findMany({ productId: { in: cart } })` | `product_pairing.co_count` | seeded at `a-catalogue.ts:63-70`. Plus live history: `:40-52` finds every **closed** order (`CONFIRMED / FULFILLMENT / PAID`) that shares a cart product and counts what else was on it. Both sources add into the same counter. |
| Reason when there is no history | `Currently promoted` | — | — | `upsell.service.ts:77` |
| Price | `₹6,000.00` | same | `product.list_price` | list price, no tier rule applied |
| `margin +₹2,400.00 each` | | derived | `product.list_price − product.cost` | `upsell.service.ts:72`. **This is the margin at list price with zero discount.** It ignores the customer's price rule and any discount you will apply, so it is an optimistic upper bound. Rendered green and signed by `<Money signed>` (`builder.tsx:338`). |

**Ranking** (`upsell.service.ts:80-82`): filter out anything whose *list-price* margin is
below its category's `min_margin_bp`, and anything with `score === 0`; then sort by
`score` desc, then `marginDelta` desc, then name; then `slice(0, 4)`.
`score = coCount + (isPromoted ? 5 : 0)` (`:76`).

With a fresh seed and a cart containing only Laptop 14":

| Product | coCount | promoted | score | list margin | category min | shown |
|---|---|---|---|---|---|---|
| Docking Station | 14 | no | 14 | 4000 bp | 1500 | 1st, margin +₹2,400 |
| Setup Service | 11 | no | 11 | 2500 bp | 2000 | 2nd, margin +₹2,000 |
| Monitor 27" | 7 | no | 7 | 3000 bp | 1500 | 3rd, margin +₹5,400 |
| Support Pro | 0 | yes | 5 | 6000 bp | 3000 | 4th, "Currently promoted", margin +₹600 |

The `score === 0` filter means an ordinary product with no co-purchase history and no promo
flag can never be suggested. The `min_margin_bp` filter is why Subscriptions has a 3000 bp
floor in the seed — a thin subscription would be suppressed.

**Dismiss** (`builder.tsx:332`) is client-only: it pushes the product id into a `dismissed`
array (`:66`) which filters the list (`:67`). Nothing is written. And because the `Builder`
is keyed on `${q.version}-${q.updatedAt}` (`page.tsx:356`), it remounts after every action —
so a dismissed suggestion **reappears as soon as you change anything else**.

### 3.8 Customer requests panel

Rendered whenever `q.portalRequests.length > 0` (`page.tsx:274`), in **both** modes.

| Column | Example | table.column | Origin |
|---|---|---|---|
| Type | `Counter discount` | `portal_request.type` | enum `COMMENT / CHANGE_REQUEST / COUNTER_DISCOUNT`; labels at `page.tsx:28` |
| Line | `Laptop 14"` or "Whole order" | `quotation_line.description` via `portal_request.line_id` | null `lineId` = order-level request (`page.tsx:301`) |
| Message | free text + "Requested delivery …" + "Response: …" + "by Nisha Acme" | `portal_request.message`, `.requested_delivery_date`, `.response_note`, `customer_contact.name` | written by the customer in `/portal/q/<publicId>`; `responseNote` written back by `respondToRequest` (`portal.service.ts:183`) |
| Proposed | `18%` | `portal_request.proposed_discount_bp` | only on `COUNTER_DISCOUNT` |
| Status | `Open` / `Accepted` / `Declined` | `portal_request.status` | `portal.service.ts:183` |
| Date | `05 Sept, 16:20` | `portal_request.created_at` | |
| Accept / Decline + note box | | — | only when `r.status === "OPEN" && canRespond` (`page.tsx:312`) |

Ordered newest first (`page.tsx:46`).

### 3.9 Audit trail tab

`page.tsx:101` — `prisma.auditLog.findMany({ where: { quotationId: q.id }, orderBy: { at: "desc" }, take: 100 })`,
run **only** when `tab === "audit"`. Rendered by the shared `AuditTrail`
(`src/components/shared/audit-trail.tsx`), which turns each row into one English sentence
plus a field-by-field diff of `beforeJson` → `afterJson`.

Every row was appended by `audit()` (`src/lib/audit.ts:25`) inside the same transaction as
the change, so a rolled-back write leaves no trace and a committed one always leaves one.
Columns: `audit_log.actor_name`, `.actor_role`, `.action`, `.reason`, `.before_json`,
`.after_json`, `.at`.

Actions this screen can produce: `CREATE`, `SET_CUSTOMER`, `LINE_ADD`, `LINE_UPDATE`,
`LINE_REMOVE`, `ORDER_DISCOUNT`, `SUPERSEDE_APPROVAL`, `CONFIRM`, `REVISE`, `SEND`,
`PORTAL_CONFIRM`, `REQUEST_ACCEPT`, `REQUEST_DECLINE`.

---

## 4. The queries this page runs

All on the server, all before any HTML is sent. `export const dynamic = "force-dynamic"`
(`page.tsx:25`) disables caching, so these run on every visit.

| # | file:line | Query | Always? |
|---|---|---|---|
| 0 | `page.tsx:38` | `requireUser()` → `getSessionUser()` → `session` join `user` | yes (plus the same lookup in the middleware and the layout — three session reads per page load) |
| 1 | `page.tsx:39-48` | `quotation.findUnique({ where: { publicId } })` with `customer.tier`, `rep`, `lines` (→ `product.category`, `plan`), latest `approvalRequest` + its `steps` + `actedBy`, all `portalRequests` + `line.description` + `contact.name`. One `findUnique` plus Prisma's include joins. `notFound()` at `:49` if missing. | yes |
| 2 | `page.tsx:50` | `customer.findMany({ archivedAt: null })` with `tier` — fills the dropdown | yes, even in read-only mode |
| 3 | `page.tsx:67` | `loadRiskWeights(prisma)` → `riskConfig.findUnique({ id: 1 })` | only when `riskBreakdown` is null **and** there is at least one line |
| 4 | `page.tsx:70` | `loadRoutingRules(prisma)` → `approvalRule.findMany({ isActive: true })` | same condition |
| 5 | `page.tsx:88` | `product.findMany({ archivedAt: null })` with `category` | only when `canEdit` |
| 6 | `page.tsx:99` | `suggestFor(q.id)` — internally 1 `findUniqueOrThrow` + up to 4 more queries (`upsell.service.ts:28, 35, 40, 46, 55`) | only when `canEdit` |
| 7 | `page.tsx:101` | `auditLog.findMany` take 100 | only on `?tab=audit` |

So a read-only visit is 3 queries plus maybe 2 for the risk fallback; a builder visit is
roughly 10.

Note queries 3 and 4 sit inside a ternary that is `await`ed inline (`page.tsx:60-72`) —
they are sequential, not parallel. Query 2 also runs unconditionally even though a
non-editable page renders the customer as a plain text box.

---

## 5. Every condition on this page

| Condition | file:line | What it changes |
|---|---|---|
| `!q` | `page.tsx:49` | `notFound()` → `src/app/not-found.tsx` |
| `tab = sp.tab === "audit" ? "audit" : "lines"` | `page.tsx:52` | which body renders; also whether the audit query runs |
| `canEdit` | `page.tsx:53` | Builder vs read-only table; whether the product picker and the suggestions are even queried; whether the Customer field is a `<select>` or a box |
| `isOwner` = `repUserId === user.id \|\| role === "ADMIN"` | `page.tsx:55` | Revise button (`:177`), Send to customer button (`:229`), and part of `canRespond` |
| `canRespond` = `isOwner && canTransition(status, "REP_RESPOND")` | `page.tsx:57` | Accept/Decline controls on customer requests (`:312`) and the "Read-only:" sentence (`:282`). `REP_RESPOND` is allowed only from `UNDER_NEGOTIATION` (`quotation.machine.ts:162`) — so a request raised while the quote is still `SENT` is visible but not answerable until the quote flips to `UNDER_NEGOTIATION`. |
| `stored ?? recompute ?? null` | `page.tsx:59-72` | the risk card's source: stored JSON blob, live recomputation, or nothing. Three-way, and the live branch also decides whether queries 3 and 4 run. |
| `q.customer ? … : "New quotation"` | `page.tsx:172` | page title |
| `sp.error` | `page.tsx:191` | red error strip |
| `status === "PENDING_APPROVAL" && request` | `page.tsx:201` | amber approval banner |
| `status === "REJECTED" && request` | `page.tsx:216` | red rejection banner |
| `status === "APPROVED"` | `page.tsx:223` | green approved banner + Send button (if `isOwner`) |
| `status === "SENT" \|\| "UNDER_NEGOTIATION"` | `page.tsx:240` | blue portal-link banner; **`user.role === "ADMIN"`** (`:247`) adds Confirm on behalf |
| `status ∈ {CONFIRMED, FULFILLMENT, PAID}` | `page.tsx:261` | green confirmed banner + fulfillment link |
| `portalRequests.length > 0` | `page.tsx:274` | the whole requests card |
| `r.status === "OPEN" && canRespond` | `page.tsx:312` | Accept / Decline buttons on one row |
| `audit.length === 0` | `page.tsx:347` | `EmptyState` vs the trail |
| `status === "DRAFT" && !canEdit` | `page.tsx:369` | "Only the owning rep (…) can edit this draft." |
| `hasLines` | `builder.tsx:135, 146` | "No lines yet…" vs the table; also disables Confirm (`:356`) and swaps the helper sentence (`:361`) |
| `view.risk?.chain.length` | `builder.tsx:357` | **the button relabels**: non-empty → "Submit for Approval", empty (or no risk) → "Confirm Quotation" |
| `status === "DRAFT"` inside the builder | `builder.tsx:350` | buttons vs the amber "already approved or sent" strip. Note the builder can be *editable* in APPROVED/SENT/UNDER_NEGOTIATION but shows no confirm button there, because `CONFIRM` is only legal from `DRAFT` (`quotation.machine.ts:155`). |
| `pending` (`useTransition`) | `builder.tsx:68` | disables every control, and flips "Every change is saved" → "Saving…" (`:143`) |
| `effective(line) !== line.discountBp` | `builder.tsx:203` | the "effective 14.5%" caption |
| `over > 0` | `builder.tsx:209`, `page.tsx:150` | `Over +N pt` badge vs `OK` |
| `marginBp < 2000` | `builder.tsx:307` | margin shown amber instead of green |
| `visibleSuggestions.length === 0` | `builder.tsx:320` | "No suggestions right now." |
| `r.code === "CONFLICT"` | `builder.tsx:79, 128`, `customer-field.tsx:45` | toast + `router.refresh()` to pull the new version |
| `current === null` | `customer-field.tsx:84` | the amber "Pick the customer first" hint and `aria-invalid` |
| `editable` | `customer-field.tsx:58` | `<select>` vs read-only box |
| `!risk \|\| !hasLines` | `risk-card.tsx:21` | "Add lines to see the blended risk score." |
| `risk.chain.length` | `risk-card.tsx:42` | amber "routes to: …" vs green "confirm goes straight through" |

---

## 6. Every action you can take here

Common to all of them, in this order:

1. Client calls the server action (`src/app/(internal)/actions/quotation.ts`).
2. `parseInput(schema, input)` (`contract.ts:86`) — Zod. Failure → `{ ok:false, code:"VALIDATION", fieldErrors }`, nothing touched.
3. `requireActionUser()` (`auth/internal.ts:86`) — throws `UnauthenticatedError` with no session.
4. Service function, inside `prisma.$transaction`.
5. Inside: `assertOwnerOrAdmin` → `assertActor` → `assertTransition` → `lockQuotation` (this is `loadForEdit`, `quotation.service.ts:386-410`).
6. The change, then `recompute(tx, id)`, then `audit(tx, …)`.
7. Action calls `revalidatePath("/quotes")` and returns `ok(view)`.
8. Client `run()` (`builder.tsx:73-85`) puts `{ totals, risk, version }` straight into state — the numbers move **immediately**, before any server render — then calls `router.refresh()`.

`toActionError` (`contract.ts:157`) maps thrown errors to codes, including friendly text for
Postgres CHECK violations (`contract.ts:118-132`).

### 6.1 Pick / change the customer

- **Control**: the `<select>` — `customer-field.tsx:64`.
- **Action**: `setCustomer` — `actions/quotation.ts:56`.
- **Schema**: `setCustomerSchema = { quotationId: zId, version: zVersion, customerId: zId }` — `validation/quotation.ts:13`.
- **Service**: `quotations.setCustomer` — `quotation.service.ts:99`.
- **Guards**: `loadForEdit` (owner/admin → `EDIT_LINES` actor → status in `DRAFT|APPROVED|SENT|UNDER_NEGOTIATION` → version lock). Then customer must exist and not be archived (`:102`, else `NotFoundError`).
- **Writes**: `quotation.customer_id` (`:104`). Then **for every existing line** (`:105-112`): re-run `bestPricelistRule` for the new tier, rewrite `quotation_line.unit_price`, `.ceiling_bp`, `.pricelist_rule_id`. Then `recompute` rewrites all the money columns on lines and quotation.
- **Audit**: one `SET_CUSTOMER` row, `before: { customer: old }`, `after: { customer, tier }` (`:113-121`).
- **On screen**: green toast "Customer set to Beta Industries (Silver price list)" (`customer-field.tsx:48`), then `router.refresh()` — new title, new Price List box, new prices, new Limits, new totals, new risk.

Worth being precise about what re-prices: **`unitPrice` and `ceilingBp` change; `discountBp`
does not.** A 12 % line discount survives a move from Gold to Bronze and instantly becomes
7 points over the new 500 bp ceiling.

### 6.2 Add a product from the catalogue

- **Control**: "+ Add" — `builder.tsx:279`, sends `{ productId, qty: 1, discountBp: 0, source: "MANUAL" }`.
- **Action**: `addLine` — `actions/quotation.ts:68`. **Schema**: `addLineSchema` — `validation/quotation.ts:15`.
- **Service**: `quotation.service.ts:127`.
- **Guards in order**: `loadForEdit` → product exists and not archived (`:130`) → qty is a whole number ≥ 1 (`:135`) → if `kind === SUBSCRIPTION`, resolve a plan or throw (`:139-145`) → **a customer must be set** (`:147`: *"Pick a customer first: prices and discount limits depend on the customer's tier"*).
- **What is captured** (`:149-152`, `:171-188`): `unitPrice` from the best price rule, `unitCost = product.cost`, `taxBp = product.taxBp`, `ceilingBp = min(tier, category)`, `pricelistRuleId`, `description = product.name`, `lineType`, `source`, `sortOrder = count + 1`.
- **Already on the quote?** `:154` looks for a line with the same `(quotationId, productId, planId)`. If found it **increments qty** instead of creating a row, and only overwrites `discountBp` when the incoming one is > 0 (`:158`) — from the catalogue it is always 0, so your typed discount survives. Audit action is `LINE_UPDATE`, not `LINE_ADD`.
- **Audit**: `LINE_ADD` with `{ product, qty, discountBp, unitPrice, source, priceRule: rule.note }` (`:189-196`), or `LINE_UPDATE`.
- **On screen**: totals, margin and the risk card jump immediately from the action's response; the new row itself appears after `router.refresh()`.

### 6.3 − / + quantity

`builder.tsx:92-96`. `qty + delta`; **if the result is ≤ 0 it calls `removeLine` instead of
`updateLine`** — pressing − on a qty-1 line deletes it. `updateLine` → `updateLineSchema`
(`validation/quotation.ts:25`) → `quotation.service.ts:202`. Guards: `loadForEdit`, line
belongs to this quote (`:205`), qty integer ≥ 1 (`:207`), at least one field to change (`:212`).
Writes `quotation_line.qty`, then `recompute`. Audit `LINE_UPDATE` with before/after
`{ product, qty, discountBp }`.

### 6.4 Edit a line discount

The input is a local draft (`builder.tsx:64`, `:197-198`), committed on **blur** or **Enter**
(`:199-200`). `commitDiscount` (`:98-112`): `percentToBp` (`:38`) rejects anything outside
0–100 with a toast and no request; if the value is unchanged, no request either. Otherwise
`updateLine({ discountBp })`.

Validation is layered: client `percentToBp`, Zod `zBp` 0–10000 (`validation/common.ts:7`),
and the DB CHECK `…discount_bp_range` → "Discount must be between 0 and 100 percent"
(`contract.ts:119`).

Writes `quotation_line.discount_bp`; `recompute` then rewrites `effective_discount_bp` and
all the money. Audit `LINE_UPDATE`.

### 6.5 Remove a line

Trash icon → `removeLine` (`builder.tsx:215`) → `actions/quotation.ts:92` →
`quotation.service.ts:227`. `loadForEdit`, line must belong to the quote, `delete`, `recompute`.
Audit `LINE_REMOVE` with `before` only. Removing the last line leaves `netTotal = 0`, so
`marginBp` becomes null and the Totals card prints `n/a`.

### 6.6 Order discount

Input + "Apply" — `builder.tsx:228-241`. `applyOrderDiscount` (`:114-121`) → `setOrderDiscount`
(`actions/quotation.ts:104`) → `quotation.service.ts:245`. Writes `quotation.order_discount_bp`,
`recompute`, audit `ORDER_DISCOUNT` with before/after.

**How the two discounts compound** — `effectiveDiscountBp` (`totals.ts:9`):

```
eff = 10000 − round((10000 − lineBp) × (10000 − orderBp) / 10000)
```

Multiplicative, not additive. 10 % line + 10 % order = **19 %**, not 20 %:
`10000 − (9000 × 9000 / 10000) = 10000 − 8100 = 1900`.

`eff` is what every ceiling is tested against (`risk.ts:63`) and what the money is computed
from (`totals.ts:14-16`). The Limit column does not move, so an order discount can push a
line over its limit without you touching that line. On `Q-2026-0004`, applying 10 % order
discount takes the 5 % Laptop line to `eff = 1450` against a 1000 ceiling — 4.5 pt over —
and drives the score from 0 to 59 with a Sales Manager + Finance chain (worked out in
scenario 3 below).

### 6.7 Add an upsell

"+ Add to Quote" — `builder.tsx:340`. Same `addLine` action, only difference is
`source: "UPSELL"`, stored in `quotation_line.source` (`schema.prisma:494`) and echoed into
the audit row. That is how reports can later tell how much revenue the suggestions produced.

### 6.8 Dismiss an upsell

`builder.tsx:332`. Client state only. No action, no write, not remembered across a refresh
(and every other action forces a remount — see 3.7).

### 6.9 Save Draft

`builder.tsx:353`. **It is a `<Link href="/quotes">`, not a button.** There is nothing to
save: every edit already committed. The tooltip says so — *"Every change is already saved;
go back to the list"*. The mockup shows a button; the implementation makes it navigation.

### 6.10 The one confirm button

`builder.tsx:356-358`. Label flips on `view.risk?.chain.length`:

- chain empty → **"Confirm Quotation"**
- chain non-empty → **"Submit for Approval"**

Disabled while `pending` or when there are no lines. Underneath, the helper line (`:361`)
reads "Add a line to confirm.", or "Routes automatically to: Sales Manager → Finance", or
"Within every limit: approves immediately, no approval step needed."

Both labels call the **same** action, `confirmQuotation` (`builder.tsx:125` →
`actions/quotation.ts:117` → `quotation.service.ts:267`). The rep never chooses a
destination; routing does.

Guards, in order (`:269-276`): quotation exists → `assertOwnerOrAdmin` → `assertActor(…, "CONFIRM")`
(SALES_REP or ADMIN only) → `assertTransition(status, "CONFIRM")` (**DRAFT only**) →
customer must be set (`:274`) → at least one line (`:275`) → `lockQuotation`.

Then `recompute` runs one final time (`:278`) — the decision is made on freshly computed
numbers, never on what the browser sent.

- **Chain empty** (`:282-292`): `quotation.status = APPROVED`. Audit `CONFIRM` with `after: { status: "APPROVED", score, chain: [] }`. Returns `{ chain: [], requestId: null }`. Toast: "Approved. No approval was required."
- **Chain non-empty** (`:295-318`): pick an unused `approvalVersion` (`:297-298`), create one `approval_request` (`version`, `risk_score`, `risk_breakdown` = the whole preview JSON, `chain`) plus one `approval_step` per role with `stepNo` 1..n (`:306`); set `quotation.status = PENDING_APPROVAL` and `quotation.approval_version`. Audit `CONFIRM` with `after: { status, score, chain, requestId, approvalVersion }`. Toast: "Sent for approval: Sales Manager → Finance".

Both branches also `revalidatePath("/approvals")` (`actions/quotation.ts:123`), so the
approvals screen updates.

### 6.11 Send to customer

Green Approved banner, owner or admin only — `page.tsx:230`. A plain `<form action=…>` with
hidden `quotationId`, `version`, `publicId`. `sendToCustomerForm` (`actions/quotation.ts:177`)
→ `sendToCustomer` (`:151`) → `orders.sendToCustomer` (`order.service.ts:20`). Guards:
owner/admin, actor `SEND` (SALES_REP or ADMIN), transition `SEND` (**APPROVED only**),
version lock. Writes `quotation.status = SENT` and `quotation.sent_at`. Audit `SEND`.
Redirects back to the same page (with `?error=` on failure).

### 6.12 Confirm on behalf (admin only)

Blue Sent/Negotiation banner, `user.role === "ADMIN"` — `page.tsx:248`.
`confirmOnBehalfForm` (`actions/quotation.ts:183`) → `confirmOnBehalf` (`:164`), which calls
`requireActionUser(["ADMIN"])` — the role check is in the action, not the service.
`orders.confirmOnBehalf` (`order.service.ts:54`) locks the version then delegates to
`confirmOrder` (`:39`): `assertActor(actor, "PORTAL_CONFIRM")` — ADMIN is explicitly allowed
there as the demo fallback (`quotation.machine.ts:181`) — `assertTransition` (SENT or
UNDER_NEGOTIATION), then `status = CONFIRMED`, `confirmed_at`, `confirmed_name =
"<customer> (confirmed by <admin>)"`, and `onConfirmedHooks` runs the warehouse split
proposal and billing inside the same transaction (`order.service.ts:48`). Audit
`PORTAL_CONFIRM`. Also `revalidatePath("/fulfillment")`.

### 6.13 Revise

Header button, `status === "REJECTED" && isOwner` — `page.tsx:178`. `reviseQuotationForm`
(`actions/quotation.ts:143`) → `reviseQuotation` (`quotation.service.ts:323`). Guards:
owner/admin, actor `REVISE` (SALES_REP/ADMIN), transition `REVISE` (**REJECTED only**),
version lock. Writes `status = DRAFT` and `approval_version += 1` — the increment is what
lets the next confirm create a fresh `approval_request` without colliding on the
`(quotationId, version)` unique key. Audit `REVISE`.

### 6.14 Accept / Decline a customer request

`page.tsx:313-324`, one form per row, two submit buttons carrying `decision=ACCEPT|DECLINE`.
`respondToRequestForm` (`actions/quotation.ts:203`) → `respondToRequest` (`:190`) →
`portal.service.ts:168`. Guards: owner/admin, actor `REP_RESPOND`, transition `REP_RESPOND`
(**UNDER_NEGOTIATION only**), request exists and is `OPEN` (`:178`).

Note: this path does **not** take a `version` — there is no optimistic lock here, unlike
every other write on this screen.

Writes `portal_request.status`, `.response_note`, `.responded_by_id`, `.responded_at` (`:181-184`).
Then the interesting branch (`:189-197`): if it was an **ACCEPT** of a `COUNTER_DISCOUNT` with
a line and a proposed bp, the line's `discount_bp` is overwritten with the customer's number,
`recompute` runs, and **if the new chain is non-empty the quote goes back into approval** —
`openApprovalRound` supersedes the old request and creates a new one with reason "Rep accepted
a customer counter above the ceiling" (`:194`), status becomes `PENDING_APPROVAL`,
`negotiation_pending = true`.

Otherwise the quote returns to `SENT`, or stays `UNDER_NEGOTIATION` if any other request is
still open (`:198-201`). `version` is incremented directly (`:204`). Audit `REQUEST_ACCEPT` /
`REQUEST_DECLINE` with the note as `reason`.

---

## 7. Scenarios

All numbers below are computed with the seeded config (weights 50/40/10, normalisers
1000/500/1000, floor 2000; rules seq 1 minScore 1 → Manager, seq 2 minScore 50 /
worst > 1000 / total > 100 000 000 → Manager + Finance).

### 1. Everything within limits — confirm goes straight through

Beta Industries (Silver, 1000 bp). The seeded `Q-2026-0004`: Laptop 14" ×2 at 5 %, Support
Pro ×2 at 0 %.

Ceilings: Laptop `min(1000, 1500) = 1000`; Support Pro `min(1000, 1200) = 1000`. Both lines
`OK`. Totals as computed in 3.4: total ₹1,36,880.00, margin 2690 (26.9 %).

Risk: worst 0, blended 0, penalty `max(0, 2000 − 2690) = 0` → **score 0, band LOW**.
`needsReview` false → chain `[]`.

Screen: green "Within every limit: confirm goes straight through.", button reads
**"Confirm Quotation"**. Press it → `status = APPROVED` in one transaction, no approval
request created, toast "Approved. No approval was required." The green Approved banner and
a **Send to customer** button appear.

(Because the seed leaves `risk_breakdown` NULL for this quote, the card you see on first
open is the *recomputed* branch at `page.tsx:63` — see scenario 12's note.)

### 2. One line over its limit — the mockup's own case

Acme Corp (Gold, 1500). Laptop 14" ×2 at 12 %, Setup Service ×1 at 18 %.

```
Laptop: ceiling min(1500,1500)=1500, eff 1200 → OK
Setup : ceiling min(1500,1000)=1000, eff 1800 → over 800 bp = 8 pt

total 13,234,880 (₹1,32,348.80)   margin 1976 (19.76%)
worst 800, blended 50, penalty 24
raw = 0.5×0.800 + 0.4×0.100 + 0.1×0.024 = 0.4424 → score 44, MEDIUM
seq 1 fires (44 ≥ 1); seq 2 does not → chain ["SALES_MANAGER"]
```

Screen: Setup Service row shows `Over +8 pt` in red, the Laptop row `OK`. Approval preview
shows 44 / Medium / worst 8 pt / blended 0.5 pt / margin 19.76% / penalty 0.24 pt and
"On confirm, routes to: Sales Manager". Button reads **"Submit for Approval"**.

Press it → `approval_request` version 1, `risk_score 44`, `chain ["SALES_MANAGER"]`, one
`approval_step` (stepNo 1, requiredRole SALES_MANAGER, status PENDING); quotation
`PENDING_APPROVAL`. Amber banner appears. `canEdit` is now **false** (PENDING_APPROVAL is
not in the `EDIT_LINES` list), so the builder is replaced by the read-only table.

### 3. Over several limits at once, none of them alarming alone

Acme (Gold). Laptop 14" ×1 at 17 %, Monitor 27" ×2 at 17 %, Setup Service ×1 at 12 %.

```
Laptop  ceiling 1500, eff 1700 → over 200   gross 6,000,000
Monitor ceiling 1500, eff 1700 → over 200   gross 3,600,000
Setup   ceiling 1000, eff 1200 → over 200   gross   800,000

worst   = 200                        (2 pt — looks harmless)
blended = 200 (all three equal)      (2 pt)
net 8,672,000  cost 7,320,000  margin 1559  → penalty 441

raw = 0.5×0.200 + 0.4×0.400 + 0.1×0.441 = 0.100 + 0.160 + 0.0441 = 0.3041
score = 30, MEDIUM → chain ["SALES_MANAGER"]
```

This is the "why blended" point from spec section 10: the worst line alone contributes only
10 points of score, but the pattern across the order contributes 16 more. Three lines each
2 points over score higher than one line 4 points over would.

**The order-discount variant.** Take `Q-2026-0004` untouched and type 10 into Order discount:

```
Laptop  eff = 10000 − round(9500 × 9000 / 10000) = 1450, ceiling 1000 → over 450
Support eff = 1000, ceiling 1000 → over 0

gross 12,200,000  disc 1,760,000  net 10,440,000  tax 1,879,200  total 12,319,200
cost 8,480,000  margin 1877  → penalty 123
worst 450, blended = 450 × 12,000,000 / 12,200,000 = 443

raw = 0.5×0.450 + 0.4×0.886 + 0.1×0.123 = 0.225 + 0.3544 + 0.0123 = 0.5917
score = 59 → HIGH
seq 1 fires (59 ≥ 1); seq 2 fires (59 ≥ 50) → longest chain wins
chain = ["SALES_MANAGER", "FINANCE"]
```

One number typed into one box turned a clean quote into a two-step approval, and the Laptop
row's own Discount input still says `5`. The "effective 14.5%" caption under it
(`builder.tsx:203`) is the only visible warning before the Status badge flips to `Over +4.5 pt`.

### 4. Margin floor breached with no ceiling broken

Acme (Gold). Setup Service ×1 at exactly 10 % — its ceiling. Nothing is over.

```
gross 800,000  disc 80,000  net 720,000  tax 129,600  total 849,600  cost 600,000
margin = 120,000 × 10000 / 720,000 = 1667  (16.67 %)
worst 0, blended 0, penalty = 2000 − 1667 = 333

raw = 0.5×0 + 0.4×0 + 0.1×0.333 = 0.0333 → score 3, band MEDIUM
needsReview: worst 0, blended 0, but penalty 333 > 0 → TRUE
seq 1 fires (3 ≥ 1) → chain ["SALES_MANAGER"]
```

Every line badge says `OK`, the margin shows amber (below 2000 — `builder.tsx:307`), and the
button still reads **"Submit for Approval"**. The reason is in the "Margin penalty" row of
the risk card, nowhere else. This is the case a newcomer misreads most often.

### 5. Editing after approval — the edit withdraws the approval

Quote is `APPROVED`. `EDIT_LINES` *is* allowed from `APPROVED` (`quotation.machine.ts:154`),
so the owner still sees the builder — but with the amber strip at `builder.tsx:365`:
*"This quotation is already approved or sent. Any edit withdraws the approval and returns it
to Draft for a new round."* No confirm button, because `status !== "DRAFT"` (`:350`).

Press + on any line. `loadForEdit` (`quotation.service.ts:393`) sees the status is in
`EDIT_SUPERSEDES_APPROVAL` (`quotation.machine.ts:189` = APPROVED, SENT, UNDER_NEGOTIATION)
and, before the edit lands:

- every `PENDING` approval request → `SUPERSEDED` with `resolvedAt` (`:395`)
- `quotation.status = DRAFT`, `approval_version += 1`, `negotiation_pending = false` (`:396-399`)
- audit row `SUPERSEDE_APPROVAL` with before/after status and approval version (`:400-408`)

then the qty change and the recompute run. After the refresh the badge says Draft, the green
banner is gone, and the confirm button is back. The same applies to a `SENT` quote — the
customer's link keeps working but the quote is a draft again.

### 6. Stale version conflict

Two tabs open on the same quote, both rendered at `version = 3`.

Tab A presses +. `lockQuotation` (`support.ts:7`) runs
`updateMany({ where: { id, version: 3 }, data: { version: { increment: 1 } } })` — 1 row
matched, version is now 4, the edit proceeds. Tab A's client state takes `version: 4` from
the response (`builder.tsx:82`).

Tab B presses +, still sending 3. `updateMany` matches 0 rows → `ConflictError("This
quotation was changed by someone else. Refresh and try again.")`. The action returns
`{ ok:false, code:"CONFLICT" }`; the client toasts the message and calls `router.refresh()`
(`builder.tsx:79`), which re-renders the page at version 4 and remounts the builder via the
`key` (`page.tsx:356`). Tab B's typed-but-uncommitted discount draft is lost; nothing in the
database was touched.

`respondToRequest` is the one write on this screen that has **no** version lock.

### 7. Another rep's quote

Arjun (`arjun@test.com`, SALES_REP) opens Riya's `Q-2026-0004`. Middleware, layout and page
guards all pass — any internal user may *read* any quote. `canEdit` is false, so:

- read-only table (`page.tsx:368`), no inputs, no trash icons
- no Add products card, no upsell panel — those queries never even ran (`page.tsx:87, 99`)
- Customer is a text box, not a dropdown (`customer-field.tsx:79`)
- on a DRAFT, the line "Only the owning rep (Riya Rao) can edit this draft." (`page.tsx:369`)
- no Revise, no Send to customer, no Accept/Decline

If Arjun forges an `addLine` call with the right ids, `assertOwnerOrAdmin`
(`quotation.service.ts:389`) throws `ForbiddenError` → `{ ok:false, code:"FORBIDDEN",
message:"Only the owning sales rep or an admin can edit this quotation" }`.

Meera (SALES_MANAGER) sees the same read-only page, minus the "owning rep" line? No — that
line only depends on `status === "DRAFT" && !canEdit`, so she sees it too. Her real
workspace for this quote is `/approvals/<publicId>`.

### 8. No customer picked

"+ New Quotation" creates a draft with `customer_id = NULL` (`quotation.service.ts:76`), then
redirects here (`actions/quotation.ts:53`). You see:

- title `Q-2026-0005 · New quotation` (`page.tsx:172`)
- the Customer select on "Select a customer…", `aria-invalid`, amber hint "Pick the customer first: prices and discount limits come from their tier." (`customer-field.tsx:84`)
- Price List: "Filled from the customer's tier"
- the builder **is** rendered — DRAFT + owner — with the full product catalogue

Press Add on any product and the action fails: `addLine` throws at `quotation.service.ts:147`
→ toast *"Pick a customer first: prices and discount limits depend on the customer's tier
Required"* (message + the `customerId` field error, joined at `builder.tsx:77`). Nothing is
written. Same guard again at confirm time (`:274`).

The upsell panel is not empty here, incidentally: with an empty cart the co-purchase map is
empty, so the only candidates are promoted products — Support Pro alone, reason "Currently
promoted" (`upsell.service.ts:56, 77`).

### 9. No lines

Fresh draft with a customer. `hasLines` false (`builder.tsx:135`):

- "No lines yet. Add products from the catalogue below." (`:147`)
- Totals card all zeros, Margin `n/a` (net is 0 → `marginBp` returns null, `money.ts:22`)
- Approval preview: "Add lines to see the blended risk score." — even though `risk` may be a stored blob, because `hasLines` gates it (`risk-card.tsx:21`)
- Confirm button **disabled** (`:356`), caption "Add a line to confirm."

Bypassing the disabled button hits `quotation.service.ts:275`: *"Add at least one line before
confirming"*.

### 10. Changing the customer after lines exist

Quote has Training Day ×1 for **Acme (Gold)**. `bestPricelistRule` found rule 1 (Gold, product
Training Day, 10 %), so the line stored `unitPrice = 1,350,000` and `ceilingBp = min(1500, 1000)
= 1000`.

Switch the customer to **Gamma Retail (Bronze)**. `setCustomer` loops the lines
(`quotation.service.ts:105-112`):

- new best rule for Bronze + Training Day: **none** (only Gold and Silver rules exist) → `unitPrice = product.listPrice = 1,500,000`. **The price goes up.**
- `ceilingBp = min(500 Bronze, 1000 Services) = 500`
- `pricelistRuleId = null`

`discountBp` is untouched. If the rep had typed 12 %, the line is now `eff 1200` against a
`500` ceiling — **7 points over** — and a quote that routed to nobody now routes to a Sales
Manager. Toast says only "Customer set to Gamma Retail (Bronze price list)"; the Limit column
and the Status badges are where you actually see it.

### 11. A subscription line, and what happens about the plan

Add Support Pro (`kind = SUBSCRIPTION`). `addLine` (`quotation.service.ts:137-145`):

1. `input.planId` given? The builder never sends one (`builder.tsx:279`).
2. Else `product.plans[0]` — plans whose `product_id` equals this product, lowest id. The seed creates none.
3. Else the first global plan (`product_id IS NULL`, lowest id) — **Monthly** (`a-plans.ts:6`).
4. If still none → `ValidationError("Pick a recurring plan for this subscription product", { planId: ["Required"] })`.

So on a seeded database a subscription always silently gets **Monthly**. The line is written
with `lineType = RECURRING` and `planId = 1`; the sub-line under the product name reads
`Subscriptions · Monthly` (`builder.tsx:171`). The plan matters later, not here: on confirm,
`onConfirmedHooks` materialises a `Subscription` and its billing schedule from
`recurring_plan.periods` / `interval`.

Delete every recurring plan in the admin area and the fourth branch fires — the Add button
toasts "Pick a recurring plan for this subscription product Required" with no way to supply
one from this screen. That is a genuine dead end in the UI.

### 12. Stale stored risk vs. recomputed risk

`page.tsx:59` prefers `quotation.risk_breakdown` and only recomputes when it is null. That
blob was written by the last `recompute` (`quotation.service.ts:380`) using the config and
rules **as they were at that moment**.

- Seeded `Q-2026-0004` has `risk_breakdown = NULL` and `risk_score = 0` (`a-quotes.ts:123` sets only the score). Opening it takes the recompute branch, runs two extra queries, and produces the same 0 — consistent, by luck.
- Now suppose an admin lowers Silver's… no: the *ceiling* is snapshotted on the line, so that changes nothing. Suppose instead the admin raises `floorMarginBp` from 2000 to 3000 in `/admin/risk`. A DRAFT that was last recomputed yesterday still shows its old score and its old empty chain. The card is stale until the next edit.
- The stored blob is only ever advisory. `confirmQuotation` calls `recompute` again (`:278`) and routes off *that*, so what actually happens can differ from what the card promised. The screen can say "Confirm goes straight through" and the confirm can still land in `PENDING_APPROVAL`. Touch any line first and the two agree again.

### 13. A big order that needs nobody

Laptop 14" ×20 at 0 % discount, for Acme.

```
gross 120,000,000  disc 0  net 120,000,000  tax 21,600,000  total 141,600,000 (₹14,16,000)
cost 84,000,000  margin 3000 (30 %)
worst 0, blended 0, penalty 0
```

`needsReview` is false (`route.ts:98`) → `routeApproval` returns `[]` **without ever looking
at the rules** (`:120`). Rule seq 2's `maxOrderTotal` of 100 000 000 would have fired on a
₹14.16 lakh order — but it is never consulted. The button reads "Confirm Quotation" and the
quote is approved instantly.

The `maxOrderTotal` and `maxWorstOverageBp` conditions can only *escalate* a quote that is
already in trouble; they can never pull a clean one into approval. Worth knowing before a
judge asks.

### 14. A wildly over-limit line pins the score at 100

Acme, Setup Service ×1 at 30 % (ceiling 1000).

```
eff 3000, over 2000 (20 pt).  net 560,000, cost 600,000 → margin −714 (a loss)
penalty = 2000 − (−714) = 2714
raw = 0.5 × 2000/1000 + 0.4 × 2000/500 + 0.1 × 2714/1000 = 1.0 + 1.6 + 0.2714 = 2.87
score = round(100 × clamp(2.87, 0, 1)) = 100 → HIGH
```

Both rules fire — seq 2 on `score ≥ 50` *and* on `worst 2000 > 1000` — longest chain wins:
`["SALES_MANAGER", "FINANCE"]`. Two approval steps are created, and Finance cannot act until
the Manager step is decided (`assertCanDecide`, `approval.machine.ts:48`).

Because the score clamps at 100, a 20-point overage and a 200-point overage look identical on
this card. The "Worst line overage" row is the only place the difference shows.

### 15. Adding a product that is already on the quote

Laptop 14" is on the quote at qty 2 and 12 % discount. Press "+ Add" on Laptop 14" in the
catalogue. `addLine` finds the existing line by `(quotationId, productId, planId = null)`
(`quotation.service.ts:154`) and updates it to `qty = 3`. Because the catalogue's Add always
sends `discountBp: 0`, the `discountBp > 0` condition at `:158` is false and **your 12 %
survives**. Audit row is `LINE_UPDATE`, before `{qty: 2, discountBp: 1200}`, after
`{qty: 3, discountBp: 1200, source: "MANUAL"}`. No duplicate row is ever created, and
`sortOrder` does not change.

A subscription is matched on `planId` too, so the same product on two different plans is two
lines.

### 16. Customer counters, rep accepts, quote goes back to approval

Quote is `SENT` at 5 % on the Laptop line. The contact opens `/portal/q/<publicId>` and
counters at 18 %. That writes a `portal_request` (type `COUNTER_DISCOUNT`, `line_id`,
`proposed_discount_bp = 1800`) and flips the quote to `UNDER_NEGOTIATION`.

Back here: the blue banner says "Under negotiation.", the Customer requests card lists the
row with Proposed `18%` and status `Open`, and — because `canRespond` is true (owner +
UNDER_NEGOTIATION) — Accept / Decline buttons plus a note box.

Press **Accept**. `respondToRequest` (`portal.service.ts:189-197`) writes `discount_bp = 1800`
on the line, recomputes, and finds the chain is non-empty (Beta is Silver, ceiling 1000, so
18 % is 8 points over). It supersedes the old approval request, opens a new round with
reason "Rep accepted a customer counter above the ceiling", sets `PENDING_APPROVAL` and
`negotiation_pending = true`. The screen comes back with the amber approval banner and the
read-only table.

Press **Decline** instead and only the request row changes: status `Declined`, your note
under the message, and the quote returns to `SENT` — unless another request is still open,
in which case it stays `UNDER_NEGOTIATION` (`portal.service.ts:198-201`).

---

## 8. Schema behind this screen

`prisma/schema.prisma`. Every money column is `Int` paise; every percentage is `Int` bp.

**`quotation`** (`:439`) — one row per quote.
`public_id` (the URL), `number`, `customer_id` (**nullable**, `:443`), `rep_user_id`, `status`,
`order_discount_bp`, the six computed money columns (`gross_total`, `discount_total`,
`net_total`, `tax_total`, `total`, `cost_total`), `margin_bp` (nullable), `risk_score`,
`risk_breakdown` (Json), `approval_version`, `version` (optimistic lock), `negotiation_pending`,
`promised_date`, `sent_at`, `confirmed_at`, `confirmed_by_contact_id`, `confirmed_name`,
`last_activity_at`. Indexed on `status`, `(rep_user_id, last_activity_at)`, `customer_id`.

**`quotation_line`** (`:488`) — the snapshot table, and the heart of this screen.
Inputs snapshotted at add time: `description`, `unit_price`, `unit_cost`, `tax_bp`,
`ceiling_bp`, `pricelist_rule_id`, `line_type`, `source`, `plan_id`.
Rep-controlled: `qty`, `discount_bp`.
Derived, rewritten by `recompute` on every mutation: `effective_discount_bp`, `gross`,
`discount_amount`, `net`, `tax`, `total`.
`sort_order` fixes the display order. `onDelete: Cascade` from the quotation.

**`customer`** (`:236`) → **`customer_tier`** (`:223`, `discount_ceiling_bp`) — half of the Limit.

**`product`** (`:320`, `list_price`, `cost`, `tax_bp`, `is_promoted`, `unit`, `archived_at`)
→ **`product_category`** (`:306`, `discount_ceiling_bp` **nullable**, `min_margin_bp`) — the
other half of the Limit, and the upsell floor.

**`pricelist_rule`** (`:356`) — `(tier_id, category_id?, product_id?, discount_bp, note)`.
Narrowest match wins. Sets `unit_price`.

**`product_pairing`** (`:375`) — `(product_id, paired_product_id, co_count)`. Upsell ranking.

**`recurring_plan`** (`:723`) — `interval`, `periods`, `proration_mode`, `bill_change_day`,
`cancel_policy`, `refund_method`, optional `product_id`.

**`risk_config`** (`:408`) — singleton id 1. The weights, normalisers and `floor_margin_bp`.
A DB CHECK enforces the weights sum to 100 (`contract.ts:127`).

**`approval_rule`** (`:393`) — `sequence` (unique), `min_score`, `max_worst_overage_bp`,
`max_order_total`, `chain` (Json `Role[]`), `is_active`.

**`approval_request`** (`:526`) + `approval_step` — created by confirm. `(quotation_id, version)`
is unique, which is why `approval_version` has to increment on revise and supersede.

**`portal_request`** (`:922`) — the negotiation rows shown mid-page.

**`audit_log`** (`:564`) — append-only. `entity_type`, `entity_id`, `quotation_id`, `action`,
`actor_type/id/name/role`, `reason`, `before_json`, `after_json`, `at`. Indexed on
`(quotation_id, at)` — exactly the audit tab's query.

**`counter`** (`:428`) — `Q-<year>-<nnnn>` sequence.

DB-level CHECK constraints back up the Zod schemas: discount 0–100 %, ceiling 0–100 %,
tax 0–100 %, qty ≥ 1, prices non-negative, risk weights sum to 100. Their friendly messages
live in `CHECK_MESSAGES` (`contract.ts:118-132`), so a violation surfaces as plain English
rather than a Postgres string.

---

## 9. How this screen connects to the others

**Into it:**
- Screen 3, `/quotes` (`src/app/(internal)/quotes/page.tsx`) — clicking a pipeline card or a table row.
- "+ New Quotation" → `createQuotationAndOpen` (`actions/quotation.ts:49`) → redirects here.
- "New customer" on Screen 3 → `createCustomerAndQuote` (`:216`) → creates customer + contact + draft, lands here.
- The dashboard and Deal Health lists link straight to `/quotes/<publicId>`.

**Out of it:**
- **Confirm with a chain** → `approval_request` → Screen 5 `/approvals` and Screen 6 `/approvals/<publicId>`, where a manager sees the same risk breakdown (from `approval_request.risk_breakdown`, frozen at submit) and the "why this was flagged" per-line table.
- **Confirm with no chain** → `APPROVED` → **Send to customer** → `SENT` → the customer's `/portal/q/<publicId>`.
- **Portal** → `portal_request` rows come back into the Customer requests panel here; accepting a counter can push the quote back into `/approvals`.
- **Confirmed** (portal confirm, or admin Confirm on behalf) → `onConfirmedHooks` (`order.service.ts:48`) creates the warehouse split proposal and the invoices → Screen 7/8 `/fulfillment/<publicId>` (linked from the green banner, `page.tsx:267`), Screen 12/13 `/invoices`, and, for `RECURRING` lines, `/subscriptions`.
- **Audit** — every write here also feeds `/approvals/<publicId>`'s trail (same component) and bumps `last_activity_at`, which is the input to Deal Health's "stalled" alert (`risk_config.stalled_days`).
- **Admin** — `/admin/products`, `/admin/tiers`, `/admin/pricelists`, `/admin/risk`, `/admin/approval-rules` supply every number this screen reads that is not on the quote itself.

---

## 10. Gotchas

1. **The Limit column is frozen at add time.** `ceiling_bp` is written only by `addLine` and by `setCustomer`. Changing a tier or category ceiling in the admin area does not move it on existing lines. That is intentional, and it is the first thing people get wrong.
2. **Discounts compound multiplicatively.** 10 % + 10 % = 19 %, not 20 % (`totals.ts:9`). An order discount can push a line over its limit while that line's own Discount box still shows a small number. The only warning is the "effective …" caption and the Status badge.
3. **The `maxOrderTotal` and `maxWorstOverageBp` rules can never fire on their own.** `routeApproval` returns `[]` before consulting any rule unless `needsReview` is true (`route.ts:98, 120`). A ₹14 lakh order at 0 % discount is auto-approved (scenario 13).
4. **The risk card can be stale.** It prefers the stored `risk_breakdown` blob and only recomputes when that is null (`page.tsx:59-72`). Confirm recomputes from scratch (`quotation.service.ts:278`), so what the card promised and what confirm does can differ if the admin changed the config since the last edit.
5. **Editing an APPROVED or SENT quote silently rolls it back to DRAFT.** `loadForEdit` supersedes the pending approval and increments `approval_version` before your edit even lands (`quotation.service.ts:393-409`). One click on `+` undoes a manager's approval. The amber strip warns you; nothing asks for confirmation.
6. **`marginBp` is null when `netTotal` is 0**, and `formatBp(null)` prints `"n/a"` (`money.ts:22`, `format.ts:46`). The risk engine treats a null margin as zero penalty (`risk.ts:69`), so an empty or fully-discounted quote scores 0 on the margin component rather than maximally.
7. **The upsell margin delta is `listPrice − cost`.** It ignores the customer's price rule and any discount you will apply (`upsell.service.ts:72`). Treat it as a ceiling, not a forecast.
8. **Dismissing an upsell is not remembered.** It is local state, and the `Builder` remounts on every action because of `key={version-updatedAt}` (`page.tsx:356`). Dismiss, then change a quantity, and the suggestion is back.
9. **The `key` also wipes typed-but-uncommitted discount drafts.** The line discount input only commits on blur or Enter (`builder.tsx:199-200`); a `router.refresh()` triggered by any other action remounts the component and throws the draft away.
10. **`CustomerField` carries the version from the server render, not the builder's live state.** Add a line and change the customer before the refresh completes and you get a CONFLICT toast (`customer-field.tsx:45`). Harmless, but confusing.
11. **`respondToRequest` has no optimistic lock.** Every other write on this screen goes through `lockQuotation`; this one does not (`portal.service.ts:168-218`). Two reps answering the same request race on the `status !== "OPEN"` check instead.
12. **"Save Draft" is a link, not a save.** `builder.tsx:353`. Every change was already committed the moment you made it. The only real "unsaved" state is a discount you typed but never blurred.
13. **A subscription silently gets the Monthly plan.** `addLine` falls through to the lowest-id global plan (`quotation.service.ts:142`). There is no plan picker on this screen. If no plan exists at all, adding a subscription becomes impossible from here.
14. **Adding a product already on the quote merges into the existing line**, incrementing qty and logging `LINE_UPDATE` (`quotation.service.ts:154-168`). No duplicate row, ever.
15. **Pressing − on a qty-1 line deletes it** without a confirmation (`builder.tsx:94`).
16. **The score clamps at 100** (`risk.ts:74`). Once you are far over, the number stops telling you how far. Read "Worst line overage" for that.
17. **`riskBand` calls score 0 "LOW" and score 1 "MEDIUM"** (`contract.ts:247`), while approval rule seq 1 fires at `minScore: 1`. So MEDIUM and "needs a manager" are effectively the same thing with the seeded rules — but that is a coincidence of the seed, not a rule of the system.
18. **The Totals card's amber-margin threshold (2000) is hard-coded in CSS** (`builder.tsx:307`) while the risk engine reads `floorMarginBp` from `risk_config`. Change the floor in admin and the colour will not follow.
19. **Anyone logged in can read any quotation**, including costs, margins, ceilings and the risk breakdown. Only *writes* are ownership-checked. The customer-facing DTO is the only place where those fields are stripped (`contract.ts:389`, `src/lib/dto/portal.ts`).
20. **The `customers` list query runs even in read-only mode** (`page.tsx:50`) and is unbounded — every non-archived customer, on every page load. Fine at demo scale.
21. **The dev database is polluted.** Alongside the seed it holds test tiers (`TierT admmtom…`), test categories, ~36 extra products and quotations up to `Q-2026-0344`. Some of those quotes have negative margins and score 100. Only `Q-2026-0001` (empty Acme draft) and `Q-2026-0004` (Beta hybrid draft) are seeded. Reset before demoing.
