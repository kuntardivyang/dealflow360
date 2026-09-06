# Screen 05 — Approvals List (`/approvals`)

## 1. What this screen is

One table of every discount-approval request that has ever been opened, plus three counters above it.

A row here is **not** a quotation. A row is one `approval_request` row. A quotation that never needed approval has no request and therefore never appears. A quotation that went through two approval rounds has **two** rows here (`src/services/approval.service.ts:165`).

Nobody creates a row by hand. The row is a side effect of one of four events, all listed in section 3.

The page file is `src/app/(internal)/approvals/page.tsx`. It is a React Server Component: it runs on the server, calls one service function, and ships HTML. There is no client-side fetching on this screen.

Mockup screen 5 (`docs/mockup/05-approvals-list.png`) asks for: title, subtitle, three counter chips, a five-column table, a "Filter: Pending Only" button, and "click any row". All are built. Two mockup details are **not** true of the code, and are explained in section 10: the mockup's `Q-1035 / LOW / Auto-Approved / -` row cannot exist, and the mockup shows five columns while the code renders six.

---

## 2. Who can open it, and who enforces that

There is **no role restriction on this screen at all**. Any logged-in internal user — including a Sales Rep — sees every approval request for every rep and every customer. That is deliberate in the code (there is no `where` clause and no `requireUser(roles)` call), but it is worth knowing.

| Role | Sees the "Approvals" tab? | Can open `/approvals`? | Sees all rows or only their own? | Can act from here? |
|---|---|---|---|---|
| `ADMIN` | Yes | Yes | All | No — the list has no buttons |
| `SALES_MANAGER` | Yes | Yes | All | No |
| `FINANCE` | Yes | Yes | All | No |
| `SALES_REP` | Yes | Yes | All, including other reps' quotes | No |
| Not logged in | — | No, redirected to `/login?next=/approvals` | — | — |
| Portal contact (customer) | — | No — the portal cookie is not the internal cookie | — | — |

The four enforcement layers, in the order a request passes through them:

| Layer | File:line | What it does on this screen |
|---|---|---|
| 1. Middleware (edge, Node runtime) | `src/middleware.ts:12`–`src/middleware.ts:43` | Reads the `df_session` cookie, looks the session up in the `session` table (`src/middleware.ts:47`), and redirects to `/login?next=%2Fapprovals` when it is missing, expired, or the user row is `is_active = false`. The `/admin` role check at `src/middleware.ts:25` does **not** apply to `/approvals`. |
| 2. Layout guard | `src/app/(internal)/layout.tsx:12` | `requireUser()` with no roles argument — re-checks the session server-side (belt to the middleware's braces) and redirects to `/login`. It also builds the nav tabs at `src/app/(internal)/layout.tsx:13` via `visibleNavItems` (`src/lib/nav.ts:21`); "Approvals" has no `roles` key at `src/lib/nav.ts:11`, so every role sees the tab. |
| 3. Page guard | `src/app/(internal)/approvals/page.tsx:12` | **None.** The list page never calls `requireUser` itself and never reads the session. Compare the detail screen, which does (`src/app/(internal)/approvals/[publicId]/page.tsx:30`). |
| 4. Service guard | `src/services/approval.service.ts:153` | **None.** `listApprovals()` takes no user argument and applies no ownership filter. |

`requireUser` itself: `src/lib/auth/internal.ts:75`. The role is read fresh from the `app_user` row on every request via the session lookup, so an Admin demoting someone takes effect immediately; nothing in the browser can claim a role.

---

## 3. Everything on the screen, and where each value comes from

Every value on this page comes from the single call `listApprovals()` at `src/app/(internal)/approvals/page.tsx:15`.

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Page title "Approvals" | `Approvals` | `src/app/(internal)/approvals/page.tsx:52` | — | Hard-coded string. |
| Subtitle | "Every quotation that needed, needs, or is going through discount approval…" | `src/app/(internal)/approvals/page.tsx:53` | — | Hard-coded; taken from the mockup text (`docs/MOCKUP_SCREENS.md:61`). |
| Browser tab title | `Approvals` | `src/app/(internal)/approvals/page.tsx:10` | — | Next.js `metadata` export. |
| "Pending" counter | `17` (dev DB) | `src/services/approval.service.ts:161` `groupBy({ by: ["status"] })`, read back at `:163`, `:190` | `approval_request.status` | Every request starts `PENDING` because the Prisma model defaults it (`prisma/schema.prisma:530`). It leaves `PENDING` only when someone decides it (`src/services/approval.service.ts:59`, `:73`, `:81`) or when a new round supersedes it (`src/services/quotation.service.ts:395`, `src/services/portal.service.ts:244`). |
| "Returned" counter | `6` (dev DB) | same `groupBy`, `src/services/approval.service.ts:190` | `approval_request.status = 'RETURNED'` | Written only by the RETURN branch at `src/services/approval.service.ts:59`. |
| "Approved" counter | `17` (dev DB) | same `groupBy`, `src/services/approval.service.ts:190` | `approval_request.status = 'APPROVED'` | Written at `src/services/approval.service.ts:81`, and only when the **last** pending step was just approved (`:77`–`:80`). |
| (no counter) Rejected / Superseded | 14 / 4 in the dev DB | — | — | Counted by the same `groupBy` but never displayed. The three tiles are fixed at `src/app/(internal)/approvals/page.tsx:61`–`:63`. Rejected and superseded rows still appear in the table. |
| Column "Quotation" | `Q-2026-0091` | `src/services/approval.service.ts:156` (`quotation` include), mapped at `:179`; rendered at `src/app/(internal)/approvals/page.tsx:24` | `quotation.number` | Allocated by `nextNumber(tx, "quotation", "Q")` when the rep pressed **+ New Quotation** (`src/services/quotation.service.ts:299`… the create at `:71`). The `counter` table holds the running number; the format is `Q-<year>-<4 digits>`. |
| The little `v2` next to the number | `v2` | `src/app/(internal)/approvals/page.tsx:25`, value from `src/services/approval.service.ts:186` | `approval_request.version` | Only rendered when `version > 1`. See section 5 and screen 06 for how a version is chosen. |
| Column "Customer" | `Acme Corp` | `src/services/approval.service.ts:156` (`customer` include), mapped at `:180` | `customer.name` | Set when the rep picked the customer on the quotation form (`setCustomer`, `src/services/quotation.service.ts:105`) or seeded (`prisma/seed/a-customers.ts`). `customer_id` is nullable, so `?? "–"` at `:180` guards a customerless quote — though confirm refuses to run without a customer (`src/services/quotation.service.ts:270`), so a request can never actually have one. |
| Column "Blended Risk" — the badge | `High` (red) | `riskBand(r.riskScore)` at `src/services/approval.service.ts:184`, rendered at `src/app/(internal)/approvals/page.tsx:35` | derived from `approval_request.risk_score` | `riskBand` is three lines: `score >= 50 → HIGH`, `score > 0 → MEDIUM`, else `LOW` (`src/lib/contract.ts:247`). Colours come from the shared badge map (`src/components/shared/status-badge.tsx:50`–`:52`). |
| Column "Blended Risk" — the number | `100` | `src/services/approval.service.ts:182`, rendered at `src/app/(internal)/approvals/page.tsx:36` | `approval_request.risk_score` | **Frozen at request creation.** Computed by `scoreLines` (`src/domain/risk.ts:33`) inside `recompute` (`src/services/quotation.service.ts:369`), then copied into the new request at `src/services/quotation.service.ts:303` (rep confirm) or `src/services/portal.service.ts:251` (customer counter / portal safety net). Nothing on this screen recomputes it. |
| Column "Stage" — resolved requests | `Approved`, `Rejected`, `Returned`, `Superseded` | `src/services/approval.service.ts:167`, rendered at `src/app/(internal)/approvals/page.tsx:43` | `approval_request.status` | Straight lookup from the status. |
| Column "Stage" — pending requests | `Sales Manager` or `Finance` | `actionableStep(r.steps)` at `src/services/approval.service.ts:166`, label at `:170` | `approval_step.required_role` of the **lowest-numbered PENDING step** | `actionableStep` (`src/lib/state/approval.machine.ts:29`) filters steps to `PENDING`, sorts by `step_no`, and returns the first. `ROLE_LABEL` turns `SALES_MANAGER` into `Sales Manager` (`src/lib/labels.ts:3`). So "Stage" answers *whose turn is it right now*, not *what state is the request in*. |
| Column "Assigned To" — a Sales Manager step | `Meera Shah` | `src/services/approval.service.ts:172`–`:173` | `app_user.name` of `quotation.rep.manager` | Chain: `approval_request.quotation_id` → `quotation.rep_user_id` → `app_user.manager_id` → that user's `name`. The rep's manager was set at signup/seed (`prisma/seed/b-users.ts:12` sets Riya's `managerId` to Meera). If the rep has no manager, the literal `Any sales manager` is shown (`:173`). |
| Column "Assigned To" — a Finance step | `Farhan Iyer` | `src/services/approval.service.ts:174`, list loaded at `:160` | `app_user.name` for every `role = 'FINANCE' AND is_active = true` | Finance is a pool, not a person: **all** active finance users are loaded once (`:160`, ordered by id) and joined with `, `. With no active finance user the literal `Finance` is shown. |
| Column "Assigned To" — resolved requests | `–` | default at `src/services/approval.service.ts:168` | — | En-dash literal. Only overwritten inside the `if (next)` block at `:169`. |
| Column "Submitted" | `05 Sep 2026, 14:11` | `src/services/approval.service.ts:187`, formatted at `src/app/(internal)/approvals/page.tsx:46` | `approval_request.created_at` | Postgres `now()` default (`prisma/schema.prisma:535`) at the instant the request row was inserted. This is the moment the quote entered approval, not the moment the quote was created. `formatDateTime` at `src/lib/format.ts:73`. |
| Row click target | `/approvals/--_k2pqS27Tp` | `rowHref` at `src/app/(internal)/approvals/page.tsx:69`, value from `src/services/approval.service.ts:178` | `quotation.public_id` | A 12-character opaque id generated by `publicId()` at quotation creation (`src/services/quotation.service.ts:73`). Note the link uses the **quotation's** public id, not the request id — so two rows for the same quotation link to the same detail page. |
| "Filter: Pending Only" / "Show all" button | — | `src/app/(internal)/approvals/page.tsx:55`–`:57` | — | A plain `<Link>` toggling `?filter=pending`. No JavaScript state; the server re-renders. |
| Empty state | "No approval requests yet" / "Nothing waiting for approval" | `src/app/(internal)/approvals/page.tsx:70`–`:76` | — | Rendered by `DataTable` when `rows.length === 0` (`src/components/shared/data-table.tsx:39`). |

### Where a `risk_score` of 100 actually comes from — a full trace

Take request id 55 in the dev DB (quotation id 144, `Q-2026-0091`, Acme Corp, Gold tier).

1. `quotation_line` 195: `Laptop 14"`, qty 2, `discount_bp = 2500`, `ceiling_bp = 1500`, `gross = 12000000` paise.
   The ceiling 1500 is `min(tier 1500, category Hardware 1500)` — `lineCeilingBp`, `src/domain/risk.ts:20`; tier value from `customer_tier.discount_ceiling_bp` seeded at `prisma/seed/b-governance.ts:8`, category value from `product_category.discount_ceiling_bp` seeded at `prisma/seed/a-catalogue.ts:10`.
2. `quotation_line` 196: `Support Pro`, `discount_bp = 0`, `ceiling_bp = 1200` (`min(1500, Subscriptions 1200)`, `prisma/seed/a-catalogue.ts:16`), `gross = 200000`.
3. `scoreLines` (`src/domain/risk.ts:33`):
   - `worstOverageBp = 2500 - 1500 = 1000` (10 percentage points over).
   - `blendedOverageBp = (1000 × 12000000 + 0 × 200000) / 12200000 = 984`.
   - `marginPenaltyBp = max(0, floorMargin 2000 − orderMargin 783) = 1217`.
   - `raw = 0.50 × (1000/1000) + 0.40 × (984/500) + 0.10 × (1217/1000) = 0.5 + 0.787 + 0.122 = 1.409`, clamped to 1 → `score = 100`.
   Weights and normalisers come from the singleton `risk_config` row (`prisma/schema.prisma:408`), seeded at `prisma/seed/b-governance.ts:25`. Nothing in the formula is a constant.
4. `routeApproval` (`src/domain/route.ts:28`): rule 1 "Over limit" (`minScore 1`) fires, rule 2 "High risk or large order" (`minScore 50`) fires; the **longest** chain among the fired rules wins → `["SALES_MANAGER", "FINANCE"]` (`prisma/seed/b-governance.ts:13`–`:21`).
5. `confirmQuotation` / `openApprovalRound` writes `risk_score = 100`, `risk_breakdown = <the whole object>`, `chain = ["SALES_MANAGER","FINANCE"]`, and one `approval_step` per role (`src/services/quotation.service.ts:299`–`:308`).

The row then reads: `Q-2026-0091 v2 | Acme Corp | High 100 | Sales Manager | Meera Shah | 05 Sep 2026, 14:11`.

---

## 4. The queries this page runs

`listApprovals()` (`src/services/approval.service.ts:153`) fires three queries **in parallel** via `Promise.all` at `:154`:

1. **The rows** — `src/services/approval.service.ts:155`
   ```
   approvalRequest.findMany({
     include: { steps: orderBy stepNo asc,
                quotation: { customer, rep: { manager } } },
     orderBy: [ { status: "asc" }, { createdAt: "desc" } ],
     take: 200,
   })
   ```
   - No `where` — every request, every rep, every customer.
   - `status: "asc"` sorts by the **Postgres enum declaration order**, not alphabetically: `PENDING, APPROVED, REJECTED, RETURNED, SUPERSEDED` (`prisma/schema.prisma:81`–`:87`). So pending work floats to the top; that is the whole point of the sort.
   - `take: 200` is a hard cap. Request 201 onwards is silently invisible, and the counters (query 3) are not capped, so on a busy system the tiles and the table will disagree. See section 10.
   - Four levels of join in one query: request → steps, and request → quotation → customer, and quotation → rep → rep's manager.

2. **The finance pool** — `src/services/approval.service.ts:160`
   ```
   user.findMany({ where: { role: "FINANCE", isActive: true }, orderBy: { id: "asc" } })
   ```
   Loaded once for the whole page, not per row.

3. **The counters** — `src/services/approval.service.ts:161`
   ```
   approvalRequest.groupBy({ by: ["status"], _count: { _all: true } })
   ```
   A separate aggregate over the whole table — deliberately not derived from the 200 rows.

Then the mapping loop at `src/services/approval.service.ts:165`–`:189` does all the "stage / assigned to" work in memory. No further database round-trips.

The `?filter=pending` filter is applied **after** the query, in JavaScript, at `src/app/(internal)/approvals/page.tsx:16`.

Cache behaviour: the page is dynamic (it awaits `searchParams`). It is re-rendered after any decision because the decision action calls `revalidatePath("/approvals")` at `src/app/(internal)/actions/approval.ts:17`.

---

## 5. Every condition on this page

| Condition | Where | What it decides |
|---|---|---|
| `filter === "pending"` | `src/app/(internal)/approvals/page.tsx:14` | Whether rows are filtered to `status === "PENDING"` (`:16`), which label the button shows (`:56`), which URL it points at (`:55`), and which empty-state title appears (`:73`). |
| `r.status === "PENDING"` | `src/services/approval.service.ts:166` | Whether `actionableStep` is even called. Resolved requests never compute a stage or assignee. |
| `actionableStep(steps)` returns non-null | `src/lib/state/approval.machine.ts:29`, used at `src/services/approval.service.ts:169` | Whether Stage becomes a role name and Assigned To becomes a person. A `PENDING` request whose steps are all decided (possible after a REJECT — see section 10) falls through to `stage = "Pending"`, `assignedTo = "–"`. |
| `next.requiredRole === "SALES_MANAGER"` | `src/services/approval.service.ts:172` | Manager branch (the rep's own manager) vs finance branch (the whole finance pool). |
| `r.quotation.rep.manager?.name ?? "Any sales manager"` | `src/services/approval.service.ts:173` | Fallback when the rep row has `manager_id = null`. |
| `financeUsers.map(...).join(", ") \|\| "Finance"` | `src/services/approval.service.ts:174` | Fallback when there is no active finance user. |
| `r.quotation.customer?.name ?? "–"` | `src/services/approval.service.ts:180` | Guards the nullable `quotation.customer_id`. |
| `r.version > 1` | `src/app/(internal)/approvals/page.tsx:25` | Whether the `v2` suffix is drawn next to the quotation number. |
| `r.status === "PENDING"` (again, in the cell) | `src/app/(internal)/approvals/page.tsx:43` | Pending rows get a warning-toned badge carrying the role label; resolved rows get the badge for their own status. |
| `counts.pending > 0` | `src/app/(internal)/approvals/page.tsx:61` | Pending tile turns amber instead of neutral. |
| `rows.length === 0` | `src/components/shared/data-table.tsx:39` | Empty state instead of a table. |
| `score >= 50` / `score > 0` | `src/lib/contract.ts:247` | HIGH / MEDIUM / LOW band. |

---

## 6. Every action you can take here

This screen has **no server actions**. It is read-only. There are exactly three interactions:

| Interaction | What happens |
|---|---|
| Click **Filter: Pending Only** | `<Link href="/approvals?filter=pending">` (`src/app/(internal)/approvals/page.tsx:55`). Full server re-render; the button flips to "Show all". No mutation, no audit row. |
| Click the **Pending** stat tile | `href="/approvals?filter=pending"` (`src/app/(internal)/approvals/page.tsx:61`). Same destination as the filter button. The Returned and Approved tiles have no `href` and are not clickable (`:62`, `:63`). |
| Click any **row** | `rowHref` at `src/app/(internal)/approvals/page.tsx:69` → `/approvals/<quotation.public_id>`, rendered as a clickable row by `DataTable` (`src/components/shared/data-table.tsx:68`). This is the mockup's "click any row to open its full approval detail". |

The three decision buttons the mockup shows (`Approve` / `Return for Revision` / `Reject`) live on screen 06, not here.

---

## 7. Scenarios

**1. Single-approver chain: a row appears out of nowhere.**
Riya builds a quote for Beta Industries (Silver, ceiling 10 %) with one laptop line at 12 %. She presses Confirm. `confirmQuotation` (`src/services/quotation.service.ts:264`) recomputes, `routeApproval` returns `["SALES_MANAGER"]`, an `approval_request` is inserted with `version = 1` and one `approval_step` (`:299`–`:308`), and the quotation goes to `PENDING_APPROVAL` (`:309`). Riya never asked for approval. The Approvals list now shows a new top row: Stage `Sales Manager`, Assigned To `Meera Shah` (Riya's `manager_id`), Pending counter +1.

**2. Two-step chain: the Stage cell changes by itself.**
Same quote but the discount is bad enough that rule 2 fires, so the chain is `["SALES_MANAGER","FINANCE"]` and two steps exist. Before anyone acts, `actionableStep` returns step 1 → Stage `Sales Manager`, Assigned To `Meera Shah`. Meera approves. Step 1 becomes `APPROVED`, the request is **still** `PENDING` because `remaining.length > 0` (`src/services/approval.service.ts:77`–`:79`), and the quotation stays `PENDING_APPROVAL`. Reload the list: same row, but Stage now reads `Finance` and Assigned To reads `Farhan Iyer`. Nothing on this screen was clicked; the row re-derived itself from the step statuses.

**3. Finance cannot jump the queue — and the list already says so.**
Farhan sees the row at Stage `Sales Manager`. Even if he opens it, `assertCanDecide` (`src/lib/state/approval.machine.ts:38`) throws `An earlier step must be decided first` (`:49`), and before that the role check at `:45` throws `This step needs a sales manager`. The Stage column is the visual form of the same rule: it names the only role that can act right now.

**4. A rep opens the list and sees other people's deals.**
Arjun (SALES_REP) opens `/approvals`. Middleware passes (valid session), layout passes (no role filter), the page applies no filter, and `listApprovals` has no `where`. He sees Riya's Acme quote, its customer, its risk score and its assignee. He cannot act on any of them, but the data is visible. This is a real property of the current code, not an oversight in this document.

**5. Return for revision: one row changes, then a second row appears.**
Meera returns Q-2026-0091. `src/services/approval.service.ts:57` claims the whole request → `status = RETURNED`, `reason = <her note>`, `resolved_at = now`. The quotation goes back to `DRAFT` and its `approval_version` is bumped (`:100`). On the list: the row's Stage becomes `Returned`, Assigned To becomes `–`, the Pending counter drops by one and the Returned counter rises by one. When Riya edits and confirms again, `confirmQuotation` finds no clash at `approval_version = 2` and inserts a **second** request with `version = 2` (`src/services/quotation.service.ts:296`–`:308`). The list now shows two rows for the same quotation number, the newer one carrying the `v2` badge, both linking to the same detail page.

**6. Reject, then revise.**
Meera rejects instead. `src/services/approval.service.ts:73` sets the request `REJECTED` and the quotation `REJECTED` (`:75`). The row's Stage reads `Rejected` (danger badge) and it is no longer counted as pending. Riya presses Revise on the quotation screen: `reviseQuotation` (`src/services/quotation.service.ts:323`) moves the quote to `DRAFT` and bumps `approval_version`. The rejected row stays on the list forever — it is the permanent record of that round.

**7. Two managers click Approve at the same second.**
Both browsers post the same `stepId`. Both transactions reach `updateMany({ where: { id: step.id, status: "PENDING" } })` at `src/services/approval.service.ts:66`. Postgres serialises them; the first updates one row, the second updates zero, and `claimed.count !== 1` throws `ConflictError` (`:70`). One manager sees success, the other sees "This step was already decided by someone else. Refresh to see the result." The list shows exactly one advance in Stage — there is no way to double-approve a step.

**8. An approval on a quote whose terms changed underneath.**
A quote was approved (request v1 `APPROVED`, quotation `APPROVED`). The rep edits a line. `loadForEdit` sees the status in `EDIT_SUPERSEDES_APPROVAL` (`src/lib/state/quotation.machine.ts:45`), sets every still-`PENDING` request on that quote to `SUPERSEDED` (`src/services/quotation.service.ts:395`), pushes the quote back to `DRAFT` and bumps `approval_version` (`:398`). The already-`APPROVED` v1 row is untouched by that path and still reads `Approved` on the list. Re-confirming creates a v2 row. Result: two rows, `Approved` and `Pending`, same quotation number.

**9. A counter-offer round arrives with no rep involvement.**
The customer counters on the portal above a ceiling. `submitRequest` (`src/services/portal.service.ts:69`) scores the *proposed* terms, and because the chain is non-empty calls `openApprovalRound` (`:99`), which supersedes every `PENDING`/`APPROVED` request on that quote (`src/services/portal.service.ts:244`) and inserts a new one at the next free version (`:245`–`:256`) with `reason = "Customer counter: Setup Service to 25%"`. The list gains a fresh Pending row, and an older row flips to `Superseded`. The rep did nothing. This is the mockup's "If negotiated terms exceed threshold, quote re-enters approval" (`docs/MOCKUP_SCREENS.md:269`).

**10. A superseded round is still on the list.**
Request 215 in the dev DB (quotation 543, `Q-2026-0325`) is `SUPERSEDED` with `reason = "Customer counter: Setup Service to 25%"` — and its step 302 is `APPROVED` by Meera. So a superseded row can contain real approvals that no longer count for anything. Stage reads `Superseded`, Assigned To `–`. It is kept because the audit story would otherwise have a hole: someone did approve those old terms.

**11. A flagged quote that shows as LOW risk.**
`routeApproval` opens a round whenever *anything* is over a limit (`needsReview`, `src/domain/route.ts:7`), but the score is a rounded 0–100 number. A 0.4-point overage on a small line rounds to `score = 0`, and `riskBand(0)` is `LOW` (`src/lib/contract.ts:247`). The row then reads `Low 0` while still demanding a manager. Request 227 in the dev DB is the near case: `risk_score = 1` → `Medium`. Read the Stage column, not the band, to know whether work is outstanding.

**12. The list is empty on a fresh database.**
`prisma/seed/*` creates no `approval_request` rows at all — `prisma/seed/a-quotes.ts` seeds two drafts and `prisma/seed/b-history.ts` seeds 24 confirmed/paid quotes with `riskScore: 0` (`prisma/seed/b-history.ts:49`) and no requests. So immediately after `pnpm seed` this screen shows the empty state "No approval requests yet". Every row in the dev database today was produced by someone confirming a quote or countering from the portal.

---

## 8. Schema behind this screen

```
approval_request                          prisma/schema.prisma:526
  id              int  pk
  quotation_id    int  fk -> quotation.id, ON DELETE CASCADE
  version         int          equals quotation.approval_version at creation
  status          enum PENDING | APPROVED | REJECTED | RETURNED | SUPERSEDED   (default PENDING)
  risk_score      int          frozen copy of the score at creation
  risk_breakdown  json         frozen copy of the whole RiskResult (never read by any screen)
  chain           json         ordered Role[] e.g. ["SALES_MANAGER","FINANCE"]
  reason          string?      reject / return note, or the supersede reason
  created_at      timestamp    default now()  -> the "Submitted" column
  resolved_at     timestamp?
  UNIQUE (quotation_id, version)            <- one request per approval round
  INDEX (status)                            <- serves the status sort and the groupBy

approval_step                             prisma/schema.prisma:546
  id             int pk
  request_id     int fk -> approval_request.id, CASCADE
  step_no        int          1, 2, ...
  required_role  enum Role    SALES_MANAGER | FINANCE
  status         enum PENDING | APPROVED | REJECTED   (default PENDING)
  acted_by_id    int? fk -> app_user.id
  acted_at       timestamp?
  note           string?
  UNIQUE (request_id, step_no)

quotation           prisma/schema.prisma:439   number, public_id, customer_id (nullable),
                                               rep_user_id, status, approval_version,
                                               negotiation_pending, risk_score, risk_breakdown
customer            prisma/schema.prisma       name, tier_id
customer_tier       prisma/schema.prisma       discount_ceiling_bp   (Bronze 500 / Silver 1000 / Gold 1500)
app_user            prisma/schema.prisma:191   name, role, manager_id, is_active
approval_rule       prisma/schema.prisma:393   sequence, min_score, max_worst_overage_bp,
                                               max_order_total, chain
risk_config         prisma/schema.prisma:408   singleton id=1: weights, normalisers, floor margin
```

The `@@unique([quotationId, version])` at `prisma/schema.prisma:541` is what makes "one row per approval round" a database fact rather than a convention, and it is the constraint both `confirmQuotation` (`src/services/quotation.service.ts:297`) and `openApprovalRound` (`src/services/portal.service.ts:246`) probe before choosing a version number.

---

## 9. How this screen connects to the others

- **In, from screen 4 (Quotation Builder / detail).** Pressing Confirm on a quote whose routing chain is non-empty is what creates the row (`src/services/quotation.service.ts:299`). If the chain is empty the quote jumps straight to `APPROVED` (`:283`) and never appears here.
- **In, from the Dashboard (screen 1).** "View Approvals" (`src/app/(internal)/dashboard/page.tsx:33`) and the "Pending Approvals" tile (`:49`) both link here. Careful: the dashboard tile counts **quotations** in `PENDING_APPROVAL` (`src/app/(internal)/dashboard/page.tsx:16`), while this page's Pending tile counts **approval requests** (`src/services/approval.service.ts:161`). They usually match but are different questions.
- **In, from the Customer Portal (screens 11–12).** A counter-offer above a ceiling opens a round with no internal user involved (`src/services/portal.service.ts:99`).
- **Out, to screen 6.** Every row links to `/approvals/<quotation.public_id>` (`src/app/(internal)/approvals/page.tsx:69`).
- **Out, to the quotation.** Screen 6 carries an "Open quotation" button to `/quotes/<publicId>`; the quotation screen mirrors the current round back with a warning card (`src/app/(internal)/quotes/[publicId]/page.tsx:201`–`:214`).
- **Reports (screen 15).** `reports.service.ts:53` computes average approval time from `approval_request.created_at` → `resolved_at` for `APPROVED` requests — the same two columns this screen's "Submitted" cell reads.

---

## 10. Gotchas

1. **The mockup's "Auto-Approved / LOW / –" row cannot exist.** A quotation that needs no approval never gets an `approval_request` (`src/services/quotation.service.ts:281`–`:289` returns early with `chain: []`), so it has no row here at all. The mockup line `Q-1035 | Nova Retail | LOW | Auto-Approved | -` (`docs/MOCKUP_SCREENS.md:66`) has no code path behind it. Trust the code.
2. **The mockup lists five columns; the code renders six.** The code adds a "Submitted" timestamp column (`src/app/(internal)/approvals/page.tsx:46`) that the mockup does not have. That is an addition, not a bug.
3. **No role check on this page.** A Sales Rep sees every other rep's approval requests, customers and risk scores. Enforcement exists only for *acting* (screen 06), not for *looking*.
4. **`take: 200` versus uncapped counters.** The table is capped at 200 rows (`src/services/approval.service.ts:159`) but the three tiles come from a `groupBy` over the whole table (`:161`). Past 200 requests the numbers on the tiles will exceed what the table can show, with no warning and no pagination.
5. **"Stage" and "status" are different things.** For a pending request the Stage column shows a **role** (whose turn it is), for a resolved one it shows a **status**. Two rows both reading amber can mean "waiting for the manager" and "returned to the rep" — read the text, not the colour.
6. **A LOW badge does not mean "no approval needed".** Any overage opens a round; the score can still round to 0 (`src/domain/route.ts:7` versus `src/lib/contract.ts:247`).
7. **Finance "Assigned To" is a list, not an owner.** It joins every active finance user's name (`src/services/approval.service.ts:174`). Add a third finance user and the cell grows. Nobody is actually assigned; whoever gets there first wins the step (`src/services/approval.service.ts:66`).
8. **The row link is keyed on the quotation, not the request.** Three rounds of the same quote are three rows pointing at one URL. The detail screen always shows the **newest** round (`src/services/approval.service.ts:205`), so clicking the old `v1` row does not open v1.
9. **`approval_request.risk_breakdown` is written on every round and read by nothing.** Grep confirms the only `riskBreakdown` read in the app is the *quotation's* copy on the quote detail page (`src/app/(internal)/quotes/[publicId]/page.tsx:59`). Screen 06 rebuilds the per-line table from the live `quotation_line` rows instead. See screen 06 section 10.
10. **Sibling steps of a REJECTED request stay PENDING.** The reject branch marks only the acted step and the request (`src/services/approval.service.ts:66`–`:74`); a two-step chain rejected at step 1 leaves step 2 with `status = PENDING` in the database forever. The list hides this because it only computes a stage when `r.status === "PENDING"` (`:166`), but the rows are there.
11. **An APPROVE can be recorded with no reason.** The Zod schema requires a note only for REJECT and RETURN (`src/lib/validation/approval.ts:13`), so `audit_log.reason` is `NULL` on approvals — 11 such rows in the dev database. Spec A3 asks that "all approvals, rejections, and edits must be logged with user, timestamp, and reason" (`docs/DealFlow360.txt:131`). User and timestamp are always there; the reason is optional on approve. That is a real gap against the spec.
12. **The dev database is polluted.** Of 58 requests, most were written by earlier automated test runs — reasons like `cleanup mtomkawh`, `mx reason`, `for revise`. The clean, human examples are request 3 (quotation 30), 54/55/56 (quotations 143/144) and 215/216 (quotation 543). Do not read the counters (17 pending / 6 returned / 17 approved) as meaningful product data.
13. **Some old rows predate the current code.** Request 56 (`Q-2026-0091` v3) exists even though its v2 predecessor is `APPROVED` and not `SUPERSEDED`. The behaviour that would have prevented it landed later, in commit `088b33d` ("a new approval round supersedes the approved request it replaces; portal confirm re-routes only when the current approval version is not approved"). Current `openApprovalRound` supersedes both `PENDING` and `APPROVED` (`src/services/portal.service.ts:244`), so this shape cannot be produced again.
