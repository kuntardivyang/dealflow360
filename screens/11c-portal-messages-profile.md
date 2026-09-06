# Screen 11c — Portal Home, Messages and Profile

## 1. What this screen is

Three small pages that share one frame. They are the rest of the portal's navigation bar from mockup screen 11 — "My Quotation | Messages | Profile".

| | `/portal` | `/portal/messages` | `/portal/profile` |
|---|---|---|---|
| Page file | `src/app/portal/(customer)/page.tsx` | `src/app/portal/(customer)/messages/page.tsx` | `src/app/portal/(customer)/profile/page.tsx` |
| Title | "My Quotations" | "Messages" | "Profile" |
| Data source | `listPortalQuotations` (`src/services/portal.service.ts:54`) | `listPortalQuotations` (the same call) | **`prisma.customerContact.findUniqueOrThrow` — direct** (`profile/page.tsx:10`) |
| Goes through the whitelist DTO | Yes | Yes | **No** |
| Writes anything | No | No | No |
| Nav label | "My Quotation" (`src/components/portal/portal-nav.tsx:8`) | "Messages" (`:9`) | "Profile" (`:10`) |

Shared frame: `src/app/portal/(customer)/layout.tsx` — brand, customer name, contact name, the three nav links, a Sign out button, and a footer. Above it, `src/app/portal/layout.tsx:6` wraps everything in `.portal-theme`, which re-tokens the primary colour to teal so the portal never looks like the internal workspace.

All three pages are **read-only**. The only action anywhere in this file is Sign out, which lives in the layout.

**Mockup fidelity note.** The mockup's nav says "My Quotation" (singular) and the page heading in `page.tsx:28` says "My Quotations" (plural). The nav label follows the mockup (`portal-nav.tsx:8`), the heading does not. Deliberate: the mockup shows one quotation, the build shows a list.

---

## 2. Who can open them, and who enforces that

| Who | What happens | Enforced where |
|---|---|---|
| Not logged in | Redirect to `/portal/login` (with `?next=` for `/portal/messages` and `/portal/profile`; **no** `?next=` for `/portal` itself) | `src/middleware.ts:14,17,19-20,37-39`. The `next` is omitted when the destination equals the portal home — `:38-39`, `home = "/portal"` |
| Valid `df_portal` | Pages render, scoped to `session → contact → customer_id` | `requirePortal()` in `(customer)/layout.tsx:10` **and again** in each page (`page.tsx:17`, `messages/page.tsx:13`, `profile/page.tsx:9`) |
| Expired session or archived customer | Redirect to login; the stale cookie is deleted at path `/portal` | `src/middleware.ts:52-53`, `:41` |
| Internal user (`df_session` only) | Redirect to `/portal/login`; their internal session survives | `src/middleware.ts:17` picks `df_portal` only; `:41` deletes only the cookie it read. See Screen 11a §2 |
| A contact from another customer | Sees **their own** list, never yours | `listPortalQuotations` filters `customerId: portal.customerId` (`portal.service.ts:56`), taken from the session, never from the request. There is no id in the URL to tamper with |

Note the double guard: the layout calls `requirePortal()` and so does every page. Redundant in a correct Next.js render (the layout always runs), but it means a page can never render unauthenticated even if it is ever reached outside this layout — and it is what supplies each page its `user` object anyway.

---

## 3. Everything on the screen, and where each value comes from

### The shared frame (`src/app/portal/(customer)/layout.tsx`)

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Brand "DealFlow360" → `/portal` | static | `layout.tsx:15` | — | Hardcoded |
| Customer name (bold) | `Acme Corp` | `requirePortal()` → `getPortalUser()` (`src/lib/auth/portal.ts:51`) → `layout.tsx:18` | `customer.name` | Seeded by `prisma/seed/a-customers.ts:24`, or typed by an Admin on the Customers screen |
| "Customer portal · Nisha Acme" | `Nisha Acme` | same call → `layout.tsx:19` | `customer_contact.name` | `prisma/seed/a-customers.ts:19` |
| Nav links, current one filled | — | `src/components/portal/portal-nav.tsx:7-11,19` | — | Static list. "My Quotation" is treated as active for `/portal` **and** for any `/portal/q/...` (`:19`), so the quotation screen keeps the tab highlighted |
| "Sign out" | — | `layout.tsx:23-27` | — | Posts to `portalLogoutAction` (`src/app/portal/actions.ts:38`) |
| Footer line | "Questions about a quotation? Use Messages and your sales representative will answer here." | `layout.tsx:33` | — | Hardcoded |

### `/portal` — My Quotations

One query: `listPortalQuotations(user)` (`page.tsx:18`). Every cell comes out of the same whitelist DTO described in Screen 11b §3.

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Heading "My Quotations" | — | `page.tsx:28` | — | Hardcoded |
| Sub-line "Quotations sent to Acme Corp. Click one to review, negotiate or confirm." | `Acme Corp` | `page.tsx:28` ← `user.customerName` | `customer.name` | From the portal session |
| Column "Quotation" | `Q-2026-0326` | `page.tsx:20` ← `dto.number` ← `src/lib/dto/portal.ts:33` | `quotation.number` | Allocated from the `counter` table when the rep created the quote |
| Column "Lines" | `2` | `page.tsx:21` ← `dto.lines.length` | count of `quotation_line` rows | Rep added them |
| Column "Total (incl. tax)" | `₹2,72,816.00` | `page.tsx:22` ← `dto.total` ← `portal.ts:47` | `quotation.total` | Written by `recompute` (`src/services/quotation.service.ts:376`) |
| Column "Status" | `Sent` | `page.tsx:23` ← `dto.status` ← `portalStatusLabel` (`src/lib/contract.ts:377`) | `quotation.status` | Set by send / your request / a rep answer / an approval |
| Column "Open requests" | `1`, or `–` when zero | `page.tsx:24` — `q.requests.filter(r => r.status === "OPEN").length \|\| "–"` | `portal_request.status` | Your own submissions on Screen 11b |
| Row click → `/portal/q/<publicId>` | — | `page.tsx:33` (`rowHref`) → `src/components/shared/data-table.tsx:68` | `quotation.public_id` | Generated when the quotation row was created |
| Empty state "No quotations yet" | — | `page.tsx:34` → `EmptyState` | — | Rendered when the list is empty (`data-table.tsx:39`) |

**Ordering:** `orderBy: { lastActivityAt: "desc" }` (`portal.service.ts:58`). `quotation.last_activity_at` is bumped by **every audited action on that quotation** — by you, by the rep, by an approver — because `src/lib/audit.ts:42` updates it on every audit write. So the list is "most recently touched first", not "newest first".

**The status pill, carefully.** `page.tsx:23` renders `<StatusBadge status={PORTAL_STATUS_CODE[q.status]} label={q.status} />`. `PORTAL_STATUS_CODE` (`page.tsx:9-14`) maps the customer label *back* to the enum name purely to pick a colour from the shared palette (`src/components/shared/status-badge.tsx:19-29`). The **`label` prop is passed explicitly** so the customer wording wins. Without it the shared component would print its own label from `QUOTATION_STATUS_LABEL` — and for `PENDING_APPROVAL` that label is **"Pending Approval"** (`src/lib/contract.ts:356`), not the neutral "Awaiting internal approval". Dropping that one prop would undo the renaming described in Screen 11b.

### `/portal/messages`

Also one query — the very same `listPortalQuotations(user)` (`messages/page.tsx:14`) — then flattened in memory: `quotes.flatMap(q => q.requests.map(r => ({ ...r, quotation: q })))` (`:15`) and re-sorted newest-first across all quotations by ISO string comparison (`:16`).

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Heading + "Everything you asked your sales representative, and their answers." | — | `messages/page.tsx:19` | — | Hardcoded |
| Quotation number link → `/portal/q/<publicId>` | `Q-2026-0326` | `:30-32` | `quotation.number`, `.public_id` | From the DTO |
| Type label | `Comment` / `Change request` / `Counter discount` | `:33` via `TYPE_LABEL` (`:10`) | `portal_request.type` | The tab you chose on Screen 11b |
| Line name | `Setup Service` | `:34` — looked up by `r.lineId` inside that quotation's own `lines` (`:25`) | `quotation_line.description` | Snapshot from the product at add time. Absent when the request was against the whole order (`line_id IS NULL`) |
| "· 25.00% proposed" | `2500` bp | `:35` via `formatBp` (`src/lib/format.ts:46`) | `portal_request.proposed_discount_bp` | The number you typed, ×100 (`negotiation-form.tsx:53`) |
| Status chip | `Open` / `Accepted` / `Declined` | `:36` → `status-badge.tsx:39-41` | `portal_request.status` | `OPEN` on insert; changed by the rep (`portal.service.ts:183`) or by approval settlement (`approval.service.ts:128`) |
| Your message | "Can we push this to next month?" | `:38` | `portal_request.message` | Typed by you |
| "Reply: Dates are fixed" | — | `:39` | `portal_request.response_note` | Typed by the rep in the note box (`src/app/(internal)/quotes/[publicId]/page.tsx:314`), or copied from the approver's note by `settleCounterOffers` (`approval.service.ts:129`) |
| Timestamp | `05 Sep 2026, 17:09` | `:41` via `formatDateTime` (`src/lib/format.ts:73`) | `portal_request.created_at` | Database default `now()` at insert |
| Empty state "No messages yet" | — | `:21` | — | When you have never submitted anything |

**What is *not* here.** No reply box. Messages is a **read-only log**; the only place to say anything is the quotation screen (Screen 11b). The footer at `(customer)/layout.tsx:33` says "Use Messages and your sales representative will answer here", which is slightly misleading — you *read* the answers here, you cannot start a thread here.

Also missing, because they are not DTO keys: who answered (`responded_by_id`), when they answered (`responded_at`), and the delivery date you asked for (`requested_delivery_date`).

### `/portal/profile`

**The one portal page that queries Prisma directly** (`profile/page.tsx:10`):

```ts
const contact = await prisma.customerContact.findUniqueOrThrow({
  where: { id: user.contactId },
  include: { customer: { include: { tier: true } } },
});
```

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Heading "Profile" / "Who you are signed in as." | — | `profile/page.tsx:13` | — | Hardcoded |
| Card title — your name | `Nisha Acme` | `:16` | `customer_contact.name` | `prisma/seed/a-customers.ts:19` |
| Card subtitle — your email | `acme@test.com` | `:17` | `customer_contact.email` | same |
| "Company Acme Corp, Ahmedabad" | `Acme Corp`, `Ahmedabad` | `:21-22` | `customer.name`, `customer.city` | `prisma/seed/a-customers.ts:24`. City is nullable, so it renders only when present (`:22`) |
| "Customer tier Gold" | `Gold` | `:25` | `customer_tier.name` | Seeded tier row; the customer's `tier_id` was set by an Admin or the seed |

Nothing on this page is editable. There is no change-password, no change-email, no add-contact.

---

## 4. The queries these pages run

| Page | Queries |
|---|---|
| Frame | `getPortalUser()` — `portal_session` ⋈ `customer_contact` ⋈ `customer` by token (`src/lib/auth/portal.ts:49`). Plus the middleware's own `portalSessionValid` (`src/middleware.ts:52`) |
| `/portal` | 1× `prisma.quotation.findMany({ where: { customerId, sentAt: { not: null }, status: { in: PORTAL_VISIBLE_STATUSES } }, include: PORTAL_INCLUDE, orderBy: { lastActivityAt: "desc" } })` — `portal.service.ts:55-59`. Then `rows.map(toPortalQuotation)` (`:60`) |
| `/portal/messages` | Exactly the same `findMany` (`:55`), then flattened client-side of the database, in the server component (`messages/page.tsx:15-16`) |
| `/portal/profile` | 1× `customerContact.findUniqueOrThrow` with `customer` and `customer.tier` joined (`profile/page.tsx:10`) |

`PORTAL_INCLUDE` (`portal.service.ts:34-38`) pulls `customer` (name + tierId), **all** line columns, and **all** portal-request columns. So the list page loads far more than it shows — and then drops it in the mapper. That is the design: over-fetch on the server, whitelist on the way out.

**Performance note.** `listPortalQuotations` has no `take`/pagination. A customer with hundreds of quotations loads them all, with every line and every request. Fine at demo scale; the index `quotation(customer_id)` (`prisma/schema.prisma:483`) is there, but nothing bounds the row count.

**Messages is the same query twice.** Navigating `/portal` → `/portal/messages` re-runs the identical `findMany` and throws away the quotation-level fields. Correct, just wasteful.

---

## 5. Every condition on these pages

| # | Condition | Where | Effect |
|---|---|---|---|
| 1 | Valid `df_portal` session | `src/middleware.ts:20`; `requirePortal()` in the layout (`:10`) and in each page | else redirect to `/portal/login` |
| 2 | `next` is omitted when the destination is `/portal` | `src/middleware.ts:38-39` | a clean login URL for the home page |
| 3 | `customer.archived_at IS NULL` | `src/middleware.ts:53`, `src/lib/auth/portal.ts:50` | archived customer → treated as logged out |
| 4 | `quotation.customer_id = session.customerId` | `portal.service.ts:56` | you only ever see your own |
| 5 | `quotation.sent_at IS NOT NULL` | `:56` | drafts the rep is still building are invisible |
| 6 | `quotation.status IN (SENT, UNDER_NEGOTIATION, PENDING_APPROVAL, CONFIRMED, FULFILLMENT, PAID)` | `:56` + `src/lib/contract.ts:368` | DRAFT / APPROVED / REJECTED / CANCELLED never appear |
| 7 | List order is `last_activity_at DESC` | `:58` | any action on a quote floats it to the top |
| 8 | "Open requests" shows `–` instead of `0` | `page.tsx:24` (`|| "–"`) | zero is falsy |
| 9 | Empty list → EmptyState instead of a table | `src/components/shared/data-table.tsx:39` | "No quotations yet" |
| 10 | Empty messages list → EmptyState | `messages/page.tsx:20` | "No messages yet" |
| 11 | Line name shown only when `line_id` is set | `messages/page.tsx:25,34` | whole-order requests show no line |
| 12 | Proposed % shown only when `proposed_discount_bp !== null` | `:35` | comments and change requests never carry one — `portal.service.ts:86` forces NULL for non-counters |
| 13 | Reply line shown only when `response_note` is set | `:39` | an accepted request with no note shows just the chip |
| 14 | City shown only when set | `profile/page.tsx:22` | `customer.city` is nullable |
| 15 | `findUniqueOrThrow` on the profile | `profile/page.tsx:10` | if the contact row vanished mid-session, the page throws and `src/app/portal/error.tsx` renders "Something went wrong" |
| 16 | Nav "My Quotation" is active for `/portal` **and** `/portal/q/...` | `portal-nav.tsx:19` | the tab stays lit while you are on a quotation |

---

## 6. Every action you can take here

There is exactly one, and it lives in the frame.

### Sign out

| Step | Detail |
|---|---|
| Button | "Sign out" — `src/app/portal/(customer)/layout.tsx:24`, inside a plain `<form action={portalLogoutAction}>` (`:23`) — a server action form, no client JavaScript needed |
| Server action | `portalLogoutAction` — `src/app/portal/actions.ts:38` |
| Zod schema | None. There is no input |
| Service | `clearPortalCookie` — `src/lib/auth/portal.ts:39-44` |
| Guards, in order | None. Signing out is always allowed; if there is no cookie, `:41` simply skips the delete |
| Tables written | `portal_session` — `deleteMany({ where: { token } })` (`:42`). The session row is destroyed, so a copied cookie value is dead immediately |
| Cookie | `df_portal` deleted at path `/portal` (`:43`) — the same path it was set with, so the delete actually takes effect |
| Audit row | **None.** `src/lib/audit.ts` is never called from any auth path |
| What changes on screen | `redirect("/portal/login")` — `actions.ts:40` |

Everything else on these three pages is navigation: a row click (`page.tsx:33`), a quotation link in Messages (`messages/page.tsx:30`), the three nav links (`portal-nav.tsx:21`), and the brand mark (`layout.tsx:15`).

---

## 7. Scenarios

**1. Nisha lands on `/portal` after logging in.** `getPortalUser()` gives `customerId = 1`. `listPortalQuotations` runs one `findMany` filtered by customer 1 + `sent_at IS NOT NULL` + the six visible statuses, ordered by `last_activity_at DESC`. Every row is mapped through `toPortalQuotation`. She sees her quotations with number, line count, total, status label and open-request count.

**2. A freshly seeded database.** `prisma/seed/a-quotes.ts` creates only Q-2026-0001 (empty Acme draft, `:53`) and Q-2026-0004 (Beta hybrid draft, `:112`), both `status: "DRAFT"` with no `sent_at`. Both fail conditions 5 and 6. **Every portal account sees an empty list** and the "No quotations yet" empty state, until a rep approves and sends something (`src/services/order.service.ts:19-31`). If someone reports "the portal is broken, it's empty" — this is why.

**3. Rahul at Beta Industries logs in.** Same code, `customerId = 2`. He sees Beta's quotations only. There is no id in the URL to change and no filter to widen: the `where` clause is built from his session (`portal.service.ts:56`). Pinned at `src/services/__tests__/portal.service.db.test.ts:67` — an Acme quotation is absent from Beta's list.

**4. A quotation goes out for approval.** Nisha counters above the ceiling on Screen 11b; the quotation becomes `PENDING_APPROVAL`. Back on `/portal` the row's status pill reads **"Awaiting internal approval"** — because `page.tsx:23` passes `label={q.status}` (the DTO's neutral label). The colour is the shared `warning` tone (`status-badge.tsx:21`), reached by mapping the label back to the enum name at `page.tsx:12`. Nothing tells her which role is approving, or how many steps remain.

**5. Open-request counter.** She has one OPEN comment on Q-2026-0326. The "Open requests" cell shows `1` (`page.tsx:24`). The rep declines it; `portal_request.status` becomes `DECLINED` (`portal.service.ts:183`); the cell shows `–` on her next load, and the request is still visible in Messages with the reply.

**6. A confirmed order that has shipped.** The quotation moves `CONFIRMED → FULFILLMENT → PAID` internally. On `/portal` the pill stays **"Confirmed"** for all three — `portalStatusLabel`'s fallthrough (`src/lib/contract.ts:381`). The customer has no shipment tracking or invoice view anywhere in this build.

**7. Messages with nothing in it.** A customer who has received a quotation but never commented sees the "No messages yet" empty state (`messages/page.tsx:21`). The list is built from `q.requests` across quotations, which is empty.

**8. Messages after a counter is approved.** The counter shows type "Counter discount", the line name, "· 25.00% proposed", the chip **Accepted**, and "Reply: <the approver's note>" — because `settleCounterOffers` copied the approver's note into `response_note` (`approval.service.ts:129`). It does **not** say who approved it: `responded_by_id` is not a DTO key.

**9. A request against the whole order.** A change request submitted with no line (`line_id IS NULL`) renders with no "· line name" fragment, because `:25` returns `null` and `:34` skips the span. Same request on Screen 11b appears in the "Your requests" list but in no line's Comment cell.

**10. Ordering surprise.** Nisha has Q-A (created last week, confirmed today) and Q-B (created today, untouched). Q-A appears **first**, because confirming wrote an audit row which bumped `last_activity_at` (`src/lib/audit.ts:42`). The list is by activity, not by creation date. There is no created-date column to explain it.

**11. Internal user opens `/portal/messages`.** Middleware `:14` → portal branch → `df_portal` missing → redirect to `/portal/login?next=%2Fportal%2Fmessages`. Their `df_session` is untouched (`:41` runs only `if (token)`, and the token it looked for was `df_portal`). At the login form their workspace credentials fail — `authenticatePortal` queries `customer_contact` (`src/lib/auth/portal.ts:16`), and internal users live in `app_user`.

**12. Session expires while Messages is open.** The page keeps showing stale data until the next navigation. On that navigation `portalSessionValid` (`src/middleware.ts:52-53`) finds `expiresAt <= now` and redirects to `/portal/login?next=%2Fportal%2Fmessages`, deleting the stale cookie at path `/portal` (`:41`).

**13. Customer is archived by an Admin.** `customer.archived_at` is set. The very next request fails at `src/middleware.ts:53` (`contact.customer.archivedAt === null` is false) and the contact is redirected to login, where `authenticatePortal` also refuses (`portal.ts:17`). Nothing is deleted; access is simply gone.

**14. Sign out, then Back button.** `clearPortalCookie` deleted the `portal_session` row (`portal.ts:42`) and the cookie (`:43`). Any cached page in the browser may flash, but the next server render is a redirect: there is no token, and even the old token value no longer exists in the table.

**15. Profile of a customer with no city.** `customer.city` is nullable (`prisma/schema.prisma:241`). `profile/page.tsx:22` renders the ", Ahmedabad" fragment only when it is set, so a city-less customer shows just "Company Beta Industries".

**16. Profile when the contact row disappears mid-session** (an Admin deletes the customer, cascading to `customer_contact`). `findUniqueOrThrow` (`:10`) throws; Next's error boundary `src/app/portal/error.tsx:8` renders "Something went wrong / We could not load your quotation" with a "Try again" button and a link back to `/portal`. In practice the middleware would usually redirect first, because the `portal_session` row cascades away too (`prisma/schema.prisma:282`).

---

## 8. Schema behind these pages

```
customer_tier ──< customer ──< customer_contact ──< portal_session
                      │              │
                      │              └──< portal_request
                      └──< quotation ──< quotation_line
```

| Table | Columns these pages read | Where |
|---|---|---|
| `portal_session` | `token`, `contact_id`, `expires_at` | `prisma/schema.prisma:275-286` |
| `customer_contact` | `id`, `customer_id`, `name`, `email` | `:257-273`. `password_hash` **is loaded by the profile query and never rendered** — see Gotcha 1 |
| `customer` | `name`, `city`, `tier_id`, `archived_at` | `:236-255` |
| `customer_tier` | `name` (shown), `discount_ceiling_bp` (**loaded by the profile query, never rendered**) | `:223-234` |
| `quotation` | `public_id`, `number`, `status`, `total`, `sent_at`, `customer_id`, `last_activity_at` | `:439-485`. The list query loads the whole row, including `cost_total`, `margin_bp`, `risk_score`, `risk_breakdown`, `rep_user_id`, `notes` — all dropped by the DTO |
| `quotation_line` | counted for the "Lines" column; `description` used in Messages | `:488-…` |
| `portal_request` | `type`, `line_id`, `message`, `proposed_discount_bp`, `status`, `response_note`, `created_at` | `:922-943` |

---

## 9. How these pages connect to the others

* **Screen 11a** (`/portal/login`) — every one of these pages redirects here without a session, and Sign out returns here.
* **Screen 11b** (`/portal/q/<publicId>`) — reached by clicking a row on `/portal` (`page.tsx:33`) or a quotation number in Messages (`messages/page.tsx:30`). It is the only place in the portal where anything can be written.
* **Screen 05, Quotation Builder** — the rep's mirror of the same rows, with cost, margin, risk, the approval chain, the warehouse plan and the rep's own notes. It is also where the replies you read in Messages are typed (`src/app/(internal)/quotes/[publicId]/page.tsx:314`).
* **Screen 06, Approvals** — resolving an approval flips a quotation back to `SENT` when `negotiation_pending` is true (`src/services/approval.service.ts:83`), which is what makes a row's status change from "Awaiting internal approval" to "Sent" here without anyone touching the portal.
* **`sendToCustomer`** (`src/services/order.service.ts:19-31`) — the single event that makes a quotation appear on `/portal` at all: it sets `status = SENT` and stamps `sent_at`.
* **Screen 09, Deal Health** — reads the same `last_activity_at` that orders this list.

---

## 10. Gotchas

1. **The Profile page bypasses the whitelist DTO.** `src/app/portal/(customer)/profile/page.tsx:10` calls `prisma.customerContact.findUniqueOrThrow` directly, with `customer` and `customer.tier` joined. That object carries `password_hash`, `customer.tier_id`, and the entire `customer_tier` row **including `discount_ceiling_bp`** — the number the whole DTO exists to hide. **It is not a leak today**: the page renders only `contact.name` (`:16`), `contact.email` (`:17`), `customer.name` and `customer.city` (`:21-22`), and `customer.tier.name` (`:25`). Because Next.js server components serialise only what the JSX uses, the ceiling never reaches the browser. But it is the one place in the portal where the guardrail is "the developer only typed five fields" rather than "the mapper only emits eleven keys". The forbidden-word test at `src/lib/dto/__tests__/portal.test.ts:32` does not cover this page. If a leak ever appears in the portal, this is where it will be. The safe fix is a tiny `toPortalProfile` DTO alongside `toPortalQuotation`.
2. **Showing the tier name is a small, deliberate disclosure.** "Customer tier Gold" (`profile/page.tsx:25`) tells the customer which bracket they are in. The *number* attached to Gold (1500 bp = 15 %) is never shown — but a customer who has been told "Gold customers get up to 15 %" by a salesperson now has the ceiling. Consider it borderline; it is defensible because the tier is part of the commercial relationship, not an internal secret.
3. **`label={q.status}` on the status badge is load-bearing.** `page.tsx:23`. Remove that prop and `StatusBadge` falls back to its own map, which prints **"Pending Approval"** for `PENDING_APPROVAL` (`status-badge.tsx:21` → `src/lib/contract.ts:356`). One deleted prop undoes the neutral relabelling. Screen 11b's page has the same pattern at `q/[publicId]/page.tsx:42`.
4. **Messages is read-only and the footer implies otherwise.** `(customer)/layout.tsx:33` says "Use Messages and your sales representative will answer here." You cannot write anything on `/portal/messages`; the only input is on the quotation screen.
5. **The list is unbounded.** No `take`, no cursor, no pagination anywhere in `listPortalQuotations` (`portal.service.ts:55-59`), and it eagerly includes every line and every request of every quotation. Fine for a demo, not for a customer with a long history.
6. **`/portal` and `/portal/messages` run the identical query.** Both call `listPortalQuotations`; Messages throws away the quotation-level fields it does not need. Harmless, but do not assume Messages has its own optimised read model.
7. **No account self-service at all.** A portal contact cannot change their password, change their email, or add a colleague. Those rows are created only by the seed or by an Admin. If a customer forgets their password, the answer is "ask your sales rep" — and the rep has no reset button either.
8. **A DRAFT quotation is invisible even to its own customer**, and so is an internally `APPROVED` one until it is sent (conditions 5 and 6). A customer being told "we've approved your quote" and seeing nothing on the portal is expected behaviour, not a bug.
9. **`is_primary` on `customer_contact` is dead weight.** It exists in the schema (`prisma/schema.prisma:263`) and defaults to `true`, and no code anywhere reads it. Every contact at a customer has identical powers.
10. **Nothing here is audited.** These pages write nothing, and sign-out writes no audit row either, so "who looked at what, and when" is not answerable from `audit_log`. Only actions taken on Screen 11b appear there.
