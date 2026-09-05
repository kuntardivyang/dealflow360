import { describe, expect, it } from "vitest";
import { collectKeys, toPortalQuotation, type PortalQuotationSource } from "@/lib/dto/portal";

// A row as the service loads it, deliberately carrying internal fields that must be dropped.
const raw = {
  id: 7,
  publicId: "abcDEF123456",
  number: "Q-2026-0003",
  status: "SENT" as const,
  repUserId: 4,
  costTotal: 432000_00,
  marginBp: 2017,
  riskScore: 42,
  riskBreakdown: { worstOverageBp: 800 },
  approvalVersion: 1,
  netTotal: 541120_00,
  taxTotal: 97401_60,
  total: 638521_60,
  confirmedAt: null,
  customer: { name: "Acme Corp", tierId: 3 },
  lines: [
    { id: 1, description: 'Laptop 14"', qty: 10, unitPrice: 60000_00, unitCost: 42000_00, discountBp: 1200, effectiveDiscountBp: 1200, ceilingBp: 1500, total: 623040_00, taxBp: 1800 },
    { id: 2, description: "Setup Service", qty: 2, unitPrice: 8000_00, unitCost: 6000_00, discountBp: 1800, effectiveDiscountBp: 1800, ceilingBp: 1000, total: 15481_60, taxBp: 1800 },
  ],
  portalRequests: [
    { id: 11, type: "COMMENT" as const, lineId: 2, message: "Can we push this to next month?", proposedDiscountBp: null, status: "OPEN" as const, responseNote: null, createdAt: new Date("2026-09-05T12:00:00Z"), respondedById: null },
  ],
};
// Cast on purpose: the row carries internal columns the mapper must ignore.
const source = raw as unknown as PortalQuotationSource;

const FORBIDDEN = /cost|margin|risk|approval|rep|warehouse|internal|ceiling|overage/i;

describe("toPortalQuotation", () => {
  it("emits exactly the whitelisted keys and nothing internal", () => {
    const dto = toPortalQuotation(source);
    expect(Object.keys(dto).sort()).toEqual(
      ["canConfirm", "confirmedAt", "customerName", "lines", "netTotal", "number", "publicId", "requests", "status", "taxTotal", "total"].sort(),
    );
    expect(Object.keys(dto.lines[0]).sort()).toEqual(["discountBp", "id", "lineTotal", "name", "qty", "taxBp", "unitPrice"]);
    expect(Object.keys(dto.requests[0]).sort()).toEqual(["createdAt", "id", "lineId", "message", "proposedDiscountBp", "responseNote", "status", "type"]);
    for (const key of collectKeys(dto)) expect(key).not.toMatch(FORBIDDEN);
    expect(JSON.stringify(dto)).not.toMatch(/42000|2017|"riskScore"|repUserId|ceilingBp/);
  });

  it("maps statuses to the four customer labels and disables confirm while a counter is open", () => {
    expect(toPortalQuotation(source)).toMatchObject({ status: "Sent", canConfirm: true });
    expect(toPortalQuotation({ ...source, status: "UNDER_NEGOTIATION" })).toMatchObject({ status: "Under Negotiation", canConfirm: true });
    expect(toPortalQuotation({ ...source, status: "PENDING_APPROVAL" })).toMatchObject({ status: "Awaiting internal approval", canConfirm: false });
    expect(toPortalQuotation({ ...source, status: "CONFIRMED" })).toMatchObject({ status: "Confirmed", canConfirm: false });
    expect(toPortalQuotation({ ...source, status: "FULFILLMENT" }).status).toBe("Confirmed");
    const withCounter = { ...source, portalRequests: [{ ...source.portalRequests[0], type: "COUNTER_DISCOUNT" as const, proposedDiscountBp: 2500 }] };
    expect(toPortalQuotation(withCounter).canConfirm).toBe(false);
  });

  it("is a snapshot of the customer-facing shape", () => {
    expect(toPortalQuotation(source)).toMatchInlineSnapshot(`
      {
        "canConfirm": true,
        "confirmedAt": null,
        "customerName": "Acme Corp",
        "lines": [
          {
            "discountBp": 1200,
            "id": 1,
            "lineTotal": 62304000,
            "name": "Laptop 14"",
            "qty": 10,
            "taxBp": 1800,
            "unitPrice": 6000000,
          },
          {
            "discountBp": 1800,
            "id": 2,
            "lineTotal": 1548160,
            "name": "Setup Service",
            "qty": 2,
            "taxBp": 1800,
            "unitPrice": 800000,
          },
        ],
        "netTotal": 54112000,
        "number": "Q-2026-0003",
        "publicId": "abcDEF123456",
        "requests": [
          {
            "createdAt": "2026-09-05T12:00:00.000Z",
            "id": 11,
            "lineId": 2,
            "message": "Can we push this to next month?",
            "proposedDiscountBp": null,
            "responseNote": null,
            "status": "OPEN",
            "type": "COMMENT",
          },
        ],
        "status": "Sent",
        "taxTotal": 9740160,
        "total": 63852160,
      }
    `);
  });
});
