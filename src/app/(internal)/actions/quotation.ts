"use server";

// Owner: A. Server actions for the sales rep. Each one: parse with the shared Zod
// schema, resolve the user, call the service, map thrown errors to ActionResult.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addLineSchema,
  confirmOnBehalfSchema,
  confirmQuotationSchema,
  createQuotationSchema,
  reviseQuotationSchema,
  ok,
  parseInput,
  removeLineSchema,
  sendToCustomerSchema,
  setOrderDiscountSchema,
  toActionError,
  updateLineSchema,
  type ActionResult,
  type ConfirmOutcome,
  type QuotationRef,
  type QuotationTotalsView,
} from "@/lib/contract";
import * as orders from "@/services/order.service";
import * as quotations from "@/services/quotation.service";
import { requireActionUser } from "@/lib/auth/internal";

const QUOTES = "/quotes";

export async function createQuotation(input: unknown): Promise<ActionResult<QuotationRef>> {
  const p = parseInput(createQuotationSchema, input);
  if (!p.ok) return p;
  try {
    const ref = await quotations.createQuotation(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    return ok(ref);
  } catch (e) {
    return toActionError(e);
  }
}

/** Form action behind "+ New Quotation": creates the draft and opens it. */
export async function createQuotationAndOpen(formData: FormData): Promise<void> {
  const result = await createQuotation({ customerId: formData.get("customerId") });
  if (!result.ok) redirect(`${QUOTES}?error=${encodeURIComponent(result.message)}`);
  redirect(`${QUOTES}/${result.data.publicId}`);
}

export async function addLine(input: unknown): Promise<ActionResult<QuotationTotalsView>> {
  const p = parseInput(addLineSchema, input);
  if (!p.ok) return p;
  try {
    const view = await quotations.addLine(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    return ok(view);
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateLine(input: unknown): Promise<ActionResult<QuotationTotalsView>> {
  const p = parseInput(updateLineSchema, input);
  if (!p.ok) return p;
  try {
    const view = await quotations.updateLine(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    return ok(view);
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeLine(input: unknown): Promise<ActionResult<QuotationTotalsView>> {
  const p = parseInput(removeLineSchema, input);
  if (!p.ok) return p;
  try {
    const view = await quotations.removeLine(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    return ok(view);
  } catch (e) {
    return toActionError(e);
  }
}

export async function setOrderDiscount(input: unknown): Promise<ActionResult<QuotationTotalsView>> {
  const p = parseInput(setOrderDiscountSchema, input);
  if (!p.ok) return p;
  try {
    const view = await quotations.setOrderDiscount(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    return ok(view);
  } catch (e) {
    return toActionError(e);
  }
}

/** The only way a quotation leaves DRAFT. Routing decides APPROVED or PENDING_APPROVAL. */
export async function confirmQuotation(input: unknown): Promise<ActionResult<ConfirmOutcome>> {
  const p = parseInput(confirmQuotationSchema, input);
  if (!p.ok) return p;
  try {
    const outcome = await quotations.confirmQuotation(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    revalidatePath("/approvals");
    return ok(outcome);
  } catch (e) {
    return toActionError(e);
  }
}

export async function reviseQuotation(input: unknown): Promise<ActionResult<QuotationRef>> {
  const p = parseInput(reviseQuotationSchema, input);
  if (!p.ok) return p;
  try {
    const ref = await quotations.reviseQuotation(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    return ok(ref);
  } catch (e) {
    return toActionError(e);
  }
}

/** Form action behind the Revise button on a rejected quotation. */
export async function reviseQuotationForm(formData: FormData): Promise<void> {
  const result = await reviseQuotation({ quotationId: formData.get("quotationId"), version: formData.get("version") });
  const publicId = String(formData.get("publicId") ?? "");
  if (!result.ok) redirect(`${QUOTES}/${publicId}?error=${encodeURIComponent(result.message)}`);
  redirect(`${QUOTES}/${publicId}`);
}

/** APPROVED -> SENT; returns the portal link to show on screen. */
export async function sendToCustomer(input: unknown): Promise<ActionResult<QuotationRef & { portalUrl: string }>> {
  const p = parseInput(sendToCustomerSchema, input);
  if (!p.ok) return p;
  try {
    const ref = await orders.sendToCustomer(p.data, await requireActionUser());
    revalidatePath(QUOTES);
    return ok(ref);
  } catch (e) {
    return toActionError(e);
  }
}

/** ADMIN only: confirm on the customer's behalf. Creates the split proposal (and billing, next). */
export async function confirmOnBehalf(input: unknown): Promise<ActionResult<QuotationRef>> {
  const p = parseInput(confirmOnBehalfSchema, input);
  if (!p.ok) return p;
  try {
    const ref = await orders.confirmOnBehalf(p.data, await requireActionUser(["ADMIN"]));
    revalidatePath(QUOTES);
    revalidatePath("/fulfillment");
    return ok(ref);
  } catch (e) {
    return toActionError(e);
  }
}

export async function sendToCustomerForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const r = await sendToCustomer({ quotationId: formData.get("quotationId"), version: formData.get("version") });
  redirect(`${QUOTES}/${publicId}${r.ok ? "" : `?error=${encodeURIComponent(r.message)}`}`);
}

export async function confirmOnBehalfForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const r = await confirmOnBehalf({ quotationId: formData.get("quotationId"), version: formData.get("version"), customerName: formData.get("customerName") });
  redirect(`${QUOTES}/${publicId}${r.ok ? "" : `?error=${encodeURIComponent(r.message)}`}`);
}
