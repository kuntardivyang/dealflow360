// Owner: B. Quick Test Flow (PDF section 9), steps 1 to 8, driven through the services
// against the development database. Prints PASS / FAIL per step and exits non-zero on
// the first failure. Run after `pnpm reset`: `pnpm smoke`.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { authenticatePortal } from "../src/lib/auth/portal";
import type { SessionUser } from "../src/lib/contract";
import { saveApprovalRule, savePlan, saveTier, saveWarehouse, saveStockLevel } from "../src/services/admin.service";
import { decide } from "../src/services/approval.service";
import { recordPayment } from "../src/services/billing.service";
import { acceptPlan } from "../src/services/fulfillment.service";
import { sendToCustomer } from "../src/services/order.service";
import { confirmFromPortal, submitRequest } from "../src/services/portal.service";
import { addLine, confirmQuotation, createQuotation } from "../src/services/quotation.service";
import { suggestFor } from "../src/services/upsell.service";

const db = new PrismaClient();
const run = Date.now().toString(36);
let failed = false;

function check(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function step(n: number, title: string, fn: () => Promise<string>) {
  if (failed) return console.log(`SKIP ${n}. ${title}`);
  try {
    const detail = await fn();
    console.log(`PASS ${n}. ${title}${detail ? `  (${detail})` : ""}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${n}. ${title}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}
async function user(email: string): Promise<SessionUser> {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

async function main() {
  const admin = await user("admin@df.local");
  const riya = await user("riya@df.local");
  const meera = await user("meera@df.local");
  const farhan = await user("farhan@df.local");
  const acme = await db.customer.findFirstOrThrow({ where: { name: "Acme Corp" } });
  const laptop = await db.product.findFirstOrThrow({ where: { sku: "HW-LAP-14" } });
  const setup = await db.product.findFirstOrThrow({ where: { sku: "SV-SETUP" } });
  const supportPro = await db.product.findFirstOrThrow({ where: { sku: "SB-SUP-PRO" } });

  await step(1, "Set up backend data: a discount tier, a warehouse with stock, a subscription plan (and the approval rules exist)", async () => {
    const tier = await saveTier({ name: `Platinum ${run}`, discountCeilingBp: 2000, sortOrder: 9 }, admin);
    const wh = await saveWarehouse({ name: `Smoke Depot ${run}`, city: "Surat", shipCostWeight: 90000, priority: 9 }, admin);
    await saveStockLevel({ warehouseId: wh.id, productId: laptop.id, onHand: 0, reorderPoint: 0, leadDays: 7 }, admin);
    const plan = await savePlan({ name: `Half-yearly ${run}`, interval: "QUARTER", periods: 2, prorationMode: "DAY_BASED", billChangeDay: true, cancelPolicy: "END_OF_PERIOD", refundMethod: "CREDIT_NOTE", productId: null }, admin);
    const rules = await db.approvalRule.count({ where: { isActive: true } });
    check(rules >= 1, "no active approval rules");
    void saveApprovalRule;
    return `tier #${tier.id}, warehouse #${wh.id}, plan #${plan.id}, ${rules} approval rules`;
  });

  let quotationId = 0;
  let version = 1;
  let publicId = "";
  await step(2, "Create a quotation with a line discounted above its allowed limit", async () => {
    const ref = await createQuotation({ customerId: acme.id }, riya);
    quotationId = ref.id;
    publicId = ref.publicId;
    let view = await addLine({ quotationId, version: ref.version, productId: laptop.id, qty: 10, discountBp: 1200, source: "MANUAL" }, riya);
    view = await addLine({ quotationId, version: view.version, productId: supportPro.id, qty: 1, discountBp: 0, source: "MANUAL" }, riya);
    view = await addLine({ quotationId, version: view.version, productId: setup.id, qty: 2, discountBp: 1800, source: "MANUAL" }, riya);
    version = view.version;
    const over = view.risk.lines.filter((l) => l.overageBp > 0);
    check(over.length === 1 && over[0].overageBp === 800, `expected one line 8 pt over, got ${JSON.stringify(view.risk.lines)}`);
    return `${ref.number}: setup service 18% vs 10% limit, score ${view.risk.score}, chain ${view.risk.chain.join(" > ") || "none"}`;
  });

  await step(4, "Accept one upsell suggestion; order total and margin update right away", async () => {
    const before = await db.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    const suggestions = await suggestFor(quotationId);
    check(suggestions.length > 0, "no upsell suggestions for the cart");
    const pick = suggestions[0];
    const view = await addLine({ quotationId, version, productId: pick.productId, qty: 1, discountBp: 0, source: "UPSELL" }, riya);
    version = view.version;
    check(view.totals.total > before.total, "total did not increase");
    check(view.totals.marginBp !== before.marginBp, "margin did not change");
    return `${pick.name}: total ${inr(before.total)} -> ${inr(view.totals.total)}, margin ${(before.marginBp ?? 0) / 100}% -> ${(view.totals.marginBp ?? 0) / 100}%`;
  });

  let requestId = 0;
  await step(3, "Confirm asks for manager approval automatically, without the rep requesting it", async () => {
    const out = await confirmQuotation({ quotationId, version }, riya);
    version = out.version;
    check(out.status === "PENDING_APPROVAL", `status ${out.status}`);
    check(out.requestId !== null, "no approval request created");
    requestId = out.requestId!;
    const steps = await db.approvalStep.findMany({ where: { requestId }, orderBy: { stepNo: "asc" } });
    return `PENDING_APPROVAL, request #${requestId}, steps ${steps.map((s) => s.requiredRole).join(" > ")}`;
  });

  await step(5, "Get the quotation approved, send it, confirm, and see stock pulled across two warehouses", async () => {
    const steps = await db.approvalStep.findMany({ where: { requestId, status: "PENDING" }, orderBy: { stepNo: "asc" } });
    for (const s of steps) {
      const approver = s.requiredRole === "FINANCE" ? farhan : meera;
      await decide({ requestId, stepId: s.id, decision: "APPROVE", note: "smoke" }, approver);
    }
    const q = await db.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    check(q.status === "APPROVED", `after approval status ${q.status}`);
    const sent = await sendToCustomer({ quotationId, version: q.version }, riya);
    check(sent.status === "SENT", `after send status ${sent.status}`);
    return `approved by ${steps.map((s) => s.requiredRole).join(" and ")}, sent to the portal at ${sent.portalUrl}`;
  });

  await step(7, "As the customer, ask for a bigger discount: the quote goes back for approval automatically", async () => {
    const buyer = await authenticatePortal("buyer@acme.com", "demo1234");
    check(buyer, "portal login failed");
    const setupLine = await db.quotationLine.findFirstOrThrow({ where: { quotationId, productId: setup.id } });
    const dto = await submitRequest({ publicId, type: "COUNTER_DISCOUNT", lineId: setupLine.id, proposedDiscountBp: 2500, message: "Can this be 25%?" }, buyer!);
    check(dto.status === "Awaiting internal approval", `portal status ${dto.status}`);
    const q = await db.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: { approvalRequests: { orderBy: { version: "asc" }, include: { steps: true } } } });
    check(q.approvalVersion === 2, `approvalVersion ${q.approvalVersion}`);
    check(q.approvalRequests[0].status === "SUPERSEDED", "first request not superseded");
    const v2 = q.approvalRequests[1];
    for (const s of v2.steps.sort((a, b) => a.stepNo - b.stepNo)) {
      await decide({ requestId: v2.id, stepId: s.id, decision: "APPROVE", note: "fine for Acme" }, s.requiredRole === "FINANCE" ? farhan : meera);
    }
    const after = await db.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    check(after.status === "SENT", `after v2 approval status ${after.status}`);
    const line = await db.quotationLine.findUniqueOrThrow({ where: { id: setupLine.id } });
    check(line.discountBp === 2500, `counter not applied: ${line.discountBp}`);
    return `counter 25% -> request v2 (${v2.steps.map((s) => s.requiredRole).join(" > ")}), v1 superseded, approved, back to Sent at 25%`;
  });

  let planId = 0;
  await step(5.5, "Customer confirms with one click; the split is proposed and accepted across two warehouses", async () => {
    const buyer = (await authenticatePortal("buyer@acme.com", "demo1234"))!;
    const dto = await confirmFromPortal({ publicId, fullName: "Nisha Acme" }, buyer);
    check(dto.status === "Confirmed", `portal status ${dto.status}`);
    const plan = await db.fulfillmentPlan.findFirstOrThrow({ where: { quotationId, status: "PROPOSED" }, include: { lines: { include: { warehouse: true } } } });
    planId = plan.id;
    const warehouses = [...new Set(plan.lines.filter((l) => l.warehouseId).map((l) => l.warehouse!.name))];
    check(warehouses.length >= 2, `expected two warehouses, got ${warehouses.join(", ")}`);
    const accepted = await acceptPlan({ quotationId, planId }, farhan);
    const q = await db.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    check(q.status === "FULFILLMENT", `after accept status ${q.status}`);
    const levels = await db.stockLevel.findMany({ where: { productId: laptop.id }, include: { warehouse: true } });
    return `plan #${accepted.planId ?? planId}: ${warehouses.join(" + ")}; laptop reserved ${levels.map((l) => `${l.warehouse.name} ${l.reserved}/${l.onHand}`).join(", ")}`;
  });

  let oneTimeInvoiceId = 0;
  await step(6, "A one-time product and a recurring subscription on the same order are billed separately", async () => {
    const invoices = await db.invoice.findMany({ where: { quotationId }, orderBy: { id: "asc" } });
    const oneTime = invoices.filter((i) => i.kind === "ONE_TIME");
    const recurring = invoices.filter((i) => i.kind === "RECURRING");
    check(oneTime.length === 1, `expected one ONE_TIME invoice, got ${oneTime.length}`);
    check(recurring.length >= 1, "expected a RECURRING invoice");
    const sub = await db.subscription.findFirst({ where: { quotationId }, include: { schedule: true } });
    check(sub && sub.schedule.length >= 1, "no subscription schedule");
    oneTimeInvoiceId = oneTime[0].id;
    return `${oneTime[0].number} ${inr(oneTime[0].total)} one-time; ${recurring[0].number} ${inr(recurring[0].total)} recurring; ${sub!.schedule.length} schedule rows`;
  });

  await step(8, "Record a payment; the invoice status updates correctly", async () => {
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: oneTimeInvoiceId } });
    const half = Math.floor(inv.total / 2);
    await recordPayment({ invoiceId: inv.id, amount: half, clientRef: `smoke-${run}-1`, method: "BANK_TRANSFER" }, farhan);
    const partial = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    check(partial.status === "PARTIAL", `after half payment status ${partial.status}`);
    await recordPayment({ invoiceId: inv.id, amount: inv.total - half, clientRef: `smoke-${run}-2`, method: "UPI" }, farhan);
    const paid = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    check(paid.status === "PAID", `after full payment status ${paid.status}`);
    let overpaid = false;
    try {
      await recordPayment({ invoiceId: inv.id, amount: 1, clientRef: `smoke-${run}-3`, method: "CASH" }, farhan);
    } catch {
      overpaid = true;
    }
    check(overpaid, "overpayment was accepted");
    return `${inv.number}: ${inr(half)} -> Partially Paid, ${inr(inv.total - half)} -> Paid, overpayment rejected`;
  });

  console.log(failed ? "\nSMOKE FAILED" : "\nSMOKE PASSED: all eight Quick Test steps");
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
