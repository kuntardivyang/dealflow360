// Owner: B. Report filters (PDF A7): period, rep, approval status, product or category.
import { z } from "zod";
import { zId, zISODate } from "./common";

export const reportFilterSchema = z
  .object({
    period: z.enum(["today", "week", "month", "custom"]).default("month"),
    from: zISODate.optional(),
    to: zISODate.optional(),
    repUserId: zId.optional(),
    approval: z.enum(["all", "pending", "approved", "rejected"]).default("all"),
    productId: zId.optional(),
    categoryId: zId.optional(),
  })
  .refine((v) => v.period !== "custom" || (v.from && v.to), { path: ["from"], message: "Pick both dates" });

export type ReportFilterInput = z.infer<typeof reportFilterSchema>;
