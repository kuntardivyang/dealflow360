// Owner: A. Mid-cycle changes and cancellation of a subscription.
import { z } from "zod";
import { zId, zISODate, zQty, zReason } from "./common";

export const changeQuantitySchema = z.object({ subscriptionId: zId, newQty: zQty, effectiveDate: zISODate });

export const cancelSubscriptionSchema = z.object({ subscriptionId: zId, effectiveDate: zISODate.optional(), reason: zReason });

export type ChangeQuantityInput = z.infer<typeof changeQuantitySchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
