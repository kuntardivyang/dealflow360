// Owner: A. Sales rep actions on a quotation. Every mutation carries `version`
// for the optimistic lock; a stale version is answered with CONFLICT.
import { z } from "zod";
import { zBp, zId, zISODate, zNote, zQty, zVersion } from "./common";

export const createQuotationSchema = z.object({
  customerId: zId,
  promisedDate: zISODate.optional(),
  notes: zNote.optional(),
});

export const addLineSchema = z.object({
  quotationId: zId,
  version: zVersion,
  productId: zId,
  qty: zQty.default(1),
  discountBp: zBp.default(0),
  planId: zId.optional(), // required by the service for SUBSCRIPTION products
  source: z.enum(["MANUAL", "UPSELL"]).default("MANUAL"),
});

export const updateLineSchema = z.object({
  quotationId: zId,
  version: zVersion,
  lineId: zId,
  qty: zQty.optional(),
  discountBp: zBp.optional(),
});

export const removeLineSchema = z.object({ quotationId: zId, version: zVersion, lineId: zId });

export const setOrderDiscountSchema = z.object({ quotationId: zId, version: zVersion, orderDiscountBp: zBp });

/** The single confirm action. Routing decides APPROVED vs PENDING_APPROVAL. */
export const confirmQuotationSchema = z.object({ quotationId: zId, version: zVersion });

export const sendToCustomerSchema = z.object({ quotationId: zId, version: zVersion });

/** Rep answers a portal request (comment, change request or counter discount). */
export const respondToRequestSchema = z.object({
  quotationId: zId,
  requestId: zId,
  decision: z.enum(["ACCEPT", "DECLINE"]),
  note: zNote.optional(),
});

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type AddLineInput = z.infer<typeof addLineSchema>;
export type UpdateLineInput = z.infer<typeof updateLineSchema>;
export type RemoveLineInput = z.infer<typeof removeLineSchema>;
export type SetOrderDiscountInput = z.infer<typeof setOrderDiscountSchema>;
export type ConfirmQuotationInput = z.infer<typeof confirmQuotationSchema>;
export type SendToCustomerInput = z.infer<typeof sendToCustomerSchema>;
export type RespondToRequestInput = z.infer<typeof respondToRequestSchema>;
