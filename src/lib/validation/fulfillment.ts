// Owner: A. Warehouse split acceptance, manual override, shipping, stock receipts.
import { z } from "zod";
import { zId, zQty, zReason } from "./common";

export const acceptSplitSchema = z.object({ quotationId: zId, planId: zId });

export const overrideSplitSchema = z.object({
  quotationId: zId,
  planId: zId, // the proposed plan being replaced
  reason: zReason,
  allocations: z
    .array(z.object({ lineId: zId, warehouseId: zId, qty: zQty }))
    .min(1, "Allocate at least one line"),
});

export const shipSchema = z.object({ shipmentId: zId });

export const stockReceiptSchema = z.object({ warehouseId: zId, productId: zId, qty: zQty, note: z.string().max(200).optional() });

export type AcceptSplitInput = z.infer<typeof acceptSplitSchema>;
export type OverrideSplitInput = z.infer<typeof overrideSplitSchema>;
export type ShipInput = z.infer<typeof shipSchema>;
export type StockReceiptInput = z.infer<typeof stockReceiptSchema>;
