"use server";

// Owner: A. Server actions for the sales rep. Each one: parse with the shared Zod
// schema, resolve the user, call the service, map thrown errors to ActionResult.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addLineSchema,
  createQuotationSchema,
  ok,
  parseInput,
  removeLineSchema,
  setOrderDiscountSchema,
  toActionError,
  updateLineSchema,
  type ActionResult,
  type QuotationRef,
  type QuotationTotalsView,
} from "@/lib/contract";
import * as quotations from "@/services/quotation.service";
import { currentUser } from "./_current-user";

const QUOTES = "/quotes";

export async function createQuotation(input: unknown): Promise<ActionResult<QuotationRef>> {
  const p = parseInput(createQuotationSchema, input);
  if (!p.ok) return p;
  try {
    const ref = await quotations.createQuotation(p.data, await currentUser());
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
    const view = await quotations.addLine(p.data, await currentUser());
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
    const view = await quotations.updateLine(p.data, await currentUser());
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
    const view = await quotations.removeLine(p.data, await currentUser());
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
    const view = await quotations.setOrderDiscount(p.data, await currentUser());
    revalidatePath(QUOTES);
    return ok(view);
  } catch (e) {
    return toActionError(e);
  }
}
