// TODO(contract): replace with requireUser() from "@/lib/auth/internal" when B lands feature 19.
// Until real sessions exist, the acting user is the seeded rep (override with DEV_USER_EMAIL).
import { UnauthenticatedError, type SessionUser } from "@/lib/contract";
import { prisma } from "@/lib/db";

export async function currentUser(): Promise<SessionUser> {
  const email = process.env.DEV_USER_EMAIL ?? "riya@df.local";
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u || !u.isActive) throw new UnauthenticatedError("Please log in");
  return { id: u.id, name: u.name, email: u.email, role: u.role, managerId: u.managerId };
}
