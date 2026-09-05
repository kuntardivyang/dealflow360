# What we would build next

Written from `KNOWN_ISSUES.md` at the end of the 24 hours. Everything here has its tables in the schema already; what is missing is the service or the screen.

1. **Smart re-approval.** When a customer counter only lowers the discount, or an edit does not worsen the tested values, skip the approvers whose decision could not change. Today any change after approval starts a full new round.
2. **Subscription cancellation with credit notes and refunds.** Cancel per plan policy (end of period, immediate prorated refund, no refund), issue the credit note, and a refund payment when the invoice is already paid. Quantity changes with proration exist; cancellation does not.
3. **Backorder consolidation.** When stock arrives at a warehouse already in an accepted plan, raise the "Consolidate Remaining Backorder" prompt and let operations merge the backorder into that shipment. Stock receipts are recorded today; the prompt is not raised.
4. **Manual override matrix.** An editable quantity per warehouse per line on the fulfillment screen, validated against live stock, with the reason recorded. The service and validation exist; the matrix UI does not.
5. **Portal magic links.** Single-use, hashed, expiring links so a customer can open a quotation without a password. The token table exists; the flow does not.
6. **Real email delivery** of portal links, approval requests and payment receipts, with the audit trail recording each send.
7. **Replenishment.** Purchase orders raised automatically when available stock falls under the reorder point, using the lead days already stored per warehouse.
8. **Pipeline board.** Kanban columns per status with drag and drop for the sales workspace; the list grouped by status stands in for it.
9. **Multi-currency price lists and multi-company.** Currency columns exist and hold INR; the rules engine would need currency-specific price rules and per-company sequences.
10. **Background deal-health recompute** on a schedule with notifications, instead of recomputing on dashboard load.
11. **Reporting depth.** Approval-time analytics per approver, discount trends per rep and category, and a real PDF renderer instead of the print stylesheet.
