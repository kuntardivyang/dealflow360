# DealFlow360

A self-governing sales operations platform built for the Odoo Hackathon 2026 finals by **Vishvam** (`vishvam129`) and **Divyang Kuntar** (`kuntardivyang`). Quotation to cash: discount governance with a blended risk score and automatic approval routing, live upsell suggestions, multi-warehouse fulfillment with locked stock reservation, hybrid one-time plus subscription billing, a separate customer negotiation portal, and a deal-health dashboard.

## Run it

Prerequisites: Node 22, pnpm 9, Docker.

```bash
cp .env.example .env            # database URL (Postgres on port 5433)
docker compose up -d            # Postgres 17
pnpm install                    # also generates the Prisma client
pnpm reset                      # drop, migrate, seed (about 10 seconds)
pnpm dev                        # http://localhost:3000
```

Checks: `pnpm test` (unit and database tests, run against the seeded database), `pnpm typecheck`, `pnpm lint`, `pnpm smoke`, `pnpm erd` (regenerates `ARCHITECTURE.md`). Run `pnpm reset` again after the tests or a demo to return to the seed.

## Seed logins

All passwords are `demo1234`.

| Role | Email | Sees |
|---|---|---|
| Sales Rep | `riya@test.com`, `arjun@test.com` | Quotations, builder, fulfillment and billing read-only |
| Sales Manager | `meera@test.com` | Approvals, deal health, back-end configuration |
| Finance | `farhan@test.com` | Second-level approvals, fulfillment, payments |
| Admin | `admin@test.com` | Everything, plus confirm on the customer's behalf |
| Customer (portal) | `acme@test.com` (Gold), `beta@test.com` (Silver), `gamma@test.com` (Bronze) | Their own quotations at `/portal` |

Customers and staff use different session tables and cookies (`df_session` on `/`, `df_portal` on `/portal`); a staff cookie never opens the portal and a portal cookie never opens the workspace.

## The eight-step flow

1. Log in as Riya, create a quotation for Acme Corp (Gold, ceiling 15 percent).
2. Add Laptop 14" x10 at 12 percent and Setup Service x2 at 18 percent. Services allow 10 percent, so that line shows **Over +8 pt**; the blended risk score is **42**.
3. Press **Confirm**. There is no "request approval" button: routing sends the quotation to the Sales Manager by itself.
4. Add the Docking Station from the upsell panel first if you like: total and margin update in the same response.
5. Log in as Meera, approve. Log in as Riya, **Send to customer**. Log in as `acme@test.com` at `/portal`, counter a bigger discount: the quotation re-enters approval automatically, this time Manager then Finance. Approve as Meera and Farhan, then confirm from the portal.
6. Fulfillment proposes the split from live stock: Main Warehouse 6 laptops, East Depot 4. Accept it: the stock is reserved in one locked transaction. Mark shipped.
7. Invoices: the one-time invoice and, for orders with a Support Pro line, a separate recurring invoice with a twelve-period schedule under Subscriptions.
8. Record a partial payment, then the rest. The invoice goes Unpaid, Partially Paid, Paid, and the order becomes Paid.

`DEMO.md` has the timed demo script and `TEST_GUIDE.md` the full manual test plan. `KNOWN_ISSUES.md` lists what is partial.

## How the rules work

- **Money** is integer paise, **percentages** are integer basis points (1250 = 12.50 percent). Rounding is half-up, once per line for the discount and once for tax; totals are sums of the rounded lines.
- **Effective discount** compounds line and order discounts: 1 - (1 - line)(1 - order).
- **Per-line ceiling** = min(customer tier ceiling, product category ceiling). Every line is checked against its own limit.
- **Blended risk score** = 100 x clamp(0.5 x worst overage / 10 pt + 0.4 x value-weighted average overage / 5 pt + 0.1 x margin shortfall under 20 percent / 10 pt). Weights and normalisers live in the `risk_config` row.
- **Routing** picks the longest chain among the `approval_rule` rows that fire (score, worst overage or order total). Never an average: a mixed order goes to the highest level any rule demands.
- **Warehouse split**: one warehouse if it covers the whole order (cheapest first), else greedy by covered value with the cheaper warehouse on ties, leftovers become backorders. One shipment per warehouse.
- **Stock reservation**: `SELECT ... FOR UPDATE` on the stock rows in id order, then a conditional `UPDATE ... WHERE on_hand - reserved >= qty`; a stale proposal fails with 409 and nothing is half-reserved. The database also enforces `reserved <= on_hand`.
- **Billing**: on confirmation, one invoice for one-time lines; each recurring line becomes a subscription with a schedule of real calendar periods (September has 30 days, October 31) and its first invoice. Proration credits the old quantity and charges the new one for the remaining days.
- **Payments** are append-only and idempotent by client reference; invoice status is derived from the paid amount.
- **Audit trail**: every mutation writes one row with actor, action, reason, before and after, inside the same transaction, and bumps the quotation's last activity, which the deal-health dashboard reads.

### Quotation states

```
DRAFT --confirm--> APPROVED --send--> SENT --portal confirm--> CONFIRMED --accept split--> FULFILLMENT --all invoices paid--> PAID
  |                   ^                 |                          ^
  +--confirm (over)--> PENDING_APPROVAL -+--reject--> REJECTED      |
                        ^     (approve)                              |
  SENT/UNDER_NEGOTIATION --counter above ceiling--> PENDING_APPROVAL (new round) --approve--> SENT
  any edit of APPROVED / SENT --> DRAFT (approval superseded, approvalVersion + 1)
```

## Architecture

Next.js 15 App Router with React Server Components for reading and Server Actions for writing, TypeScript strict, Tailwind 4 with shadcn (Base UI), Prisma 6 on PostgreSQL 17, Zod 3 on every input, Vitest. One process, no queues, no cloud. `ARCHITECTURE.md` has the module map and the generated ER diagram of the 36 tables.

```
src/domain        pure business rules with unit tests (money, totals, risk, routing, split, proration, anomaly)
src/services      transactions: quotation, order, fulfillment, billing, approval, portal, admin, health, reports, upsell
src/lib           contract (shared types and Zod schemas), auth, state machines, audit, db, format
src/app/(auth)    login, signup
src/app/(internal) workspace: dashboard, quotes, approvals, fulfillment, subscriptions, invoices, health, reports, admin
src/app/portal    customer portal: separate layout, session and whitelisted DTO
prisma            schema, migration with CHECK constraints, seed split by owner
```

## Ownership

| Area | Owner |
|---|---|
| Schema, seed, contract, quotation engine, builder, upsell, fulfillment, billing, invoices, subscriptions, README | Vishvam |
| Shell and navigation, auth and sessions, risk score and routing, state machines, audit helper, approvals, admin, portal, deal health, reports, demo notes | Divyang |

Each pull request was reviewed and merged by the other person.

## Credits

Next.js, React, Prisma, PostgreSQL, Tailwind CSS, shadcn/ui and Base UI, Lucide icons, Zod, Vitest, bcryptjs, SheetJS (XLS export), sonner. Problem statement and mockup by the Odoo Hackathon 2026 organisers.
