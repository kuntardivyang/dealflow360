// Owner: B. Report filters (PDF A7): period, rep, approval status, product or category.
import { z } from "zod";
import { zId, zISODate } from "./common";

// The filter UI is a plain GET form, so every field is submitted on every Apply:
// an unused date input and an unselected dropdown both arrive as "". `.optional()`
// only tolerates `undefined`, so without this an empty field would fail the whole
// object and silently reset every filter back to its default.
const dropBlanks = (v: unknown): unknown =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, value]) => value !== "" && value !== undefined))
    : v;

export const reportFilterSchema = z.preprocess(
  dropBlanks,
  z
    .object({
      period: z.enum(["today", "week", "month", "custom"]).default("month"),
      from: zISODate.optional(),
      to: zISODate.optional(),
      repUserId: zId.optional(),
      approval: z.enum(["all", "pending", "approved", "rejected"]).default("all"),
      productId: zId.optional(),
      categoryId: zId.optional(),
    })
    .refine((v) => v.period !== "custom" || (v.from && v.to), { path: ["from"], message: "Pick both dates" }),
);

export type ReportFilterInput = z.infer<typeof reportFilterSchema>;
