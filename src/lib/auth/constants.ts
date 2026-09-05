// Owner: B. Cookie names and lifetimes. No imports, so the middleware (edge runtime)
// can use them without pulling in Prisma.
export const SESSION_COOKIE = "df_session"; // internal users, path /
export const PORTAL_COOKIE = "df_portal"; // customer contacts, path /portal
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
