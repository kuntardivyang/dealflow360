// Owner: B. Customer portal authentication. Separate table (PortalSession), separate
// cookie (df_portal, path /portal), separate guard. An internal df_session is never read
// here and a df_portal cookie is never read by the internal guard, so the two worlds
// cannot be confused even in one browser.
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UnauthenticatedError, type PortalUser } from "@/lib/contract";
import { prisma } from "@/lib/db";
import { sessionToken } from "@/lib/ids";
import { PORTAL_COOKIE, SESSION_TTL_MS } from "./constants";

export { PORTAL_COOKIE };

export async function authenticatePortal(email: string, password: string): Promise<PortalUser | null> {
  const c = await prisma.customerContact.findUnique({ where: { email: email.trim().toLowerCase() }, include: { customer: true } });
  if (!c || c.customer.archivedAt) return null;
  if (!(await bcrypt.compare(password, c.passwordHash))) return null;
  return { contactId: c.id, contactName: c.name, customerId: c.customerId, customerName: c.customer.name };
}

export async function createPortalSession(contactId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.portalSession.create({ data: { token, contactId, expiresAt } });
  return { token, expiresAt };
}

export async function setPortalCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/portal",
    expires: expiresAt,
  });
}

export async function clearPortalCookie(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (token) await prisma.portalSession.deleteMany({ where: { token } });
  jar.delete({ name: PORTAL_COOKIE, path: "/portal" });
}

export async function getPortalUser(): Promise<PortalUser | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.portalSession.findUnique({ where: { token }, include: { contact: { include: { customer: true } } } });
  if (!s || s.expiresAt <= new Date() || s.contact.customer.archivedAt) return null;
  return { contactId: s.contact.id, contactName: s.contact.name, customerId: s.contact.customerId, customerName: s.contact.customer.name };
}

/** Pages: redirect to the portal login. */
export async function requirePortal(nextPath?: string): Promise<PortalUser> {
  const u = await getPortalUser();
  if (!u) redirect(nextPath ? `/portal/login?next=${encodeURIComponent(nextPath)}` : "/portal/login");
  return u;
}

/** Server actions: throw so the action answers { ok: false, code: "UNAUTHENTICATED" }. */
export async function requirePortalAction(): Promise<PortalUser> {
  const u = await getPortalUser();
  if (!u) throw new UnauthenticatedError("Please log in to your portal");
  return u;
}

/** Only portal paths may be used as a post-login destination. */
export function safePortalNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/portal/") || next.startsWith("/portal//") || next.startsWith("/portal/login")) return "/portal";
  return next;
}
