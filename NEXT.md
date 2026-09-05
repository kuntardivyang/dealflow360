# What we would build next

Written from `KNOWN_ISSUES.md` at the end of the 24 hours. Everything here has its tables in the schema already; what is missing is the service or the screen.

1. **Smart re-approval.** When a customer counter only lowers the discount, or an edit does not worsen the tested values, skip the approvers whose decision could not change. Today any change after approval starts a full new round.
2. **Subscription plan changes and pausing.** Quantity changes with proration and cancellation under all three policies are built, including credit notes and refund payments. What is missing is swapping a subscription onto a different plan (`SubscriptionChangeType.PLAN` is declared and never written) and pausing one (`SubscriptionStatus.PAUSED` likewise, and the Subscriptions list renders a Paused tile that is always 0).
3. **Backorder consolidation.** When stock arrives at a warehouse already in an accepted plan, raise the "Consolidate Remaining Backorder" prompt and let operations merge the backorder into that shipment. Stock receipts are recorded today; the prompt is not raised.
4. **A shipment-optimal warehouse split.** The manual override matrix is built and validated against live stock. The automatic split, though, is greedy by remaining order value, which is a proxy for "fewest shipments" rather than a guarantee: on a brute-force sweep of fully-satisfiable cases it used more shipments than necessary about 1 % of the time. Its single-warehouse shortcut also compares value, so a zero-priced line is invisible to it.
5. **Portal magic links.** Single-use, hashed, expiring links so a customer can open a quotation without a password. The token table exists; the flow does not.
6. **Real email delivery** of portal links, approval requests and payment receipts, with the audit trail recording each send.
7. **Replenishment.** Purchase orders raised automatically when available stock falls under the reorder point, using the lead days already stored per warehouse.
8. **Drag and drop on the pipeline board.** The Kanban board with the five mockup stage columns is the default view of `/quotes`. Dragging a card between columns to drive the transition is not wired.
9. **Multi-currency price lists and multi-company.** Currency columns exist and hold INR; the rules engine would need currency-specific price rules and per-company sequences.
10. **Background deal-health recompute** on a schedule with notifications, instead of recomputing on dashboard load.
11. **Reporting depth.** Approval-time analytics per approver, discount trends per rep and category, and a real PDF renderer instead of the print stylesheet.
