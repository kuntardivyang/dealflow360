"use server";

// Owner: B. Portal server actions. The portal has its own session, so these never call
// the internal guard; every service call is scoped by the contact's customer.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authenticatePortal, clearPortalCookie, createPortalSession, requirePortalAction, safePortalNext, setPortalCookie } from "@/lib/auth/portal";
import {
  fail,
  ok,
  parseInput,
  portalConfirmSchema,
  portalLoginSchema,
  portalRequestSchema,
  toActionError,
  type ActionError,
  type ActionResult,
  type PortalQuotationDTO,
} from "@/lib/contract";
import * as portal from "@/services/portal.service";

export type PortalLoginState = ActionError | null;

export async function portalLoginAction(_prev: PortalLoginState, form: FormData): Promise<PortalLoginState> {
  const parsed = parseInput(portalLoginSchema, { email: form.get("email"), password: form.get("password") });
  if (!parsed.ok) return parsed;
  try {
    const user = await authenticatePortal(parsed.data.email, parsed.data.password);
    if (!user) return fail("VALIDATION", "Invalid email or password", { password: ["Invalid email or password"] });
    const { token, expiresAt } = await createPortalSession(user.contactId);
    await setPortalCookie(token, expiresAt);
  } catch (e) {
    return toActionError(e);
  }
  redirect(safePortalNext(String(form.get("next") ?? "")));
}

export async function portalLogoutAction(): Promise<void> {
  await clearPortalCookie();
  redirect("/portal/login");
}

export async function submitRequest(input: unknown): Promise<ActionResult<PortalQuotationDTO>> {
  const p = parseInput(portalRequestSchema, input);
  if (!p.ok) return p;
  try {
    const dto = await portal.submitRequest(p.data, await requirePortalAction());
    revalidatePath(`/portal/q/${dto.publicId}`);
    revalidatePath("/portal");
    return ok(dto);
  } catch (e) {
    return toActionError(e);
  }
}

export async function confirm(input: unknown): Promise<ActionResult<PortalQuotationDTO>> {
  const p = parseInput(portalConfirmSchema, input);
  if (!p.ok) return p;
  try {
    const dto = await portal.confirmFromPortal(p.data, await requirePortalAction());
    revalidatePath(`/portal/q/${dto.publicId}`);
    revalidatePath("/portal");
    return ok(dto);
  } catch (e) {
    return toActionError(e);
  }
}
