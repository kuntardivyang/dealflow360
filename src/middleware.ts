// Owner: B. Session gate for every internal page. Runs on the Node runtime so it can
// check the token in the database: an invalid or expired df_session is redirected to
// /login before any page renders, so no quotation data is ever streamed to a browser
// that is not logged in. Roles are checked by requireUser() in layouts and actions.
// The customer portal has its own cookie and is never touched here.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { prisma } from "@/lib/db";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await isValidSession(token) : false;
  if (valid) return NextResponse.next();

  const url = req.nextUrl.clone();
  const next = `${url.pathname}${url.search}`;
  url.pathname = "/login";
  url.search = next && next !== "/dashboard" && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  const res = NextResponse.redirect(url);
  if (token) res.cookies.delete(SESSION_COOKIE); // stale cookie: drop it so the next request is a clean anonymous one
  return res;
}

async function isValidSession(token: string): Promise<boolean> {
  const s = await prisma.session.findUnique({
    where: { token },
    select: { expiresAt: true, user: { select: { isActive: true } } },
  });
  return !!s && s.expiresAt > new Date() && s.user.isActive;
}

export const config = {
  runtime: "nodejs",
  // Everything except the auth pages, the customer portal, API routes, Next internals and static files.
  matcher: ["/((?!login|signup|portal|api|_next|favicon.ico|.*\\..*).*)"],
};
