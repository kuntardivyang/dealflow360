"use server";

// Owner: B. Deal Health actions: recompute alerts, nudge the rep, escalate.
import { revalidatePath } from "next/cache";
import { requireActionUser } from "@/lib/auth/internal";
import { ok, parseInput, toActionError, type ActionResult } from "@/lib/contract";
import { z } from "zod";
import * as health from "@/services/health.service";

const alertActionSchema = z.object({ alertId: z.coerce.number().int().positive(), action: z.enum(["NUDGE", "ESCALATE"]) });

export async function refreshHealth(): Promise<ActionResult<{ open: number }>> {
  try {
    await requireActionUser();
    const open = await health.refreshAlerts();
    revalidatePath("/health");
    revalidatePath("/dashboard");
    return ok({ open });
  } catch (e) {
    return toActionError(e);
  }
}

export async function actOnAlert(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof health.actOnAlert>>>> {
  const p = parseInput(alertActionSchema, input);
  if (!p.ok) return p;
  try {
    const user = await requireActionUser(["SALES_MANAGER", "FINANCE", "ADMIN"]);
    const result = await health.actOnAlert(p.data.alertId, p.data.action, user);
    revalidatePath("/health");
    revalidatePath(`/quotes/${result.quotationNumber}`);
    return ok(result);
  } catch (e) {
    return toActionError(e);
  }
}
