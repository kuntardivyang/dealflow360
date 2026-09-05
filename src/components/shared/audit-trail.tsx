import { QUOTATION_STATUS_LABEL } from "@/lib/contract";
import { formatBp, formatDateTime, formatMoney } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type AuditEntry = {
  id: number;
  at: Date;
  actorName: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: number;
  reason: string | null;
  beforeJson: unknown;
  afterJson: unknown;
};

// What each action reads as, in the past tense. Unknown actions fall back to the verb itself.
const ACTION_TEXT: Record<string, string> = {
  CREATE: "created",
  UPDATE: "updated",
  LINE_ADD: "added a line to",
  LINE_UPDATE: "changed a line on",
  LINE_REMOVE: "removed a line from",
  ORDER_DISCOUNT: "changed the order discount on",
  CONFIRM: "confirmed",
  REVISE: "reopened",
  SEND: "sent to the customer",
  APPROVE: "approved a step of",
  REJECT: "rejected",
  RETURN: "returned for revision",
  PORTAL_COMMENT: "commented on",
  PORTAL_CHANGE_REQUEST: "requested a change on",
  PORTAL_COUNTER: "countered the discount on",
  PORTAL_CONFIRM: "confirmed",
  REQUEST_ACCEPT: "accepted the customer request on",
  REQUEST_DECLINE: "declined the customer request on",
  ACCEPT_SPLIT: "accepted the warehouse split for",
  OVERRIDE_SPLIT: "overrode the warehouse split for",
  SHIP: "shipped",
  RECORD_PAYMENT: "recorded a payment on",
  NUDGE: "nudged the rep about",
  ESCALATE: "escalated",
  ROLE_CHANGE: "changed the role of",
};

const FIELD_LABEL: Record<string, string> = {
  number: "Number",
  customer: "Customer",
  status: "Status",
  product: "Product",
  qty: "Quantity",
  discountBp: "Discount",
  orderDiscountBp: "Order discount",
  proposedDiscountBp: "Proposed discount",
  unitPrice: "Unit price",
  total: "Total",
  score: "Risk score",
  chain: "Approval chain",
  requestId: "Request",
  approvalVersion: "Approval version",
  requestVersion: "Approval version",
  step: "Step",
  role: "Role",
  request: "Request status",
  negotiationPending: "Negotiation pending",
  confirmedName: "Confirmed by",
  confirmedBy: "Confirmed by",
  invoicesCreated: "Invoices created",
  planProposed: "Split proposed",
  source: "Source",
  priceRule: "Price rule",
  managerId: "Manager",
  discountCeilingBp: "Discount ceiling",
  minMarginBp: "Minimum margin",
  onHand: "On hand",
  reorderPoint: "Reorder point",
  leadDays: "Lead days",
  shipCostWeight: "Ship cost weighting",
  priority: "Priority",
  name: "Name",
  nudged: "Nudged",
  type: "Type",
};

const STATUS_LABELS: Record<string, string> = { ...QUOTATION_STATUS_LABEL, PENDING: "Pending", RETURNED: "Returned", SUPERSEDED: "Superseded", OPEN: "Open", ACCEPTED: "Accepted", DECLINED: "Declined" };

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (Array.isArray(value)) return value.length ? value.map((v) => formatValue(key, v)).join(" then ") : "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (/Bp$/.test(key)) return formatBp(value);
    if (/price|total|amount|cost|weight|charge|credit|net/i.test(key)) return formatMoney(value);
    return String(value);
  }
  if (typeof value === "string") {
    if (key === "status" || key === "request") return STATUS_LABELS[value] ?? value;
    if (value in ROLE_LABEL) return ROLE_LABEL[value as keyof typeof ROLE_LABEL];
    return value;
  }
  return JSON.stringify(value);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** "Discount: 12% → 18%" for changed fields; "Customer: Gamma Retail" for new values. */
export function describeChange(before: unknown, after: unknown): { label: string; from: string | null; to: string }[] {
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const out: { label: string; from: string | null; to: string }[] = [];
  for (const key of keys) {
    const from = key in b ? formatValue(key, b[key]) : null;
    const to = key in a ? formatValue(key, a[key]) : "–";
    if (from !== null && from === to) continue;
    out.push({ label: FIELD_LABEL[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), from, to });
  }
  return out;
}

export function describeEntry(e: AuditEntry, subject?: string): string {
  const verb = ACTION_TEXT[e.action] ?? e.action.toLowerCase().replaceAll("_", " ");
  const entity = e.entityType.replace(/([A-Z])/g, " $1").trim().toLowerCase();
  const target = subject ?? (e.entityType === "Quotation" || e.entityType === "PortalRequest" || e.entityType === "ApprovalStep" || e.entityType === "ApprovalRequest" || e.entityType === "DealAlert" ? "this quotation" : `${entity} #${e.entityId}`);
  return `${verb} ${target}`;
}

/** Human-readable audit trail: one sentence per entry plus a compact list of what changed. */
export function AuditTrail({ entries, subject, highlightId, className }: { entries: AuditEntry[]; subject?: string; highlightId?: number | string | null; className?: string }) {
  return (
    <ul className={cn("divide-y", className)}>
      {entries.map((e) => {
        const changes = describeChange(e.beforeJson, e.afterJson);
        return (
          <li key={e.id} data-audit-id={e.id} className={cn("grid gap-1 px-1 py-3 text-sm sm:grid-cols-[150px_1fr]", String(e.id) === String(highlightId ?? "") && "rounded-md bg-success/10")}>
            <div className="text-muted-foreground">{formatDateTime(e.at)}</div>
            <div className="min-w-0 space-y-1">
              <p>
                <span className="font-medium">{e.actorName}</span>
                {e.actorRole ? <span className="text-muted-foreground"> ({ROLE_LABEL[e.actorRole as keyof typeof ROLE_LABEL] ?? e.actorRole.toLowerCase().replaceAll("_", " ")})</span> : null} {describeEntry(e, subject)}
              </p>
              {e.reason ? <p className="text-muted-foreground">“{e.reason}”</p> : null}
              {changes.length ? (
                <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {changes.map((c) => (
                    <div key={c.label} className="flex gap-1">
                      <dt>{c.label}:</dt>
                      <dd className="text-foreground">
                        {c.from !== null ? (
                          <>
                            <span className="text-muted-foreground line-through">{c.from}</span> → {c.to}
                          </>
                        ) : (
                          c.to
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
