# Screen 06 — Approval Detail (`/approvals/[publicId]`)

## 1. What this screen is

The reviewer's screen. It answers three questions and offers one decision.

1. **Why was this flagged?** A per-line table: discount given, limit allowed, over by how much.
2. **Where is it in the chain?** A stepper: Submitted → Sales Manager → (Finance, only when the chain demands it) → Confirmed.
3. **What has happened to this deal?** The audit trail — every approval, rejection, edit and portal message, with user, time and reason.

And then: **Approve**, **Return for Revision**, or **Reject**.

The URL segment is the **quotation's** `public_id`, not the request id (`src/services/approval.service.ts:194`). The page always renders the **newest** approval round for that quotation (`:205`); older rounds are counted in the subtitle but not drawn.

Page file: `src/app/(internal)/approvals/[publicId]/page.tsx`. Server component. The only client-side code is the decision panel (`src/components/approvals/decision-panel.tsx:1`, `"use client"`).

This is mockup screen 6 (`docs/mockup/06-approval-detail.png`) and spec section B4 (`docs/DealFlow360.txt:204`).

---

## 2. Who can open it, and who enforces that

Opening the page and *acting* on it are two different permissions. **Anyone logged in can open it. Only the right role, at the right step, on someone else's quote, can act.**

| Role | Can open the page? | Buttons enabled? | Which guard decides | If they force the request anyway |
|---|---|---|---|---|
| `SALES_MANAGER` (not the rep) | Yes | Only while the actionable step is `SALES_MANAGER` | `src/app/(internal)/approvals/[publicId]/page.tsx:37` | Server re-checks: `requireActionUser` (`src/app/(internal)/actions/approval.ts:14`) → `assertActor` (`src/services/approval.service.ts:43`) → `assertCanDecide` (`:48`) |
| `FINANCE` (not the rep) | Yes | Only while the actionable step is `FINANCE` | same | `assertCanDecide` throws `This step needs a sales manager` (`src/lib/state/approval.machine.ts:45`) or `An earlier step must be decided first` (`:49`) |
| `ADMIN` | Yes | Yes for **any** step role (`user.role === "ADMIN"` at `page.tsx:38`) | same | `assertCanDecide` lets ADMIN stand in (`src/lib/state/approval.machine.ts:45`) — but still not on their own quote |
| `SALES_REP` | Yes | Never — `requireActionUser` rejects the role outright | `src/app/(internal)/actions/approval.ts:14` (`["SALES_MANAGER","FINANCE","ADMIN"]`) | `ForbiddenError` → `{ ok:false, code:"FORBIDDEN" }` |
| The quote's **own rep** (even if manager/admin) | Yes | No — `user.id !== q.repUserId` fails at `page.tsx:38` | message at `page.tsx:41` | `assertCanDecide` throws `You cannot approve your own quotation` (`src/lib/state/approval.machine.ts:44`) — the very first check |
| Not logged in | No — redirect to `/login?next=…` | — | `src/middleware.ts:12`, `src/lib/auth/internal.ts:75` | — |
| Portal contact | No — wrong cookie | — | `src/middleware.ts:17` | — |

The four enforcement layers, in order:

| Layer | File:line | What it does |
|---|---|---|
| 1. Middleware | `src/middleware.ts:12`–`:43` | Valid `df_session` in the `session` table, unexpired, user `is_active`. Otherwise redirect. No role check for `/approvals`. |
| 2. Layout | `src/app/(internal)/layout.tsx:12` | `requireUser()` — session again, no roles. |
| 3. Page | `src/app/(internal)/approvals/[publicId]/page.tsx:30` | `requireUser()` — **no roles argument**, so this is authentication only. Its purpose here is to obtain `user.id` and `user.role` for the `canDecide` calculation at `:37`. |
| 4. Server action + service | `src/app/(internal)/actions/approval.ts:14`, then `src/services/approval.service.ts:43`–`:48` | The real gate. Everything above it is UI convenience; a hand-crafted POST is stopped here. |

The page-level `canDecide` at `:37` only greys out buttons. It repeats — but does not replace — the server rules.

---

## 3. Everything on the screen, and where each value comes from

Every value comes from one query, `getApprovalDetail(publicId)` at `src/app/(internal)/approvals/[publicId]/page.tsx:31` (implementation `src/services/approval.service.ts:193`), plus the session user from `requireUser()` at `:30`.

Worked example throughout: **`Q-2026-0091`** (quotation id 144, Acme Corp, Gold), current round = request 55.

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Title `Approval Detail: Q-2026-0091 (Acme Corp)` | as shown | `src/services/approval.service.ts:194`, rendered `page.tsx:52`–`:55` | `quotation.number`, `customer.name` | Number allocated from the `counter` table when the rep created the quote; customer name set by `setCustomer` (`src/services/quotation.service.ts:105`). |
| Subtitle `Submitted by Riya Rao. Request v2, 1 earlier version superseded.` | as shown | `rep` include at `src/services/approval.service.ts:198`; `history` at `:206`; rendered `page.tsx:57` | `app_user.name` via `quotation.rep_user_id`; `approval_request.version`; `count(history)` | `rep_user_id` was stamped as `user.id` when the quote was created (`src/services/quotation.service.ts:74`). `history` is every approval request for this quote except the newest (`src/services/approval.service.ts:206`). |
| "Open quotation" button | `/quotes/--_k2pqS27Tp` | `page.tsx:59` | `quotation.public_id` | Generated by `publicId()` at quotation creation (`src/services/quotation.service.ts:71`). |
| **Fact strip** — Blended Risk badge | `High` | `riskBand(current.riskScore)` at `page.tsx:35`, rendered `:69` | derived from `approval_request.risk_score` | `riskBand`: `>=50 HIGH`, `>0 MEDIUM`, else `LOW` (`src/lib/contract.ts:247`). |
| **Fact strip** — `score 100` | `100` | `page.tsx:69` | `approval_request.risk_score` | **Frozen.** Written once by `confirmQuotation` (`src/services/quotation.service.ts:303`) or `openApprovalRound` (`src/services/portal.service.ts:251`) from the `scoreLines` result (`src/domain/risk.ts:33`). See "the frozen score" below. |
| **Fact strip** — Customer Tier | `Gold` | `customer: { include: { tier: true } }` at `src/services/approval.service.ts:197`, rendered `page.tsx:75` | `customer_tier.name` via `customer.tier_id` | Seeded at `prisma/seed/b-governance.ts:8`; a customer's tier is chosen when the customer is created (`src/services/quotation.service.ts:56`). |
| **Fact strip** — `ceiling 15%` | `15%` | `page.tsx:76` | `customer_tier.discount_ceiling_bp` = `1500` | Basis points → percent by `formatBp` (`src/lib/format.ts:46`). This is the **tier** ceiling, which is not necessarily any line's ceiling (a category can be stricter). |
| **Fact strip** — Quotation status badge | `Pending Approval` | `page.tsx:82` | `quotation.status` | Set to `PENDING_APPROVAL` by whichever event opened this round. |
| **Fact strip** — `total ₹1,08,560.00 · margin 7.83%` | as shown | `page.tsx:84` | `quotation.total`, `quotation.margin_bp` | Both recomputed on every mutation by `recompute` (`src/services/quotation.service.ts:371`–`:381`) from `computeTotals`. Money is integer paise; `Money` renders it. |
| **Why This Quote Was Flagged** — header text with `(10 pt over)` | `10 pt` | `worst` computed at `page.tsx:47`, rendered `:97` | **live** `quotation_line.effective_discount_bp − ceiling_bp`, max over lines | Note: this is recomputed in the page from current line rows, *not* read from the frozen snapshot. |
| Table column **Line** | `Laptop 14" (Hardware)` | `lines` include at `src/services/approval.service.ts:199`, rendered `page.tsx:117`–`:118` | `quotation_line.description`, `product_category.name` | `description` is snapshotted onto the line when the product was added (`addLine`), so renaming the product later does not rewrite history. The category name is joined live through `product.category`. |
| Table column **Discount Given** | `25%` | `page.tsx:120` | `quotation_line.effective_discount_bp` = `2500` | The **compound** of the line discount and the order-level discount, written by `recompute` (`src/services/quotation.service.ts:365`) from `computeTotals`. Not the raw `discount_bp`. |
| Table column **Limit Allowed** | `15%` | `page.tsx:121` | `quotation_line.ceiling_bp` = `1500` | Snapshotted onto the line at add-time and re-snapshotted whenever the customer changes (`src/services/quotation.service.ts:109`–`:110`) as `category.discountCeilingBp === null ? tier : min(tier, category)`. Same rule as `lineCeilingBp` (`src/domain/risk.ts:20`). For Support Pro it is `min(Gold 1500, Subscriptions 1200) = 1200`. |
| Table column **Over By** | `10 pt OVER` (red) / `0 pt - OK` (green) | `over` at `page.tsx:113`, rendered `:123`–`:127` | `effective_discount_bp − ceiling_bp` | Computed in the page. Any positive value also tints the whole row (`page.tsx:115`). |
| **Approval Steps** card description | `Sales Manager, then Finance.` | `chain.length === 1 ? … : …` at `page.tsx:152` | `approval_request.chain` (JSON `Role[]`) | Parsed by `parseChain` (`src/services/approval.service.ts:151`), which is a Zod array parse with `.catch([])` so corrupt JSON degrades to an empty array instead of a crash. |
| **Stepper** — "Submitted" + timestamp | `05 Sep 2026, 14:11` | `page.tsx:166` | `approval_request.created_at` | `now()` at request insert. |
| **Stepper** — one node per step | `Sales Manager`, `Finance` | `current.steps` at `src/services/approval.service.ts:200`, mapped `page.tsx:156`–`:163` | `approval_step.step_no`, `required_role`, `status` | Steps were created in one shot from the chain: `chain.map((role, i) => ({ stepNo: i + 1, requiredRole: role }))` (`src/services/quotation.service.ts:307`). |
| **Stepper** — a step's detail line | `Meera Shah, 05 Sep 2026, 14:22 · ok, 8 pp on services` | `page.tsx:160`–`:162`, assembled `src/components/approvals/stepper.tsx:36` | `approval_step.acted_by_id` → `app_user.name`, `acted_at`, `note` | All three written in the same `updateMany` that claimed the step (`src/services/approval.service.ts:68`). `note` is the text the reviewer typed in the dialog; it is `NULL` when they approved without one. |
| **Stepper** — "Confirmed" node | done / todo | `page.tsx:38` in the stepper (`src/components/approvals/stepper.tsx:19`) | `quotation.status ∈ {CONFIRMED, FULFILLMENT, PAID}` | The customer pressing Confirm in the portal (`src/services/portal.service.ts:149`). |
| **Audit Trail** entries | see below | `auditLogs` include at `src/services/approval.service.ts:201` (`orderBy at desc, take 50`), rendered `page.tsx:143` | `audit_log.*` | One row per state change, always written inside the same transaction as the change (`src/lib/audit.ts:25`). |
| **Decision** card, actionable | "Waiting for Sales Manager. That is you." | `src/components/approvals/decision-panel.tsx:93` | derived | `canDecide` at `page.tsx:37`. |
| **Decision** card, blocked | "You submitted this quotation, so someone else has to review it." / "This step is waiting for a Finance." | `blockedWhy` at `page.tsx:39`–`:45` | derived from `user.id`, `user.role`, `approval_step.required_role` | Note the grammar bug: the template is `` `This step is waiting for a ${ROLE_LABEL[...]}` `` (`page.tsx:43`), producing "a Finance". |
| **Decision** card, finished | "Approved. The rep can now send it to the customer." etc. | `page.tsx:174`–`:184` | `approval_request.status`, `approval_request.reason` | Shown instead of the buttons when there is no actionable step. |

### The frozen score, and why it matters

`approval_request.risk_score` is a **copy taken at the moment the round opened** (`src/services/quotation.service.ts:303`, `src/services/portal.service.ts:251`). The quotation carries its own, always-current `quotation.risk_score`, rewritten by `recompute` after every single mutation (`src/services/quotation.service.ts:379`).

This screen deliberately shows the **request's** copy (`page.tsx:35`, `:69`), never the quotation's. That matters because:

- A reviewer is being asked to approve *specific terms*. The score they see is the score of the terms that were submitted to them.
- If those terms had changed underneath, the approval would be meaningless — and the code prevents that separately: any edit while `APPROVED`/`SENT`/`UNDER_NEGOTIATION` supersedes the round and forces a new one (`src/services/quotation.service.ts:393`–`:399`), and a customer counter opens a fresh round (`src/services/portal.service.ts:99`).
- The superseded round keeps its old number forever. Round 1 of `Q-2026-0325` reads `42`, round 2 reads `78` — two different sets of terms, two honest records.

The frozen record is richer than the score alone: `approval_request.risk_breakdown` (`prisma/schema.prisma:532`) stores the entire `RiskResult` object — every line's `effectiveDiscountBp`, `ceilingBp` and `overageBp`, plus `worstOverageBp`, `blendedOverageBp`, `marginBp`, `marginPenaltyBp`, `score`, `band` and `chain`. For request 55 in the dev database:

```json
{ "band": "HIGH", "chain": ["SALES_MANAGER","FINANCE"], "score": 100,
  "marginBp": 783, "worstOverageBp": 1000, "marginPenaltyBp": 1217, "blendedOverageBp": 984,
  "lines": [ { "lineId": 195, "ceilingBp": 1500, "overageBp": 1000, "effectiveDiscountBp": 2500 },
             { "lineId": 196, "ceilingBp": 1200, "overageBp": 0,    "effectiveDiscountBp": 0 } ] }
```

**But this screen does not read it.** The "Why This Quote Was Flagged" table is rebuilt from the **live** `quotation_line` rows (`page.tsx:112`–`:121`), and so is the `worst` figure in the card description (`page.tsx:47`). A repo-wide grep finds exactly one read of any `riskBreakdown` column in the whole app — the *quotation's* copy on the quote detail screen (`src/app/(internal)/quotes/[publicId]/page.tsx:59`). `approval_request.risk_breakdown` is written on every round and read by nothing.

In practice the two agree, because the events that change a line also open a new round. The score is frozen; the table beside it is live. Section 10 records this as a real inconsistency.

### How the "Why This Quote Was Flagged" numbers are produced

For each line the page computes `over = effective_discount_bp − ceiling_bp` (`page.tsx:113`). Three separate columns, three separate origins:

- **Discount given** — `quotation_line.effective_discount_bp`. Written by `recompute` (`src/services/quotation.service.ts:365`) from `computeTotals`, which compounds the line discount with the order-level discount. A rep typing 20 % on a line of an order that already carries 5 % does not get 25 %: `computeTotals` compounds them, and whatever it produces is what this column shows.
- **Limit allowed** — `quotation_line.ceiling_bp`. Snapshotted, not joined. Written when the line was added and rewritten only when the customer changes (`src/services/quotation.service.ts:107`–`:111`). An admin raising the Gold ceiling tomorrow does **not** change what this screen shows for an existing quote — a deliberate property.
- **Over by** — arithmetic in the page. Zero or negative renders the green `0 pt - OK` badge (`page.tsx:126`).

Spec section 10 (`docs/DealFlow360.txt:387`) is exactly this table: "Laptop (Hardware): 12 % given, 15 % allowed, fine. Setup Service (Service): 18 % given, 10 % allowed, 8 points over. One bad line is enough."

### The stepper, and how Finance appears

The stepper (`src/components/approvals/stepper.tsx:8`) renders `["Submitted", ...steps, "Confirmed"]`.

Finance is a node **only when a Finance step row exists**, which happens only when `approval_request.chain` contained `FINANCE`, which happens only when `routeApproval` returned a two-role chain. That routing is in `src/domain/route.ts:28`:

1. If nothing is over a limit and the margin floor holds, the chain is `[]` and no request exists at all (`needsReview`, `src/domain/route.ts:7`).
2. Otherwise every `approval_rule` row is tested by `ruleFires` (`src/domain/route.ts:12`): score ≥ `min_score`, **or** worst overage > `max_worst_overage_bp`, **or** order total > `max_order_total`. Any one is enough.
3. Among the rules that fired, the **longest** chain wins (`src/domain/route.ts:33`) — max, never average. This is spec A3's "when a quote mixes categories, route to the highest required level" (`docs/DealFlow360.txt:129`).
4. If something is over a limit but no rule fired, the lowest-sequence rule reviews it anyway (`src/domain/route.ts:32`); if the admin deleted every rule, `FALLBACK_CHAIN = ["SALES_MANAGER"]` (`src/domain/route.ts:21`). A violation can never escape unreviewed.

Seeded rules (`prisma/seed/b-governance.ts:11`–`:23`):

| seq | name | min_score | max_worst_overage_bp | max_order_total | chain |
|---|---|---|---|---|---|
| 1 | Over limit | 1 | — | — | `["SALES_MANAGER"]` |
| 2 | High risk or large order | 50 | 1000 (10 pt) | ₹10,00,000 | `["SALES_MANAGER","FINANCE"]` |

So: score 20 → only rule 1 fires → Sales Manager only → **no Finance node**. Score 100, or a worst overage above 10 points, or an order above ₹10 lakh → rule 2 also fires → Sales Manager then Finance → **Finance node appears**.

Each node's colour (`src/components/approvals/stepper.tsx:26`–`:35`): step `APPROVED` → green tick; step `REJECTED` → red cross; request `RETURNED` → amber rotate icon on every undecided step; request `PENDING` and this is the first pending step → amber ring plus the word "waiting"; otherwise a grey "todo" dot.

### The audit trail, entry by entry

`AuditTrail` (`src/components/shared/audit-trail.tsx:131`) draws one `<li>` per `audit_log` row, newest first, capped at 50 (`src/services/approval.service.ts:201`). Each entry shows:

| Part | Source | Example |
|---|---|---|
| Timestamp | `audit_log.at`, `formatDateTime` (`audit-trail.tsx:138`) | `05 Sep 2026, 14:24` |
| Actor name | `audit_log.actor_name` (`:141`) | `Farhan Iyer` — copied from the session user at write time (`src/lib/audit.ts:34`), so it survives a later rename |
| Actor role | `audit_log.actor_role` → `ROLE_LABEL` (`:142`) | `(Finance)`. A portal contact has `actor_role = NULL` and the name reads `Nisha Acme (Acme Corp)` |
| The sentence | `ACTION_TEXT[action]` + subject (`audit-trail.tsx:123`) | `approved a step of Q-2026-0091`. Unknown actions fall back to the lower-cased verb (`:124`) |
| Reason, in quotes | `audit_log.reason` (`:144`) | `"drop the setup discount"` — `NULL` on approvals, so nothing renders |
| Field diffs | `describeChange(before_json, after_json)` (`:109`) | `Status: Pending Approval → Sent`, `Request status: Pending`, `Negotiation pending: yes → no` |

`describeChange` unions the keys of the two JSON blobs, drops keys whose value did not change (`:117`), and formats by key name: anything ending in `Bp` becomes a percentage, anything matching `price|total|amount|cost|…` becomes money, booleans become yes/no (`audit-trail.tsx:93`–`:97`). Field names are humanised through `FIELD_LABEL` (`:48`) — that is why `requestVersion` prints as "Approval version".

Highlighting: after a successful decision the panel navigates to `?audit=<id>` (`decision-panel.tsx:84`); the page passes that through as `highlightId` (`page.tsx:143`) and the matching `<li>` gets a green background (`audit-trail.tsx:137`). So the reviewer literally sees the row their click just wrote — spec B4's "confirmation screen with a full audit trail entry" (`docs/DealFlow360.txt:214`).

The real audit trail for `Q-2026-0091` in the dev database, oldest first:

| at | actor | action | entity | after_json |
|---|---|---|---|---|
| 14:08:13 | Riya Rao (Sales Rep) | `CREATE` | Quotation 144 | `{number: Q-2026-0091, customer: Acme Corp}` |
| 14:08:13 | Riya Rao | `LINE_ADD` | QuotationLine 195 | `{product: Laptop 14", qty: 2, discountBp: 1000}` |
| 14:08:13 | Riya Rao | `LINE_ADD` | QuotationLine 196 | `{product: Support Pro, qty: 2, discountBp: 0}` |
| 14:08:13 | Riya Rao | `CONFIRM` | Quotation 144 | `{chain: [], score: 0, status: APPROVED}` ← 10 % on a Gold quote is inside every ceiling, so **no approval request was created** |
| 14:08:13 | Riya Rao | `SEND` | Quotation 144 | `{status: SENT}` |
| 14:11:55 | Nisha Acme (Acme Corp) | `PORTAL_COUNTER` | PortalRequest 21 | `{proposedDiscountBp: 2500, chain: [SALES_MANAGER, FINANCE], status: PENDING_APPROVAL, approvalVersion: 2}`, reason `"We can sign today at 25 percent on the laptops"` |
| 14:22:09 | Meera Shah (Sales Manager) | `APPROVE` | ApprovalStep 76 | before `{step:1, role:SALES_MANAGER, status:PENDING_APPROVAL, requestVersion:2}`, after `{status:PENDING_APPROVAL, request:PENDING, negotiationPending:true}` — reason `NULL` |
| 14:24:34 | Farhan Iyer (Finance) | `APPROVE` | ApprovalStep 77 | after `{status: SENT, request: APPROVED, negotiationPending: false}` ← the counter-offer case: **SENT, not APPROVED** |
| 14:25:32 | Nisha Acme | `PORTAL_CONFIRM` | Quotation 144 | `{status: PENDING_APPROVAL, chain: [...]}` |

That single table is the whole product: rep quotes inside the limits → customer counters above them → the counter, not the rep, triggers approval → manager then finance → back to the customer.

---

## 4. The queries this page runs

Two, both awaited at the top of the component.

1. **`requireUser()`** — `src/app/(internal)/approvals/[publicId]/page.tsx:30`, implementation `src/lib/auth/internal.ts:75`. Reads the `df_session` cookie and joins `session` → `app_user`. Supplies `user.id` and `user.role` for `canDecide`.

2. **`getApprovalDetail(publicId)`** — `src/services/approval.service.ts:193`. One `quotation.findUnique` with five nested includes:

   ```
   quotation where publicId
     customer      -> tier                              (fact strip: tier name + ceiling)
     rep                                                (subtitle: "Submitted by …")
     lines         orderBy sortOrder asc
                   -> product -> category               (flagged table)
     approvalRequests orderBy version DESC
                   -> steps orderBy stepNo asc
                            -> actedBy                  (stepper)
     auditLogs     orderBy at DESC, take 50             (audit trail)
   ```

   Post-processing at `src/services/approval.service.ts:204`–`:206`:
   - `null` (→ `notFound()`, a 404) when the quotation does not exist **or** has zero approval requests. A quote that was auto-approved has no detail page.
   - `current = approvalRequests[0]` — the highest `version`, because of the `version: "desc"` order.
   - `chain = parseChain(current.chain)` — Zod parse with `.catch([])` (`:151`).
   - `history = approvalRequests.slice(1)` — the older rounds, used only for the subtitle count.

   Note that `auditLogs` is scoped by `audit_log.quotation_id`, so the trail covers the **whole quotation**, all rounds, plus line edits and portal messages — not just this approval round.

No client-side fetching. After a decision the panel calls `router.refresh()` (`decision-panel.tsx:85`) and the action has already called `revalidatePath` for four paths (`src/app/(internal)/actions/approval.ts:17`–`:20`).

---

## 5. Every condition on this page

| # | Condition | Where | Effect |
|---|---|---|---|
| 1 | `!detail` | `page.tsx:32` | `notFound()` → 404. Fires for an unknown `publicId` **or** a quotation with no approval requests (`src/services/approval.service.ts:204`). |
| 2 | `current.status === "PENDING"` | `page.tsx:36` | Whether `actionableStep` is called at all. |
| 3 | `actionableStep(current.steps)` → `next` | `src/lib/state/approval.machine.ts:29` | The lowest-numbered `PENDING` step. `null` when every step is decided. Drives both the decision panel and the "Decision" fallback card (`page.tsx:171`). |
| 4 | `user.id !== q.repUserId` | `page.tsx:38` | Own-quote rule. Blocks the buttons; message at `:41`. |
| 5 | `user.role === "ADMIN" \|\| user.role === next.requiredRole` | `page.tsx:38` | Role match, Admin standing in. Message at `:43`. |
| 6 | `q.status === "PENDING_APPROVAL"` | `page.tsx:38` | The quotation itself must be in approval. **This condition has no `blockedWhy` message** (`:39`–`:45` never covers it), so a right-role reviewer can see disabled buttons with the neutral text "Waiting for Sales Manager." and no explanation. |
| 7 | `chain.length === 1` | `page.tsx:152` | Card subtitle "Sales Manager only." vs "Sales Manager, then Finance." Note it says "Sales Manager only" for **any** one-role chain, so a Finance-only chain would be mislabelled. |
| 8 | `over > 0` per line | `page.tsx:113`, `:115`, `:123` | Red row tint and the `N pt OVER` badge, versus `0 pt - OK`. |
| 9 | `history.length` | `page.tsx:57` | Whether the subtitle mentions superseded earlier versions, and singular vs plural. |
| 10 | `q.auditLogs.length === 0` | `page.tsx:143` | Empty state instead of the trail. In practice impossible — creating the quotation writes an audit row. |
| 11 | `next ? DecisionPanel : Decision card` | `page.tsx:171` | Buttons vs a read-only summary. |
| 12 | `current.status` in the fallback card | `page.tsx:178`–`:181` | Four different closing sentences (Approved / Rejected / Returned / Superseded), each appending `current.reason` when present. |
| 13 | Step colour: `APPROVED` / `REJECTED` / request `RETURNED` / first pending / else | `src/components/approvals/stepper.tsx:26`–`:35` | done / failed / returned / current / todo. |
| 14 | `["CONFIRMED","FULFILLMENT","PAID"].includes(quotationStatus)` | `src/components/approvals/stepper.tsx:19` | Whether the final "Confirmed" node is green. |
| 15 | `copy.needsReason && note.trim().length < 3` | `src/components/approvals/decision-panel.tsx:63` | Client-side block before the round trip, for RETURN and REJECT only. Mirrored server-side at `src/lib/validation/approval.ts:13`. |
| 16 | `result.code === "CONFLICT"` | `src/components/approvals/decision-panel.tsx:71` | Closes the dialog, shows an error toast, and refreshes — the "someone beat you to it" path. |

---

## 6. Every action you can take here

All three buttons call the **same** server action with a different `decision` value.

```
Approve / Return for Revision / Reject          decision-panel.tsx:96, :105, :115
  -> dialog opens, reviewer types a note        decision-panel.tsx:127-:152
  -> submit()                                   decision-panel.tsx:60
  -> decide({ requestId, stepId, decision, note })   decision-panel.tsx:68
  -> server action `decide`                     src/app/(internal)/actions/approval.ts:10
  -> Zod: approvalDecisionSchema                src/lib/validation/approval.ts:5
  -> requireActionUser(["SALES_MANAGER","FINANCE","ADMIN"])   actions/approval.ts:14
  -> approvals.decide(input, user)              src/services/approval.service.ts:30
  -> one prisma.$transaction                    src/services/approval.service.ts:31
```

**Zod schema** (`src/lib/validation/approval.ts:5`):
- `requestId`, `stepId`: `zId` — coerced positive int ≤ 2147483647 (`src/lib/validation/common.ts:19`).
- `decision`: enum `APPROVE | REJECT | RETURN`.
- `note`: `zNote` optional — trimmed, max 2000 chars (`src/lib/validation/common.ts:35`).
- `superRefine` at `:12`: for `REJECT` and `RETURN`, a note of at least 3 trimmed characters is required — message "A reason is required to reject or return". **`APPROVE` is exempt.**

**Guards, in the exact order the service runs them** (`src/services/approval.service.ts:30`–`:48`):

| # | Guard | Line | Throws | Code |
|---|---|---|---|---|
| 0a | Request exists | `:32`, `:36` | `NotFoundError("Approval request not found")` | `NOT_FOUND` |
| 0b | Step belongs to that request | `:37`, `:38` | `NotFoundError("Approval step not found")` | `NOT_FOUND` |
| 1 | **Actor role** — `assertActor(actor, action)` | `:43` → `src/lib/state/quotation.machine.ts:66` | `A sales rep cannot approve step` | `FORBIDDEN` |
| 2 | **Quotation state** — `assertTransition(q.status, action)` | `:44` → `src/lib/state/quotation.machine.ts:49` | `Illegal transition: cannot approve step a quotation that is draft` — `APPROVE_STEP`/`REJECT`/`RETURN` are legal only from `PENDING_APPROVAL` (`src/lib/state/quotation.machine.ts:12`–`:14`) | `CONFLICT` |
| 3 | **Request state** — `assertRequestTransition` | `:45` → `src/lib/state/approval.machine.ts:20` | `Illegal transition: approval request cannot go from returned to approved` — only `PENDING` has outgoing edges besides `APPROVED → SUPERSEDED` (`src/lib/state/approval.machine.ts:6`–`:12`) | `CONFLICT` |
| 4 | **Step state** — `assertStepTransition` | `:47` → `src/lib/state/approval.machine.ts:24` | An already-decided step is a stale click, deliberately a 409 and not a 403 (comment at `:46`) | `CONFLICT` |
| 5a | **Own-quote rule** — `user.id === quotation.repUserId` | `src/lib/state/approval.machine.ts:44` | `You cannot approve your own quotation` | `FORBIDDEN` |
| 5b | **Role match** — `user.role !== step.requiredRole && user.role !== "ADMIN"` | `src/lib/state/approval.machine.ts:45` | `This step needs a sales manager` | `FORBIDDEN` |
| 5c | **Lowest-pending-step rule** — `actionableStep(allSteps).id !== step.id` | `src/lib/state/approval.machine.ts:48` | `An earlier step must be decided first` | `FORBIDDEN` |
| 6 | **The conditional claim** — see below | `:57` (RETURN) or `:66` (APPROVE/REJECT) | `ConflictError("This step was already decided by someone else. Refresh to see the result.")` | `CONFLICT` |

Guard 6 is the one that settles two simultaneous approvers. It is not a read-then-write; it is a single conditional UPDATE:

```ts
const claimed = await tx.approvalStep.updateMany({
  where: { id: step.id, status: "PENDING" },          // the condition is IN the WHERE
  data:  { status: ..., actedById: user.id, actedAt: now, note },
});
if (claimed.count !== 1) throw new ConflictError(...);   // src/services/approval.service.ts:66-:70
```

Postgres serialises the two updates on the row. The first sees `status = 'PENDING'` and updates one row; the second sees `status = 'APPROVED'` and updates zero. Zero rows means "I lost", and the whole transaction rolls back — no partial write, no audit row. RETURN uses the same trick one level up, on the request (`:57`–`:61`), so a return racing an approve also has exactly one winner.

**What each decision writes:**

| | RETURN | REJECT | APPROVE (not the last step) | APPROVE (last step) |
|---|---|---|---|---|
| `approval_request` | `status=RETURNED`, `reason=note`, `resolved_at` (`:59`) | `status=REJECTED`, `reason=note`, `resolved_at` (`:73`) | unchanged, stays `PENDING` (`:79`) | `status=APPROVED`, `resolved_at` (`:81`) |
| `approval_step` | untouched — the step stays `PENDING` | this step → `REJECTED` + actor/time/note (`:68`) | this step → `APPROVED` + actor/time/note | this step → `APPROVED` + actor/time/note |
| `quotation.status` | `DRAFT` (`:63`) | `REJECTED`, **or `SENT` if `negotiation_pending`** (`:75`) | `PENDING_APPROVAL` (unchanged) (`:79`) | `APPROVED`, **or `SENT` if `negotiation_pending`** (`:83`) |
| `quotation.version` | +1 (`:98`) | +1 | +1 | +1 |
| `quotation.approval_version` | **+1** (`:100`) — only RETURN bumps it | — | — | — |
| `quotation.negotiation_pending` | → `false` (`:99`) | → `false` | unchanged | → `false` |
| `portal_request` | if the round was a counter: all `OPEN` counters → `DECLINED` with responder + note (`:90`, `:126`) | same, `DECLINED` | — | counters → `ACCEPTED` **and `quotation_line.discount_bp` is overwritten with `proposed_discount_bp`** (`:123`–`:125`), then `recompute` (`:91`) |
| `audit_log` | 1 row, `action=RETURN`, `entityType=ApprovalRequest` (`:104`–`:113`) | 1 row, `action=REJECT`, `entityType=ApprovalStep` | 1 row, `action=APPROVE`, `entityType=ApprovalStep` | same |
| `quotation.last_activity_at` | touched by `audit()` (`src/lib/audit.ts:42`) | same | same | same |

Everything above happens inside **one** `prisma.$transaction` (`:31`). A failure anywhere — including the conflict throw — rolls back the lot, so a decision without an audit row is impossible, and an audit row without the decision is impossible.

**The audit row's shape** (`src/services/approval.service.ts:104`–`:113`):
- `entity_type` = `ApprovalRequest` for RETURN, `ApprovalStep` for the other two; `entity_id` matches.
- `before_json` = `{ status, step, role, requestVersion }`.
- `after_json` = `{ status, request, negotiationPending }`.
- `reason` = the trimmed note, or `NULL`.

**What changes on screen** (`src/components/approvals/decision-panel.tsx:78`–`:86`): a success toast "Approved. Audit entry #527 written." with the new quotation status; `router.push('?audit=527')`; `router.refresh()`. The page re-renders — the stepper advances, the fact strip's quotation badge changes, and the new audit entry is highlighted green.

**The three destinations, in one line each:**
- **Approve** → next step, or `APPROVED` — *unless* `negotiation_pending`, in which case `SENT`.
- **Return for revision** → `DRAFT`, `approval_version + 1`, the whole request closed. The rep edits and confirms again, which starts a fresh round from step 1.
- **Reject** → `REJECTED` — *unless* `negotiation_pending`, in which case `SENT` with the original terms.

**The `negotiationPending` case, spelled out.** When a round was opened by a customer counter, `quotation.negotiation_pending` is `true` (`src/services/portal.service.ts:106`). Approving the last step then does **not** send the quote to `APPROVED`; it sends it to `SENT` (`src/services/approval.service.ts:83`) — back onto the customer's portal, with the countered discount now applied to the line (`settleCounterOffers`, `:120`–`:131`) and the totals recomputed (`:91`). The customer, not the rep, is the next actor. Rejecting the same round also lands on `SENT` (`:75`), but with the lines untouched and the counter marked `DECLINED` — "we heard you, the answer is no, here is the original offer."

---

## 7. Scenarios

**1. Single-approver chain, approved.**
Riya confirms a Beta Industries quote 2 points over. `routeApproval` fires rule 1 only → chain `["SALES_MANAGER"]`, one step. Meera opens the detail: fact strip `Medium 20`, stepper `Submitted ✓ → Sales Manager (waiting) → Confirmed`, decision card "Waiting for Sales Manager. That is you." She clicks Approve, types nothing, confirms. Guards 1–5 pass; the claim at `:66` updates one row; `remaining.length === 0` so the request becomes `APPROVED` (`:81`) and the quotation becomes `APPROVED` (`:83`). Toast: "Approved. Audit entry #N written. Q-… is now approved." The panel is replaced by "Approved. The rep can now send it to the customer." (`page.tsx:178`).

**2. Two-step chain, both steps.**
Score 100 → rules 1 and 2 both fire → longest chain wins → `["SALES_MANAGER","FINANCE"]`, two steps. Meera approves: `remaining` contains step 2, so `nextStatus = "PENDING_APPROVAL"` (`:79`) and the request stays `PENDING`. Nothing about the quotation's status changes; only `version` increments. The stepper now shows Sales Manager green with "Meera Shah, 05 Sep 2026, 14:22", Finance amber and "waiting". Farhan opens the page and now `canDecide` is true for him. He approves; `remaining` is empty; request `APPROVED`, quotation `APPROVED`. This is the seeded shape of request 55 (steps 76 and 77).

**3. Finance tries to go first.**
Step 1 is `SALES_MANAGER` and pending. Farhan opens the page. `next.requiredRole === "SALES_MANAGER"`, his role is `FINANCE`, so `canDecide` is false (`page.tsx:38`) and `blockedWhy` reads "This step is waiting for a Sales Manager." (`:43`). The buttons are greyed. If he POSTs anyway, guard 5b throws `This step needs a sales manager` (`src/lib/state/approval.machine.ts:45`) before guard 5c would have thrown `An earlier step must be decided first`. Two independent rules cover the same mistake.

**4. A rep opens their own quote.**
Riya navigates to `/approvals/<her own quote>`. The page renders in full — she sees the risk score, the flagged lines and the audit trail. `user.id === q.repUserId`, so `canDecide` is false and `blockedWhy` reads "You submitted this quotation, so someone else has to review it." (`page.tsx:41`). If she POSTs, she is stopped twice over: `requireActionUser` rejects `SALES_REP` outright (`actions/approval.ts:14`), and even an Admin-roled rep would hit the own-quote check, which is the **first** line of `assertCanDecide` (`src/lib/state/approval.machine.ts:44`).

**5. Return for revision, then resubmit.**
Meera clicks Return, types "Drop the setup discount to 10 %". The client blocks anything under 3 characters (`decision-panel.tsx:63`) and so does Zod (`src/lib/validation/approval.ts:13`). Service: the whole request is claimed `RETURNED` with `reason` (`:57`); the quotation goes to `DRAFT` and `approval_version` is bumped to 2 (`:63`, `:100`). **Step 1 is never touched** — it stays `PENDING` in the database, and the stepper paints it amber via the `requestStatus === "RETURNED"` branch (`stepper.tsx:31`). Riya edits the line and confirms again: `confirmQuotation` finds no request at version 2, inserts one (`src/services/quotation.service.ts:296`–`:308`) with a **freshly scored** risk snapshot. The detail page now shows round v2 with step 1 pending again; the subtitle reads "Request v2, 1 earlier version superseded".

**6. Reject, then revise.**
Meera clicks Reject with "Margin too thin". Step 1 → `REJECTED`, request → `REJECTED`, quotation → `REJECTED` (`:72`–`:75`). The stepper draws a red cross on Sales Manager. The decision card reads "Rejected: Margin too thin." (`page.tsx:179`). Riya presses Revise on the quotation screen — legal only from `REJECTED` (`src/lib/state/quotation.machine.ts:15`) — which sets `DRAFT` and bumps `approval_version` (`src/services/quotation.service.ts:331`). Her next confirm opens round v2. The rejected round remains, permanently, as round v1.

**7. Two managers click at once.**
Meera and an Admin both have the page open and both click Approve within the same second. Both transactions pass guards 1–5 (they read the same `PENDING` step). Both reach `updateMany({ where: { id, status: "PENDING" } })`. Postgres lets one through: `claimed.count === 1`, it proceeds and commits. The other gets `claimed.count === 0` and throws `ConflictError` (`:70`); its transaction rolls back entirely — no step change, no quotation change, no audit row. Their browser sees `code === "CONFLICT"`, closes the dialog, shows an error toast and refreshes (`decision-panel.tsx:71`–`:75`), landing on the already-advanced page.

**8. A stale tab: the step was decided minutes ago.**
Same mechanism, different guard. Because the request was re-read at the top of the transaction (`:32`), `assertStepTransition` (guard 4) already sees `APPROVED → APPROVED` as illegal and throws a `CONFLICT` (`src/lib/state/approval.machine.ts:14`, `:24`) before the claim is even attempted. The service comment at `:46` explains the choice: a stale click is a 409, not a 403, because it is a timing problem and not a permissions problem.

**9. An approval on a quote whose terms changed underneath.**
The quote was approved; the rep then edits a line. `loadForEdit` sees `APPROVED` in `EDIT_SUPERSEDES_APPROVAL` (`src/lib/state/quotation.machine.ts:45`), sets every still-`PENDING` request to `SUPERSEDED` (`src/services/quotation.service.ts:395`), forces the quote back to `DRAFT`, bumps `approval_version` and writes a `SUPERSEDE_APPROVAL` audit row (`:400`–`:408`). A reviewer who had the detail page open and clicks Approve is stopped by guard 2 — `assertTransition("DRAFT", "APPROVE_STEP")` is illegal (`src/lib/state/quotation.machine.ts:12`) — with "Illegal transition: cannot approve step a quotation that is draft". Nobody can approve terms that no longer exist.

**10. A counter-offer round, approved.**
The exact `Q-2026-0091` story in the audit table above. The customer counters 10 % → 25 % on the portal. `submitRequest` scores the *proposed* terms (`src/services/portal.service.ts:96`), gets a two-role chain, calls `openApprovalRound` (`:99`), and sets `negotiation_pending = true` (`:106`). Meera approves step 1 (quotation stays `PENDING_APPROVAL`, `negotiationPending: true` in the audit blob). Farhan approves step 2: `remaining` is empty → request `APPROVED`; because `negotiation_pending` is true, `nextStatus = "SENT"` not `"APPROVED"` (`:83`); `settleCounterOffers` writes `discount_bp = 2500` onto line 195 and marks the portal request `ACCEPTED` with Farhan as responder (`:120`–`:130`); `recompute` rewrites the totals (`:91`); `negotiation_pending` is cleared (`:99`). The quote lands back on the customer's portal with the discount they asked for. Compare audit row 527 (`status: PENDING_APPROVAL`) with 528 (`status: SENT`) — the whole mechanism is visible in two JSON blobs.

**11. A counter-offer round, rejected.**
Same setup, Meera rejects at step 1 with "We cannot do 25 % on hardware". Request `REJECTED`; because `negotiation_pending` is true, the quotation goes to `SENT`, **not** `REJECTED` (`:75`). `settleCounterOffers` runs with `accepted = false`: the lines are left alone and the portal request is marked `DECLINED` with the reason as `response_note` (`:127`–`:128`). The customer sees the original offer again with an explanation. The deal is not dead — only the counter is.

**12. A superseded round.**
Quotation 543 (`Q-2026-0325`) in the dev database: request 215, version 1, `SUPERSEDED`, `reason = "Customer counter: Setup Service to 25%"`, and its single step **is `APPROVED` by Meera Shah**. Then request 216, version 2, chain `[SALES_MANAGER, FINANCE]`, both steps approved. Both rounds are kept, and that is the point: round 1 records that a manager genuinely approved the 42-score terms, round 2 records that two people approved the 78-score terms the customer actually got. Deleting round 1 would erase a real decision by a real person. `openApprovalRound` supersedes both `PENDING` and `APPROVED` predecessors (`src/services/portal.service.ts:244`) but never deletes them, and `@@unique([quotationId, version])` (`prisma/schema.prisma:541`) guarantees the versions cannot collide. Opening `/approvals/hxi-Ni5cntmj` shows **round 2 only**; the subtitle notes "1 earlier version superseded". There is no UI to view round 1 — see section 10.

**13. A quote that never needed approval has no page.**
`Q-2026-0091` at 14:08 was confirmed with `chain: []` and went straight to `APPROVED` — no `approval_request` row. Had you tried `/approvals/--_k2pqS27Tp` before 14:11, `getApprovalDetail` would have returned `null` at `src/services/approval.service.ts:204` and the page would have 404'd (`page.tsx:32`). Only after the customer's counter did the page exist.

---

## 8. Schema behind this screen

```
approval_request                      prisma/schema.prisma:526
  version         int                 -> subtitle "Request v2"; UNIQUE with quotation_id
  status          enum                -> stepper colours, decision-card text, guard 3
  risk_score      int    FROZEN       -> fact strip band + score          (page.tsx:35, :69)
  risk_breakdown  json   FROZEN       -> written every round, READ BY NOTHING
  chain           json   Role[]       -> "Sales Manager, then Finance."   (page.tsx:152)
  reason          string?             -> decision-card text               (page.tsx:179-:180)
  created_at                          -> stepper "Submitted"              (page.tsx:166)
  resolved_at                         -> reports only

approval_step                         prisma/schema.prisma:546
  step_no, required_role              -> stepper node labels, actionableStep ordering
  status                              -> node icon; guard 4; the conditional claim
  acted_by_id -> app_user.name        -> node detail line
  acted_at, note                      -> node detail line
  UNIQUE (request_id, step_no)

quotation                             prisma/schema.prisma:439
  status                              -> fact strip badge; guard 2; stepper "Confirmed"
  approval_version                    -> which version the next round takes
  negotiation_pending                 -> the SENT-instead-of-APPROVED branch (:75, :83)
  version                             -> optimistic lock, +1 on every decision
  rep_user_id                         -> own-quote rule
  total, margin_bp                    -> fact strip

quotation_line                        prisma/schema.prisma:488
  description                         -> "Line" column (snapshot, not a product join)
  effective_discount_bp               -> "Discount Given"  (line + order discount compounded)
  ceiling_bp                          -> "Limit Allowed"   (min(tier, category), snapshotted)
  discount_bp                         -> overwritten by settleCounterOffers on an accepted counter

customer -> customer_tier             name + discount_ceiling_bp -> fact strip
product  -> product_category          name -> "(Hardware)"; discount_ceiling_bp feeds ceiling_bp
audit_log                             prisma/schema.prisma:564   the trail
approval_rule / risk_config           prisma/schema.prisma:393 / :408   routing + scoring inputs
portal_request                        counters settled on a negotiation decision
```

Two constraints carry most of the weight:
- `@@unique([quotationId, version])` on `approval_request` (`prisma/schema.prisma:541`) — one row per round, enforced by the database.
- The conditional `WHERE status = 'PENDING'` in the claim (`src/services/approval.service.ts:66`) — mutual exclusion without a lock table.

---

## 9. How this screen connects to the others

- **In, from screen 5.** Row click → `/approvals/<quotation.public_id>` (`src/app/(internal)/approvals/page.tsx:69`).
- **In, from anywhere with the quote's public id.** The URL is guessable from the quotation URL — same id, different prefix.
- **Out, to screen 4.** "Open quotation" → `/quotes/<publicId>` (`page.tsx:59`). That screen mirrors the round back as a warning card with per-step badges and the same risk score (`src/app/(internal)/quotes/[publicId]/page.tsx:201`–`:214`).
- **Out, to the portal (screens 11–12).** An approved or rejected counter-offer round returns the quote to `SENT`, which is the portal's visible state (`src/services/approval.service.ts:75`, `:83`).
- **Back to screen 5.** `revalidatePath("/approvals")` (`src/app/(internal)/actions/approval.ts:17`) means the list's counters and Stage column are already correct when the reviewer navigates back.
- **Fulfillment (screens 7–8).** Only reachable after the customer confirms, which the stepper's last node tracks (`src/components/approvals/stepper.tsx:19`).
- **Reports (screen 15).** Average approval time = `resolved_at − created_at` over `APPROVED` requests (`src/services/reports.service.ts:53`) — the two timestamps this screen's decisions write.
- **Deal Health (screen 14).** Every audit write also touches `quotation.last_activity_at` (`src/lib/audit.ts:42`), which is what "idle for N days" reads. Deciding a request resets that clock.

---

## 10. Gotchas

1. **An APPROVE decision can be recorded with `reason: null`.** The Zod `superRefine` demands a note only for REJECT and RETURN (`src/lib/validation/approval.ts:13`); the dialog even labels it "Note (optional)" for approve (`decision-panel.tsx:21`). Spec A3 says "all approvals, rejections, and edits must be logged with user, timestamp, and reason" (`docs/DealFlow360.txt:131`). User and timestamp are always written (`src/lib/audit.ts:33`–`:35`); the reason is not. The dev database has 11 `APPROVE` audit rows with `reason IS NULL`, including both approvals on `Q-2026-0091`. This is a genuine gap against the spec, not a documentation shortcut.
2. **Sibling steps of a REJECTED request stay `PENDING` forever.** The reject branch marks only the acted step and the request (`src/services/approval.service.ts:66`–`:74`); step 2 of a two-step chain is never closed. Nothing reads it afterwards, because every downstream check gates on `request.status === "PENDING"` first (`page.tsx:36`, `src/services/approval.service.ts:166`) — but any raw query over `approval_step` will find pending steps belonging to dead requests. RETURN is even blunter: it touches no step at all (`:57`–`:63`).
3. **The frozen breakdown is never displayed.** `approval_request.risk_breakdown` holds a complete per-line snapshot of the terms that were submitted, and this screen ignores it — the flagged table is rebuilt from live `quotation_line` rows (`page.tsx:112`) and even `worst` is recomputed (`page.tsx:47`). So the score in the fact strip and the table below it have different provenance: one frozen, one live. They agree today only because every edit path opens a new round. If a line were ever changed without opening a round, this page would show an old score above a new table, silently.
4. **`current.riskScore` versus `quotation.riskScore`.** Both exist, both are on this page's data, and they can differ. The page correctly uses the request's copy (`page.tsx:35`), while the quote detail screen uses the quotation's (`src/app/(internal)/quotes/[publicId]/page.tsx:59`). If the two screens ever show different numbers for the same deal, this is why.
5. **You cannot view a superseded round.** `getApprovalDetail` always returns `approvalRequests[0]` (`src/services/approval.service.ts:205`) and `history` is used only to count (`page.tsx:57`). Clicking the `v1` row on the list opens `v2`. The old round's frozen score, breakdown and step notes are in the database and unreachable through the UI.
6. **One condition on `canDecide` has no explanation.** `q.status === "PENDING_APPROVAL"` is in the boolean at `page.tsx:38` but not in the `blockedWhy` ladder at `:39`–`:45`. A manager looking at a superseded round sees disabled buttons and the neutral text "Waiting for Sales Manager." with no reason given.
7. **"Sales Manager only." is hard-coded for any single-role chain.** `chain.length === 1 ? "Sales Manager only." : "Sales Manager, then Finance."` (`page.tsx:152`). An admin who configures a Finance-only rule gets a wrong label. Likewise the two-role text assumes the order.
8. **"This step is waiting for a Finance."** — `blockedWhy` at `page.tsx:43` inserts `ROLE_LABEL[...]` after "a", so Finance reads ungrammatically. Cosmetic.
9. **The audit trail is capped at 50 and is not scoped to this round.** `take: 50` at `src/services/approval.service.ts:201`, `where` is the quotation. A long-running deal with many line edits and portal messages will push the earliest approval entries off the bottom, with no "load more".
10. **Anyone logged in can read the page.** `requireUser()` at `page.tsx:30` passes no roles. A Sales Rep can open any colleague's approval detail and read the cost-derived margin, the risk score and the full audit trail. Only *acting* is restricted.
11. **Approving a counter-offer rewrites a line's discount.** `settleCounterOffers` sets `quotation_line.discount_bp = portal_request.proposed_discount_bp` directly (`src/services/approval.service.ts:124`), bypassing the normal `updateLine` path and its guards. It is correct here — this is the whole point of accepting a counter — but it means a `quotation_line` can change without a `LINE_UPDATE` audit row. The `APPROVE` row's `after_json` is the only trace.
12. **The dev database is polluted.** 58 approval requests, most written by earlier automated test runs, with reasons like `cleanup mtomkawh`, `mx reason`, `for revise`. Use requests 3, 54/55/56 and 215/216 as the honest examples. There are no seeded approval requests at all — `prisma/seed/*` creates none, so on a fresh database this screen is unreachable until someone confirms an over-ceiling quote.
13. **One dev-database row is impossible under current code.** Request 56 (`Q-2026-0091` v3) was created even though v2 was `APPROVED`. Today `confirmFromPortal` re-routes only when the current approval version is not covered by an approval (`src/services/portal.service.ts:140`–`:141`) and `openApprovalRound` supersedes `APPROVED` predecessors too (`:244`). Both landed in commit `088b33d`, after that row was written. Do not use request 56 to reason about current behaviour.
14. **The mockup's audit table has an action this app never writes.** `docs/MOCKUP_SCREENS.md:83` shows "Resubmitted". There is no `RESUBMITTED` action in the code; a resubmit appears as a fresh `CONFIRM` row (`ACTION_TEXT` at `src/components/shared/audit-trail.tsx:20`–`:46`). Trust the code.
