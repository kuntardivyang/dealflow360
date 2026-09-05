# DealFlow360 demo script (5 minutes, two flows)

**Before walking up**: `pnpm reset` (fresh seed), `pnpm build && pnpm start` warm (click every tab once), Chrome window 1 logged in as `riya@test.com` / `demo1234` at 1280x720, 110 % zoom; Chrome incognito window 2 on `/portal/login` (not yet logged in); `ARCHITECTURE.md` open in a third tab. B drives, A narrates. A holds the fallback list at the bottom. Hard cut at 4:30.

Seed logins: `admin` / `riya` / `arjun` (reps) / `meera` (Sales Manager) / `farhan` (Finance) `@test.com`, password `demo1234`. Portal: `acme@test.com` / `demo1234` (Acme Corp, Gold, 15 %).

**0:00 Intro (A)**: "DealFlow360 is a self-governing deal engine: every quote is scored against per-line discount ceilings, routed for approval automatically, split across warehouses against live stock, and billed as one-time plus recurring invoices, with the customer negotiating in a real separate portal. Two flows: governance and hybrid billing."

## Flow 1: governance to payment (0:20 to 3:20)

| t | Click (B) | Say (A) | Expect (verified by `pnpm smoke`) |
|---|---|---|---|
| 0:20 | Quotations → `Q-2026-0001 Acme Corp (Draft)` → add Laptop 14" x10 at 12 % | "Acme is Gold, ceiling 15 %; the laptop at 12 % is fine." | Line net ₹5,28,000.00, Status OK |
| 0:40 | Add Setup Service x2 at 18 % | "Services cap at 10 %: this line is 8 points over its own limit. Score 42, so this quote will need the Sales Manager, no button for it." | Line OVER (+8 pt); risk preview 42, chain Sales Manager |
| 1:00 | Upsell panel → Docking Station → Add to Quote | "Suggestions come from co-purchase history in the database. Total and margin move immediately." | Total and margin update in the same response |
| 1:20 | Confirm | "Confirm is the only button. Routing says: Sales Manager only." | Status Pending Approval; steps: Sales Manager |
| 1:30 | Close Workspace → log in `meera@test.com` → Approvals → row → Approve with note "ok, 8 pp on services" | "Every decision is an audit row with user, time and reason. Finance is not asked because no rule demanded it." | Approved; toast shows the audit entry; row highlighted |
| 1:50 | Back as Riya → quotation → Send to customer → copy link | "The portal link carries a random public id; no email dependency." | Status Sent |
| 2:00 | Window 2: paste link → log in `acme@test.com` / `demo1234` | "Separate route group, separate cookie, whitelisted payload: no cost, margin, risk or approval data here; open DevTools if you like." | Portal shows Sent, lines, totals |
| 2:15 | Counter discount on Setup Service: 25 % → Submit Request | "25 % is 15 points over; the counter itself re-enters approval, and this time Finance is required." | Portal: Awaiting internal approval; window 1 Approvals: v2 with Sales Manager + Finance, v1 Superseded |
| 2:35 | Window 1: approve as Meera, then as `farhan@test.com` | | Quote back to Sent; the service line now 25 % |
| 2:50 | Window 2: Confirm Quotation → type the name | "Confirmed: invoices generated, split proposed." | Confirmed; window 1 Fulfillment: Main Warehouse 6 laptops, East Depot 4, 2 shipments |
| 3:05 | Accept Suggested Split → Invoices → one-time invoice ₹6,44,280.00 → Record payment ₹3,22,140.00 then the rest | "Stock is reserved inside a transaction with row locks. Partial, then paid." | Invoice Partially Paid → Paid; quotation Paid |

## Flow 2: hybrid billing and deal health (3:20 to 4:40)

| t | Click (B) | Say (A) | Expect |
|---|---|---|---|
| 3:20 | Quotations → `Q-2026-0004 Beta Industries (Draft)`: Laptop 14" x2 at 5 %, Support Pro x2 monthly → Confirm | "Silver ceiling 10 %, within limits and above the margin floor: approved with no reviewer." | Approved directly |
| 3:35 | Admin "Confirm on behalf" → Invoices | "One-time invoice and a separate recurring invoice with a 12-month schedule, from the same order." | ONE_TIME ₹1,34,520.00 and RECURRING ₹2,360.00 |
| 3:55 | Subscriptions → Beta's Support Pro → Modify (only if merged) | "Day-based proration against the real period; reducing would create a credit note." | Proration invoice, schedule updated |
| 4:15 | Deal Health | "Stalled: Gamma Retail idle 9 days against a 3-day setting, Beta 14 days. Anomaly: Arjun at 22 % against his 9 % average. Slippage: a backorder 4 days past promise." | 2 stalled, 1 anomaly, 1 slippage |
| 4:30 | Click the Gamma alert → Nudge Rep | "The nudge is an audit row on the quote." | Toast with the audit entry; "Nudge sent" inline |
| 4:40 | Close (A) | "Everything you saw is Postgres plus unit-tested rules; KNOWN_ISSUES.md lists what is stubbed." | |

## Fallbacks (A reads, B jumps)

- Builder or confirm fails → `Q-2026-0002 Beta Industries (Pending Approval)` from the seed, continue at the approval step.
- Portal login fails → Admin "Confirm on behalf" on the approved quote; narrate the portal from the screen recording.
- Split fails → run `pnpm smoke` in the terminal: step 5.5 shows Main + East Depot.
- Payment fails → show the seeded paid invoice on the history quotes.
- App dead → screen recording on the second laptop.
- Any 409 toast → "that is the optimistic lock doing its job": refresh, click once.

## Reviewer questions, one-liners

- Risk formula: per-line ceiling = min(tier, category); score = 50 % worst overage + 40 % value-weighted overage + 10 % margin shortfall, weights from `risk_config`; PDF example scores 42 → Sales Manager only. Test: `src/domain/__tests__/risk.test.ts`.
- Routing: longest chain among the `approval_rule` rows that fire, never an average; nothing over → no approval.
- Portal isolation: `app/portal/**`, `df_portal` cookie on `/portal`, `PortalSession` table, `toPortalQuotation()` whitelist with a snapshot test that forbids cost/margin/risk/approval keys, every query scoped by the customer on the session, unknown or foreign id → 404.
- Two approvers at once: conditional `UPDATE ... WHERE status = 'PENDING'` with a row-count check; the loser gets a 409.
- Stock race: `SELECT ... FOR UPDATE` in id order, conditional `UPDATE reserved` with `on_hand - reserved >= qty`, database CHECK constraint.
