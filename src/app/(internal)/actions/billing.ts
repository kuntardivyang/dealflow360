"use server";

// Owner: A. Record a payment against an invoice. The form sends rupees; paise are stored.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ok, parseInput, recordPaymentSchema, toActionError, type ActionResult,
  errorQuery,
} from "@/lib/contract";
import { requireActionUser } from "@/lib/auth/internal";
import * as billing from "@/services/billing.service";

export async function recordPayment(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof billing.recordPayment>>>> {
  const p = parseInput(recordPaymentSchema, input);
  if (!p.ok) return p;
  try {
    const r = await billing.recordPayment(p.data, await requireActionUser(["ADMIN", "FINANCE", "SALES_MANAGER"]));
    for (const path of ["/invoices", "/quotes", "/subscriptions"]) revalidatePath(path);
    return ok(r);
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordPaymentForm(formData: FormData): Promise<void> {
  const publicId = String(formData.get("publicId") ?? "");
  const rupees = Number(formData.get("amountRupees"));
  const amount = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
  const r = await recordPayment({
    invoiceId: formData.get("invoiceId"),
    amount,
    clientRef: formData.get("clientRef"),
    method: formData.get("method") ?? "BANK_TRANSFER",
    reference: formData.get("reference") || undefined,
  });
  const msg = r.ok ? "" : `${errorQuery(r)}`;
  redirect(`/invoices/${publicId}${msg}`);
}
