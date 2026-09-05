# Known issues and honest notes

Kept current after every reviewer visit. What is stubbed, partial or fragile, with the planned fix.

## Partial or not built (from the plan's cut list)

- **Subscription quantity change and cancellation with proration** (features 80, 81, 83): the plan rules (day-based proration, bill change day, cancellation policy, refund method) are configured and stored, the billing schedule is materialised on confirm, but the mid-cycle change screen and the credit note are not built yet. Next: `services/subscription.service.ts` with `prorate()` against the real period.
- **Backorder consolidation prompt** (feature 91): backorder lines are visible on the fulfillment detail; the "Consolidate Remaining Backorder" prompt on stock receipt is not built.
- **Manual override matrix** (feature 92): Accept Suggested Split works; the editable per-warehouse override is a form only if A finished it, otherwise "next".
- **Magic-link portal login** (feature 73): the portal uses email + password (seeded `acme@test.com` / `demo1234`). The token table exists; the link flow is not built.
- **Pipeline (Kanban) view** (feature 84): the nav item points to the quotation list grouped by status; there is no drag and drop.
- **Multi-currency and multi-company** (PDF bonus): not started. Money is INR paise everywhere; `currency` columns hold the constant `INR`.
- **PDF export** is the browser print dialog on a print stylesheet (navigation and filters hidden), not a PDF library. XLS export is real (SheetJS).
- **Deal health recompute** happens on every dashboard load and on "Recompute now"; there is no background timer.

## Behaviour worth knowing

- **Approved terms and re-approval**: any customer counter-offer that breaks a ceiling or the margin floor opens a new approval round automatically; the previous approved request is marked *Superseded*. Portal confirm re-runs routing only when the current approval version is not already approved, so approved terms are never re-flagged.
- **Margin floor routes too**: a discount within every ceiling still needs the Sales Manager when the order margin drops under the configured 20 % floor. The seeded Setup Service has a thin margin, so a customer counter from 8 % to 14 % on the laptop already triggers this. For the demo use the 25 % counter on the service line, which shows the Manager + Finance chain.
- **Database tests assume a fresh seed**: `pnpm smoke` and the database tests create quotations and reserve demo stock (laptop Main 6/6). Run `pnpm reset` before a demo or before `pnpm test`; A's fulfillment test fails on a consumed seed.
- **Database CHECK violations** (discount outside 0..100 %, negative stock) never reach the database in normal use because every action parses with Zod first; if one did, it surfaces as the generic "Something went wrong" action error, not a field error. Next: map Prisma's constraint error to a 400 in `toActionError`.
- **Sessions**: 24 h, database backed, one cookie per side (`df_session` path `/`, `df_portal` path `/portal`). The middleware checks the token in the database on every page request, so an invalid cookie never receives page data. This costs one query per request.
- **Reviewer-visible identities**: commits are by `kuntardivyang` and `vishvam129`; merge commits made on GitHub carry the profile name `Divyang Kuntar`, the same account.

## Fixed during the day (for the record)

- Auth or role checks in a Next.js layout alone leaked page data into the response because pages render in parallel with layouts. Fixed by enforcing session, portal cookie and admin role in `middleware.ts` (Node runtime) and inside each admin page.
- A new approval round did not supersede an already approved request, so the approvals list showed "Approved" next to a pending v2. Fixed.
- Portal confirm re-routed approved terms in a loop. Fixed (see above).
