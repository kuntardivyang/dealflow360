// Owner: B. Manager / Finance decision on one approval step.
import { z } from "zod";
import { zId, zNote } from "./common";

export const approvalDecisionSchema = z
  .object({
    requestId: zId,
    stepId: zId,
    decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
    note: zNote.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "APPROVE" && (!v.note || v.note.trim().length < 3)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "A reason is required to reject or return" });
    }
  });

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
