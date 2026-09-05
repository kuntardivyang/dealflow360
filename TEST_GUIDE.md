# DealFlow360 manual test guide

Step-by-step browser walkthrough of every functional cycle. Follow the flows in order on a fresh seed: later flows reuse quotations and stock created by earlier ones. Every expected number below was computed from the seed data (`prisma/seed/*`) with the domain functions (`src/domain/*`): money is integer paise shown as INR, tax is 18 % on every product, discounts round half-up once per line.

Conventions: **[Riya]** = the browser is logged in as that user. "Toast" = the green/red message at the bottom right. `<today>` is the Asia/Kolkata calendar date of the run.

---

## 0. Reset and prerequisites

| Step | Command | Expect |
|---|---|---|
| 1 | `docker compose up -d` | Postgres 17 on `localhost:5433` (`dealflow360-db` healthy) |
| 2 | `pnpm install` | also runs `prisma generate` |
| 3 | `pnpm reset` (**run this yourself, by hand; never let an AI tool run it**, it drops the database) | migrations + seed; last line `Seed complete ... Logins: *@test.com / demo1234, portal acme@test.com / demo1234` |
| 4 | `pnpm dev` | app at http://localhost:3000 |
| 5 | Optional: `pnpm test` then `pnpm smoke` | vitest green; smoke prints `PASS 1..8` and `SMOKE PASSED`. Both consume demo stock (they reserve Laptop 14" at Main 6/6), so run `pnpm reset` again before the manual flows. |

Seed facts you will check against:

| Item | Seed value |
|---|---|
| Tiers (ceiling) | Bronze 5 %, Silver 10 %, Gold 15 % |
| Categories (ceiling / min upsell margin) | Hardware 15 % / 15 %, Services 10 % / 20 %, Subscriptions 12 % / 30 % |
| Per-line limit | min(tier ceiling, category ceiling), snapshotted on the line when it is added |
| Products (price, cost) | Laptop 14" ₹60,000 / ₹42,000 · Laptop 16" (variant) ₹75,000 / ₹52,500 · Docking Station ₹6,000 / ₹3,600 · Monitor 27" ₹18,000 / ₹12,600 · Setup Service ₹8,000 / ₹6,000 (per visit) · Training Day ₹15,000 / ₹11,000 · Support Basic ₹500 / ₹200 per seat-month · Support Pro ₹1,000 / ₹400 per seat-month (promoted) |
| Price rules | Gold −10 % and Silver −5 % on Training Day only |
| Stock (Main Warehouse ₹500/shipment, East Depot ₹800/shipment) | Laptop 14" 6 / 5 · Laptop 16" 3 / 0 (3 reserved by seeded order) · Docking Station 20 / 0 · Monitor 27" 2 / 10 |
| Approval rules | Rule 1 "Over limit": score ≥ 1 → Sales Manager. Rule 2 "High risk or large order": score ≥ 50 **or** worst line > 10 pt over **or** order total > ₹10,00,000 → Sales Manager then Finance. Longest firing chain wins. |
| Risk config | weights 50/40/10, normalisers 10 pt / 5 pt / 10 pt, margin floor 20 %, stalled after 3 days, anomaly z ≥ 2 or 10 pt over rep average, min history 5 |
| Plans | Monthly (12 periods), Quarterly (4), Yearly (1); day-based proration, credit-note refunds |
| Quotations | `Q-2026-0001` Acme Corp empty draft (Riya) · `Q-2026-0004` Beta Industries hybrid draft (Riya): Laptop 14" ×2 at 5 % + Support Pro ×2 Monthly · `Q-2026-1001..1024` closed history · `1025` Arjun anomaly (Sent) · `1026` Gamma stalled draft · `1027` Beta stalled approved · `1028` Acme in fulfillment with a backorder |
| Counters | next quotation `Q-2026-0005`, next invoice `INV-2026-0001` |

Logins (password `demo1234` everywhere):

| Login | Role | Used for |
|---|---|---|
| `admin@test.com` | Admin | back-end, Confirm on behalf, stands in for any approver |
| `meera@test.com` | Sales Manager (Riya's and Arjun's manager) | approvals step 1, deal health actions |
| `farhan@test.com` | Finance | approvals step 2, fulfillment, payments |
| `riya@test.com`, `arjun@test.com` | Sales Rep | quotations |
| `acme@test.com` (Acme Corp, Gold) · `beta@test.com` (Beta, Silver) · `gamma@test.com` (Gamma Retail, Bronze) | Portal customer | `/portal/login` |

Two browser profiles help: a normal window for staff (cookie `df_session`, path `/`) and an incognito window for the portal (cookie `df_portal`, path `/portal`). Staff logout = **Close Workspace** (top right); it deletes the session row.

---

## 1. Login and signup

**1a. Signup is forced to Sales Rep.** Open http://localhost:3000 → redirected to `/login`. Click **Sign Up**.
1. Submit with password `short` → field error "At least 8 characters".
2. Fill Full name `Test Rep`, Email `test.rep@test.com`, Password `demo1234` → **Create account** → lands on `/dashboard`. The user chip shows "Test Rep · Sales Rep". The nav has 8 tabs (Dashboard … Reports) and **no Product tab, no "Go to Back-end" button**. Note the helper text on the form: "New accounts start as Sales Rep."
3. Type `/admin` in the address bar → redirected to `/dashboard?forbidden=admin`.
4. Sign up again with the same email → "That email is already registered".
5. **Close Workspace** → back at `/login`.

**1b. Login.** Wrong password → "Invalid email or password" (same message for an unknown email). Log in as `riya@test.com` → `/dashboard` with three tiles: Pending Approvals 0, Open Quotations 5 on a fresh seed (Q-0001, Q-0004, 1025, 1026, 1027; live count), At-Risk Deals (0 until Deal Health has run once, then 4). Visiting `/approvals` while logged out redirects to `/login?next=%2Fapprovals` and returns you there after login.

**1c. Portal login is separate.** In the incognito window open `/portal` → redirected to `/portal/login`. Log in `acme@test.com` → "My Quotations" list, on a fresh seed one row: `Q-2026-1025` (Arjun's Sent quote), status Sent. Staff cookies do not work here and vice versa: paste `/quotes` into the incognito window → redirected to `/login`.

---

## 2. Build a quotation (Riya)

**[Riya]** Quotations tab → card **Acme Corp · Q-2026-0001 (Draft)**. Header reads "Gold tier (ceiling 15%) · Rep Riya Rao".

| Step | Click | Expect |
|---|---|---|
| 1 | In **Add products**, chip **Hardware**, then **Add** on Laptop 14" | line appears: Qty 1, Price ₹60,000.00, Discount 0, Limit 15%, **OK**, Total ₹70,800.00. Totals: Gross ₹60,000.00, Tax ₹10,800.00, Total ₹70,800.00, Margin 30%. Approval preview: score 0, Low, "Within every limit". |
| 2 | Press **+** nine times (Qty 10) | Total ₹7,08,000.00 |
| 3 | Type `12` in the line's Discount % and press Enter | Limit 15%, **OK**, line total ₹6,23,040.00; Totals: Gross ₹6,00,000.00, Discount −₹72,000.00, Net ₹5,28,000.00, Tax ₹95,040.00, Total ₹6,23,040.00, Margin 20.45%. Score 0. |
| 4 | Chip **Services** → **Add** Setup Service, **+** once (Qty 2), Discount `18` | Limit **10%** (Services is stricter than Gold), badge **Over +8 pt**, line total ₹15,481.60. Totals: Gross ₹6,16,000.00, Discount −₹74,880.00, Net ₹5,41,120.00, Tax ₹97,401.60, **Total ₹6,38,521.60, Margin 20.17%**. Approval preview: **score 42, Medium**; Worst line overage 8 pt, Blended overage 0.21 pt, Margin penalty 0 pt; "On confirm, routes to: Sales Manager". Confirm button caption: "Confirm sends this to: Sales Manager". |
| 5 | Order discount: type `5`, **Apply** | Every line shows "effective …" under its discount: Laptop 16.4% (Over +1.4 pt), Setup 22.1% (Over +12.1 pt). Line + order discounts compound: 1 − (1−0.12)(1−0.05) = 16.4 %. Score rises and the chain becomes Sales Manager → Finance (worst line > 10 pt). |
| 6 | Order discount back to `0`, **Apply** | back to step 4 numbers |
| 7 | **Upsell and Cross-Sell** panel | Suggestions ranked by co-purchase: **Docking Station** ("Bought with Laptop 14" 14×", margin +₹2,400.00 each), Monitor 27" (7×), Support Pro (Promo, "Currently promoted"). Setup Service is not suggested (already in cart / below the 20 % Services margin floor). |
| 8 | **Add to Quote** on Docking Station | Line added with Limit 15%, OK, ₹7,080.00. Totals update in the same response: **Total ₹6,45,601.60, Margin 20.38%**, score still 42. Docking Station disappears from the panel. |
| 9 | **X** (Dismiss) on Monitor 27" | removed from the panel for this page view only |
| 10 | Quotation → **Audit trail** tab | rows LINE_ADD / LINE_UPDATE / ORDER_DISCOUNT with Riya Rao (sales rep), before/after JSON; the upsell line's after JSON contains `"source":"UPSELL"` |

Leave the quote in Draft; Flow 3a confirms it.

---

## 3. Confirm and automatic routing

There is a single **Confirm** button; the rep never asks for approval. Routing is decided per line against min(tier, category) ceiling, then by the risk score.

**3a. Over limit → Pending Approval, Sales Manager only (PDF example).** **[Riya]** on Q-2026-0001 (Laptop 14" ×10 at 12 %, Setup Service ×2 at 18 %, Docking Station ×1): **Confirm** → toast "Sent for approval: Sales Manager". Status badge **Pending Approval**; yellow card "Awaiting approval, round 1 · Sales Manager: pending · Blended risk 42". The builder is replaced by a read-only table. Approvals tab: Pending 1, row `Q-2026-0001 Acme Corp · Medium 42 · Stage Sales Manager · Assigned To Meera Shah`.

**3b. Within limit → Approved immediately.** **[Riya]** Quotations → **Beta Industries · Q-2026-0004 (Draft)**. Lines: Laptop 14" ×2 at 5 % (Limit 10%, OK, ₹1,34,520.00) and Support Pro ×2 · Monthly (Limit 10%, OK, ₹2,360.00). Totals: Gross ₹1,22,000.00, Discount −₹6,000.00, Net ₹1,16,000.00, Tax ₹20,880.00, **Total ₹1,36,880.00, Margin 26.9%**, score 0 Low. Caption "Confirm approves this quotation immediately." → **Confirm** → toast "Approved. No approval was required." Status **Approved**, green card with **Send to customer**. Nothing appears on the Approvals tab. Leave it here for Flow 7.

**3c. Bronze + 30 % order discount → Sales Manager then Finance.** **[Riya]** Quotations → customer dropdown **Gamma Retail (Bronze)** → **+ New Quotation** → opens `Q-2026-0005` (header "Bronze tier (ceiling 5%)"). Add Laptop 14" ×1 (Limit **5%**). Order discount `30` → **Apply**: line shows "effective 30%", **Over +25 pt**, total ₹49,560.00 (Gross ₹60,000.00, Discount −₹18,000.00, Net ₹42,000.00, Tax ₹7,560.00), **Margin 0%** shown in warning colour. Approval preview: **score 100, High**, worst 25 pt, blended 25 pt, margin penalty 20 pt, "routes to: Sales Manager → Finance" (rule 2 fires on score ≥ 50 and worst > 10 pt). **Confirm** → Pending Approval, round 1 with two steps "Sales Manager: pending · Finance: pending". Approvals list: Pending 2, this row High 100, Stage Sales Manager.

---

## 4. Approvals (Meera, Farhan)

Open **Approvals** → click a row → Approval Detail: risk chips, "Why This Quote Was Flagged" table (Discount Given / Limit Allowed / Over By), stepper Submitted → Sales Manager → (Finance) → Confirmed, Audit Trail, Decision panel.

**4a. Wrong person cannot decide.** **[Riya]** open `/approvals/<Q-0001>`: all three buttons disabled, text "You submitted this quotation, so someone else has to review it." **[Farhan]** on `Q-2026-0005`: disabled, "This step is waiting for a Sales Manager." (Finance cannot act before the Manager step.)

**4b. Approve.** **[Meera]** Approvals → `Q-2026-0001` → **Approve** → dialog → note `ok, 8 pp on services` → **Approve**. Toast "Approved. Audit entry #N written. Q-2026-0001 is now approved." The page reloads with `?audit=N` and that audit row highlighted green: `Meera Shah · Sales Manager · approve · <time> · ok, 8 pp on services`. Stepper: Sales Manager done with "Meera Shah, <time> · ok, 8 pp on services"; Finance not present (chain was Manager only). Decision card now "Approved. The rep can now send it to the customer." Approvals list: Approved 1.

**4c. Return for revision.** **[Meera]** `Q-2026-0005` → **Return for Revision** → click the button with an empty reason → inline error "Give a reason (at least 3 characters)". Reason `Justify 30% on a Bronze account` → toast "Returned for revision… now draft". Request status **Returned**; Approvals list Returned 1. **[Riya]** the quotation is **Draft** again and editable, audit trail shows RETURN with the reason. Change nothing and **Confirm** again → Pending Approval "round 2" (the detail page says "Request v2, 1 earlier version superseded"… v1 is listed as Returned in history).

**4d. Two-step chain and Reject.** **[Meera]** approve `Q-2026-0005` step 1 (note `ok if Finance agrees`) → toast "…is now pending approval"; row stays Pending, Stage **Finance**, Assigned To Farhan Iyer. **[Farhan]** open it: "Waiting for Finance. That is you." → **Reject**, reason `Margin is zero` → toast "Rejected… now rejected". Quotation **Rejected**; red card with the reason and a **Revise** button (rep or admin). **[Riya]** **Revise** → Draft (audit REVISE). Set the order discount to `0`, and leave it; Flow 8 uses it.

**4e. Stale double click.** Open the same pending approval in two tabs as Meera, approve in tab 1, then approve in tab 2 → red toast "This step was already decided by someone else. Refresh to see the result." (HTTP-409 style conflict, not a permissions error).

**4f. Admin stands in.** Admin can approve any step, but still not a quotation whose rep is the admin themself.

---

## 5. Send, portal negotiation, re-approval, portal confirm

**5a. Send.** **[Riya]** Quotations → `Q-2026-0001` (Approved) → **Send to customer** → status **Sent**; blue card shows `Portal link: /portal/q/<publicId>`. Copy the 12-character id. Audit: SEND.

**5b. Portal view.** Incognito: `/portal/q/<publicId>` → redirected to `/portal/login?next=…` → `acme@test.com` / `demo1234` → back on the quotation. Check:
- Header "Quotation Q-2026-0001 for Acme Corp", status **Sent**.
- Columns are only Line / Qty / Unit price / Discount / Line total (incl. 18% tax) / Customer Comment. **No cost, margin, limit, overage, risk score, approver or rep names anywhere** (check the page source or DevTools network response too: the DTO is a whitelist).
- Lines: Laptop 14" 10 × ₹60,000.00 at 12% = ₹6,23,040.00; Setup Service 2 × ₹8,000.00 at 18% = ₹15,481.60; Docking Station 1 × ₹6,000.00 = ₹7,080.00. Subtotal ₹5,47,120.00, Tax ₹98,481.60, Total ₹6,45,601.60.
- Nav: My Quotation / Messages / Profile (Profile: Nisha Acme, Acme Corp, Ahmedabad, tier Gold).
- Wrong customer: log in as `beta@test.com` and open the same URL → **404**. Any unknown id → 404.

**5c. Comment and change request.** As acme@test.com, tab **Comment**, Line "Whole quotation", message `Can you deliver before the 20th?` → **Submit Request** → toast "Request sent to your sales representative." Status becomes **Under Negotiation**; the request lists under "Your requests" as Open and on **Messages**. Tab **Change request**, line Setup Service, Requested Delivery Date any date, message `Push setup to next month` → Submit → second Open request; the Setup line's Customer Comment column shows it. Internally **[Riya]** the quote shows **Negotiation** and the audit trail has PORTAL_COMMENT / PORTAL_CHANGE_REQUEST by Nisha Acme (contact). Confirm Quotation is still enabled (comments do not block).

**5d. Counter discount above the ceiling → automatic re-approval.** Tab **Counter discount**, Line **Setup Service (current discount 18%)**, Counter Discount % `25`, message `Can this be 25%?` → **Submit Request** → toast "Request sent. Your counter-offer needs an internal approval…". Portal status **Awaiting internal approval**; the request form is disabled ("Your last request is being reviewed internally"); Confirm disabled.
**[Meera]** Approvals: `Q-2026-0001` now has a **v2** row, **High 78**, Stage Sales Manager; the v1 row shows **Superseded**. Detail: "Request v2, 1 earlier version superseded"; flagged table shows Setup Service **18%** given (v2 scores the proposed 25 %: worst 15 pt over, hence Finance). Steps "Sales Manager, then Finance". Approve (`fine for Acme`) → still Pending, Stage Finance. **[Farhan]** approve → quotation back to **Sent**; the Setup Service line now reads **25%**, total ₹14,160.00; quotation Total **₹6,44,280.00**, Margin 20.22%. The portal request is marked **Accepted** (portal: status Sent again, line Discount 25%, Total ₹6,44,280.00).
Variant: a counter **within** every ceiling (e.g. Docking Station to 5 %) does not open an approval round; the quote goes to Under Negotiation with the counter **Open** and the customer's Confirm is disabled until it is answered. The rep-side Accept/Decline screen for such a request is not built (service `respondToRequest` exists, no UI), so do this only on a throw-away quote.
Note: even a within-ceiling counter re-routes if it pushes order margin under 20 % (Laptop 8 % → 14 % on this quote gives margin 18.6 %, score 43, Sales Manager).

**5e. Rejecting a counter.** If the approver **Rejects** the v2 request instead, the quote returns to **Sent** with the original 18 % and the portal request shows **Declined** with the reason.

**5f. Portal confirm.** Incognito: **Confirm Quotation** → dialog → Full name `Nisha Acme` → **Confirm Quotation** → toast "Quotation confirmed. Thank you!" Status **Confirmed**, form disabled, card "Confirmed on <date>. Your order is being prepared." Internally: status **Confirmed**, green card "Order confirmed by Nisha Acme … Open fulfillment →". Audit PORTAL_CONFIRM with `invoicesCreated: 1, planProposed: true`. Dashboard "Recent Activity" shows the confirm.

**5g. Admin confirm on behalf (fallback).** On any **Sent** or Negotiation quotation **[Admin]** sees **Confirm on behalf** in the blue card (other roles do not). It records `confirmedName = "<Customer> (confirmed by Admin)"` and runs the same hooks. Used in Flows 6b and 7b.

---

## 6. Fulfillment (Farhan or Admin; Riya may accept her own split)

**6a. Split proposal and acceptance.** **[Farhan]** Fulfillment tab. Stock table (fresh seed): Main/Laptop 14" 6 · 0 · 6; East/Laptop 14" 5 · 0 · 5; Main/Laptop 16" 3 · 3 · 0 (seeded order); Main/Docking Station 20 · 0 · 20; East/Docking Station 0 · 0 · 0; Main/Monitor 27" 2 · 0 · 2 (warning colour, at reorder point); East/Monitor 27" 10 · 0 · 10. "Orders awaiting fulfillment": `Q-2026-1028 Acme Corp · Backorder · Main Warehouse + Backorder` (seed) and **`Q-2026-0001 Acme Corp · Split Pending · Main Warehouse + East Depot`**.
Click Q-2026-0001 → detail "Recommended split from live stock · 2 shipments":

| Warehouse | Qty fulfilled | Est. shipments | Cost |
|---|---|---|---|
| Main Warehouse | 6 × Laptop 14", 1 × Docking Station | 1 | ₹500.00 |
| East Depot | 4 × Laptop 14" | 1 | ₹800.00 |

Side card: Shipments 2, Estimated shipping cost ₹1,300.00, Plan **Split Pending**. (Main is chosen first because it covers the most order value; the Setup Service line never ships.) **Manual Override** is present but disabled ("arrives with the next merge").
**Accept Suggested Split** → plan **Accepted**, quotation **Fulfillment**, each warehouse row now has **Mark shipped**. Fulfillment list: Q-0001 status **Reserved**. Stock table: Main/Laptop 14" **6 · 6 · 0**, East/Laptop 14" **5 · 4 · 1**, Main/Docking Station **20 · 1 · 19**. Audit: SPLIT_ACCEPTED. Click Accept again in a second tab → "This split was already accepted".
**[Riya]** can also press Accept on her own order, but does not see **Mark shipped** or **Receive stock** (ops roles only).

**6b. Mark shipped.** **[Farhan]** Mark shipped on Main Warehouse → badge "Shipped <date>", stock Main/Laptop 14" **0 · 0 · 0**, Docking **19 · 0 · 19**. Mark shipped on East Depot → East/Laptop 14" **1 · 0 · 1**; list status **Shipped**. Invoice detail (Flow 7) step "Shipped" turns green only when every shipment is shipped.

**6c. Backorder case (Monitor 27" ×13).** **[Riya]** Quotations → Acme Corp → **+ New Quotation** (`Q-2026-0006`) → Hardware → Add Monitor 27", press **+** twelve times (Qty 13), discount 0 → Total ₹2,76,120.00, Margin 30%, score 0 → **Confirm** → Approved → **Send to customer**. **[Admin]** open it → **Confirm on behalf** → Confirmed. **[Farhan]** Fulfillment → `Q-2026-0006 · Split Pending · East Depot + Main Warehouse + Backorder`: East Depot 10 × Monitor 27" ₹800.00; Main Warehouse 2 × Monitor 27" ₹500.00; **Backorder 1 × Monitor 27", expected `<today + 7>`** (lead days from stock); 2 shipments, ₹1,300.00. Accept → list status **Backorder**; stock East/Monitor 10 · 10 · 0, Main/Monitor 2 · 2 · 0. Text under the table mentions the "Consolidate Remaining Backorder" prompt: that prompt is **not built** (KNOWN_ISSUES). **Receive stock** form (ops roles): East Depot, Monitor 27", qty 5 → **Record receipt** → East/Monitor 15 · 10 · 5; the backorder line does not change automatically.

---

## 7. Billing: invoices, payments, subscriptions

**7a. One-time invoice and payments.** **[Farhan]** Invoices tab: tiles Unpaid 1, Paid 0, Balance due ₹6,44,280.00; row **INV-2026-0001 · Acme Corp · One-time · ₹6,44,280.00 · Paid ₹0.00 · Unpaid · due `<today + 15>`** (if you ran 6c first, INV-2026-0001 may be the Monitor order; go by customer and amount). Click it:
- Progress: Order Confirmed ✓, Shipped ✓ (after 6b), Invoiced ✓, Paid ○.
- Lines: Laptop 14" 10 × ₹60,000.00 12% net ₹5,28,000.00 tax ₹95,040.00 total ₹6,23,040.00; Setup Service 2 × ₹8,000.00 **25%** net ₹12,000.00 tax ₹2,160.00 total ₹14,160.00; Docking Station 1 × ₹6,000.00 0% ₹6,000.00 / ₹1,080.00 / ₹7,080.00. Subtotal ₹5,46,000.00, Tax ₹98,280.00, Total ₹6,44,280.00, Balance due ₹6,44,280.00.
- **Record Payment** card (ops roles only; Riya does not see it): amount `322140` (₹3,22,140.00), method Bank transfer, reference `UTR-1` → **Record Payment** → status **Partially Paid**, Paid ₹3,22,140.00, Balance ₹3,22,140.00, payment listed. Invoices tile still Unpaid 1.
- Overpayment: type `400000` → the browser blocks the submit (input `max` = balance). Remove the `max` attribute in DevTools and submit → red banner "Amount exceeds the balance due At most 32214000 paise is due". Amount `0` → "Amount must be more than zero".
- Pay the balance (default value) with UPI → **Paid**, Balance ₹0.00, progress step Paid ✓, the Record Payment card disappears. Quotations: `Q-2026-0001` badge **Paid** (all invoices of the order paid). Audit on the quote: RECORD_PAYMENT ×2, PAID.
- Double click / refresh-resubmit of the payment form records **one** payment (hidden `clientRef` is idempotent).

**7b. Hybrid order: one-time + recurring on one order.** **[Riya]** Quotations → `Q-2026-0004` (Approved from 3b) → **Send to customer**. **[Admin]** → **Confirm on behalf** (or incognito as `beta@test.com` → My Quotations → Q-2026-0004 → Confirm Quotation, name `Rahul Beta`). Then:
- Invoices: two new rows for Beta Industries: **One-time ₹1,34,520.00** (`INV-2026-000N`) and **Recurring ₹2,360.00** (`INV-2026-000N+1`), both Unpaid, due `<today + 15>`. Open the recurring one: header "Recurring invoice · Monthly · order Q-2026-0004"; line "Support Pro · Monthly · `<today>` to `<today + 1 month − 1 day>`", 2 × ₹1,000.00, net ₹2,000.00, tax ₹360.00, total ₹2,360.00.
- Fulfillment: `Q-2026-0004 · Split Pending`. On a fresh seed Main Warehouse 2 × Laptop 14", 1 shipment ₹500.00; **after Flow 6 the laptop stock is Main 0 / East 1, so the proposal is East Depot 1 × Laptop 14" + Backorder 1** (expected `<today + 10>`). Receive 5 laptops at Main first if you want a clean single shipment (the proposal is fixed at confirm time; a new one is only proposed on confirm, so receive stock **before** confirming).
- Subscriptions tab: Active 1 · row **Beta Industries · Support Pro × 2 · Monthly · Next bill `<today + 1 month>` · Active**. Click it → Billing detail:
  - Header "Monthly · 2 × Seat / month · current period `<today>` to `<today + 1 month − 1 day>` · from order Q-2026-0004".
  - **One-time lines (from the originating order)**: Laptop 14" · 2 · ₹1,34,520.00 · "Invoiced as INV-… Unpaid".
  - **Recurring lines**: Support Pro × 2 · Monthly · Next bill date · ₹2,360.00. Footnote "Proration: by calendar day of the real period, the change day is billed. Cancellation: immediate prorated refund, refunds as credit note."
  - **Billing schedule: 12 rows** of ₹2,360.00; #1 `<today>`–`<today+1m−1d>` **Invoiced** linked to the recurring invoice; #2–#12 **Scheduled**, each starting one month later (e.g. run on 2026-09-05: 05 Sep–04 Oct, 05 Oct–04 Nov, … 05 Aug 2027–04 Sep 2027).
  - **Modify Subscription** and **Cancel Subscription** are disabled: mid-cycle proration and credit notes are not built (KNOWN_ISSUES).
- Pay both Beta invoices in full → quotation `Q-2026-0004` becomes **Paid** only when both are paid (it is CONFIRMED, which also qualifies).

---

## 8. Admin back-end and how a changed rule/ceiling changes routing

**[Admin]** (Meera and Farhan can also open everything except Users). Top right **Go to Back-end** → `/admin` with six cards. Every save writes an audit row with before/after.

**8a. Tiers, categories, approval chain, risk config** (`/admin/tiers`). Tier rows Bronze 5 / Silver 10 / Gold 15 with inline **Save**; **Add tier** row. Category rows Hardware 15 / 15, Services 10 / 20, Subscriptions 12 / 30. Approval chain: rule 1 and rule 2 as in the seed table, with a roles picker; **Add rule**. Risk configuration form (weights must add to 100: set 50/40/20 → "Weights must add up to 100").

**8b. A changed rule threshold re-routes on the next confirm (live).** Set rule 2 **Score ≥** from `50` to `40` → Save. **[Riya]** new Acme quotation: Laptop 14" ×10 at 12 % + Setup Service ×2 at 18 % → preview still score 42 but chain now **"Sales Manager → Finance"**; Confirm → two steps. Set the threshold back to 50 (leave the quote Pending or have Meera return it).

**8c. A changed ceiling applies to lines added afterwards (ceilings are snapshotted per line).** Set **Services** Max discount to `20` → Save. **[Riya]** on the Gamma quote `Q-2026-0005` from 4d (Draft, order discount 0) the Laptop line still shows Limit 5% (snapshot). New Acme quotation → Laptop 14" ×10 at 12 % + Setup Service ×2 at 18 % → Setup line **Limit 20%, OK**, score **0**, "confirm goes straight through" → Confirm → **Approved** without a reviewer. Restore Services to `10`. (Gotcha: a quote with only Setup Service at 18 % still routes to Sales Manager → Finance because its margin is 8.5 %, under the 20 % floor: score 100.)
Tier ceilings work the same way: Bronze 5 → 35 makes a new Gamma line with a 30 % order discount OK (margin floor permitting).

**8d. Warehouses and stock** (`/admin/warehouses`). Edit Ship cost weighting / Priority; **Add warehouse** `West Hub`, ₹600, priority 3. Stock table shows In Stock / Reserved / Available; setting On hand below Reserved is refused ("On hand cannot go below the quantity already reserved"). A new warehouse with stock is used by the very next split proposal.

**8e. Plans** (`/admin/plans`). Monthly (12), Quarterly (4), Yearly (1), day-based, bill change day ticked, immediate prorated refund, credit note. **Add plan** `Half-yearly`, Quarterly, 2 periods. It then appears as the plan of any subscription product added after (the builder picks the first active plan; there is no plan picker on the line).

**8f. Products** (`/admin/products`, also the **Product** nav tab). Tiles Total Products 8 (8 active, 0 archived), Pricelists 2 (3 tiers, 1 currency), Variants 1. Click Laptop 14" → General Info (kind, category, price, cost, tax 18%, promoted), **Variants** table (Laptop 16", extra price ₹15,000), **Pricelists** rules. **+ New Product** → create `Webcam`, SKU `HW-CAM`, Hardware, ₹4,000 / ₹2,500 → redirected to its page; it shows in the builder's Hardware chip. Adding a Gold price rule "minus 10 %" on Training Day is already seeded: in a builder for Acme, Training Day is priced ₹13,500.00 (the audit LINE_ADD shows `priceRule: "Gold price on training"`); for Gamma it stays ₹15,000.00.

**8g. Users** (`/admin/users`, **Admin only**; Meera gets `/dashboard?forbidden=1`). Rows with Role and Reports to. Change `Test Rep` (from 1a) to **Sales Manager** → Save → toast. Log in as test.rep@test.com: the Product tab and Go to Back-end appear on the next request (role is read from the database every request; no re-login needed). Setting a user as their own manager is refused.

---

## 9. Deal Health dashboard and Reports

**9a. Deal Health** (any staff role; actions need Manager/Finance/Admin). **[Meera]** Deal Health tab; alerts are recomputed on every load (**Recompute now** button too). Fresh seed:

| Tile | Count | Rows |
|---|---|---|
| Stalled Deals | 2 | Gamma Retail `Q-2026-1026` (Riya, Draft) "Idle 9 days (limit 3)" severity 3 · Beta Industries `Q-2026-1027` (Arjun, Approved) "Idle 14 days (limit 3)" severity 4 |
| Discount Anomalies | 1 | Acme Corp `Q-2026-1025` (Arjun, Sent) "Discount 22.0% vs rep average 9.0%" |
| Delivery Slippage | 1 | Acme Corp `Q-2026-1028` (Fulfillment) "Expected `<today+3>`, promised `<yesterday>` (4 days late)" |

After Flow 3c, while `Q-2026-0005` was open at 30 %, a second anomaly appears for Riya ("Discount 30.0% vs rep average 6.5%") and disappears again once the discount is reset; alerts resolve themselves. Clicking a Deal name opens the quotation. **Nudge Rep** on the Gamma row → toast "Nudge sent to Riya Rao on Q-2026-1026 · Audit entry #N written", inline "Nudge sent <time>"; the quotation's audit trail shows NUDGE with the alert message as reason. **Escalate** → "Escalated <time>", button disabled afterwards. Dashboard tile At-Risk Deals now shows the open alert count. **[Riya]** sees the alerts but no buttons.

**9b. Reports** (`/reports`, Admin/Manager/Finance; Riya is redirected). Default period last 30 days. Fresh seed tiles: **Quotes Created 14** (8 history quotes created 15–27 days ago + Q-1025/1026/1027/1028 + Q-0001 + Q-0004) plus every quotation you created in this run; **Avg Approval Time** e.g. "0.1 h" once Flow 4 has approved requests (from submission to final approval); **Top Upsold Product: Docking Station** (1 upsell line, from Flow 2). Filters: Period **Today** → only today's quotes; Sales Team / Rep **Arjun Mehta**; Approval Status **Pending** (status Pending Approval), **Approved** (Approved/Sent/Negotiation/Confirmed/Fulfillment/Paid), **Rejected**; Product **Support Pro** → Q-0004 only; Category **Services**. Footer sums Discount / Net / Total of the visible rows; row click opens the quote. **Export XLS** downloads `dealflow360-report-<from>-to-<to>.xlsx` with sheets "Quotations" (same rows + a Totals line) and "Summary" (period, quotes created, average approval hours, top upsold). **Export PDF** opens the browser print dialog with nav and filters hidden (no PDF library).

---

## 10. Validation and abuse checks

| Try | Where | Expect |
|---|---|---|
| Line discount `150` (or `-5`) then Enter | builder | toast "Discount must be between 0 and 100 percent"; nothing saved |
| Order discount `150` → Apply | builder | toast "Order discount must be between 0 and 100 percent" |
| Quantity 0 | builder | there is no qty box; **−** at Qty 1 removes the line (LINE_REMOVE in audit). Server schema refuses qty < 1 ("Quantity must be at least 1") for crafted requests |
| Confirm with no lines | builder | button disabled, caption "Add a line to confirm." (server: "Add at least one line before confirming") |
| Another rep edits Riya's draft | **[Arjun]** opens `/quotes/<Q-0001>` | read-only table, no builder, no Confirm ("Only the owning sales rep or an admin can edit"); Admin can edit |
| Rep approves | **[Riya]** approval detail | buttons disabled; direct action → FORBIDDEN "a sales rep cannot approve step" |
| Finance before Manager | **[Farhan]** step-1 pending quote | "This step is waiting for a Sales Manager." |
| Rep on `/admin`, `/reports` | **[Riya]** | redirected to `/dashboard?forbidden=…` |
| Rep on fulfillment / invoice | **[Riya]** | no Mark shipped, no Receive stock, no Record Payment card |
| Reject / Return with a 2-character reason | decision dialog | "Give a reason (at least 3 characters)" |
| Counter discount with an empty % | portal | "Enter the discount you propose" |
| Comment with an empty message | portal | "Write a message" |
| Confirm with a 1-letter name | portal | Confirm button stays disabled; server "Too short" |
| Portal confirm while a counter is open | portal | button disabled; server "Your counter-offer is still being reviewed…" |
| Editing an Approved or Sent quote | **[Riya]** or Admin, `+` on a line | allowed, but the quote drops back to **Draft**, the pending/approved request is **Superseded** (audit SUPERSEDE_APPROVAL) and a new round starts on the next Confirm; the warning text above the Confirm button says so |
| Stale double click | two tabs, same action | approvals: "This step was already decided by someone else. Refresh to see the result."; builder: "This quotation was changed by someone else. Refresh and try again." (page refreshes itself); split: "This split was already accepted"; Send to customer twice: "Illegal transition: cannot send a quotation that is sent" |
| Payment above balance | invoice | browser `max` first; server "Amount exceeds the balance due" |
| Payment on a Paid invoice | invoice | form hidden; server "Illegal transition: invoice cannot go from paid to paid" |
| Signup password `1234567`, bad email | `/signup` | "At least 8 characters", "Enter a valid email" |
| Portal URL of another customer, or a random id | portal | 404 page |
| Expired / deleted cookie | any page | redirected to the right login page with `?next=` |

---

## Not covered because the feature is not built (see KNOWN_ISSUES.md)

- Subscription **Modify / Cancel** with proration and credit notes (buttons disabled).
- **Manual Override** of the warehouse split (button disabled) and the **Consolidate Remaining Backorder** prompt.
- Rep-side **Accept / Decline** of a portal comment, change request or within-ceiling counter (service exists, no screen).
- **Magic-link** portal login (email + password only), **Forgot Password**, Kanban **Pipeline**, multi-currency, real PDF export, background deal-health timer.
- Dashboard **+ New Quotation** button is disabled; use the Quotations tab.
