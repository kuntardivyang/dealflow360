/**
 * The contract between the two halves of DealFlow360.
 *
 * A (order path: Sales Rep, Finance/Ops, schema) and B (governance: Sales Manager,
 * Admin, Customer portal, auth and shell) both import shared shapes from here and
 * nowhere else. Rules: add, never rename; keep pure types and Zod schemas only,
 * no Prisma queries. If you need something that is not here yet, stub it in your
 * own file with `// TODO(contract)` and ask the owner to add it.
 */
import { z } from "zod";

// Enums are shared with the database. Both the runtime object and the type are exported.
export {
  Role,
  QuotationStatus,
  ApprovalRequestStatus,
  ApprovalStepStatus,
  InvoiceKind,
  InvoiceStatus,
  PortalRequestType,
  PortalRequestStatus,
  AlertType,
  FulfillmentPlanStatus,
  SubscriptionStatus,
  LineType,
  LineSource,
  ProductKind,
  BillingInterval,
  ProrationMode,
  CancelPolicy,
  RefundMethod,
  ActorType,
} from "@/generated/prisma/enums";
import type { Role, QuotationStatus, PortalRequestStatus, PortalRequestType } from "@/generated/prisma/enums";

// Zod schemas by area (owners noted inside each file).
export * from "./validation/common";
export * from "./validation/auth";
export * from "./validation/quotation";
export * from "./validation/approval";
export * from "./validation/portal";
export * from "./validation/fulfillment";
export * from "./validation/billing";
export * from "./validation/subscription";
export * from "./validation/admin";
export * from "./validation/reports";

// ---------------------------------------------------------------------------
// 1. Scalars. Never floats for money or percentages.
// ---------------------------------------------------------------------------

/** Integer paise (60000_00 = INR 60,000.00). */
export type Money = number;
/** Integer basis points (1250 = 12.50 %). */
export type Bp = number;
/** Calendar date as YYYY-MM-DD, no time, no zone. */
export type ISODate = string;

export const APPROVER_ROLES = ["SALES_MANAGER", "FINANCE"] as const satisfies readonly Role[];
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/** Roles allowed to open the backend configuration area. */
export const BACKEND_ROLES: readonly Role[] = ["ADMIN", "SALES_MANAGER", "FINANCE"];
/** Roles allowed to act on fulfillment and billing. */
export const OPS_ROLES: readonly Role[] = ["ADMIN", "FINANCE", "SALES_MANAGER"];

// ---------------------------------------------------------------------------
// 2. Server action results. Every action returns this; nothing throws to the UI.
// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string[]>;
export type ErrorCode = "VALIDATION" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "UNAUTHENTICATED" | "ERROR";

export type ActionError = { ok: false; code: ErrorCode; message: string; fieldErrors?: FieldErrors };
export type ActionResult<T> = { ok: true; data: T } | ActionError;

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (code: ErrorCode, message: string, fieldErrors?: FieldErrors): ActionError => ({
  ok: false,
  code,
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

/** Parse with a Zod schema and flatten issues into per-field messages. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): { ok: true; data: z.infer<S> } | ActionError {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of r.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fail("VALIDATION", "Please fix the highlighted fields", fieldErrors);
}

// Errors thrown inside services. Actions convert them with `toActionError`.
export class ConflictError extends Error {
  readonly code = "CONFLICT" as const;
}
export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
}
export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
}
export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED" as const;
}
export class ValidationError extends Error {
  readonly code = "VALIDATION" as const;
  constructor(message: string, readonly fieldErrors: FieldErrors = {}) {
    super(message);
  }
}

/** Friendly text for the database CHECK constraints, keyed by the constraint name suffix used in the init migration. */
const CHECK_MESSAGES: Record<string, string> = {
  discount_bp_range: "Discount must be between 0 and 100 percent",
  ceiling_bp_range: "Discount ceiling must be between 0 and 100 percent",
  min_margin_range: "Minimum margin must be between 0 and 100 percent",
  tax_bp_range: "Tax must be between 0 and 100 percent",
  qty_positive: "Quantity must be at least 1",
  prices_non_negative: "Prices cannot be negative",
  non_negative: "Stock cannot go negative or be reserved beyond what is on hand",
  paid_within_total: "Payment cannot exceed the invoice total",
  amount_positive: "Amount must be more than zero",
  weights_sum_100: "Risk weights must add up to 100",
  min_score_range: "Minimum score must be between 0 and 100",
  period_order: "The period end must not be before its start",
  periods_positive: "A plan needs at least one period",
};

/** Database and Prisma errors, recognised by shape so this file stays free of Prisma imports. */
function fromDatabaseError(e: unknown): ActionError | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: string }).code;
  const meta = (e as { meta?: { target?: string[] | string; field_name?: string } }).meta;
  const message = String((e as { message?: string }).message ?? "");
  if (code === "P2002") {
    const target = Array.isArray(meta?.target) ? meta?.target.join(", ") : meta?.target;
    return fail("VALIDATION", "A record with this value already exists", target ? { [String(target)]: ["Already in use"] } : undefined);
  }
  if (code === "P2003") return fail("VALIDATION", "A referenced record no longer exists. Refresh and try again.");
  if (code === "P2025") return fail("NOT_FOUND", "The record was not found. It may have been changed or removed.");
  const check = message.match(/violates check constraint "([^"]+)"/);
  if (check) {
    const key = Object.keys(CHECK_MESSAGES).find((k) => check[1].endsWith(k));
    return fail("VALIDATION", key ? CHECK_MESSAGES[key] : "A value is outside the allowed range");
  }
  if (/PrismaClientValidationError|Argument .* is missing|Invalid value for argument/.test(message)) {
    return fail("VALIDATION", "Some of the values sent were not valid");
  }
  return null;
}

export function toActionError(e: unknown): ActionError {
  if (e instanceof ValidationError) return fail("VALIDATION", e.message, e.fieldErrors);
  if (e instanceof ConflictError || e instanceof ForbiddenError || e instanceof NotFoundError || e instanceof UnauthenticatedError)
    return fail(e.code, e.message);
  return fromDatabaseError(e) ?? fail("ERROR", "Something went wrong. Please try again.");
}

/** Query string for a redirect after a failed form action: message plus every field error. */
export function errorQuery(r: ActionError): string {
  const detail = r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" ") : "";
  return `?error=${encodeURIComponent(`${r.message}${detail ? ` ${detail}` : ""}`)}`;
}

// ---------------------------------------------------------------------------
// 3. Sessions and actors
// ---------------------------------------------------------------------------

/** Internal user resolved from the df_session cookie. Role is read from the database every request. */
export type SessionUser = { id: number; name: string; email: string; role: Role; managerId: number | null };
/** Portal contact resolved from the df_portal cookie. */
export type PortalUser = { contactId: number; contactName: string; customerId: number; customerName: string };

/** Who did something, stored on every audit row. */
export type Actor = { type: "USER" | "CONTACT" | "SYSTEM"; id: number | null; name: string; role?: string };
export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", id: null, name: "System" };
export const actorFromUser = (u: SessionUser): Actor => ({ type: "USER", id: u.id, name: u.name, role: u.role });
export const actorFromPortal = (p: PortalUser): Actor => ({ type: "CONTACT", id: p.contactId, name: `${p.contactName} (${p.customerName})` });

// ---------------------------------------------------------------------------
// 4. Domain shapes. Pure functions in src/domain take and return only these.
// ---------------------------------------------------------------------------

// totals (A)
export interface LineInput {
  lineId: number;
  unitPrice: Money;
  qty: number;
  discountBp: Bp;
  unitCost: Money;
  taxBp: Bp;
}
export interface LineTotals {
  lineId: number;
  effectiveDiscountBp: Bp;
  gross: Money;
  discountAmount: Money;
  net: Money;
  tax: Money;
  total: Money;
  cost: Money;
}
export interface Totals {
  lines: LineTotals[];
  grossTotal: Money;
  discountTotal: Money;
  netTotal: Money;
  taxTotal: Money;
  total: Money;
  costTotal: Money;
  marginBp: Bp | null; // null when netTotal is 0
}

// risk (B). Weights and normalisers come from the RiskConfig row, never constants.
export interface RiskLine extends LineInput {
  categoryCeilingBp: Bp | null;
}
export interface RiskWeights {
  wWorst: number; // integer percent, e.g. 50
  wBlended: number; // 40
  wMargin: number; // 10
  normWorstBp: Bp; // 1000
  normBlendedBp: Bp; // 500
  normMarginBp: Bp; // 1000
  floorMarginBp: Bp; // 2000
}
export interface RiskLineResult {
  lineId: number;
  effectiveDiscountBp: Bp;
  ceilingBp: Bp;
  overageBp: Bp;
}
export interface RiskResult {
  score: number; // 0..100 integer
  worstOverageBp: Bp;
  blendedOverageBp: Bp; // value weighted
  marginBp: Bp | null;
  marginPenaltyBp: Bp;
  lines: RiskLineResult[];
}
export type RiskBand = "LOW" | "MEDIUM" | "HIGH";
export const riskBand = (score: number): RiskBand => (score >= 50 ? "HIGH" : score > 0 ? "MEDIUM" : "LOW");

// routing (B)
export interface RoutingRule {
  sequence: number;
  minScore: number;
  maxWorstOverageBp: Bp | null;
  maxOrderTotal: Money | null;
  chain: ApproverRole[];
}
/** What the builder shows before confirm: the score and the chain it would trigger. */
export interface RiskPreview extends RiskResult {
  chain: ApproverRole[];
  band: RiskBand;
}

// split (A)
export interface DemandLine {
  lineId: number;
  productId: number;
  qty: number;
  unitPrice: Money;
}
export interface StockRow {
  stockLevelId: number;
  warehouseId: number;
  productId: number;
  available: number; // onHand - reserved
}
export interface WarehouseInfo {
  id: number;
  name: string;
  shipCostWeight: Money;
  priority: number;
}
export interface SplitAllocation {
  lineId: number;
  productId: number;
  qty: number;
}
export interface SplitPlan {
  shipments: { warehouseId: number; lines: SplitAllocation[]; estCost: Money }[];
  backorders: SplitAllocation[];
  shipmentCount: number;
  estCost: Money;
}

// proration (A)
export interface ProrateInput {
  periodStart: ISODate;
  periodEnd: ISODate;
  changeDate: ISODate;
  unitPrice: Money;
  discountBp: Bp;
  oldQty: number;
  newQty: number;
  mode: "DAY_BASED" | "NONE";
  billChangeDay: boolean;
}
export interface ProrateResult {
  daysInPeriod: number;
  remainingDays: number;
  credit: Money;
  charge: Money;
  net: Money; // charge - credit; negative means a credit note
}
export interface SchedulePeriod {
  periodStart: ISODate;
  periodEnd: ISODate;
  billDate: ISODate;
  net: Money;
  tax: Money;
  total: Money;
}

// deal health (B)
export interface OpenQuote {
  quotationId: number;
  repUserId: number;
  status: QuotationStatus;
  lastActivityAt: Date;
  effectiveDiscountBp: Bp;
}
export interface SlipRow {
  quotationId: number;
  promisedDate: ISODate;
  expectedDate: ISODate | null;
  shipped: boolean;
}
export interface HealthConfig {
  stalledDays: number;
  anomalyZ: number;
  anomalyAbsBp: Bp;
  minHistory: number;
}
export interface HealthAlert {
  quotationId: number;
  type: "STALLED" | "DISCOUNT_ANOMALY" | "DELIVERY_SLIPPAGE";
  severity: number;
  message: string;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 5. Status labels and the portal view
// ---------------------------------------------------------------------------

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT: "Sent",
  UNDER_NEGOTIATION: "Negotiation",
  CONFIRMED: "Confirmed",
  FULFILLMENT: "Fulfillment",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

/** Statuses a customer may see in the portal. DRAFT, APPROVED and REJECTED are never visible. */
export const PORTAL_VISIBLE_STATUSES: readonly QuotationStatus[] = [
  "SENT",
  "UNDER_NEGOTIATION",
  "PENDING_APPROVAL",
  "CONFIRMED",
  "FULFILLMENT",
  "PAID",
];
export type PortalStatusLabel = "Sent" | "Under Negotiation" | "Awaiting internal approval" | "Confirmed";
export function portalStatusLabel(s: QuotationStatus): PortalStatusLabel {
  if (s === "SENT") return "Sent";
  if (s === "UNDER_NEGOTIATION") return "Under Negotiation";
  if (s === "PENDING_APPROVAL") return "Awaiting internal approval";
  return "Confirmed";
}

/**
 * The only shape that leaves the server for a customer. Built by an explicit pick
 * in src/lib/dto/portal.ts. Must never contain cost, margin, risk, approval,
 * rep, warehouse, ceiling or overage information.
 */
export interface PortalQuotationDTO {
  publicId: string;
  number: string;
  customerName: string;
  status: PortalStatusLabel;
  lines: { id: number; name: string; qty: number; unitPrice: Money; discountBp: Bp; lineTotal: Money; taxBp: Bp }[];
  netTotal: Money;
  taxTotal: Money;
  total: Money;
  requests: {
    id: number;
    type: PortalRequestType;
    lineId: number | null;
    message: string | null;
    proposedDiscountBp: Bp | null;
    status: PortalRequestStatus;
    responseNote: string | null;
    createdAt: string;
  }[];
  canConfirm: boolean;
  confirmedAt: string | null;
}

// ---------------------------------------------------------------------------
// 6. Server action signatures. Each side implements its interface in
//    src/app/(internal)/actions/<name>.ts (portal ones under src/app/portal).
// ---------------------------------------------------------------------------

export type QuotationRef = { id: number; publicId: string; number: string; status: QuotationStatus; version: number };
export type QuotationTotalsView = { totals: Totals; risk: RiskPreview; version: number };
export type ConfirmOutcome = QuotationRef & { chain: ApproverRole[]; requestId: number | null };

export interface QuotationActions {
  createQuotation(input: unknown): Promise<ActionResult<QuotationRef>>;
  addLine(input: unknown): Promise<ActionResult<QuotationTotalsView>>;
  updateLine(input: unknown): Promise<ActionResult<QuotationTotalsView>>;
  removeLine(input: unknown): Promise<ActionResult<QuotationTotalsView>>;
  setOrderDiscount(input: unknown): Promise<ActionResult<QuotationTotalsView>>;
  /** The single confirm. APPROVED when routing returns [], else PENDING_APPROVAL. */
  confirmQuotation(input: unknown): Promise<ActionResult<ConfirmOutcome>>;
  sendToCustomer(input: unknown): Promise<ActionResult<QuotationRef & { portalUrl: string }>>;
  respondToRequest(input: unknown): Promise<ActionResult<QuotationRef>>;
}

export interface ApprovalActions {
  decide(input: unknown): Promise<ActionResult<QuotationRef & { auditLogId: number }>>;
}

export interface PortalActions {
  login(input: unknown): Promise<ActionResult<{ redirectTo: string }>>;
  submitRequest(input: unknown): Promise<ActionResult<PortalQuotationDTO>>;
  confirm(input: unknown): Promise<ActionResult<PortalQuotationDTO>>;
}

export interface FulfillmentActions {
  acceptSplit(input: unknown): Promise<ActionResult<QuotationRef & { planId: number }>>;
  overrideSplit(input: unknown): Promise<ActionResult<QuotationRef & { planId: number }>>;
  ship(input: unknown): Promise<ActionResult<{ shipmentId: number }>>;
  receiveStock(input: unknown): Promise<ActionResult<{ stockLevelId: number; promptIds: number[] }>>;
}

export interface BillingActions {
  recordPayment(input: unknown): Promise<ActionResult<{ invoiceId: number; status: string; paidAmount: Money; due: Money }>>;
}

export interface SubscriptionActions {
  changeQuantity(input: unknown): Promise<ActionResult<ProrateResult & { invoiceId: number | null; creditNoteId: number | null }>>;
  cancel(input: unknown): Promise<ActionResult<{ subscriptionId: number; creditNoteId: number | null }>>;
}

// ---------------------------------------------------------------------------
// 7. Transitions A needs in B's quotation state machine (src/lib/state).
//    Listed here so both sides agree on action names.
// ---------------------------------------------------------------------------

export const QUOTATION_ACTIONS = [
  "EDIT_LINES", // DRAFT -> DRAFT; APPROVED/SENT/UNDER_NEGOTIATION -> DRAFT (supersedes approval)
  "CONFIRM", // DRAFT -> APPROVED | PENDING_APPROVAL
  "APPROVE_STEP", // PENDING_APPROVAL -> PENDING_APPROVAL | APPROVED | SENT (negotiation)
  "REJECT", // PENDING_APPROVAL -> REJECTED | SENT (negotiation)
  "RETURN", // PENDING_APPROVAL -> DRAFT
  "REVISE", // REJECTED -> DRAFT
  "SEND", // APPROVED -> SENT
  "PORTAL_REQUEST", // SENT | UNDER_NEGOTIATION -> UNDER_NEGOTIATION | PENDING_APPROVAL
  "REP_RESPOND", // UNDER_NEGOTIATION -> SENT | UNDER_NEGOTIATION | PENDING_APPROVAL
  "PORTAL_CONFIRM", // SENT | UNDER_NEGOTIATION -> CONFIRMED | PENDING_APPROVAL
  "ACCEPT_SPLIT", // CONFIRMED -> FULFILLMENT
  "SHIP", // FULFILLMENT -> FULFILLMENT
  "RECORD_PAYMENT", // CONFIRMED | FULFILLMENT -> PAID when every invoice is paid
] as const;
export type QuotationAction = (typeof QUOTATION_ACTIONS)[number];
