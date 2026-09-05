// Owner: B. Invoice lifecycle and the payment arithmetic guard. Status is derived from
// paidAmount, so it can never disagree with the payments that were recorded.
import { ValidationError, type InvoiceStatus, type Money } from "@/lib/contract";
import { assertMove } from "./machine";

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  POSTED: ["PARTIAL", "PAID", "VOID"],
  PARTIAL: ["PAID"],
  PAID: [],
  VOID: [],
};

export const PAYABLE_STATUSES: readonly InvoiceStatus[] = ["POSTED", "PARTIAL"];

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  assertMove("invoice", INVOICE_TRANSITIONS, from, to);
}

export function statusAfterPayment(total: Money, paidAmount: Money): InvoiceStatus {
  if (paidAmount <= 0) return "POSTED";
  return paidAmount < total ? "PARTIAL" : "PAID";
}

/**
 * Apply a payment: amount must be positive and must not exceed what is due (400 with a
 * field error), and the invoice must be payable (409). Returns the new paid amount and status.
 */
export function applyPayment(invoice: { status: InvoiceStatus; total: Money; paidAmount: Money }, amount: Money) {
  if (!PAYABLE_STATUSES.includes(invoice.status)) {
    assertInvoiceTransition(invoice.status, "PAID"); // throws ConflictError for PAID / VOID
  }
  const due = invoice.total - invoice.paidAmount;
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError("Amount must be more than zero", { amount: ["Enter a positive amount"] });
  if (amount > due) throw new ValidationError("Amount exceeds the balance due", { amount: [`At most ${due} paise is due`] });
  const paidAmount = invoice.paidAmount + amount;
  const status = statusAfterPayment(invoice.total, paidAmount);
  assertInvoiceTransition(invoice.status, status === invoice.status ? "PAID" : status);
  return { paidAmount, status, due: invoice.total - paidAmount };
}
