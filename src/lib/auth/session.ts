// Owner: B. Internal session lookup for the df_session cookie.
// The cookie holds only an opaque token; the role is read from the database on
// every request so a role change by Admin takes effect immediately.
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/contract";

export const SESSION_COOKIE = "df_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt <= new Date() || !session.user.isActive) return null;
  const { id, name, email, role, managerId } = session.user;
  return { id, name, email, role, managerId };
}
