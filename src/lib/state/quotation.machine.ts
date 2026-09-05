// Owner: B. Quotation lifecycle (BLUEPRINT B.2). The action names are the shared list in
// the contract, so A's services and B's services call the same guard. The target state
// of CONFIRM, PORTAL_REQUEST, REP_RESPOND and PORTAL_CONFIRM depends on routing at run
// time, so this table lists the states each action is allowed FROM; services set the
// destination. Every service calls assertTransition() inside its transaction.
import { ForbiddenError, type Actor, type QuotationAction, type QuotationStatus, type Role } from "@/lib/contract";
import { assertAllowed, humanize, isAllowed, type TransitionTable } from "./machine";

export const QUOTATION_TRANSITIONS: TransitionTable<QuotationStatus, QuotationAction> = {
  EDIT_LINES: ["DRAFT", "APPROVED", "SENT", "UNDER_NEGOTIATION"], // outside DRAFT the edit supersedes the approval and returns to DRAFT
  CONFIRM: ["DRAFT"], // -> APPROVED when routing is empty, else PENDING_APPROVAL
  APPROVE_STEP: ["PENDING_APPROVAL"], // -> PENDING_APPROVAL (more steps) | APPROVED | SENT (negotiation)
  REJECT: ["PENDING_APPROVAL"], // -> REJECTED | SENT with the original terms (negotiation)
  RETURN: ["PENDING_APPROVAL"], // -> DRAFT
  REVISE: ["REJECTED"], // -> DRAFT
  SEND: ["APPROVED"], // -> SENT
  PORTAL_REQUEST: ["SENT", "UNDER_NEGOTIATION"], // -> UNDER_NEGOTIATION | PENDING_APPROVAL (counter above ceilings)
  REP_RESPOND: ["UNDER_NEGOTIATION"], // -> SENT | UNDER_NEGOTIATION | PENDING_APPROVAL
  PORTAL_CONFIRM: ["SENT", "UNDER_NEGOTIATION"], // -> CONFIRMED | PENDING_APPROVAL
  ACCEPT_SPLIT: ["CONFIRMED"], // -> FULFILLMENT
  SHIP: ["FULFILLMENT"], // -> FULFILLMENT
  RECORD_PAYMENT: ["CONFIRMED", "FULFILLMENT"], // -> PAID once every invoice is paid
};

/** Who may perform each action. Ownership (the rep owns the quote) and step-role checks stay in the services. */
export type ActorKind = Role | "CONTACT";
export const QUOTATION_ACTORS: Record<QuotationAction, readonly ActorKind[]> = {
  EDIT_LINES: ["SALES_REP", "ADMIN"],
  CONFIRM: ["SALES_REP", "ADMIN"],
  APPROVE_STEP: ["SALES_MANAGER", "FINANCE", "ADMIN"],
  REJECT: ["SALES_MANAGER", "FINANCE", "ADMIN"],
  RETURN: ["SALES_MANAGER", "FINANCE", "ADMIN"],
  REVISE: ["SALES_REP", "ADMIN"],
  SEND: ["SALES_REP", "ADMIN"],
  PORTAL_REQUEST: ["CONTACT"],
  REP_RESPOND: ["SALES_REP", "ADMIN"],
  PORTAL_CONFIRM: ["CONTACT", "ADMIN"], // ADMIN = "Confirm on behalf", the demo fallback
  ACCEPT_SPLIT: ["FINANCE", "SALES_MANAGER", "ADMIN", "SALES_REP"],
  SHIP: ["FINANCE", "SALES_MANAGER", "ADMIN"],
  RECORD_PAYMENT: ["FINANCE", "SALES_MANAGER", "ADMIN"],
};

/** Deals still in play; everything else is confirmed, closed or dead. */
export const OPEN_STATUSES: readonly QuotationStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "UNDER_NEGOTIATION"];
export const EDIT_SUPERSEDES_APPROVAL: readonly QuotationStatus[] = ["APPROVED", "SENT", "UNDER_NEGOTIATION"];

export const canTransition = (from: QuotationStatus, action: QuotationAction): boolean => isAllowed(QUOTATION_TRANSITIONS, from, action);

export function assertTransition(from: QuotationStatus, action: QuotationAction): void {
  assertAllowed("quotation", QUOTATION_TRANSITIONS, from, action);
}

function kindOf(actor: Actor): ActorKind | "SYSTEM" | null {
  if (actor.type === "SYSTEM") return "SYSTEM";
  if (actor.type === "CONTACT") return "CONTACT";
  return (actor.role as Role | undefined) ?? null;
}

/** System actors (seed, health service) may do anything; users need a listed role; contacts only portal actions. */
export function canAct(actor: Actor, action: QuotationAction): boolean {
  const kind = kindOf(actor);
  if (kind === "SYSTEM") return true;
  return kind !== null && QUOTATION_ACTORS[action].includes(kind);
}

export function assertActor(actor: Actor, action: QuotationAction): void {
  if (!canAct(actor, action)) {
    const who = actor.type === "CONTACT" ? "a customer" : actor.role ? `a ${humanize(actor.role)}` : "this user";
    throw new ForbiddenError(`${who[0].toUpperCase()}${who.slice(1)} cannot ${humanize(action)}`);
  }
}
