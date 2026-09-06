# Screen 14 — Deal Health and Anomaly Dashboard

Route: `/health`
Page file: `src/app/(internal)/health/page.tsx`
Spec: `docs/DealFlow360.txt` section B9 (line 291)
Mockup: `docs/MOCKUP_SCREENS.md` screen 14, image `docs/mockup/14-deal-health-dashboard.png`

---

## 1. What this screen is

One list of problems, recomputed from live data every time you open the page.

Three kinds of problem:

1. **Stalled** — an open quotation nobody has touched for more than N days.
2. **Discount anomaly** — a discount well above what this rep normally gives.
3. **Delivery slippage** — a promised delivery date that has passed, or that the fulfillment plan already expects to miss.

Each row links to the quotation. A manager can **Nudge Rep** or **Escalate** from the row.

The important mental model: **there is no background job.** Nothing wakes up at night and scans for stalled deals. The detectors run inside the page render (`src/app/(internal)/health/page.tsx:22`, `await refreshAlerts()`) and inside the "Recompute now" button (`src/app/(internal)/actions/health.ts:15`). If nobody opens the page, no alert row is ever written or resolved. The `deal_alert` table is a **cache of the last time somebody looked**, not an event log.

---

## 2. Who can open it, and who enforces that

| Role | Can open `/health`? | Sees the Action column? | Can Nudge / Escalate? | Enforced at |
| --- | --- | --- | --- | --- |
| ADMIN | yes | yes | yes | `src/app/(internal)/health/page.tsx:25`, `src/app/(internal)/actions/health.ts:28` |
| SALES_MANAGER | yes | yes | yes | same |
| FINANCE | yes | yes | yes | same |
| SALES_REP | yes | **no** | **no** | `src/app/(internal)/health/page.tsx:25` hides the column; `src/app/(internal)/actions/health.ts:28` throws `FORBIDDEN` |
| not logged in | no | — | — | `src/middleware.ts:12-43` redirects to `/login?next=/health` |

Three layers, in the order they run:

1. **`src/middleware.ts:12`** — runs before the page. Reads the `df_session` cookie, looks the token up in `session` (`src/middleware.ts:47`), checks `expiresAt > now` and `user.isActive`. No valid session → redirect to `/login`. The matcher at `src/middleware.ts:59` covers `/health`. Note the middleware only role-gates paths starting with `/admin` (`src/middleware.ts:25`), so it does **not** restrict `/health` by role.
2. **`requireUser()`** at `src/app/(internal)/health/page.tsx:21` — called with **no roles argument**, so it only re-checks that a session exists (`src/lib/auth/internal.ts:75-80`). Every logged-in role passes.
3. **`requireActionUser(["SALES_MANAGER", "FINANCE", "ADMIN"])`** at `src/app/(internal)/actions/health.ts:28` — the real gate on Nudge/Escalate. Hiding the buttons in the UI (`page.tsx:25`, `canAct`) is cosmetic; this line is what actually stops a SALES_REP who replays the server action.

`refreshHealth` (the "Recompute now" button) calls `requireActionUser()` with **no roles** (`src/app/(internal)/actions/health.ts:14`) — any logged-in user, including a SALES_REP, can trigger a full recompute.

The nav tab "Deal Health" has no `roles` field (`src/lib/nav.ts:15`), which matches: everyone sees it.

---

## 3. Everything on the screen, and where each value comes from

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Page title | "Deal Health and Anomaly Dashboard" | hard-coded `page.tsx:30` | — | — |
| Description "idle more than 3 days … z ≥ 2 or 10 points over" | 3 / 2 / 10 | `page.tsx:23` `prisma.riskConfig.findUnique({ where: { id: 1 } })` | `risk_config.stalled_days`, `.anomaly_z`, `.anomaly_abs_bp` | Seeded row id=1; an ADMIN edits it on the Risk Configuration screen. Same singleton row that holds the risk-score weights (`prisma/schema.prisma:408-425`). |
| Tile "Stalled Deals" number | 0 | `listAlerts()` `src/services/health.service.ts:79-80` counts alerts with `type === "STALLED"` | `deal_alert.type` where `resolved_at IS NULL` | Written by `refreshAlerts` seconds earlier, from `detectStalled` (`src/domain/anomaly.ts:20`) |
| Tile caption "quotes idle 4+ days" | 4 | `page.tsx:35`, `(cfg.stalledDays ?? 3) + 1` | `risk_config.stalled_days` | The `+1` is because the detector uses strict `>` (`src/domain/anomaly.ts:24`): idle exactly 3 days is not stalled, 4 is. |
| Tile "Discount Anomalies" number | 30 | `health.service.ts:80` | `deal_alert.type = 'DISCOUNT_ANOMALY'` | `detectDiscountAnomalies` (`src/domain/anomaly.ts:39`) |
| Tile "Delivery Slippage" number | 1 | `health.service.ts:80` | `deal_alert.type = 'DELIVERY_SLIPPAGE'` | `detectSlippage` (`src/domain/anomaly.ts:63`) |
| Row → Deal → customer name | "Acme Corp" (or "No customer") | `listAlerts` include `health.service.ts:77` | `customer.name` via `quotation.customer_id` | Typed by the rep when the quotation was created. `customer_id` is nullable, hence the `?? "No customer"` at `page.tsx:57`. |
| Row → quote number | `Q-2026-0144` | `health.service.ts:77` | `quotation.number` | Allocated from the `counter` table when the quotation was created |
| Row → rep name | "Priya Rep" | `health.service.ts:77` | `user.name` via `quotation.rep_user_id` | Set at quotation creation to the logged-in rep |
| Row → status badge | "Sent" | `health.service.ts:77` | `quotation.status` | The quotation state machine (`src/lib/state/quotation.machine.ts`) |
| Row → Issue badge label | "Discount anomaly" | `page.tsx:17` `TYPE_LABEL[a.type]` | `deal_alert.type` | Chosen by whichever detector fired |
| Row → Issue message | "Discount 24.6% vs rep average 2.7%" | `page.tsx:68` | `deal_alert.message` | Composed as a template string by the detector: `src/domain/anomaly.ts:29` (stalled), `:54` (discount), `:75` (slippage). Rewritten on every recompute (`health.service.ts:64`). |
| Row → "severity N" | "severity 3" | `page.tsx:69`, shown only when `> 1` | `deal_alert.severity` | Integer from the detector — see the arithmetic in section 5 |
| Row → Flagged | "5 Sep 2026, 16:58" | `page.tsx:72` `formatDateTime(a.firstSeenAt)` | `deal_alert.first_seen_at` | Set once, at `health.service.ts:65`, the **first** recompute that saw this condition. Never updated afterwards — repeats only touch `last_seen_at` (`health.service.ts:64`). So "Flagged" means "when we first noticed", which is not the same as "when the deal went bad" — it is the first page load after it went bad. |
| Row → "Nudge sent 5 Sep, 17:18" | | `page.tsx:75` → `alert-actions.tsx:32` | `deal_alert.last_nudged_at` | `health.service.ts:92` |
| Row → "Escalated 5 Sep, 17:19" | | `alert-actions.tsx:30` | `deal_alert.escalated_at` | `health.service.ts:92` |
| Row link target | `/quotes/<publicId>` | `page.tsx:54` | `quotation.public_id` | Random 12-char id generated at creation (`src/lib/ids.ts`) |
| Empty state | "Every deal is healthy" | `page.tsx:40` | — | Rendered when `visible.length === 0` |

Real rows from the dev database (**polluted** — 178 quotations left over from earlier test agents, not a clean seed):

```
 id | quotation_id |       type        | severity |                      message
  4 |          582 | DELIVERY_SLIPPAGE |        6 | Promised 2026-08-30, not shipped (6 days overdue)
  3 |          581 | DISCOUNT_ANOMALY  |        5 | Discount 40.0% vs rep average 2.7%
  5 |          144 | DISCOUNT_ANOMALY  |        3 | Discount 24.6% vs rep average 2.7%
```

and the payload column of alert 5:

```json
{"z": 3.01, "sdBp": 729, "meanBp": 267, "baseline": "rep", "discountBp": 2459}
```

`payload` (`deal_alert.payload`, JSON) is written at `health.service.ts:64-65` from the detector's `payload` object. **Nothing on this screen renders it.** It exists so you can audit why an alert fired. Read it with SQL.

---

## 4. The queries this page runs

In order.

### 4a. `requireUser()` — the session
`src/lib/auth/internal.ts:75` → `getSessionUser()` reads the `df_session` cookie and joins `session` → `user`.

### 4b. `refreshAlerts()` — three parallel reads, then a transaction
`src/services/health.service.ts:24`.

1. **Config** — `health.service.ts:16`
   `SELECT * FROM risk_config WHERE id = 1`. If the row is missing, hard-coded fallbacks kick in at `health.service.ts:17`: `stalledDays 3, anomalyZ 2, anomalyAbsBp 1000, minHistory 5`. These are the same numbers as the Prisma column defaults (`prisma/schema.prisma:417-420`).

2. **Open quotations** — `health.service.ts:27`
   `WHERE status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','UNDER_NEGOTIATION')` — the list comes from `OPEN_STATUSES` at `src/lib/state/quotation.machine.ts:44`.
   Selects `id, repUserId, status, lastActivityAt, grossTotal, discountTotal`. No `take`, so **every** open quotation is loaded.

3. **Discount history** — `health.service.ts:28-33`
   `WHERE status IN ('CONFIRMED','FULFILLMENT','PAID')` (the `HISTORY_STATUSES` constant, `health.service.ts:13`), `ORDER BY confirmed_at DESC`, **`take: 500`**.
   Only *won* quotations count as history. A rejected quotation with a wild discount never pollutes the baseline.

4. **Slippage candidates** — `health.service.ts:34-37`
   `WHERE status IN ('CONFIRMED','FULFILLMENT') AND promised_date IS NOT NULL`, with the ACCEPTED fulfillment plan, its lines (`is_backorder`, `expected_date`) and its shipments (`status`).

5. **Existing open alerts** — `health.service.ts:57`
   `SELECT * FROM deal_alert WHERE resolved_at IS NULL`.

6. **The reconcile transaction** — `health.service.ts:61-69`. Described in section 5.

### 4c. `listAlerts()` — what the table renders
`health.service.ts:74-78`. `SELECT * FROM deal_alert WHERE resolved_at IS NULL ORDER BY severity DESC, first_seen_at ASC`, joining the quotation, its customer and its rep. No pagination — every open alert is rendered.

### 4d. `riskConfig.findUnique` again
`page.tsx:23`. The page reads `risk_config` a second time, purely for the description text and tile captions. `refreshAlerts` already read it internally but does not return it.

---

## 5. Every condition on this page

### 5.1 The reconcile loop (`health.service.ts:58-69`)

The key is `` `${quotationId}:${type}` `` (`health.service.ts:58`). At most **one open alert per quotation per type**. A quotation can carry three alerts at once (one stalled, one discount, one slippage) but never two stalled.

| Situation | What happens | Line |
| --- | --- | --- |
| Detector fires and no unresolved row has that key | `INSERT` with `first_seen_at = last_seen_at = now` | `health.service.ts:65` |
| Detector fires and an unresolved row exists | `UPDATE severity, message, payload, last_seen_at`. `first_seen_at` is untouched, so the "Flagged" column keeps the original date even as the message changes. | `health.service.ts:64` |
| An unresolved row exists but no detector fired for that key | `UPDATE ... SET resolved_at = now` in one `updateMany` | `health.service.ts:67-68` |

All of it runs inside `prisma.$transaction` (`health.service.ts:61`), so a crash mid-way leaves the table exactly as it was.

There is **no** "resolved then reappears" merging: if the condition comes back later, a brand new row is inserted (the old one stays resolved). That is why the dev DB shows `STALLED: 1 total, 0 open` — the single stalled alert was created, then resolved on a later load.

### 5.2 Stalled (`src/domain/anomaly.ts:20-32`)

```
idleDays = floor((now - lastActivityAt) / 86_400_000)      anomaly.ts:18
fires when  idleDays > cfg.stalledDays                      anomaly.ts:24   (strict >)
severity    = max(1, floor(idleDays / cfg.stalledDays))     anomaly.ts:28
message     = "Idle {idleDays} days (limit {stalledDays})"  anomaly.ts:29
```

With the seeded `stalledDays = 3`:

| idle days | fires? | severity |
| --- | --- | --- |
| 3 | no (`3 > 3` is false) | — |
| 4 | yes | `floor(4/3) = 1` |
| 6 | yes | `floor(6/3) = 2` |
| 9 | yes | `floor(9/3) = 3` |
| 14 | yes | `floor(14/3) = 4` |

Severity is literally "how many times over the limit". It is shown only when `> 1` (`page.tsx:69`), so a freshly stalled deal shows no severity chip.

The status filter at `anomaly.ts:22` re-checks `OPEN` (`anomaly.ts:8`) even though the SQL already filtered — belt and braces, and it keeps the pure function correct when called from tests.

### 5.3 Where `lastActivityAt` comes from — and the nudge paradox

`quotation.last_activity_at` (`prisma/schema.prisma:466`) defaults to `now()` at creation. After that, **exactly one thing** bumps it:

```ts
// src/lib/audit.ts:41-43
if (e.quotationId) {
  await tx.quotation.update({ where: { id: e.quotationId }, data: { lastActivityAt: new Date() } });
}
```

`audit()` is the single audit helper, called inside the transaction of every service that changes a quotation. So the rule is: **any audited change to a quotation resets its idle clock.** Adding a line, changing a discount, approving, sending, a portal counter-offer, recording a payment — all of them write an audit row with `quotationId` set, and all of them bump `lastActivityAt`.

Now the consequence, which surprises people:

`actOnAlert` (`health.service.ts:93-101`) calls `audit(tx, { ..., quotationId: alert.quotationId, action: "NUDGE" })`. That audit row carries a `quotationId`, so `src/lib/audit.ts:42` bumps `lastActivityAt` to now.

**Nudging a stalled deal clears the stalled alert.** Click "Nudge Rep" on a 9-day-idle quote, then reload `/health`: `idleDays` is now 0, `detectStalled` does not fire, the reconcile loop finds no `STALLED` key for that quotation, and `health.service.ts:68` stamps `resolved_at` on the very alert you just acted on. The row vanishes from the table, along with the "Nudge sent …" label you were expecting to see.

This does **not** happen for discount anomalies or delivery slippage — those detectors do not look at `lastActivityAt`, so nudging one leaves it in place and the "Nudge sent" label sticks. That is why the dev DB has a nudged discount alert (id 3) still open, but zero open stalled alerts.

Whether that is a bug or a feature is a judgement call. Read literally, it is correct: the deal *is* no longer idle, because a human just acted on it. But it means the dashboard cannot show you "deals I nudged and that are still not moving" — the evidence is only on the quotation's audit trail.

### 5.4 Discount anomaly (`src/domain/anomaly.ts:39-60`)

First, what is compared. The **order-level effective discount in basis points**, computed at `health.service.ts:21`:

```
effectiveDiscountBp = grossTotal === 0 ? 0 : round(discountTotal * 10000 / grossTotal)
```

`grossTotal` and `discountTotal` are stored paise columns on `quotation` (`prisma/schema.prisma:448-449`), recalculated by the pricing service whenever a line changes. So a 25% discount is `2500` bp. Line-level and order-level discounts are already rolled into `discountTotal`, so this is the blended discount on the whole order.

Skip conditions (`anomaly.ts:42`): status not open, or `effectiveDiscountBp <= 0`. A zero-discount quote is never an anomaly.

Baseline choice (`anomaly.ts:43-45`):

```
own      = repHistory.get(repUserId) ?? []
baseline = own.length >= cfg.minHistory ? own : teamHistory
if (baseline.length === 0) continue       // no history at all -> silent
```

- The rep has **≥ minHistory** (5) confirmed/fulfilment/paid quotes → compare against *their own* discounts.
- Fewer than 5 → compare against the whole team's last 500 won quotes.
- Team history also empty (a brand-new database) → **no alert at all**. This is deliberate: with nothing to compare against, everything would look anomalous.

The `baseline` field in `payload` records which branch ran, and the message says "rep average" or "team average" (`anomaly.ts:54`).

The test (`anomaly.test.ts:33-37`) is the executable version of this rule.

The maths (`anomaly.ts:46-49`):

```
mean, sd = meanAndSd(baseline)            // population sd, anomaly.ts:10-15
z        = (discountBp - mean) / max(sd, 100)
overMean = discountBp - mean
fires when  z >= cfg.anomalyZ  OR  overMean >= cfg.anomalyAbsBp
severity = max(1, round(z))               anomaly.ts:53
```

**Why the sd is floored at 100 bp (= 1 percentage point).** If a rep has always given exactly 8%, the standard deviation is 0 and every z-score is infinity — an 8.1% discount would be a screaming anomaly. Flooring the denominator at 100 bp means the rep needs to be at least `anomalyZ` percentage points above their own average before the z branch fires. `anomaly.test.ts:39-45` pins this:

- history `[800,800,800,800,800]`, mean 800, sd 0 → floor 100
- discount 950: `z = (950-800)/100 = 1.5` → below 2 → no alert
- discount 1000: `z = (1000-800)/100 = 2.0` → fires
- with `anomalyZ = 3`, 1000 no longer fires

**The absolute escape hatch.** `overMean >= anomalyAbsBp` (default 1000 bp = 10 points). This catches the rep with a *wildly variable* history, where the sd is so large that nothing ever reaches z ≥ 2. Example: history `[0, 4000]` → mean 2000, sd 2000. A 3900 bp discount gives `z = (3900-2000)/2000 = 0.95`, well under 2 — but `overMean = 1900 >= 1000`, so it fires anyway. Severity would then be `max(1, round(0.95)) = 1`.

**Worked example with real data from the dev DB** (alert id 5, quotation 144):

```
discountBp = 2459   (24.59% blended discount on the order)
meanBp     = 267    (this rep's own average across their won quotes: 2.67%)
sdBp       = 729    (7.29 points; well above the 100 bp floor, so the floor does not bite)
z          = (2459 - 267) / max(729, 100) = 2192 / 729 = 3.007
             3.007 >= anomalyZ (2)  ->  fires on the z branch
             overMean = 2192 >= anomalyAbsBp (1000) -> would also have fired on the absolute branch
severity   = max(1, round(3.007)) = 3
message    = "Discount 24.6% vs rep average 2.7%"       (2459/100 -> 24.59 -> toFixed(1))
```

and alert id 3 on the same rep's baseline:

```
discountBp = 4000, mean = 267, sd = 729
z = 3733 / 729 = 5.12  ->  severity = round(5.12) = 5    (matches the stored row)
```

Note the severities are on completely different scales between detector types — a stalled severity 3 means "three times over the idle limit", a discount severity 3 means "three standard deviations out", a slippage severity 3 means "three days". They sort together in one `ORDER BY severity DESC` (`health.service.ts:76`), so a 6-day slippage outranks a 5-sigma discount. That ordering is not meaningful; treat the list as unordered within a type.

### 5.5 Delivery slippage (`src/domain/anomaly.ts:63-80`)

The input rows are assembled at `health.service.ts:48-54`:

| Field | Built from | Meaning |
| --- | --- | --- |
| `promisedDate` | `quotation.promised_date` (`@db.Date`, `prisma/schema.prisma:460`), via `toISODate` | What the customer was told |
| `expectedDate` | the **latest** `expected_date` among the ACCEPTED plan's backorder lines (`health.service.ts:50-51`) | When the plan itself thinks the goods arrive |
| `shipped` | `plan exists AND shipments.length > 0 AND every shipment.status === 'SHIPPED' AND no backorder lines` (`health.service.ts:52`) | Fully out the door |

Note `q.fulfillmentPlans[0]` (`health.service.ts:49`) takes the first ACCEPTED plan. The query filters `status: "ACCEPTED"`, so in practice there is one.

Then (`anomaly.ts:65-77`):

```
if (shipped) skip
late    = expectedDate && expectedDate > promisedDate ? diffDays(promised, expected) : 0   // predictive
overdue = today > promisedDate ? diffDays(promised, today) : 0                             // reactive
slip    = max(late, overdue)
fires when slip > 0
severity = slip          (whole days)
```

Two independent triggers:

- **Reactive / overdue** — the promise date is in the past and the order is not fully shipped. Message: `"Promised 2026-08-30, not shipped (6 days overdue)"`.
- **Predictive / late** — the promise date may still be in the future, but a backorder line already says the stock arrives after it. Message: `"Expected 2026-09-12, promised 2026-09-10 (2 days late)"`. This is the useful one — it warns you *before* you break the promise.

`today` is the **Asia/Kolkata** calendar date, computed at `anomaly.ts:83` via `todayISO("Asia/Kolkata", now)` (`src/domain/dates.ts:31`). The server runs in UTC; business "today" is Indian. `promisedDate` is a `@db.Date` column read through `toISODate` (`src/domain/dates.ts:23`), which uses the **UTC** components — correct for a date-only column.

`anomaly.test.ts:48-61` pins all four cases, including quotation 4 (`promised 2026-09-10, expected 2026-09-09`) which correctly does **not** fire: an expected date *earlier* than the promise is good news.

### 5.6 The type filter

`/health?type=STALLED` filters client-side in the render (`page.tsx:24`), after `listAlerts()` has already loaded everything. The tiles keep showing the **unfiltered** counts (`page.tsx:35-37` use `counts`, not `visible`), which is what you want — the tiles are the navigation. Clicking the active tile toggles back to `/health` (`page.tsx:35`, the ternary on `href`).

Any junk value works: `/health?type=BANANA` filters to zero rows and shows "No alerts of this kind" (`page.tsx:40`). There is no validation on `type`.

### 5.7 `healthScore` is dead code

`src/domain/anomaly.ts:87-90` exports a composite score:

```
score = 100 - min(40, idle * 4) - round(riskScore * 0.3) - (anomaly ? 15 : 0) - (slippage ? 15 : 0)
clamped to 0..100
```

It is unit-tested (`src/domain/__tests__/anomaly.test.ts:69-73`) and **called from nowhere else**. `grep -rn healthScore src/` returns only the definition and the test. No service imports it, no page renders it. **There is no composite health number anywhere in the product.** If somebody asks "what's this deal's health score?", the answer is: the feature was written and then not wired up. Do not let the file name mislead you.

---

## 6. Every action you can take here

### 6.1 Open the page
Runs the full recompute (`page.tsx:22`). This is a write on a GET: opening `/health` inserts, updates and resolves `deal_alert` rows.

### 6.2 Click a tile
Navigation only. `/health?type=...` (`page.tsx:35-37`). Re-renders the page, which recomputes again.

### 6.3 Click a row or the customer name
`ClickableRow` / `Link` to `/quotes/{publicId}` (`page.tsx:54,56`). This is spec B9's "clicking an alert opens the related quotation directly".

### 6.4 "Recompute now"
`src/components/health/refresh-button.tsx:56` → `refreshHealth()` (`src/app/(internal)/actions/health.ts:12`).
Any logged-in role. Calls `refreshAlerts()`, then `revalidatePath("/health")` and `revalidatePath("/dashboard")` (`:16-17`), then toasts `"Health recomputed: N open alerts"` where N is `found.length` — the number of conditions detected, returned at `health.service.ts:70`.

Because the page recomputes on load anyway, this button is mostly reassurance. It matters when you have edited `risk_config` in another tab and want the thresholds re-applied without a navigation.

### 6.5 "Nudge Rep"
`src/components/health/alert-actions.tsx:36` → `actOnAlert({ alertId, action: "NUDGE" })` → `src/app/(internal)/actions/health.ts:24` → `src/services/health.service.ts:86`.

In one transaction (`health.service.ts:87`):

1. Load the alert with its quotation (`:88`). Missing → `NotFoundError` (`:89`).
2. Already resolved → `ConflictError "This alert is already resolved"` (`:90`). The client catches `code === "CONFLICT"` and calls `router.refresh()` (`alert-actions.tsx:19`) so the stale row disappears.
3. `UPDATE deal_alert SET last_nudged_at = now` (`:92`).
4. `audit(tx, { entityType: "DealAlert", entityId: alert.id, quotationId: alert.quotationId, action: "NUDGE", reason: alert.message, after: { nudged: <rep name>, type: <alert type> } })` (`:93-101`).

**Be clear about what a nudge is.** It is an `audit_log` row. It sends no email, no push, no in-app notification. There is no notification table in the schema. The rep learns about it only if they open that quotation and read its audit trail. The toast (`alert-actions.tsx:22-24`) says "Nudge sent to Priya on Q-2026-0144 — Audit entry #713 written on the quotation", which is honest: an audit entry is exactly what was written.

And per section 5.3, the audit row bumps `lastActivityAt`, which clears any STALLED alert on that quotation.

### 6.6 "Escalate"
Same code path, `action: "ESCALATE"`. Stamps `escalated_at` instead of `last_nudged_at` (`health.service.ts:92`) and writes `after: { escalated: true, type }` (`:100`). Also an audit row, also no notification, also bumps `lastActivityAt`.

The button is disabled once `escalatedAt` is set (`alert-actions.tsx:39`) — you can escalate once. Nudge has no such guard; you can nudge repeatedly and each one overwrites `last_nudged_at`.

`revalidatePath` after the action (`src/app/(internal)/actions/health.ts:30-31`) uses `result.quotationNumber` in the path — but the quotation route is keyed on `publicId`, not `number` (`page.tsx:54`). So `revalidatePath("/quotes/Q-2026-0144")` revalidates a path that does not exist. Harmless (the client also calls `router.refresh()`), but the quotation page is not actually invalidated by this line.

---

## 7. Scenarios

### 7.1 A freshly stalled deal
Quotation 401, status SENT, `last_activity_at = 2026-09-01 10:00`. `risk_config.stalled_days = 3`.

- **1 Sep – 4 Sep**: someone loads `/health`. `idleDays` is 0…3. `3 > 3` is false → nothing.
- **5 Sep 11:00**, a manager loads `/health`. `refreshAlerts` runs. `idleDays = floor((5 Sep 11:00 − 1 Sep 10:00)/86_400_000) = 4`. `4 > 3` → fires. `severity = floor(4/3) = 1`. Message `"Idle 4 days (limit 3)"`.
- No unresolved row with key `401:STALLED` → **INSERT** (`health.service.ts:65`) with `first_seen_at = last_seen_at = 2026-09-05 11:00`.
- The tile "Stalled Deals" goes from 0 to 1. The row shows Flagged "5 Sep 2026, 11:00", no severity chip (severity is 1, and `page.tsx:69` only shows `> 1`).

Notice: the deal became stale on 4 Sep, but "Flagged" says 5 Sep, because that is when a human opened the page. No page load, no alert.

### 7.2 A deal that stops being stalled
Same quotation, alert id 88 open. On 7 Sep the rep edits a line. The pricing service writes an audit row with `quotationId: 401`, so `src/lib/audit.ts:42` sets `last_activity_at = 2026-09-07 09:30`.

Next `/health` load, 7 Sep 10:00: `idleDays = 0`, `detectStalled` returns nothing for 401. `foundKeys` has no `401:STALLED`. `existing` still has alert 88 → it lands in `cleared` (`health.service.ts:67`) → `UPDATE deal_alert SET resolved_at = '2026-09-07 10:00' WHERE id = 88`.

The row disappears from the table, the tile drops back to 0. The row is still in the table with `resolved_at` set — nothing is ever deleted.

If the rep then goes quiet again for 4 days, a **new** row is inserted with a new `first_seen_at`. There is no reopening of row 88.

### 7.3 A rep with no history
New rep, user id 42, joined last week, zero quotations in CONFIRMED/FULFILLMENT/PAID. They send a quote with a 35% discount.

- `repHistory.get(42)` → `undefined` → `own = []` (`anomaly.ts:43`).
- `own.length (0) >= minHistory (5)` is false → `baseline = teamHistory`.
- The team has won quotes, so `teamHistory` has entries. Say mean 380 bp, sd 900 bp.
- `z = (3500 − 380) / max(900, 100) = 3120 / 900 = 3.47` → ≥ 2 → fires. `severity = 3`.
- Message: `"Discount 35.0% vs team average 3.8%"` — the word "team" comes from the same `own.length >= minHistory` check (`anomaly.ts:54`).
- `payload.baseline = "team"`.

**Edge case:** on a brand-new database where *nobody* has won anything, `teamHistory` is also empty, `baseline.length === 0`, and `anomaly.ts:45` `continue`s. No discount alert can ever fire until the first quotation reaches CONFIRMED. `anomaly.test.ts:36` pins this.

### 7.4 A rep with a long history
Rep id 7 has 40 won quotes. `repHistory.get(7)` has 40 entries (built at `health.service.ts:46`). `40 >= 5` → own history is the baseline.

Using the real dev-DB numbers: mean 267 bp, sd 729 bp. Their new quote at 2200 bp:

```
z = (2200 − 267) / max(729, 100) = 1933 / 729 = 2.652  ->  >= 2, fires
severity = round(2.652) = 3
message  = "Discount 22.0% vs rep average 2.7%"
```

Their colleague with the same 22% discount but a mean of 1800 bp and sd of 400 bp gets `z = (2200−1800)/400 = 1.0` → does not fire on z; `overMean = 400 < 1000` → does not fire on the absolute branch either. **Same discount, different verdict** — which is the whole point of B9's "well above a rep's *historical* average".

One thing to know: `take: 500` on the history query (`health.service.ts:31`) is a global cap across all reps, ordered by `confirmed_at DESC`. Once the company has more than 500 won quotations, a rep who has not closed anything recently gets **zero** history rows and silently falls back to the team baseline, even though they have years of data. Nothing on screen tells you this happened; only `payload.baseline` in the database does.

### 7.5 An absolute-threshold anomaly
Rep id 9 is erratic: won quotes at 0%, 5%, 40%, 2%, 38% → `[0, 500, 4000, 200, 3800]`.

```
mean = (0+500+4000+200+3800)/5 = 1700
variance = ((0-1700)² + (500-1700)² + (4000-1700)² + (200-1700)² + (3800-1700)²)/5
         = (2_890_000 + 1_440_000 + 5_290_000 + 2_250_000 + 4_410_000)/5 = 3_256_000
sd = 1804
```

New quote at 3000 bp (30%):

```
z        = (3000 − 1700) / max(1804, 100) = 1300 / 1804 = 0.72   ->  0.72 < 2, z branch does NOT fire
overMean = 3000 − 1700 = 1300                                    ->  1300 >= 1000, ABSOLUTE branch fires
severity = max(1, round(0.72)) = max(1, 1) = 1
```

So the alert appears with **severity 1 and no severity chip**, even though the discount is 30%. The severity formula only ever reflects the z-score (`anomaly.ts:53`), never the absolute overage. A deal caught purely by the escape hatch always looks mild. Check `payload.z` if a low severity looks wrong.

(If z had rounded to 0 — say `z = 0.3` — `Math.max(1, 0)` still gives 1, so severity is never 0.)

### 7.6 An overdue delivery
Quotation 582, status FULFILLMENT, `promised_date = 2026-08-30`. Its ACCEPTED plan has one shipment still in PACKED, so `shipped` is false (`health.service.ts:52` requires *every* shipment to be SHIPPED). No backorder lines, so `expectedDate = null`.

On 5 Sep, `today = "2026-09-05"` (Kolkata):

```
late    = 0                                            (expectedDate is null)
overdue = diffDays("2026-08-30", "2026-09-05") = 6      (today > promised)
slip    = max(0, 6) = 6                                 -> fires
severity = 6
message  = "Promised 2026-08-30, not shipped (6 days overdue)"
```

This is alert id 4 in the dev database, verbatim. It sorts to the top of the table because 6 is the highest severity.

Every subsequent page load re-fires it with a larger `slip`, so `severity` and `message` climb by one per day via the UPDATE at `health.service.ts:64`, while `first_seen_at` stays at 5 Sep.

### 7.7 A predicted-late delivery
Quotation 610, `promised_date = 2026-09-10`. The ACCEPTED plan has a backorder line with `expected_date = 2026-09-14`.

On 5 Sep — **five days before anything is actually late**:

```
expectedDate = "2026-09-14"   (latest backorder expected_date, health.service.ts:51)
shipped      = false          (backorders.length > 0 forces this false, health.service.ts:52)
late    = diffDays("2026-09-10", "2026-09-14") = 4     (expected > promised)
overdue = 0                                            (today 2026-09-05 <= promised)
slip    = max(4, 0) = 4  -> fires, severity 4
message = "Expected 2026-09-14, promised 2026-09-10 (4 days late)"
```

The message branch is chosen by `late > 0` (`anomaly.ts:75`), so you can tell predictive from reactive by reading the sentence.

If the warehouse later receives stock and the plan line stops being a backorder, `backorders` is empty, `expectedDate` is null, `shipped` may become true — the detector goes quiet and the next page load resolves the alert.

### 7.8 Nudging, then reloading — the disappearing alert
Alert id 88: `STALLED`, quotation 401, "Idle 9 days", severity 3, nudged never.

1. Manager clicks **Nudge Rep** at 14:00.
2. `health.service.ts:92` sets `deal_alert.last_nudged_at = 14:00`.
3. `health.service.ts:93` writes an `audit_log` row with `quotationId = 401`.
4. `src/lib/audit.ts:42` sets `quotation.last_activity_at = 14:00`.
5. Toast: "Nudge sent to Priya on Q-2026-0144 · Audit entry #713 written on the quotation."
6. `alert-actions.tsx:25` calls `router.refresh()` → the page re-renders → `refreshAlerts()` runs again.
7. `idleDays = floor((14:00 − 14:00)/DAY) = 0`. Not stalled. `foundKeys` lacks `401:STALLED`.
8. `health.service.ts:68` sets `resolved_at = 14:00` on alert 88.
9. The row is gone. The "Nudge sent 14:00" label you expected never renders.

The only surviving evidence is `audit_log` row 713 on quotation 401 — visible on the quotation's audit trail — plus the resolved `deal_alert` row 88, which no screen shows.

Now the same click on a **discount anomaly**: steps 1–6 are identical, but the discount detector never reads `lastActivityAt`, so at step 7 it fires again, the reconcile loop UPDATEs the existing row (`health.service.ts:64`) and `last_nudged_at` survives. The row stays, now labelled "Nudge sent …". That is why the dev DB has alert id 3 (`DISCOUNT_ANOMALY`) carrying both a `last_nudged_at` and an `escalated_at`, and zero open `STALLED` rows.

### 7.9 Two people open the page at once
Both run `refreshAlerts` concurrently. Both read `existing` (`health.service.ts:57`) *outside* the transaction, then both try to INSERT the same `(quotationId, type)`. There is an index on `(quotation_id, type)` (`prisma/schema.prisma:960`) but **no unique constraint**, so nothing stops it: you can end up with two open alerts for the same condition, both rendered. The next single-user recompute will find only one of them via `existing.find` (`health.service.ts:63`), update it, and resolve the other (it lands in `cleared`). So it self-heals on the next load, but a double row is possible in the window.

### 7.10 A SALES_REP opens `/health`
Middleware passes (valid session, path is not `/admin`). `requireUser()` at `page.tsx:21` passes (no roles argument). The recompute runs — a rep can trigger a full alert recompute. `canAct` is false (`page.tsx:25`), so the "Action" header (`page.tsx:49`) and cells (`page.tsx:73`) are not rendered at all.

Important: the rep sees **every** alert in the company, including other reps' deals with their names, quote numbers, customers and discount percentages. There is no `repUserId` scoping in `listAlerts` (`health.service.ts:74-78`). If that is not intended, this is the line to change.

---

## 8. Schema behind this screen

### `deal_alert` (`prisma/schema.prisma:945-963`)

| Column | Type | Written by | Meaning |
| --- | --- | --- | --- |
| `id` | serial | Postgres | |
| `quotation_id` | int FK → `quotation`, `ON DELETE CASCADE` | `health.service.ts:65` | Delete a quotation and its alerts go with it |
| `type` | `AlertType` enum: `STALLED`, `DISCOUNT_ANOMALY`, `DELIVERY_SLIPPAGE` (`schema.prisma:181-185`) | `health.service.ts:65` | Which detector fired |
| `severity` | int, default 1 | `:64`, `:65` | Meaning differs per type — see 5.2 / 5.4 / 5.5 |
| `message` | text | `:64`, `:65` | Pre-rendered English from the detector. Rewritten on every recompute. |
| `payload` | jsonb, nullable | `:64`, `:65` | The evidence. Never rendered. |
| `first_seen_at` | timestamptz, default now | `:65` only | The "Flagged" column. Never updated. |
| `last_seen_at` | timestamptz, default now | `:64`, `:65` | Last recompute that still saw the condition. Not rendered anywhere. |
| `resolved_at` | timestamptz, nullable | `:68` | Non-null = hidden everywhere. Nothing ever clears it back to null. |
| `last_nudged_at` | timestamptz, nullable | `:92` | Renders "Nudge sent …" |
| `escalated_at` | timestamptz, nullable | `:92` | Renders "Escalated …", disables the Escalate button |

Indexes: `(quotation_id, type)` and `(resolved_at)` (`schema.prisma:960-961`). The second one serves the `WHERE resolved_at IS NULL` in both `listAlerts` and `refreshAlerts`.

### `risk_config` (`prisma/schema.prisma:408-425`)
Singleton, `id` defaults to 1. Four columns matter here — `stalled_days` (3), `anomaly_z` (2.0, a `Float`), `anomaly_abs_bp` (1000), `min_history` (5). The other eight columns are the risk-score weights used by the approval engine. **One row, two features.** Changing `stalled_days` on the Risk Configuration admin screen changes this dashboard on the very next page load, with no migration and no recompute job.

### `quotation` — the columns this screen reads
`last_activity_at` (`:466`, the idle clock), `gross_total` / `discount_total` (`:448-449`, the discount ratio), `promised_date` (`:460`, `@db.Date`), `status`, `rep_user_id`, `public_id`, `number`, `risk_score`. There is an index on `(rep_user_id, last_activity_at)` (`:482`).

### `audit_log`
The target of Nudge and Escalate. Written by `src/lib/audit.ts:26`, with `entity_type = "DealAlert"`, `entity_id` = the alert id, `quotation_id` = the quotation, `action` = `NUDGE` or `ESCALATE`, `reason` = the alert message at that moment.

---

## 9. How this screen connects to the others

- **← Risk Configuration (admin)** — writes `risk_config`. `stalled_days`, `anomaly_z`, `anomaly_abs_bp`, `min_history` are read here on every load (`health.service.ts:16`). Turn `stalled_days` down to 1 and the tile count jumps on the next refresh.
- **← Every quotation screen** — every audited edit bumps `last_activity_at` via `src/lib/audit.ts:42`, which is the single input to the stalled detector.
- **← The quotation pricing path** — `gross_total` and `discount_total` are what the anomaly detector divides.
- **← Fulfillment** — the ACCEPTED plan, its backorder `expected_date`s and its shipment statuses are the entire slippage input (`health.service.ts:34-37`).
- **→ Quotation detail (`/quotes/[publicId]`)** — every row links there (`page.tsx:54`), and that is where a Nudge or Escalate actually shows up, on the audit trail.
- **→ Dashboard** — `refreshHealth` revalidates `/dashboard` too (`src/app/(internal)/actions/health.ts:17`), so the dashboard shows alert-derived numbers.
- **Reports (`/reports`)** has no link to or from here. They read different tables.

---

## 10. Gotchas

1. **A GET request writes to the database.** Loading `/health` inserts, updates and resolves rows. Two tabs open = two recomputes.
2. **No background job.** Everything in `KNOWN_ISSUES.md:12` is accurate: "Deal health recompute happens on every dashboard load and on 'Recompute now'; there is no background timer." A stalled deal in a company where nobody visits `/health` is never flagged.
3. **Nudging a stalled deal deletes the alert you nudged** (section 5.3, scenario 7.8). Expected behaviour of the code, surprising behaviour for the user.
4. **`healthScore` is not used anywhere.** No composite health number is rendered. Only the definition and its test reference it.
5. **Severity is not comparable across types.** One `ORDER BY severity DESC` sorts days-overdue against sigmas against multiples-of-idle-limit.
6. **Severity ignores the absolute discount branch.** An anomaly caught only by `overMean >= anomalyAbsBp` gets severity `max(1, round(z))`, usually 1, and shows no chip (scenario 7.5).
7. **`first_seen_at` is "when we noticed", not "when it happened".** It is the timestamp of the first page load after the condition became true.
8. **Discount history is capped at 500 rows globally** (`health.service.ts:31`), ordered by `confirmed_at DESC`. Past 500 won quotations, older reps silently lose their own baseline and fall back to the team's.
9. **The `payload` JSON is written and never read by any UI.** It is the only place the actual z, mean, sd and baseline choice are recorded. Use SQL when an alert looks wrong.
10. **Sales reps see the whole company's alerts.** `listAlerts` has no per-rep scoping.
11. **No unique constraint on `(quotation_id, type, resolved_at IS NULL)`** — concurrent recomputes can duplicate a row (scenario 7.9). It heals on the next single load.
12. **`revalidatePath("/quotes/" + quotationNumber)`** at `src/app/(internal)/actions/health.ts:31` uses the human number where the route wants `publicId`. It revalidates nothing.
13. **`/health?type=` is unvalidated.** A bad value silently shows the empty state rather than an error.
14. **Everything is recomputed with `now = new Date()` on the server (UTC), except slippage**, which converts to the Asia/Kolkata calendar date (`anomaly.ts:83`). So "idle days" is a UTC-clock difference and "overdue days" is an Indian-calendar difference. They disagree by up to half a day at the boundaries.
