import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, QUOTATION_ACTIONS, ValidationError, type Actor, type QuotationStatus } from "@/lib/contract";
import { QuotationStatus as Q } from "@/generated/prisma/enums";
import {
  actionableStep,
  applyPayment,
  assertCanDecide,
  assertActor,
  assertPlanTransition,
  assertRequestTransition,
  assertStepTransition,
  assertSubscriptionChangeable,
  assertTransition,
  canTransition,
  QUOTATION_TRANSITIONS,
  statusAfterPayment,
} from "@/lib/state";

const ALL_STATUSES = Object.values(Q) as QuotationStatus[];

describe("quotation machine", () => {
  it("throws ConflictError for every disallowed (state, action) pair and passes every allowed one", () => {
    let disallowed = 0;
    for (const action of QUOTATION_ACTIONS) {
      for (const from of ALL_STATUSES) {
        if (QUOTATION_TRANSITIONS[action].includes(from)) {
          expect(() => assertTransition(from, action)).not.toThrow();
          expect(canTransition(from, action)).toBe(true);
        } else {
          expect(() => assertTransition(from, action)).toThrow(ConflictError);
          disallowed++;
        }
      }
    }
    expect(disallowed).toBeGreaterThan(100);
  });

  it("refuses to confirm twice and to confirm from any state but DRAFT", () => {
    expect(() => assertTransition("PENDING_APPROVAL", "CONFIRM")).toThrow(/cannot confirm a quotation that is pending approval/);
    expect(() => assertTransition("APPROVED", "CONFIRM")).toThrow(ConflictError);
    expect(() => assertTransition("CONFIRMED", "CONFIRM")).toThrow(ConflictError);
  });

  it("lets edits supersede an approval but not a confirmed order", () => {
    expect(canTransition("APPROVED", "EDIT_LINES")).toBe(true);
    expect(canTransition("SENT", "EDIT_LINES")).toBe(true);
    expect(canTransition("CONFIRMED", "EDIT_LINES")).toBe(false);
    expect(canTransition("PAID", "EDIT_LINES")).toBe(false);
  });

  it("keeps the portal on SENT / UNDER_NEGOTIATION only", () => {
    for (const action of ["PORTAL_REQUEST", "PORTAL_CONFIRM"] as const) {
      expect(canTransition("SENT", action)).toBe(true);
      expect(canTransition("UNDER_NEGOTIATION", action)).toBe(true);
      expect(canTransition("PENDING_APPROVAL", action)).toBe(false);
      expect(canTransition("DRAFT", action)).toBe(false);
      expect(canTransition("CONFIRMED", action)).toBe(false);
    }
  });

  it("checks who may act", () => {
    const rep: Actor = { type: "USER", id: 1, name: "Riya", role: "SALES_REP" };
    const manager: Actor = { type: "USER", id: 2, name: "Meera", role: "SALES_MANAGER" };
    const contact: Actor = { type: "CONTACT", id: 9, name: "Nisha (Acme)" };
    const system: Actor = { type: "SYSTEM", id: null, name: "System" };
    expect(() => assertActor(rep, "APPROVE_STEP")).toThrow(ForbiddenError);
    expect(() => assertActor(manager, "APPROVE_STEP")).not.toThrow();
    expect(() => assertActor(contact, "CONFIRM")).toThrow(ForbiddenError);
    expect(() => assertActor(contact, "PORTAL_CONFIRM")).not.toThrow();
    expect(() => assertActor(rep, "PORTAL_REQUEST")).toThrow(ForbiddenError);
    expect(() => assertActor(system, "RECORD_PAYMENT")).not.toThrow();
  });
});

describe("approval machine", () => {
  const steps = [
    { id: 11, stepNo: 1, requiredRole: "SALES_MANAGER" as const, status: "PENDING" as const },
    { id: 12, stepNo: 2, requiredRole: "FINANCE" as const, status: "PENDING" as const },
  ];

  it("only the lowest pending step is actionable", () => {
    expect(actionableStep(steps)?.id).toBe(11);
    expect(actionableStep([{ ...steps[0], status: "APPROVED" }, steps[1]])?.id).toBe(12);
    expect(actionableStep([{ ...steps[0], status: "APPROVED" }, { ...steps[1], status: "APPROVED" }])).toBeNull();
  });

  it("Finance cannot act before the Manager step, the rep cannot approve their own quote, ADMIN may stand in", () => {
    const quote = { repUserId: 1 };
    expect(() => assertCanDecide(steps[1], steps, { id: 3, role: "FINANCE" }, quote)).toThrow(/earlier step/);
    expect(() => assertCanDecide(steps[0], steps, { id: 3, role: "FINANCE" }, quote)).toThrow(/needs a sales manager/);
    expect(() => assertCanDecide(steps[0], steps, { id: 1, role: "SALES_MANAGER" }, quote)).toThrow(/own quotation/);
    expect(() => assertCanDecide(steps[0], steps, { id: 2, role: "SALES_MANAGER" }, quote)).not.toThrow();
    expect(() => assertCanDecide(steps[0], steps, { id: 4, role: "ADMIN" }, quote)).not.toThrow();
  });

  it("requests and steps are decided once", () => {
    expect(() => assertRequestTransition("PENDING", "SUPERSEDED")).not.toThrow();
    expect(() => assertRequestTransition("APPROVED", "REJECTED")).toThrow(ConflictError);
    expect(() => assertStepTransition("PENDING", "APPROVED")).not.toThrow();
    expect(() => assertStepTransition("APPROVED", "APPROVED")).toThrow(ConflictError);
  });
});

describe("invoice machine", () => {
  it("derives the status from the paid amount", () => {
    expect(statusAfterPayment(1000, 0)).toBe("POSTED");
    expect(statusAfterPayment(1000, 400)).toBe("PARTIAL");
    expect(statusAfterPayment(1000, 1000)).toBe("PAID");
  });

  it("partial then full payment; overpayment and zero are 400s; a paid invoice is a 409", () => {
    const partial = applyPayment({ status: "POSTED", total: 1000, paidAmount: 0 }, 400);
    expect(partial).toEqual({ paidAmount: 400, status: "PARTIAL", due: 600 });
    const paid = applyPayment({ status: "PARTIAL", total: 1000, paidAmount: 400 }, 600);
    expect(paid).toEqual({ paidAmount: 1000, status: "PAID", due: 0 });
    expect(() => applyPayment({ status: "PARTIAL", total: 1000, paidAmount: 400 }, 601)).toThrow(ValidationError);
    expect(() => applyPayment({ status: "POSTED", total: 1000, paidAmount: 0 }, 0)).toThrow(ValidationError);
    expect(() => applyPayment({ status: "PAID", total: 1000, paidAmount: 1000 }, 1)).toThrow(ConflictError);
    expect(() => applyPayment({ status: "VOID", total: 1000, paidAmount: 0 }, 1)).toThrow(ConflictError);
  });
});

describe("plan and subscription machines", () => {
  it("a plan is accepted once", () => {
    expect(() => assertPlanTransition("PROPOSED", "ACCEPTED")).not.toThrow();
    expect(() => assertPlanTransition("ACCEPTED", "ACCEPTED")).toThrow(ConflictError);
  });

  it("only an active subscription can change", () => {
    expect(() => assertSubscriptionChangeable("ACTIVE")).not.toThrow();
    expect(() => assertSubscriptionChangeable("CANCELLED")).toThrow(ConflictError);
  });
});
