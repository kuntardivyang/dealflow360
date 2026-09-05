// Owner: B. The only shape that leaves the server for a customer. Built by an explicit
// pick, never by spreading a database row, so cost, margin, risk, approvals, rep,
// warehouse, ceiling and overage information can never reach the portal. The snapshot
// test in __tests__/portal.test.ts guards the key list.
import { portalStatusLabel, type PortalQuotationDTO, type PortalRequestStatus, type PortalRequestType, type QuotationStatus } from "@/lib/contract";

export interface PortalQuotationSource {
  publicId: string;
  number: string;
  status: QuotationStatus;
  netTotal: number;
  taxTotal: number;
  total: number;
  confirmedAt: Date | null;
  customer: { name: string } | null;
  lines: { id: number; description: string; qty: number; unitPrice: number; discountBp: number; total: number; taxBp: number }[];
  portalRequests: {
    id: number;
    type: PortalRequestType;
    lineId: number | null;
    message: string | null;
    proposedDiscountBp: number | null;
    status: PortalRequestStatus;
    responseNote: string | null;
    createdAt: Date;
  }[];
}

export function toPortalQuotation(q: PortalQuotationSource): PortalQuotationDTO {
  const openCounter = q.portalRequests.some((r) => r.type === "COUNTER_DISCOUNT" && r.status === "OPEN");
  return {
    publicId: q.publicId,
    number: q.number,
    customerName: q.customer?.name ?? "",
    status: portalStatusLabel(q.status),
    lines: q.lines.map((l) => ({
      id: l.id,
      name: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountBp: l.discountBp,
      lineTotal: l.total,
      taxBp: l.taxBp,
    })),
    netTotal: q.netTotal,
    taxTotal: q.taxTotal,
    total: q.total,
    requests: q.portalRequests.map((r) => ({
      id: r.id,
      type: r.type,
      lineId: r.lineId,
      message: r.message,
      proposedDiscountBp: r.proposedDiscountBp,
      status: r.status,
      responseNote: r.responseNote,
      createdAt: r.createdAt.toISOString(),
    })),
    canConfirm: (q.status === "SENT" || q.status === "UNDER_NEGOTIATION") && !openCounter,
    confirmedAt: q.confirmedAt ? q.confirmedAt.toISOString() : null,
  };
}

/** Every key at every depth of a DTO, for the forbidden-word test. */
export function collectKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => collectKeys(v, prefix));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [`${prefix}${k}`, ...collectKeys(v, `${prefix}${k}.`)]);
  }
  return [];
}
