"use server";

// Owner: B. Server action for the Sales Manager / Finance decision (PDF B4).
import { revalidatePath } from "next/cache";
import { requireActionUser } from "@/lib/auth/internal";
import { approvalDecisionSchema, ok, parseInput, toActionError, type ActionResult } from "@/lib/contract";
import * as approvals from "@/services/approval.service";

/** Approve, reject or return the given step. Returns the new quotation ref and the audit row id. */
export async function decide(input: unknown): Promise<ActionResult<approvals.DecisionOutcome>> {
  const p = parseInput(approvalDecisionSchema, input);
  if (!p.ok) return p;
  try {
    const user = await requireActionUser(["SALES_MANAGER", "FINANCE", "ADMIN"]);
    const outcome = await approvals.decide(p.data, user);
    revalidatePath("/approvals");
    revalidatePath(`/approvals/${outcome.publicId}`);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${outcome.publicId}`);
    return ok(outcome);
  } catch (e) {
    return toActionError(e);
  }
}
