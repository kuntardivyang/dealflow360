// Owner: A. Mid-cycle changes and cancellation of a subscription.
import { z } from "zod";
import { zId, zISODate, zQty, zReason } from "./common";

export const changeQuantitySchema = z.object({ subscriptionId: zId, newQty: zQty, effectiveDate: zISODate });

export const cancelSubscriptionSchema = z.object({ subscriptionId: zId, effectiveDate: zISODate.optional(), reason: zReason });

/** Odoo 19: Upsell and Renew open a quotation against the running subscription. */
export const startUpsellSchema = z.object({ subscriptionId: zId });
export const startRenewalSchema = z.object({ subscriptionId: zId });

export type ChangeQuantityInput = z.infer<typeof changeQuantitySchema>;
export type StartUpsellInput = z.infer<typeof startUpsellSchema>;
export type StartRenewalInput = z.infer<typeof startRenewalSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
