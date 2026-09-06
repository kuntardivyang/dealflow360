# Screen 03 — Quotations list (pipeline board and table)

## 1. What this screen is

- **Route:** `/quotes`, plus two optional query params: `?status=<STAGE>` and `?view=table`
- **Page file:** `src/app/(internal)/quotes/page.tsx` (165 lines, one file, no sub-components)
- **Mockup:** screen 3, "Quotations List" (`docs/mockup/03-quotations-list.png`, text list in `docs/MOCKUP_SCREENS.md:30-37`)
- **Kind:** list screen. Two renderings of the same data — a five-column Kanban board (default) and a seven-column table (`?view=table`).
- **Job:** show every quotation in the system grouped by stage, let you filter to one stage, and give you the one button that starts a new one.

The mockup's sub-line says "one row per quotation"; the board is what the mockup actually *draws*, so the code makes the board the default and rewords the sub-line per view (`src/app/(internal)/quotes/page.tsx:85`).

## 2. Who can open it, and who enforces that

| Role | Can reach `/quotes`? | Where that is enforced |
|---|---|---|
| ADMIN | Yes | `src/middleware.ts:21-32`, then `src/app/(internal)/layout.tsx:12` |
| SALES_MANAGER | Yes | same |
| FINANCE | Yes | same |
| SALES_REP | Yes | same |
| portal CONTACT | **No** | `src/middleware.ts:17` looks for `df_session`; a contact only has `df_portal` (`src/lib/auth/constants.ts:3-4`), so `src/middleware.ts:35-42` redirects to `/login?next=%2Fquotes` |
| anonymous | No | same |

The four layers:

1. **Middleware** — `src/middleware.ts:12-43`. `/quotes` matches the catch-all matcher (`src/middleware.ts:59`) and is not under `/admin`, so any valid session passes. `sessionRole()` (`:46-49`) rejects expired sessions and deactivated users.
2. **Layout guard** — `src/app/(internal)/layout.tsx:12`, `requireUser()` with no role list.
3. **Page guard** — **none.** `src/app/(internal)/quotes/page.tsx` never imports `requireUser` and never reads the session. Every internal role sees **every** quotation, including other reps'. There is no `where: { repUserId: user.id }` anywhere on this page.
4. **Action guard** — the New Quotation form goes through `requireActionUser()` (`src/app/(internal)/actions/quotation.ts:40`) and `assertActor(..., "EDIT_LINES")` (`src/services/quotation.service.ts:68`), which allows only `SALES_REP` and `ADMIN` (`src/lib/state/quotation.machine.ts:28`).

Ownership is enforced one screen later, not here: opening `/quotes/<publicId>` is allowed for anyone, but editing requires `q.repUserId === user.id || user.role === "ADMIN"` (`src/app/(internal)/quotes/[publicId]/page.tsx:53`, and server-side at `src/services/support.ts:12-16`).

## 3. Everything on the screen, and where each value comes from

### Shared chrome

| What you see | Example value | Which query produced it | table.column | How that value came to exist |
|---|---|---|---|---|
| Title "Quotations" | `Quotations` | literal | — | `src/app/(internal)/quotes/page.tsx:84` |
| Sub-line | "Every quotation in the system, one card per quotation, grouped by stage. Click a card to open it." | ternary on `table` | — | `src/app/(internal)/quotes/page.tsx:85`. Swaps to the "one per row" wording when `?view=table`. |
| Error strip (red) | "Only the owning sales rep or an admin can edit this quotation" | `searchParams.error` | — | Not from the database. Written into the URL by `errorQuery()` (`src/lib/contract.ts:165-168`) when a redirecting form action fails — e.g. `createQuotationAndOpen` at `src/app/(internal)/actions/quotation.ts:52`. Rendered at `src/app/(internal)/quotes/page.tsx:100`. |
| "All 178" chip | count of every quotation | `prisma.quotation.groupBy({ by:["status"], _count:{_all:true} })` — `src/app/(internal)/quotes/page.tsx:49`, summed at `:51` | `quotation.status` (`prisma/schema.prisma:445`) | One `GROUP BY status` over the whole table, no `where`. Includes `REJECTED`, `CANCELLED`, `PAID` — everything. |
| "Draft 59" chip etc. | per-stage count | `countOf(s)` — `src/app/(internal)/quotes/page.tsx:52` | same groupBy | Each of the ten statuses is folded onto one of five stages by `STAGE_OF` (`:22-33`), then the counts are added. So the Draft chip = DRAFT + REJECTED + CANCELLED. |
| Chip label | `Pending Approval` | `QUOTATION_STATUS_LABEL[s]` | — | Static map at `src/lib/contract.ts:354-365`. |
| Chip highlight | the active chip is filled | `chip(filter === s)` — `src/app/(internal)/quotes/page.tsx:64-68`, `:108` | — | Pure CSS branch on whether `searchParams.status` matched this chip. |

### Kanban card (default view)

| What you see | Example value | Which query produced it | table.column | How that value came to exist |
|---|---|---|---|---|
| Card headline (customer) | `Beta Industries` | `include: { customer: { select: { name: true } } }` — `src/app/(internal)/quotes/page.tsx:45`, rendered `:141` | `customer.name` (`prisma/schema.prisma:239`) | Seeded at `prisma/seed/a-customers.ts:25` (`make("Beta Industries", "Kolkata", tiers.silver.id, …)`), or created by `createCustomer` (`src/services/quotation.service.ts:51-60`). The link from quotation to customer is `quotation.customer_id`, written either at creation (`src/services/quotation.service.ts:76`) or later by `setCustomer` (`:104`). |
| …when there is no customer | `No customer yet` | same | `quotation.customer_id IS NULL` (`prisma/schema.prisma:443`) | The column is nullable on purpose: "+ New Quotation" opens an empty draft and the customer is picked inside the builder, Odoo-style (`src/lib/validation/quotation.ts:7`, `src/services/quotation.service.ts:76`). Fallback string at `src/app/(internal)/quotes/page.tsx:141`. |
| Card amount | `₹1,36,880.00` for the seeded `Q-2026-0004` | the same `findMany` (`:43-48`), rendered by `<Money paise={q.total}/>` at `:142` | `quotation.total` (`prisma/schema.prisma:452`) | **Integer paise, never a float.** Recomputed on every line change by `recompute()` (`src/services/quotation.service.ts:369-382`), which calls `computeTotals()` (`src/domain/totals.ts`) over the quotation's lines and writes `gross_total`, `discount_total`, `net_total`, `tax_total`, `total`, `cost_total`, `margin_bp` in one update. For `Q-2026-0004` the seed computed it directly (`prisma/seed/a-quotes.ts:106-127`): Laptop 14" list price `rs(60_000)` = 6 000 000 paise (`prisma/seed/a-catalogue.ts:20`) × qty 2 = 12 000 000 gross, less 5 % = 600 000, net 11 400 000, tax at the product's default `tax_bp` 1800 (`prisma/schema.prisma:330`) = 2 052 000; plus Support Pro `rs(1_000)` × 2 = 200 000 net + 36 000 tax. Sum = **13 688 000 paise = ₹1,36,880.00**, which is exactly what the database holds. Formatted by `formatMoney` (`src/lib/format.ts:34-36`) with `Intl.NumberFormat("en-IN", { style:"currency", currency:"INR" })`. |
| Card quotation number | `Q-2026-0004` | same findMany, rendered `:145` | `quotation.number` (`prisma/schema.prisma:442`) | Minted once at creation by `nextNumber(tx, "quotation", "Q")` (`src/services/support.ts:19-22`): upserts the `counter` row keyed `"quotation"` **inside the creating transaction** so two simultaneous creates cannot collide, then `formatNumber` (`src/lib/ids.ts:21`) renders `Q-<UTC year>-<zero-padded 4>`. The seed pre-sets the counter to 4 (`prisma/seed/a-quotes.ts:38-44`), so your first hand-made quotation is `Q-2026-0005`. |
| Card sub-badge (only sometimes) | `Rejected` | same findMany, rendered `:146` | `quotation.status` | Shown only when the real status differs from the column it was folded into — `q.status !== stage`. A `REJECTED` quote sits in the Draft column with a red "Rejected" badge; a `PAID` quote sits in Confirmed with a green "Paid" badge. Colours from `src/components/shared/status-badge.tsx:19-45`. |
| Card footer — rep name | `Riya Rao` | `include: { rep: { select: { name: true } } }` — `:45`, rendered `:149` | `app_user.name` (`prisma/schema.prisma:194`) via `quotation.rep_user_id` (`:444`) | `rep_user_id` is set to the session user at creation and never changed afterwards (`src/services/quotation.service.ts:77`). The five demo users are seeded at `prisma/seed/b-users.ts:8-16` — Riya Rao and Arjun Mehta are the two `SALES_REP`s, both reporting to Meera Shah. The relation is required, so this never falls back. |
| Card footer — timestamp | `04 Sept, 09:58` | same, rendered `:149` | `quotation.last_activity_at` (`prisma/schema.prisma:466`) | Defaults to `now()` at insert. Bumped to `new Date()` by the audit helper on **every** quotation-scoped change (`src/lib/audit.ts:42`) — so it is "the last time anything at all happened", not "the last time a human typed". For the seeded quotes it is set explicitly: `daysAgo(0)` for `Q-2026-0001` (`prisma/seed/a-quotes.ts:54`) and `daysAgo(1)` for `Q-2026-0004` (`:124`). Formatted IST by `formatDateTime` (`src/lib/format.ts:73-76`). |
| Column header badge | `Draft`, `Pending Approval`, … | `StatusBadge status={stage}` — `:130` | — | The stage key, labelled through `QUOTATION_STATUS_LABEL` inside `src/components/shared/status-badge.tsx:20-24`. |
| Column count | `59` | `inStage.length` — `:125`, `:132` | — | **Counted from the fetched page, not the database.** This is the number of cards actually rendered in that column, so it can be smaller than the chip above it. See Gotchas. |

### Table view (`?view=table`)

Columns are declared at `src/app/(internal)/quotes/page.tsx:71-79` and rendered by `DataTable` (`src/components/shared/data-table.tsx:22`).

| Column | Example | Cell code | table.column | Origin |
|---|---|---|---|---|
| Quotation | `Q-2026-0004` | `:72` | `quotation.number` | as above |
| Customer | `Beta Industries` / "No customer yet" | `:73` | `customer.name` | as above |
| Rep | `Riya Rao` | `:74` | `app_user.name` | as above |
| Amount (right aligned) | `₹1,36,880.00` | `:75` | `quotation.total` | as above |
| Margin (right aligned) | `26.9%`, or `n/a` | `:76` | `quotation.margin_bp` (`prisma/schema.prisma:454`) | Integer basis points. Written by `recompute()` (`src/services/quotation.service.ts:378`) from `computeTotals().marginBp`, which is `(netTotal − costTotal) / netTotal` in bp and is **null when `net_total` is 0** (`src/lib/contract.ts:216`). `cost_total` in turn comes from `quotation_line.unit_cost`, which was copied off `product.cost` when the line was added (`src/services/quotation.service.ts:181`) — e.g. Laptop 14" cost `rs(42_000)` (`prisma/seed/a-catalogue.ts:20`). `formatBp` renders `bp/100` with a `%`, and prints the literal `n/a` for null (`src/lib/format.ts:46-49`). So every empty draft shows `n/a` in this column. |
| Stage | `Draft` badge | `:77` | `quotation.status` | Here it shows the **real** status, not the folded stage — a rejected quote reads "Rejected", unlike the board where it hides in the Draft column. |
| Last activity | `04 Sept, 09:58` | `:78` | `quotation.last_activity_at` | as above |
| Whole row clickable | → `/quotes/<publicId>` | `rowHref` at `:120` → `src/components/shared/data-table.tsx:68-71` → `src/components/shared/clickable-row.tsx:9-17` | `quotation.public_id` (`prisma/schema.prisma:441`) | 12 random URL-safe characters from `publicId()` (`src/lib/ids.ts:8-13`), generated at `src/services/quotation.service.ts:74`. Clicks on inner links/buttons are ignored (`src/components/shared/clickable-row.tsx:12-15`), and hovering prefetches the detail page (`:24`). |

## 4. The queries this page runs

Two queries, in parallel (`src/app/(internal)/quotes/page.tsx:42-50`).

**1. The rows** — `prisma.quotation.findMany` (`:43-48`)

- `where`: `undefined` when no filter is active — i.e. **every quotation in the database**, no role scoping, no archive filter. When a chip is active it becomes `{ status: { in: [...] } }` where the list is every status that folds onto that stage (`:44`): filtering to Draft actually queries `DRAFT, REJECTED, CANCELLED`; filtering to Confirmed queries `CONFIRMED, FULFILLMENT, PAID`; Negotiation queries `SENT, UNDER_NEGOTIATION`.
- `include`: `customer { name }` (left join — `customer_id` is nullable) and `rep { name }` (inner join — `rep_user_id` is required). Both use `select` so only the name column crosses the wire. No lines, no approval requests, no audit — the card needs none of them.
- `orderBy`: `{ lastActivityAt: "desc" }` — newest activity first, in every column and every table row.
- `take: 200` — a hard cap. There is no pagination UI and no "showing 200 of N" note.
- Index used: `@@index([status])` (`prisma/schema.prisma:481`) when filtered. The compound `@@index([repUserId, lastActivityAt])` (`:482`) does not help here because the page never filters by rep.

**2. The chip counts** — `prisma.quotation.groupBy({ by: ["status"], _count: { _all: true } })` (`:49`)

- No `where`, no `take`. It is a full `GROUP BY status` over the table, so the chips describe the *whole* database even when the board below only drew 200 cards.
- `total` = sum of all groups (`:51`); `countOf(stage)` = sum of the groups whose `STAGE_OF` maps to that stage (`:52`).

Plus the two session reads that every internal page pays: `src/middleware.ts:47` and `src/lib/auth/session.ts:15`.

`export const dynamic = "force-dynamic"` at `src/app/(internal)/quotes/page.tsx:16` means the page is re-rendered on every request and never served from the full route cache — necessary because `revalidatePath("/quotes")` is fired by nearly every quotation action (`src/app/(internal)/actions/quotation.ts:41`, `:61`, `:73`, `:85`, …).

## 5. Every condition on this page

| Condition | File:line | What each outcome means to you |
|---|---|---|
| `const filter = CHIPS.find((s) => s === sp.status)` | `:39` | Whitelist. Only the five chip values are honoured. `?status=SENT`, `?status=PAID` or a typo silently becomes "All" — no error, no empty state. |
| `const table = sp.view === "table"` | `:40` | Exact string match. `?view=list` or `?view=TABLE` gives you the board. |
| `where: filter ? { status: { in: … } } : undefined` | `:44` | Filtered → a stage query that includes the folded statuses. Unfiltered → every quotation. |
| `STAGE_OF[st] === filter` (inside the `where`) | `:44` | Builds the status list for the chosen stage from the fold map, so the chip count and the query can never disagree about which statuses belong where. |
| `const status = next.status === undefined ? filter : next.status` | `:56` | In the `href()` helper: `undefined` means "keep the current filter" (used by the view toggle), `null` means "clear it" (used by the All chip). |
| `const view = next.view ?? (table ? "table" : "cards")` | `:57` | Switching stage preserves whether you were in table or board mode. |
| `if (status) p.set("status", status)` / `if (view === "table") p.set(...)` | `:58-59` | Defaults are omitted from the URL, so the clean state is just `/quotes`. |
| `chip(active)` → `active ? "border-foreground/25 bg-accent …" : "…text-muted-foreground"` | `:64-68` | Purely visual: the selected chip is filled and bold. |
| `sp.error ? <p class="…text-destructive">…</p> : null` | `:100` | An error came back from a redirecting action → red strip under the header. Note it is rendered as raw text from the URL. |
| `quotes.length === 0 ? <EmptyState/> : table ? <DataTable/> : <board/>` | `:114-162` | Three-way. Zero rows → empty state (and **no board columns at all**, not even empty ones). `?view=table` → the seven-column table. Otherwise → the Kanban. |
| `title={filter ? \`No ${LABEL[filter].toLowerCase()} quotations\` : "No quotations yet"}` | `:116` | Filtered-and-empty says "No approved quotations"; unfiltered-and-empty says "No quotations yet". |
| `(filter ? [filter] : PIPELINE)` | `:123`, `:124` | Filtered board renders **one** full-width column; unfiltered renders all five. `gridTemplateColumns` is computed from that array's length (`:123`). |
| `quotes.filter((q) => STAGE_OF[q.status] === stage)` | `:125` | The client-side fold. Every one of the ten statuses lands in exactly one column, so nothing disappears — `REJECTED` and `CANCELLED` join Draft, `SENT` joins Negotiation, `FULFILLMENT` and `PAID` join Confirmed. |
| `q.customer?.name ?? "No customer yet"` | `:141` (card), `:73` (table) | Nullable `customer_id` handled. |
| `q.status !== stage ? <StatusBadge status={q.status}/> : null` | `:146` | Card shows a second badge only when its real status is not the column name. A plain DRAFT card shows no badge; a REJECTED card in Draft does. |
| `rows.length === 0 && empty` | `src/components/shared/data-table.tsx:39` | Dead branch here — the page never passes `empty`, and it never reaches DataTable with zero rows because `:114` catches that first. |
| `formatBp(q.marginBp)` with default fallback `"n/a"` | `src/lib/format.ts:46-48` | `margin_bp` null (an empty draft, or any quote with `net_total = 0`) → the literal `n/a`. |

## 6. Every action you can take here

### "+ New Quotation" (primary button)

- `<form action={createQuotationAndOpen}>` at `src/app/(internal)/quotes/page.tsx:88-92`. A real POST; works without JS.
- **Server action:** `createQuotationAndOpen` — `src/app/(internal)/actions/quotation.ts:49-54`. No `customerId` input exists on this page, so it calls `createQuotation({})`.
- **Zod schema:** `createQuotationSchema` — `src/lib/validation/quotation.ts:6-10`. All optional; `{}` passes. Parsed at `src/app/(internal)/actions/quotation.ts:37` via `parseInput` (`src/lib/contract.ts:86-95`).
- **Service:** `createQuotation` — `src/services/quotation.service.ts:66-92`, inside `prisma.$transaction`.
- **Guards in order:** 1) `requireActionUser()` (`src/app/(internal)/actions/quotation.ts:40` → `src/lib/auth/internal.ts:86-91`), throws `UnauthenticatedError` on a dead cookie. 2) `assertActor(actorFromUser(user), "EDIT_LINES")` (`src/services/quotation.service.ts:68` → `src/lib/state/quotation.machine.ts:66-71`), allows only `SALES_REP` and `ADMIN`. 3) customer lookup (`:69-70`) — skipped, no id sent.
- **Writes:** `counter.value` +1 for key `quotation` (`src/services/support.ts:20`); one `quotation` row with `public_id`, `number`, `customer_id = NULL`, `rep_user_id = you`, and schema defaults for everything else (`status DRAFT`, all money `0`, `version 1`, `last_activity_at now()`); one `audit_log` row (`entity_type 'Quotation'`, `action 'CREATE'`, `after_json {"number":"Q-2026-0005","customer":null}`) via `src/lib/audit.ts:26-33`; then `quotation.last_activity_at` bumped again by `src/lib/audit.ts:42`.
- **Audit row:** one, `CREATE`.
- **On screen:** `revalidatePath("/quotes")` (`src/app/(internal)/actions/quotation.ts:41`) then `redirect` to `/quotes/<publicId>` (`:53`). You never see the new card appear here — you are already inside the builder. On failure: `redirect("/quotes" + errorQuery(result))` (`:52`), so you land back here with the red strip.

### "Switch to Table View" / "Switch to Card View"

- `<Link href={href({ view: table ? "cards" : "table" })}>` — `src/app/(internal)/quotes/page.tsx:93-95`. No action, no schema, no write. It just flips `?view` while keeping `?status` (`:56-57`).

### The six stage chips

- `<Link href={href({ status: null })}>` for All (`:104`) and `<Link href={href({ status: s })}>` for each stage (`:108`). Read-only navigation; both queries re-run on the new URL because the page is `force-dynamic`.

### Clicking a card

- `<Link href={\`/quotes/${q.publicId}\`}>` wrapping the whole card (`:137`). Opens the quotation detail / builder.

### Clicking a table row

- `rowHref` (`:120`) → `ClickableRow` (`src/components/shared/clickable-row.tsx:9-17`), which does `router.push(href)` on click and on Enter/Space, ignores clicks that landed on an inner `a, button, input, select, textarea` (`:13`), and prefetches on hover (`:24`).

Nothing on this screen is drag-and-drop. You **cannot** move a card between columns — the stage is a function of `quotation.status`, and status only changes through the lifecycle actions on the detail screen and in the approval/portal/fulfillment services (`src/lib/state/quotation.machine.ts:9-23`).

## 7. Scenarios

1. **Happy path — a rep opens Quotations.**
   `/quotes` renders the board with five columns. `findMany` returns up to 200 rows ordered by `last_activity_at desc` (`:46-47`), and each one is dropped into a column by `STAGE_OF` (`:125`). **You see:** cards ordered newest-activity-first within every column, chips across the top with database-wide counts.

2. **Fresh seed, before anyone touches anything.**
   `prisma/seed/a-quotes.ts` writes `Q-2026-0001` (Acme, empty, `lastActivityAt = daysAgo(0)`) and `Q-2026-0004` (Beta, two lines, `daysAgo(1)`); `prisma/seed/b-history.ts:74-123` adds 24 PAID/CONFIRMED quotes, one SENT anomaly, a Gamma DRAFT idle 9 days, a Beta APPROVED idle 14 days, and one FULFILLMENT order. **You see:** Draft column has `Q-2026-0001` (₹0.00, "Acme Corp"), `Q-2026-0004` (₹1,36,880.00, "Beta Industries") and the Gamma draft; Approved has one Beta card; Negotiation has the SENT Acme card with a blue "Sent" sub-badge; Confirmed has 25 cards, each showing "Confirmed" or "Paid" as a sub-badge. Pending Approval is **empty** — the seed never produces one.

3. **The database is empty.**
   `quotes.length === 0` at `:114` → `EmptyState` with "No quotations yet / Press New Quotation to start one; the customer is picked inside the quotation." (`:115-118`). Note the five board columns are **not** drawn — you get one dashed panel, not an empty pipeline. The chips still render, all reading `0`.

4. **You click "Approved" and there is nothing approved.**
   URL becomes `/quotes?status=APPROVED`. The `where` at `:44` selects only `APPROVED`. Zero rows → `:116` builds the title from the label: **"No approved quotations"**. The chip above still shows `Approved 0`, so the two agree.

5. **You filter, then switch view.**
   From `/quotes?status=DRAFT`, "Switch to Table View" builds `href({ view: "table" })`; `next.status` is `undefined`, so `:56` keeps the current `filter` and you land on `/quotes?status=DRAFT&view=table`. Your filter survives. Conversely, clicking a chip while in table view keeps `view=table` (`:57`).

6. **A quote in an unusual status — REJECTED.**
   A manager rejects `Q-2026-0007`. `status` becomes `REJECTED`. `STAGE_OF.REJECTED = "DRAFT"` (`:24`), so the card reappears in the **Draft** column with a red "Rejected" badge under the number (`:146`), and the Draft chip's count includes it. **Why:** the mockup has only five columns, and the comment at `:19-20` says every other status folds into the nearest one "so no quotation disappears from the board". In **table** view the Stage column shows the true `Rejected` badge (`:77`) — the two views disagree on purpose.

7. **A PAID quote.**
   `STAGE_OF.PAID = "CONFIRMED"` (`:31`). It sits in Confirmed with a green "Paid" sub-badge, and the Confirmed chip counts it. There is no "closed" column, so the Confirmed column grows forever.

8. **You type `?status=SENT` by hand.**
   `CHIPS.find(s => s === "SENT")` returns `undefined` (`:39`, `CHIPS` at `:18` has no SENT). `filter` is falsy → no `where` → **you get the unfiltered board**, and the "All" chip is highlighted. No error is shown. Use `?status=UNDER_NEGOTIATION` to see sent quotes.

9. **A Sales Manager presses "+ New Quotation".**
   `assertActor` throws `ForbiddenError("A sales manager cannot edit lines")` (`src/lib/state/quotation.machine.ts:66-69`), mapped by `toActionError` (`src/lib/contract.ts:159-160`), and `createQuotationAndOpen` redirects to `/quotes?error=A+sales+manager+cannot+edit+lines` (`src/app/(internal)/actions/quotation.ts:52`). **You see:** the same board plus a red strip at `:100`. The button is not hidden for their role.

10. **More than 200 quotations — the number that lies.**
    The dev database currently holds 178, so this has not bitten yet, but at 201: the chips read the real totals from `groupBy` (`:49`), while the per-column headers read `inStage.length` (`:132`), which counts only the rows in the 200-row page. **You see:** "Draft 240" in the chip and `200` at the top of the Draft column, with no explanation and no pagination control. Filtering to one stage makes it accurate again for that stage (up to 200).

11. **Stale data / another user acts.**
    Someone confirms a quote you are looking at. Your board does not move; there is no polling. The page is `force-dynamic` (`:16`), so any navigation or the header's **Reload Data** (`src/components/shell/workspace-actions.tsx:21`) re-runs both queries. Server actions from other screens call `revalidatePath("/quotes")` (`src/app/(internal)/actions/quotation.ts:41` and friends), which invalidates the cache but does not push anything to an already-open tab.

12. **Concurrent edits.**
    Nothing on this page writes to a quotation, so there is no conflict to have here. The optimistic lock lives one screen down: `lockQuotation` does `updateMany({ where: { id, version } , data: { version: { increment: 1 } } })` and throws `ConflictError("This quotation was changed by someone else. Refresh and try again.")` when zero rows matched (`src/services/support.ts:7-10`). The only way that surfaces on `/quotes` is through the `?error=` strip after a redirecting action.

13. **Session dies while the board is open.**
    Clicking a card triggers a navigation; the middleware finds the session expired (`src/middleware.ts:48`), deletes the cookie (`:41`) and redirects to `/login?next=%2Fquotes%2FaB3xQ...`. After logging in, `safeNextPath` (`src/lib/auth/internal.ts:57-62`) takes you to the quotation you clicked.

14. **A rep opens someone else's quotation from this board.**
    Allowed — `/quotes/<publicId>` has no ownership guard on read (`src/app/(internal)/quotes/[publicId]/page.tsx:38` passes no role list). The builder renders read-only because `canEdit` requires `q.repUserId === user.id || user.role === "ADMIN"` (`:53`), and any write would be rejected by `assertOwnerOrAdmin` (`src/services/support.ts:12-16`).

## 8. Schema behind this screen

```prisma
model Quotation {                                  // prisma/schema.prisma:439
  id             Int             @id @default(autoincrement())
  publicId       String          @unique @map("public_id")   // the /quotes/<id> href on every card and row
  number         String          @unique                     // "Q-2026-0004" shown on the card and in column 1
  customerId     Int?            @map("customer_id")         // NULL -> "No customer yet"
  repUserId      Int             @map("rep_user_id")         // Rep column; NOT used to filter this list
  status         QuotationStatus @default(DRAFT)             // folded to a column by STAGE_OF; the chip counts
  total          Int             @default(0)                 // paise; the Amount / card figure
  marginBp       Int?            @map("margin_bp")           // basis points; NULL -> "n/a" in the Margin column
  lastActivityAt DateTime        @default(now()) @map("last_activity_at") // the sort key AND the card footer date
  version        Int             @default(1)                 // optimistic lock, used on the detail screen only
  customer Customer? @relation(fields: [customerId], references: [id])  // left join for the name
  rep      User      @relation("QuotationRep", fields: [repUserId], references: [id]) // inner join for the name
  @@index([status])                             // used when a chip filter is active
  @@index([repUserId, lastActivityAt])          // unused here — this page never filters by rep
}

enum QuotationStatus {                             // prisma/schema.prisma:57
  DRAFT PENDING_APPROVAL APPROVED REJECTED SENT
  UNDER_NEGOTIATION CONFIRMED FULFILLMENT PAID CANCELLED
}                                                  // ten values, five columns; STAGE_OF does the folding

model Customer {                                   // prisma/schema.prisma:236
  id   Int    @id @default(autoincrement())
  name String                                 // the card headline and the Customer column
}

model User {                                       // prisma/schema.prisma:191
  id   Int    @id @default(autoincrement())
  name String                                 // the Rep column and the card footer
}

model Counter {                                    // prisma/schema.prisma:428
  key   String @id                            // "quotation"
  value Int    @default(0)                    // last used sequence -> quotation.number
}

model AuditLog {                                   // prisma/schema.prisma:564
  quotationId Int? @map("quotation_id")       // written on create; also bumps quotation.last_activity_at
  action      String                          // "CREATE" for the + New Quotation button
}
```

## 9. How this screen connects to the others

**Links in:**

- "Quotations" header tab, on every internal screen (`src/lib/nav.ts:10`) — no role condition.
- The dashboard's **Open Quotations** tile (`src/app/(internal)/dashboard/page.tsx:52`).
- Every failed redirecting quotation action lands here with `?error=` — `createQuotationAndOpen` (`src/app/(internal)/actions/quotation.ts:52`) and any other form action that uses `errorQuery` against the `/quotes` base.

**Links out:**

| Control | Goes to | Condition for it to appear |
|---|---|---|
| Any card | `/quotes/<publicId>` | one per fetched quotation (`:137`) |
| Any table row | `/quotes/<publicId>` | `?view=table` only (`:120`) |
| Six chips | `/quotes?status=…` | always (`:104-111`) |
| View toggle | `/quotes?view=table` ⇄ `/quotes` | always (`:93`) |
| + New Quotation | `/quotes/<publicId>` on success, `/quotes?error=…` on refusal | always rendered; succeeds only for SALES_REP / ADMIN |

The board is the **entry point to the whole order path**: from a card you reach the builder, from the builder Submit for Approval creates the `approval_request` that shows on `/approvals`, portal confirmation moves the quote to CONFIRMED which makes it appear on `/fulfillment`, and payment moves it to PAID which shows on `/invoices`. Each of those transitions changes `quotation.status`, which is exactly what moves the card between columns here.

## 10. Gotchas

1. **The chip count and the column count are computed differently.** Chips come from a full `groupBy` over the table (`:49`); column headers come from `inStage.length` on the 200-row page (`:132`). Past 200 quotations they diverge with no warning and no pagination.
2. **`take: 200` is a silent truncation.** No "load more", no page numbers, no note in the UI (`:47`).
3. **Only five `?status` values are accepted.** `?status=SENT`, `?status=PAID`, `?status=REJECTED` all fall through to "All" (`:18`, `:39`) instead of erroring. There is no way to filter to Rejected or Cancelled from the UI at all.
4. **The board hides the real status; the table shows it.** `REJECTED` and `CANCELLED` sit in the Draft column, `PAID` and `FULFILLMENT` in Confirmed (`:22-33`). The card mitigates this with a sub-badge only when the status differs (`:146`). Switch to table view to see the true stage.
5. **Empty board = no columns.** When the query returns zero rows the whole pipeline is replaced by a single dashed panel (`:114-118`), so you never see five empty columns even in the "no quotations yet" state — unlike the mockup, which draws empty columns.
6. **Every role sees every rep's quotations.** No page guard, no `repUserId` filter. `@@index([repUserId, lastActivityAt])` exists in the schema (`prisma/schema.prisma:482`) as if scoping were intended, but nothing uses it.
7. **The cards are not draggable.** It looks like a Kanban board; it is a read-only grouping. Status changes happen through the state machine (`src/lib/state/quotation.machine.ts:9-23`) on other screens.
8. **`?error=` is reflected text from the URL.** `src/app/(internal)/quotes/page.tsx:100` prints `sp.error` directly. React escapes it, so it cannot inject markup, but anyone can craft a `/quotes?error=…` link that shows an arbitrary red message.
9. **Margin reads `n/a` on every empty draft.** `margin_bp` is null whenever `net_total` is 0 (`src/lib/contract.ts:216`, `src/services/quotation.service.ts:378`), and `formatBp`'s default fallback is the string `n/a` (`src/lib/format.ts:46`). That is correct behaviour, not missing data.
10. **Money is integer paise everywhere.** `quotation.total` = 13 688 000 means ₹1,36,880.00. Never treat these columns as rupees or as floats; `Money` (`src/components/shared/money.tsx:5`) and `formatMoney` (`src/lib/format.ts:34`) do the divide-by-100.
11. **The dev database is polluted.** It currently holds 178 quotations (59 DRAFT, 17 PENDING_APPROVAL, 15 APPROVED, 11 REJECTED, 18 SENT, 3 UNDER_NEGOTIATION, 32 CONFIRMED, 16 FULFILLMENT, 7 PAID) left by earlier agents, and the seeded history quotes `Q-2026-1001…1024` are not present in it. Use the seed files, not the running database, as the reference for what a clean install looks like.
12. **Declared but not wired:** `PIPELINE` is just an alias for `CHIPS` (`:21`) — two names, one array. The mockup's dollar amounts (`Acme Corp - $12,400`) are USD placeholders; the app is INR-only (`quotation.currency` defaults to `"INR"` at `prisma/schema.prisma:446` and is never read by any screen).
