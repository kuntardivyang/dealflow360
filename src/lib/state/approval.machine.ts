// Owner: B. Approval request and step lifecycles, plus the two guards every decision
// needs: only the lowest pending step is actionable, and the approver is never the rep.
import { ForbiddenError, type ApprovalRequestStatus, type ApprovalStepStatus, type Role } from "@/lib/contract";
import { assertMove } from "./machine";

export const REQUEST_TRANSITIONS: Record<ApprovalRequestStatus, readonly ApprovalRequestStatus[]> = {
  PENDING: ["APPROVED", "REJECTED", "RETURNED", "SUPERSEDED"],
  APPROVED: [],
  REJECTED: [],
  RETURNED: [],
  SUPERSEDED: [],
};

export const STEP_TRANSITIONS: Record<ApprovalStepStatus, readonly ApprovalStepStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

export function assertRequestTransition(from: ApprovalRequestStatus, to: ApprovalRequestStatus): void {
  assertMove("approval request", REQUEST_TRANSITIONS, from, to);
}

export function assertStepTransition(from: ApprovalStepStatus, to: ApprovalStepStatus): void {
  assertMove("approval step", STEP_TRANSITIONS, from, to);
}

/** The single step that can be acted on now: the lowest-numbered PENDING one, or null when none is left. */
export function actionableStep<T extends { stepNo: number; status: ApprovalStepStatus }>(steps: readonly T[]): T | null {
  const pending = steps.filter((s) => s.status === "PENDING").sort((a, b) => a.stepNo - b.stepNo);
  return pending[0] ?? null;
}

/**
 * Role guard for a decision: the user must hold the step's required role (ADMIN may
 * stand in), Finance cannot act before the Manager step, and nobody approves their own quote.
 */
export function assertCanDecide(
  step: { id: number; stepNo: number; requiredRole: Role; status: ApprovalStepStatus },
  allSteps: readonly { id: number; stepNo: number; status: ApprovalStepStatus }[],
  user: { id: number; role: Role },
  quotation: { repUserId: number },
): void {
  if (user.id === quotation.repUserId) throw new ForbiddenError("You cannot approve your own quotation");
  if (user.role !== step.requiredRole && user.role !== "ADMIN") {
    throw new ForbiddenError(`This step needs a ${step.requiredRole.toLowerCase().replaceAll("_", " ")}`);
  }
  const next = actionableStep(allSteps);
  if (!next || next.id !== step.id) throw new ForbiddenError("An earlier step must be decided first");
}
