// Owner: B. Internal authentication: password check, database-backed sessions, the
// df_session cookie and the two guards. The cookie holds an opaque token only; the
// role is read from the user row on every request, so an Admin role change applies
// at once and nothing in the browser can claim a role.
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ForbiddenError, UnauthenticatedError, type Role, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { sessionToken } from "@/lib/ids";
import { getSessionUser, SESSION_COOKIE, SESSION_TTL_MS } from "./session";

export { getSessionUser, SESSION_COOKIE, SESSION_TTL_MS };

export const BCRYPT_ROUNDS = 10;
export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, BCRYPT_ROUNDS);

/** Email + password -> user, or null. One generic failure for unknown email and wrong password alike. */
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const u = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!u || !u.isActive) return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}

/** New session row for a user; returns the opaque token to put in the cookie. */
export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(SESSION_COOKIE);
}

/** Only same-site paths may be used as a post-login destination (no open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login") || next.startsWith("/signup")) {
    return fallback;
  }
  return next;
}

function assertRole(user: SessionUser, roles?: readonly Role[]): void {
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    throw new ForbiddenError("You do not have access to this area");
  }
}

/**
 * Guard for pages and layouts: redirects to /login?next=... when there is no valid
 * session, and to the dashboard when the role may not see the area. The middleware
 * enforces both earlier; this is the belt to its braces.
 */
export async function requireUser(roles?: readonly Role[], nextPath?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  if (roles && roles.length > 0 && !roles.includes(user.role)) redirect("/dashboard?forbidden=1");
  return user;
}

/**
 * Guard for server actions and route handlers: throws instead of redirecting, so the
 * action can answer { ok: false, code: "UNAUTHENTICATED" | "FORBIDDEN" } via toActionError.
 */
export async function requireActionUser(roles?: readonly Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError("Please log in");
  assertRole(user, roles);
  return user;
}
