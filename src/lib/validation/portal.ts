// Owner: B. Customer portal: login, requests, confirm. Inputs are keyed by the
// quotation publicId; the service still scopes every query by the session's customer.
import { z } from "zod";
import { zBp, zEmail, zId, zISODate, zName, zNote, zPublicId } from "./common";

export const portalLoginSchema = z.object({ email: zEmail, password: z.string().min(1, "Enter your password") });

export const portalRequestSchema = z
  .object({
    publicId: zPublicId,
    type: z.enum(["COMMENT", "CHANGE_REQUEST", "COUNTER_DISCOUNT"]),
    lineId: zId.optional(),
    message: zNote.optional(),
    proposedDiscountBp: zBp.optional(),
    requestedDeliveryDate: zISODate.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "COUNTER_DISCOUNT") {
      if (v.lineId === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lineId"], message: "Pick a line" });
      if (v.proposedDiscountBp === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["proposedDiscountBp"], message: "Enter the discount you propose" });
    } else if (!v.message || v.message.trim().length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["message"], message: "Write a message" });
    }
  });

export const portalConfirmSchema = z.object({ publicId: zPublicId, fullName: zName });

export type PortalLoginInput = z.infer<typeof portalLoginSchema>;
export type PortalRequestInput = z.infer<typeof portalRequestSchema>;
export type PortalConfirmInput = z.infer<typeof portalConfirmSchema>;
