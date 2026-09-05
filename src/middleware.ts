// Owner: B. Session gates, on the Node runtime so they can check the database.
// Internal pages need a valid df_session; portal pages need a valid df_portal. Each side
// reads only its own cookie, and an invalid one is redirected before any page renders,
// so no quotation data is ever streamed to a browser that is not logged in.
import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_COOKIE, SESSION_COOKIE } from "@/lib/auth/constants";
import { BACKEND_ROLES } from "@/lib/contract";
import { prisma } from "@/lib/db";

const PORTAL_OPEN = ["/portal/login", "/portal/auth"];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const portal = pathname === "/portal" || pathname.startsWith("/portal/");
  if (portal && PORTAL_OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const cookieName = portal ? PORTAL_COOKIE : SESSION_COOKIE;
  const token = req.cookies.get(cookieName)?.value;
  if (portal) {
    if (token && (await portalSessionValid(token))) return NextResponse.next();
  } else if (token) {
    const role = await sessionRole(token);
    if (role) {
      // The back-end configuration area is for Admin, Sales Manager and Finance only.
      if (pathname.startsWith("/admin") && !BACKEND_ROLES.includes(role)) {
        const home = req.nextUrl.clone();
        home.pathname = "/dashboard";
        home.search = "?forbidden=admin";
        return NextResponse.redirect(home);
      }
      return NextResponse.next();
    }
  }

  const url = req.nextUrl.clone();
  const next = `${pathname}${search}`;
  url.pathname = portal ? "/portal/login" : "/login";
  const home = portal ? "/portal" : "/dashboard";
  url.search = next !== home && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  const res = NextResponse.redirect(url);
  if (token) res.cookies.delete({ name: cookieName, path: portal ? "/portal" : "/" });
  return res;
}

/** The user's role for a live session, or null when the session is missing, expired or the user is inactive. */
async function sessionRole(token: string) {
  const s = await prisma.session.findUnique({ where: { token }, select: { expiresAt: true, user: { select: { isActive: true, role: true } } } });
  return s && s.expiresAt > new Date() && s.user.isActive ? s.user.role : null;
}

async function portalSessionValid(token: string): Promise<boolean> {
  const s = await prisma.portalSession.findUnique({ where: { token }, select: { expiresAt: true, contact: { select: { customer: { select: { archivedAt: true } } } } } });
  return !!s && s.expiresAt > new Date() && s.contact.customer.archivedAt === null;
}

export const config = {
  runtime: "nodejs",
  // Everything except the internal auth pages, API routes, Next internals and static files.
  matcher: ["/((?!login|signup|api|_next|favicon.ico|.*\\..*).*)"],
};
