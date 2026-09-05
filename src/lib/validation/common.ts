// Owner: A. Shared primitives used by every other schema.
import { z } from "zod";

/** Integer paise. */
export const zMoney = z.number().int().min(0, "Amount cannot be negative");
/** Integer basis points, 0..100 percent. */
export const zBp = z
  .number()
  .int()
  .min(0, "Discount cannot be negative")
  .max(10000, "Discount cannot exceed 100 percent");
/** Whole-number percent typed by a user (e.g. "12"), converted to basis points. */
export const zPercentToBp = z.coerce
  .number()
  .min(0, "Cannot be negative")
  .max(100, "Cannot exceed 100")
  .transform((p) => Math.round(p * 100));
export const zQty = z.coerce.number().int().min(1, "Quantity must be at least 1").max(100000);
export const zId = z.coerce.number().int().positive();
export const zVersion = z.coerce.number().int().min(1);
export const zPublicId = z.string().regex(/^[A-Za-z0-9_-]{12}$/, "Invalid id");
export const zISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zEmail = z.string().trim().toLowerCase().email("Enter a valid email");
export const zPassword = z.string().min(8, "At least 8 characters").max(72);
export const zName = z.string().trim().min(2, "Too short").max(120);
export const zReason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);
export const zNote = z.string().trim().max(2000, "Too long");
