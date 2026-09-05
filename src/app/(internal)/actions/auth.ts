"use server";

// Owner: B. Login, signup and logout. Signup has no role input: the database default
// (SALES_REP) applies and Admin changes roles later. Both success paths redirect, so
// the redirect must not be wrapped in the try/catch that maps service errors.
import { Prisma } from "@/generated/prisma/client";
import { redirect } from "next/navigation";
import {
  authenticate,
  clearSessionCookie,
  createSession,
  hashPassword,
  safeNextPath,
  setSessionCookie,
} from "@/lib/auth/internal";
import { fail, loginSchema, parseInput, signupSchema, toActionError, type ActionError } from "@/lib/contract";
import { prisma } from "@/lib/db";

export type AuthFormState = ActionError | null;

const formValues = (form: FormData) => Object.fromEntries(Array.from(form.entries()).filter(([k]) => !k.startsWith("$")));

export async function loginAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = parseInput(loginSchema, formValues(form));
  if (!parsed.ok) return parsed;
  let user;
  try {
    user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) return fail("VALIDATION", "Invalid email or password", { password: ["Invalid email or password"] });
    const { token, expiresAt } = await createSession(user.id);
    await setSessionCookie(token, expiresAt);
  } catch (e) {
    return toActionError(e);
  }
  redirect(safeNextPath(String(form.get("next") ?? "")));
}

export async function signupAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = parseInput(signupSchema, formValues(form));
  if (!parsed.ok) return parsed;
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, passwordHash }, // role: database default SALES_REP
    });
    const { token, expiresAt } = await createSession(user.id);
    await setSessionCookie(token, expiresAt);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("VALIDATION", "That email is already registered", { email: ["An account with this email already exists. Log in instead."] });
    }
    return toActionError(e);
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
