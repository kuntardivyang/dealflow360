// Owner: B. Internal login and signup. Signup has no role field on purpose:
// the database default (SALES_REP) applies and Admin changes roles later.
import { z } from "zod";
import { zEmail, zName, zPassword } from "./common";

export const loginSchema = z.object({ email: zEmail, password: z.string().min(1, "Enter your password") });
export const signupSchema = z.object({ name: zName, email: zEmail, password: zPassword });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
