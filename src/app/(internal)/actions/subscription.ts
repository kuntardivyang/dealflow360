"use server";

// Owner: A. Subscription changes from the billing detail screen.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cancelSubscriptionSchema, changeQuantitySchema, errorQuery, ok, parseInput, toActionError, type ActionResult } from "@/lib/contract";
import { requireActionUser } from "@/lib/auth/internal";
import * as subscriptions from "@/services/subscription.service";

export async function changeQuantity(input: unknown): Promise<ActionResult<subscriptions.ChangeOutcome>> {
  const p = parseInput(changeQuantitySchema, input);
  if (!p.ok) return p;
  try {
    const r = await subscriptions.changeQuantity(p.data, await requireActionUser(["ADMIN", "FINANCE", "SALES_MANAGER"]));
    for (const path of ["/subscriptions", "/invoices", "/quotes"]) revalidatePath(path);
    return ok(r);
  } catch (e) {
    return toActionError(e);
  }
}

export async function changeQuantityForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const r = await changeQuantity({ subscriptionId: formData.get("subscriptionId"), newQty: formData.get("newQty"), effectiveDate: formData.get("effectiveDate") });
  if (!r.ok) {
    const detail = r.fieldErrors ? " " + Object.values(r.fieldErrors).flat().join(" ") : "";
    redirect(`/subscriptions/${publicId}?error=${encodeURIComponent(r.message + detail)}`);
  }
  const msg = r.data.net > 0 ? `Prorated: credit ${r.data.credit} paise, charge ${r.data.charge} paise, invoice ${r.data.invoiceNumber} posted for the difference` : r.data.net < 0 ? `Prorated: credit note issued for the reduction` : "Quantity changed; nothing to prorate";
  redirect(`/subscriptions/${publicId}?ok=${encodeURIComponent(msg)}`);
}

export async function cancelSubscription(input: unknown): Promise<ActionResult<subscriptions.CancelOutcome>> {
  const p = parseInput(cancelSubscriptionSchema, input);
  if (!p.ok) return p;
  try {
    const r = await subscriptions.cancelSubscription(p.data, await requireActionUser());
    for (const path of ["/subscriptions", "/invoices"]) revalidatePath(path);
    return ok(r);
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelSubscriptionForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const r = await cancelSubscription({ subscriptionId: formData.get("subscriptionId"), effectiveDate: formData.get("effectiveDate") || undefined, reason: formData.get("reason") });
  if (!r.ok) redirect(`/subscriptions/${publicId}${errorQuery(r)}`);
  const msg = r.data.creditNoteId
    ? `Cancelled (${r.data.policy.toLowerCase().replaceAll("_", " ")}), credit note issued for the unused days`
    : `Cancelled, effective ${r.data.cancelEffective}`;
  redirect(`/subscriptions/${publicId}?ok=${encodeURIComponent(msg)}`);
}
