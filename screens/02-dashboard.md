# Screen 02 — Sales Dashboard

## 1. What this screen is

- **Route:** `/dashboard`
- **Page file:** `src/app/(internal)/dashboard/page.tsx`
- **Mockup:** screen 2, "Sales Dashboard" (`docs/mockup/02-sales-dashboard.png`, text list in `docs/MOCKUP_SCREENS.md:19-28`)
- **Kind:** list / overview screen. It has no `[id]` segment and no detail pane.
- **Job:** the landing page after login. Three counts (approvals waiting, deals still open, deals Deal Health has flagged), two buttons, and the last six things anybody did in the system.

It is also the **redirect target** for two failures elsewhere: the middleware sends a Sales Rep who typed `/admin` here (`src/middleware.ts:26-29`), and `requireUser(roles)` sends a wrong-role user here (`src/lib/auth/internal.ts:78`). See Gotchas — the page ignores both signals.

The file still carries a header comment calling itself a "Placeholder home by B" (`src/app/(internal)/dashboard/page.tsx:1-2`). That comment is stale: the page reads live data and is the shipped dashboard. Trust the code.

## 2. Who can open it, and who enforces that

| Role | Can reach `/dashboard`? | Where that is enforced |
|---|---|---|
| ADMIN | Yes | `src/middleware.ts:21-32` (valid `df_session` → `NextResponse.next()`), then `src/app/(internal)/layout.tsx:12` |
| SALES_MANAGER | Yes | same |
| FINANCE | Yes | same |
| SALES_REP | Yes | same |
| portal CONTACT | **No** | `src/middleware.ts:17` picks `SESSION_COOKIE` (`df_session`) for any non-`/portal` path. A contact only holds `df_portal` (`src/lib/auth/constants.ts:4`), so `token` is undefined and `src/middleware.ts:35-42` redirects to `/login?next=%2Fdashboard`… actually to `/login` with no `next`, because `src/middleware.ts:39` drops `next` when it equals the home path. |
| anonymous | No | same redirect |

The four enforcement layers, for this screen:

1. **Middleware** — `src/middleware.ts:12-43`. Runs on the Node runtime (`src/middleware.ts:57`) so it can hit Postgres. `sessionRole()` (`src/middleware.ts:46-49`) loads `session` joined to `app_user` and returns null if the row is missing, `expires_at` has passed, or `app_user.is_active` is false. The matcher (`src/middleware.ts:59`) covers `/dashboard`.
2. **Layout guard** — `src/app/(internal)/layout.tsx:12` calls `requireUser()` with no role list, so it only checks "logged in", and redirects to `/login` if not (`src/lib/auth/internal.ts:77`). This is the belt to the middleware's braces; it also produces the `user` object the header chip needs.
3. **Page guard** — **none.** `src/app/(internal)/dashboard/page.tsx` never calls `requireUser`. Every internal role sees exactly the same numbers. There is no per-rep scoping anywhere on this page.
4. **Action guard** — the one action here (`+ New Quotation`) is guarded inside the service: `requireActionUser()` at `src/app/(internal)/actions/quotation.ts:40`, then `assertActor(actorFromUser(user), "EDIT_LINES")` at `src/services/quotation.service.ts:68`, whose table (`src/lib/state/quotation.machine.ts:28`) allows only `SALES_REP` and `ADMIN`. A Sales Manager or Finance user sees the button and is refused when they press it.

## 3. Everything on the screen, and where each value comes from

| What you see | Example value | Which query produced it | table.column | How that value came to exist |
|---|---|---|---|---|
| Page title "Sales Dashboard" | `Sales Dashboard` | none — literal | — | Hard-coded at `src/app/(internal)/dashboard/page.tsx:29`. Mockup says "Sales Dashboard / Home"; the code drops "/ Home". |
| Sub-line | "Central hub: pending approvals, open deals and everything Deal Health has flagged." | none — literal | — | `src/app/(internal)/dashboard/page.tsx:30`. |
| **Pending Approvals** number | `17` on the current dev DB; `0` on a fresh seed | `prisma.quotation.count({ where: { status: "PENDING_APPROVAL" } })` — `src/app/(internal)/dashboard/page.tsx:16` | `quotation.status` (`prisma/schema.prisma:445`) | The column defaults to `DRAFT` (`prisma/schema.prisma:445`). It becomes `PENDING_APPROVAL` only when a rep presses Submit for Approval on the quotation detail screen: `confirmQuotation` in `src/services/quotation.service.ts` writes the status after `riskPreview()` returns a non-empty approver chain, which comes from the `approval_rule` rows seeded at `prisma/seed/b-governance.ts:11-23` scored against the `risk_config` row at `prisma/seed/b-governance.ts:25-40`. **The seed never creates a PENDING_APPROVAL quotation** (`prisma/seed/a-quotes.ts` makes two DRAFTs; `prisma/seed/b-history.ts` makes PAID/CONFIRMED/SENT/DRAFT/APPROVED/FULFILLMENT), so on a clean `pnpm reset` this tile reads **0**. |
| Pending Approvals caption | "17 quotations waiting for a reviewer" — actually the caption is just "quotations waiting for a reviewer" | ternary at `src/app/(internal)/dashboard/page.tsx:48` | — | Singular/plural chosen from the count itself: `pendingApprovals === 1 ? "quotation" : "quotations"`. |
| Pending Approvals colour | amber when > 0 | `src/app/(internal)/dashboard/page.tsx:50` | — | `tone={pendingApprovals > 0 ? "warning" : "default"}`; the tone maps to `text-warning` and an amber left bar in `src/components/shared/stat-tile.tsx:25-36`. |
| **Open Quotations** number | `112` on the current dev DB (59 DRAFT + 17 PENDING + 15 APPROVED + 18 SENT + 3 UNDER_NEGOTIATION); `2` on a fresh seed | `prisma.quotation.count({ where: { status: { in: ["DRAFT","PENDING_APPROVAL","APPROVED","SENT","UNDER_NEGOTIATION"] } } })` — `src/app/(internal)/dashboard/page.tsx:17` | `quotation.status` | Same column. The five statuses are the same set as `OPEN_STATUSES` (`src/lib/state/quotation.machine.ts:44`) but they are **retyped inline**, not imported. `REJECTED` and `CANCELLED` are excluded, so a rejected quote silently leaves this count. On a fresh seed the two DRAFTs are `Q-2026-0001` (empty, `prisma/seed/a-quotes.ts:47-56`) and `Q-2026-0004` (`prisma/seed/a-quotes.ts:106-127`), plus whatever `prisma/seed/b-history.ts:108-109` adds — a Gamma DRAFT, a Beta APPROVED and the SENT anomaly quote — so a truly clean seed shows **5**. |
| **At-Risk Deals** number | `31` on the current dev DB; `0` immediately after a seed | `prisma.dealAlert.count({ where: { resolvedAt: null } })` — `src/app/(internal)/dashboard/page.tsx:18` | `deal_alert.resolved_at IS NULL` (`prisma/schema.prisma:945-962`) | `deal_alert` rows are **never seeded**. They are written only by `refreshAlerts()` (`src/services/health.service.ts:61-69`), which is called from exactly one place: the Deal Health page, `src/app/(internal)/health/page.tsx:22`. The detector inputs are `quotation.last_activity_at` (stalled), `quotation.gross_total`/`discount_total` per rep (anomaly) and `quotation.promised_date` vs `fulfillment_line.expected_date` (slippage), all read at `src/services/health.service.ts:26-38`, thresholds from `risk_config` (`src/services/health.service.ts:15-18`, seeded at `prisma/seed/b-governance.ts:35-38`: stalledDays 3, z 2, 10 points, minHistory 5). **So this tile is a cache: it shows what the last visit to `/health` left behind.** |
| At-Risk caption / colour | "flagged by Deal Health"; red when > 0 | `src/app/(internal)/dashboard/page.tsx:56-58` | — | Literal caption; `tone={atRisk > 0 ? "danger" : "default"}`. |
| Tile is clickable | whole tile is a link | `src/components/shared/stat-tile.tsx:47-50` | — | `href` props at `src/app/(internal)/dashboard/page.tsx:49`, `:52`, `:58` → `/approvals`, `/quotes`, `/health`. |
| **Recent Activity** — actor name | `Riya Rao` | `prisma.auditLog.findMany` — `src/app/(internal)/dashboard/page.tsx:19-23` | `audit_log.actor_name` (`prisma/schema.prisma:572`) | Written by the single audit helper `audit()` at `src/lib/audit.ts:26-33`, from `Actor.name`. For an internal user that is `actorFromUser(u)` = `{ type:"USER", id, name, role }` (`src/lib/contract.ts:182`), whose `name` is `app_user.name` — e.g. `"Riya Rao"`, seeded at `prisma/seed/b-users.ts:12`. For a portal customer it is `actorFromPortal` (`src/lib/contract.ts:183`) → `"Nisha Acme (Acme Corp)"`, built from `customer_contact.name` + `customer.name` (`prisma/seed/a-customers.ts:24`). For the system it is `"System"` (`src/lib/contract.ts:181`). |
| Recent Activity — verb | `line update`, `set customer`, `create` | same query | `audit_log.action` (`prisma/schema.prisma:569`) | The service that made the change passes an UPPER_SNAKE verb: `"CREATE"` at `src/services/quotation.service.ts:86`, `"SET_CUSTOMER"` at `:117`, `"LINE_ADD"` at `:193`, `"LINE_UPDATE"` at `:163`. The page lower-cases it and swaps underscores for spaces: `a.action.toLowerCase().replaceAll("_", " ")` (`src/app/(internal)/dashboard/page.tsx:75`). No lookup table, so you read raw verbs. |
| Recent Activity — quotation number link | `Q-2026-0004` | the `include` at `src/app/(internal)/dashboard/page.tsx:22` | `quotation.number` (`prisma/schema.prisma:442`) via `audit_log.quotation_id` (`prisma/schema.prisma:568`) | `number` is minted once at creation by `nextNumber(tx,"quotation","Q")` (`src/services/support.ts:19-22`): it upserts the `counter` row keyed `"quotation"` inside the same transaction and formats it with `formatNumber` (`src/lib/ids.ts:21`) as `Q-<UTC year>-<4 digits>`. The counter starts at 4 from the seed (`prisma/seed/a-quotes.ts:38-44`), so the first quotation you create by hand is `Q-2026-0005`. |
| Recent Activity — link target | `/quotes/aB3xQ...` | same include (`publicId`) | `quotation.public_id` (`prisma/schema.prisma:441`) | 12 random URL-safe characters from `publicId()` (`src/lib/ids.ts:8-13`), generated at `src/services/quotation.service.ts:74`. Integer ids never appear in URLs. |
| Recent Activity — customer in brackets | `(Acme Corp)` or `(no customer)` | nested include at `src/app/(internal)/dashboard/page.tsx:22` | `customer.name` (`prisma/schema.prisma:239`) via `quotation.customer_id` | `customer.name` is seeded at `prisma/seed/a-customers.ts:24-26` (Acme Corp / Beta Industries / Gamma Retail) or written by `createCustomer` (`src/services/quotation.service.ts:51-60`). `quotation.customer_id` is **nullable** (`prisma/schema.prisma:443`) because a draft opens before a customer is chosen (`src/services/quotation.service.ts:76`), so the page falls back to the string `"no customer"` (`src/app/(internal)/dashboard/page.tsx:83`). |
| Recent Activity — timestamp | `05 Sept, 14:30` | `orderBy: { at: "desc" }` | `audit_log.at` (`prisma/schema.prisma:577`) | Database default `now()`; formatted by `formatDateTime` (`src/lib/format.ts:73-76`) with `Intl.DateTimeFormat("en-IN")` fixed to `Asia/Kolkata` (`src/lib/format.ts:5`, `:22-29`). So the clock is always IST regardless of the viewer. |
| "No activity yet" empty card | shown when there are zero audit rows | `recent.length === 0` at `src/app/(internal)/dashboard/page.tsx:67` | — | `EmptyState` (`src/components/shared/empty-state.tsx:6`). **This is the state right after `pnpm reset`**: no seed file writes an `audit_log` row (grep `prisma/seed/*.ts` — `audit` is never imported), so the seeded quotations have no history. |
| Header: brand, nine tabs, Reload / Back-end / Close Workspace, user chip | — | `src/app/(internal)/layout.tsx:15-27` | `app_user.name`, `app_user.role` | Tabs come from the static list `NAV_ITEMS` (`src/lib/nav.ts:8-18`) filtered by role (`src/lib/nav.ts:21-23`) — only "Product" is role-gated. "Go to Back-end" appears only for `BACKEND_ROLES` (`src/lib/contract.ts:63`) via `canOpenBackend` (`src/lib/nav.ts:25-27`) passed at `src/app/(internal)/layout.tsx:22`. |

## 4. The queries this page runs

All four run in parallel in one `Promise.all` (`src/app/(internal)/dashboard/page.tsx:15-24`).

1. `prisma.quotation.count({ where: { status: "PENDING_APPROVAL" } })` — `:16`. No select, no join; Postgres answers from the `@@index([status])` on `quotation` (`prisma/schema.prisma:481`). Feeds tile 1.
2. `prisma.quotation.count({ where: { status: { in: [...5 statuses] } } })` — `:17`. Same index. Feeds tile 2.
3. `prisma.dealAlert.count({ where: { resolvedAt: null } })` — `:18`. Uses `@@index([resolvedAt])` (`prisma/schema.prisma:961`). Feeds tile 3.
4. `prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 6, include: { quotation: { select: { number, publicId, customer: { select: { name } } } } } })` — `:19-23`.
   - **Ordering:** newest first, by `audit_log.at`.
   - **Limit:** 6 rows, matching the three-line mockup loosely.
   - **Include:** the quotation is a `LEFT JOIN` because `audit_log.quotation_id` is nullable — an admin editing a product or a warehouse writes an audit row with no quotation, and that row still shows here with no link. `customer` is a second left join because `quotation.customer_id` is nullable too.
   - **No `where`:** every entity type appears — `Quotation`, `QuotationLine`, `Invoice`, `StockLevel`, `RiskConfig`, whatever a service passed as `entityType` (`src/lib/audit.ts:6`).

There are three other queries you pay for on every load, from the layout, not the page: `getSessionUser()` runs `prisma.session.findUnique({ include: { user: true } })` (`src/lib/auth/session.ts:15`), and the middleware runs its own narrower `session` lookup before that (`src/middleware.ts:47`). So a dashboard load is two session reads plus four data reads.

There is **no** `export const dynamic` on this page. It is still rendered per request, because the layout calls `cookies()` through `getSessionUser` (`src/lib/auth/session.ts:13`), which opts the whole route out of static rendering.

## 5. Every condition on this page

| Condition | File:line | What each outcome means |
|---|---|---|
| `pendingApprovals === 1 ? "quotation" : "quotations"` | `:48` | Grammar only. Note "0 quotations" is correct, "1 quotation" is correct. |
| `tone={pendingApprovals > 0 ? "warning" : "default"}` | `:50` | Any pending approval turns the big number amber and paints the tile's left bar amber (`src/components/shared/stat-tile.tsx:27`, `:33`). Zero is neutral grey-blue. |
| `tone={atRisk > 0 ? "danger" : "default"}` | `:58` | Any unresolved alert turns the number red (`src/components/shared/stat-tile.tsx:28`, `:34`). |
| `recent.length === 0 ? <EmptyState/> : <ol>…` | `:67-91` | Zero audit rows → the "No activity yet" panel. One or more → the list. |
| `a.quotation ? <Link>…</Link> : null` | `:76-85` | The audit row belongs to a quotation → you get the number as a link plus the customer in brackets. It does not (admin/stock/config changes) → you see only "Admin update stock" with a timestamp and no way to click through. |
| `a.quotation.customer?.name ?? "no customer"` | `:83` | The quotation has a customer → its name. It is a bare draft → the literal text "(no customer)". |
| `href ? <Link>{tile}</Link> : tile` | `src/components/shared/stat-tile.tsx:47-53` | All three tiles pass `href`, so all three are links. |
| `visibleNavItems(role)` filter | `src/lib/nav.ts:22` | `SALES_REP` loses the "Product" tab; the other eight are shown to everyone. |
| `canOpenBackend(user.role)` | `src/lib/nav.ts:26`, used at `src/app/(internal)/layout.tsx:22` | ADMIN / SALES_MANAGER / FINANCE see the "Go to Back-end" button in the header; a rep does not. |

That is the complete list. The page has **no role branch of its own** — a Sales Rep and an Admin see byte-identical content.

## 6. Every action you can take here

### "View Approvals" (outline button)

- Plain `<Link href="/approvals">` (`src/app/(internal)/dashboard/page.tsx:33`). No server action, no schema, no write.
- Navigates to `/approvals` (`src/app/(internal)/approvals/page.tsx`), which has no role guard of its own either — every internal role can read the approvals list.

### "+ New Quotation" (primary button)

- Rendered as `<form action={createQuotationAndOpen}>` (`src/app/(internal)/dashboard/page.tsx:36-40`). It is a real form POST to a server action, so it works without JavaScript.
- **Server action:** `createQuotationAndOpen(formData)` — `src/app/(internal)/actions/quotation.ts:49-54`. It reads `formData.get("customerId")`, which is always absent on this screen (no hidden input), so it calls `createQuotation({})`.
- **Zod schema:** `createQuotationSchema` — `src/lib/validation/quotation.ts:6-10`. All three fields (`customerId`, `promisedDate`, `notes`) are optional, so `{}` parses. Parsed by `parseInput` at `src/app/(internal)/actions/quotation.ts:37`.
- **Service:** `quotations.createQuotation(input, user)` — `src/services/quotation.service.ts:66-92`, wrapped in `prisma.$transaction`.
- **Guards, in order:**
  1. `requireActionUser()` — `src/app/(internal)/actions/quotation.ts:40` → `src/lib/auth/internal.ts:86-91`. Throws `UnauthenticatedError` if the cookie is dead. No role list is passed here.
  2. `assertActor(actorFromUser(user), "EDIT_LINES")` — `src/services/quotation.service.ts:68` → `src/lib/state/quotation.machine.ts:66-71`. `QUOTATION_ACTORS.EDIT_LINES = ["SALES_REP","ADMIN"]` (`:28`). A Sales Manager gets `ForbiddenError("A sales manager cannot edit lines")`.
  3. Customer existence check — `src/services/quotation.service.ts:69-70`. Skipped here because no `customerId` was sent.
- **Tables/columns written:**
  - `counter` — `value` incremented for key `"quotation"` (`src/services/support.ts:20`).
  - `quotation` — a new row with `public_id` (random, `src/lib/ids.ts:8`), `number`, `customer_id = NULL`, `rep_user_id = <you>`, `promised_date = NULL`, `notes = NULL`; everything else takes its schema default: `status = DRAFT`, all money columns `0`, `version = 1`, `last_activity_at = now()` (`prisma/schema.prisma:445-467`).
  - `audit_log` — one row via `audit()` (`src/services/quotation.service.ts:82-89` → `src/lib/audit.ts:26-33`): `entity_type='Quotation'`, `action='CREATE'`, `actor_type='USER'`, `actor_name=<your name>`, `actor_role=<your role>`, `after_json={"number":"Q-2026-0005","customer":null}`.
  - `quotation.last_activity_at` — bumped again by `src/lib/audit.ts:42` because `quotationId` was passed.
- **Audit row:** yes, exactly one (`CREATE`).
- **What changes on screen:** nothing on `/dashboard` — the action redirects. `revalidatePath("/quotes")` fires first (`src/app/(internal)/actions/quotation.ts:41`), then `redirect(\`/quotes/${result.data.publicId}\`)` (`:53`) drops you straight into the empty builder. On failure it redirects to `/quotes?error=<message>` (`:52`, query built by `errorQuery` at `src/lib/contract.ts:165-168`) — **not** back to the dashboard.

### Header controls (from the layout, present on every internal screen)

- **Reload Data** — `router.refresh()` + a toast (`src/components/shell/workspace-actions.tsx:21-25`). Re-runs the four queries above; writes nothing.
- **Go to Back-end** — `<Link href="/admin">` (`src/components/shell/workspace-actions.tsx:38`), rendered only for backend roles.
- **Close Workspace** — `<form action={logoutAction}>` (`src/components/shell/workspace-actions.tsx:46`). Deletes the `session` row and clears the cookie (`src/lib/auth/internal.ts:49-54`).

## 7. Scenarios

1. **Happy path, Riya the rep logs in.**
   You submit the login form → `authenticate()` (`src/lib/auth/internal.ts:19-25`) matches `app_user` by lowercased email and `bcrypt.compare`, `createSession` (`:28-33`) inserts a `session` row with a 24-hour expiry (`src/lib/auth/constants.ts:5`), and you land on `/dashboard` (`safeNextPath` default, `src/lib/auth/internal.ts:57`). The middleware re-reads that session (`src/middleware.ts:47`), the layout reads it a second time (`src/lib/auth/session.ts:15`), and the four queries run. **You see:** three tiles and the six newest audit lines, each ending with an IST timestamp.

2. **Straight after `pnpm reset` — the "everything is zero" state.**
   Seed writes zero `audit_log` rows and zero `deal_alert` rows (no seed file imports `audit` or touches `deal_alert`). It writes five open quotations and no `PENDING_APPROVAL` one. **You see:** Pending Approvals `0` (grey), Open Quotations `5`, At-Risk Deals `0` (grey), and the "No activity yet" panel from `src/app/(internal)/dashboard/page.tsx:68`. This is expected, not a bug — until you either open `/health` or do some work.

3. **At-Risk Deals is stale.**
   You open `/health`, which calls `refreshAlerts()` (`src/app/(internal)/health/page.tsx:22`) and inserts, say, 31 `deal_alert` rows. Now `/dashboard` shows At-Risk Deals `31`. You then edit one of those stalled quotes, which bumps `last_activity_at` (`src/lib/audit.ts:42`) so the stall condition is gone — but `/dashboard` still shows `31`, because nothing on the dashboard runs the detectors. **Why:** `src/app/(internal)/dashboard/page.tsx:18` only counts rows; the resolve happens in `src/services/health.service.ts:67-68`, which runs only from `/health`. **You see:** the correct number only after clicking the At-Risk tile (which navigates to `/health` and recomputes on the way in).

4. **A Sales Manager presses "+ New Quotation".**
   The form posts, `requireActionUser()` passes (they are logged in), then `assertActor` throws `ForbiddenError("A sales manager cannot edit lines")` (`src/lib/state/quotation.machine.ts:66-69`). `toActionError` maps it to `{ ok:false, code:"FORBIDDEN" }` (`src/lib/contract.ts:159-160`), and `createQuotationAndOpen` redirects to `/quotes?error=A%20sales%20manager%20cannot%20edit%20lines` (`src/app/(internal)/actions/quotation.ts:52`). **You see:** you are thrown onto the Quotations screen with a red message strip (`src/app/(internal)/quotes/page.tsx:100`), not left on the dashboard. The button is never hidden for their role.

5. **A Sales Rep types `/admin` in the URL bar.**
   Middleware matches `pathname.startsWith("/admin")` and `!BACKEND_ROLES.includes("SALES_REP")` (`src/middleware.ts:25`), and redirects to `/dashboard?forbidden=admin` (`:27-29`). **You see:** the normal dashboard. No message. The page never reads `searchParams` — there is no `searchParams` prop on `DashboardPage` at all (`src/app/(internal)/dashboard/page.tsx:14`). The `?forbidden=admin` is dead in the URL bar.

6. **A Sales Rep clicks the "Reports" tab.**
   The tab is visible to every role (`src/lib/nav.ts:16` has no `roles` key), but `src/app/(internal)/reports/page.tsx:18` calls `requireUser(BACKEND_ROLES)`, which redirects to `/dashboard?forbidden=1` (`src/lib/auth/internal.ts:78`). **You see:** you bounce back to the dashboard with no explanation, same as above.

7. **Your session expires while the tab is open.**
   You click "View Approvals". Middleware finds the `session` row but `expires_at <= now()`, so `sessionRole` returns null (`src/middleware.ts:48`), and you are redirected to `/login?next=%2Fapprovals` with the stale cookie deleted (`src/middleware.ts:41`). After logging back in, `safeNextPath` (`src/lib/auth/internal.ts:57-62`) returns you to `/approvals`.

8. **An admin deactivates your account mid-session.**
   `app_user.is_active` goes false. The very next request fails both `sessionRole` (`src/middleware.ts:48`) and `getSessionUser` (`src/lib/auth/session.ts:16`), so you are logged out on the next click. The role is read from the database on every request — nothing is cached in the cookie (`src/lib/auth/internal.ts:2-4`).

9. **Two people work at once.**
   Another rep creates a quotation. Your dashboard does not update — there is no polling and no websocket. Press **Reload Data** in the header (`src/components/shell/workspace-actions.tsx:21`) or navigate away and back; the page is dynamic, so any fresh request re-runs the four counts.

10. **An audit row with no quotation.**
    An admin edits a product; `admin.service.ts` writes an `audit_log` row with `entityType:'Product'` and no `quotationId`. Because the dashboard query has no `where` (`src/app/(internal)/dashboard/page.tsx:19-23`), that row appears in Recent Activity as `Admin update product` with no link and no bracketed customer (the `a.quotation ? … : null` branch at `:76`). **You see:** a line you cannot click through.

11. **A quotation is deleted.**
    `audit_log.quotation_id` is `onDelete: Cascade` (`prisma/schema.prisma:579`), so the history goes with it. Recent Activity would simply show older rows instead. Nothing in the UI deletes quotations today.

## 8. Schema behind this screen

```prisma
model Quotation {                                  // prisma/schema.prisma:439
  id             Int             @id @default(autoincrement())
  publicId       String          @unique @map("public_id")   // the /quotes/<id> link in Recent Activity
  number         String          @unique                     // "Q-2026-0004", the visible link text
  customerId     Int?            @map("customer_id")         // nullable -> "(no customer)" on the dashboard
  repUserId      Int             @map("rep_user_id")         // set to the creator; NOT used to filter this screen
  status         QuotationStatus @default(DRAFT)             // the only column both count tiles read
  lastActivityAt DateTime        @default(now()) @map("last_activity_at") // bumped by audit(); feeds the stalled detector behind tile 3
  customer  Customer?  @relation(fields: [customerId], references: [id])
  auditLogs AuditLog[]
  alerts    DealAlert[]
  @@index([status])                                          // the index both count() calls use
}

model AuditLog {                                   // prisma/schema.prisma:564
  id          Int       @id @default(autoincrement())
  entityType  String    @map("entity_type")   // "Quotation" | "QuotationLine" | "Product" | ... (not filtered here)
  entityId    Int       @map("entity_id")     // unused on this screen
  quotationId Int?      @map("quotation_id")  // nullable -> decides whether the line gets a link
  action      String                          // "CREATE", "LINE_ADD", ... lower-cased for display
  actorType   ActorType @map("actor_type")    // USER | CONTACT | SYSTEM; unused on this screen
  actorName   String    @map("actor_name")    // the bold name at the start of each line
  actorRole   String?   @map("actor_role")    // stored but not shown here
  at          DateTime  @default(now())       // the sort key and the right-hand timestamp
  quotation   Quotation? @relation(fields: [quotationId], references: [id], onDelete: Cascade)
  @@index([quotationId, at])
}

model DealAlert {                                  // prisma/schema.prisma:945
  id          Int       @id @default(autoincrement())
  quotationId Int       @map("quotation_id")
  type        AlertType                      // STALLED | DISCOUNT_ANOMALY | DELIVERY_SLIPPAGE
  resolvedAt  DateTime? @map("resolved_at")  // the ONLY column this screen reads: NULL = still counted
  @@index([resolvedAt])
}

model Customer {                                   // prisma/schema.prisma:236
  id   Int    @id @default(autoincrement())
  name String                                 // the "(Acme Corp)" in each activity line
}

model User {                                       // prisma/schema.prisma:191
  name     String                              // copied into audit_log.actor_name at write time
  role     Role     @default(SALES_REP)        // decides the header tabs, not the page body
  isActive Boolean  @default(true) @map("is_active") // false = logged out on the next request
}
```

## 9. How this screen connects to the others

**Links in:**

- Login success — `safeNextPath(..., "/dashboard")` (`src/lib/auth/internal.ts:57`).
- The "Dashboard" tab, on every internal screen (`src/lib/nav.ts:9`). Always visible, no role condition.
- Middleware admin refusal — `/dashboard?forbidden=admin` (`src/middleware.ts:26-29`), when a `SALES_REP` requests any `/admin/*` path.
- Role refusal on any page that passes a role list to `requireUser` — `/dashboard?forbidden=1` (`src/lib/auth/internal.ts:78`). That is `/admin/*`, `/reports`, and nothing else on the internal side.

**Links out:**

| Control | Goes to | Condition for it to appear |
|---|---|---|
| Pending Approvals tile | `/approvals` | always (`:49`) |
| Open Quotations tile | `/quotes` | always (`:52`) |
| At-Risk Deals tile | `/health` | always (`:58`) |
| View Approvals button | `/approvals` | always (`:33`) |
| + New Quotation | `/quotes/<publicId>` of the brand-new draft, or `/quotes?error=…` | always rendered; succeeds only for SALES_REP / ADMIN |
| Recent Activity number | `/quotes/<publicId>` | only when `audit_log.quotation_id` is not null (`:76`) |
| Header tabs | eight fixed routes + `/admin/products` | "Product" only for `BACKEND_ROLES` (`src/lib/nav.ts:17`) |

Nothing links **from** the dashboard to fulfillment, invoices or subscriptions except through the header tabs — the three tiles cover approvals, quotes and health only, matching the mockup.

## 10. Gotchas

1. **The At-Risk tile is a stale cache.** It counts `deal_alert` rows but never recomputes them. Only `/health` calls `refreshAlerts()` (`src/app/(internal)/health/page.tsx:22`). A deal that recovered still shows as at-risk until someone visits Deal Health. The docblock at the top of `src/services/health.service.ts:1-2` says alerts are recomputed "on every dashboard load" — that is wrong for this dashboard; it is true only of `/health`. Trust the code.
2. **A fresh seed shows an empty Recent Activity.** No seed file writes `audit_log`. If the reader resets the database and thinks the feed is broken, it is not.
3. **`?forbidden=admin` and `?forbidden=1` are ignored.** Both middleware and `requireUser` redirect here with a reason, and the page has no `searchParams` prop at all (`src/app/(internal)/dashboard/page.tsx:14`). Refused users get no feedback whatsoever.
4. **"+ New Quotation" is shown to roles that cannot use it.** No role check wraps the button (`:36-40`); the refusal happens server-side and dumps you on `/quotes` with an error banner rather than telling you here.
5. **The open-status list is duplicated.** `["DRAFT","PENDING_APPROVAL","APPROVED","SENT","UNDER_NEGOTIATION"]` is typed inline at `:17` instead of importing `OPEN_STATUSES` (`src/lib/state/quotation.machine.ts:44`). The two agree today; a change to one will not propagate.
6. **No per-rep scoping.** `quotation.rep_user_id` exists and is indexed with `lastActivityAt` (`prisma/schema.prisma:482`), but the dashboard counts every quotation in the system for every role. A rep sees the manager's numbers.
7. **The header comment lies about the file.** `src/app/(internal)/dashboard/page.tsx:1` calls itself a placeholder "A replaces this file in feature 85". It was never replaced; this is the real screen.
8. **Timestamps are always IST.** `formatDateTime` hard-codes `Asia/Kolkata` (`src/lib/format.ts:5`, `:23`). There is no per-user timezone.
9. **The dev database is polluted.** At the time of writing it holds 178 quotations, 1088 audit rows and 31 open alerts left by earlier agents, and the seeded history quotes `Q-2026-1001…1024` (`prisma/seed/b-history.ts`) are **not** present. Any number you see there is not a seed number. The seed baseline is: 2 quotations from `prisma/seed/a-quotes.ts` plus 27 from `prisma/seed/b-history.ts`, 0 audit rows, 0 alerts.
10. **Declared but not wired:** the mockup's "3 flagged by Deal Health / 12 active deals / 4 quotations waiting" captions are copy in the drawing only — the real captions are static strings and the numbers are separate. There is no company/team selector anywhere, despite the mockup mentioning one on screen 1.
