"use server";

// Owner: A. Fulfillment actions: accept the suggested split, override it, ship, receive stock.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  acceptSplitSchema,
  ok,
  overrideSplitSchema,
  parseInput,
  shipSchema,
  stockReceiptSchema,
  toActionError,
  type ActionResult,
  type QuotationRef,
  errorQuery,
} from "@/lib/contract";
import { requireActionUser } from "@/lib/auth/internal";
import * as fulfillment from "@/services/fulfillment.service";

const PATHS = ["/fulfillment", "/quotes"];
const refresh = () => PATHS.forEach((p) => revalidatePath(p));

export async function acceptSplit(input: unknown): Promise<ActionResult<QuotationRef & { planId: number }>> {
  const p = parseInput(acceptSplitSchema, input);
  if (!p.ok) return p;
  try {
    const ref = await fulfillment.acceptPlan(p.data, await requireActionUser());
    refresh();
    return ok(ref);
  } catch (e) {
    return toActionError(e);
  }
}

export async function overrideSplit(input: unknown): Promise<ActionResult<QuotationRef & { planId: number }>> {
  const p = parseInput(overrideSplitSchema, input);
  if (!p.ok) return p;
  try {
    const ref = await fulfillment.overridePlan(p.data, await requireActionUser());
    refresh();
    return ok(ref);
  } catch (e) {
    return toActionError(e);
  }
}

export async function ship(input: unknown): Promise<ActionResult<{ shipmentId: number }>> {
  const p = parseInput(shipSchema, input);
  if (!p.ok) return p;
  try {
    const r = await fulfillment.ship(p.data, await requireActionUser());
    refresh();
    return ok(r);
  } catch (e) {
    return toActionError(e);
  }
}

export async function receiveStock(input: unknown): Promise<ActionResult<{ stockLevelId: number }>> {
  const p = parseInput(stockReceiptSchema, input);
  if (!p.ok) return p;
  try {
    const r = await fulfillment.receiveStock(p.data, await requireActionUser(["ADMIN", "FINANCE", "SALES_MANAGER"]));
    refresh();
    return ok(r);
  } catch (e) {
    return toActionError(e);
  }
}

/** Form actions for the fulfillment detail page. */
export async function acceptSplitForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const r = await acceptSplit({ quotationId: formData.get("quotationId"), planId: formData.get("planId") });
  redirect(`/fulfillment/${publicId}${r.ok ? "" : `${errorQuery(r)}`}`);
}

export async function shipForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const r = await ship({ shipmentId: formData.get("shipmentId") });
  redirect(`/fulfillment/${publicId}${r.ok ? "" : `${errorQuery(r)}`}`);
}

export async function receiveStockForm(formData: FormData): Promise<void> {
  const r = await receiveStock({ warehouseId: formData.get("warehouseId"), productId: formData.get("productId"), qty: formData.get("qty"), note: "Manual receipt" });
  redirect(`/fulfillment${r.ok ? "" : `${errorQuery(r)}`}`);
}

/**
 * Manual Override form: one qty field per (order line, warehouse) named `alloc.<lineId>.<warehouseId>`.
 * Empty or zero fields are skipped; whatever is not allocated becomes a backorder in the service.
 */
export async function overrideSplitForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const allocations: { lineId: string; warehouseId: string; qty: string }[] = [];
  for (const [key, value] of formData.entries()) {
    const m = /^alloc\.(\d+)\.(\d+)$/.exec(key);
    const qty = String(value ?? "").trim();
    if (!m || qty === "" || Number(qty) === 0) continue;
    allocations.push({ lineId: m[1], warehouseId: m[2], qty });
  }
  const r = await overrideSplit({ quotationId: formData.get("quotationId"), planId: formData.get("planId"), reason: formData.get("reason"), allocations });
  if (!r.ok) {
    const detail = r.fieldErrors ? " " + Object.values(r.fieldErrors).flat().join(" ") : "";
    redirect(`/fulfillment/${publicId}?error=${encodeURIComponent(r.message + detail)}`);
  }
  redirect(`/fulfillment/${publicId}`);
}
