# Screen 11a — Portal Login

## 1. What this screen is

| | |
|---|---|
| Route | `/portal/login` |
| Page file | `src/app/portal/login/page.tsx` |
| Form component | `src/components/portal/login-form.tsx` (client) |
| Server action | `portalLoginAction` — `src/app/portal/actions.ts:24` |
| Auth module | `src/lib/auth/portal.ts` |
| Cookie | `df_portal`, path `/portal` — `src/lib/auth/constants.ts:4` |
| Mockup | Screen 11 header ("DealFlow360 · My Quotation · Messages · Profile") is what you reach *after* this page. The mockup does not draw a portal login; the spec demands one. |
| Spec | Section 4, A1: "Customers access their quotations through a portal login (magic link, or email and password)" — `docs/DealFlow360.txt:104` |

This is the **front door of the second application**. DealFlow360 is really two apps sharing one Next.js process and one database:

* the internal workspace (`/dashboard`, `/quotes`, `/admin`, …), whose users are rows in `app_user`, and
* the customer portal (`/portal/**`), whose users are rows in `customer_contact`.

They do not share a session, a cookie, a table, or a guard. This page mints the second one.

**Honest note on the spec.** The spec offers two options, "magic link, or email and password". Only email + password is built. The magic-link table exists in the schema — `model PortalLoginToken` at `prisma/schema.prisma:288` with `tokenHash`, `contactId`, `quotationId`, `expiresAt`, `usedAt` — and **nothing in `src/` ever reads or writes it**. The only two references anywhere outside the schema are the relation field `CustomerContact.loginTokens` (`prisma/schema.prisma:268`) and the ERD generator's model list (`scripts/erd.ts:30`). There is also an empty folder `src/app/portal/auth/.gitkeep`, and the middleware already whitelists `/portal/auth` as an open path (`src/middleware.ts:10`) — the seam where a magic-link handler was meant to go. It was never built.

---

## 2. Who can open it, and who enforces that

| Who | What happens | Enforced where |
|---|---|---|
| Anyone, no cookies at all | Page renders | `src/middleware.ts:10,15` — `/portal/login` is in `PORTAL_OPEN`, so the middleware returns `NextResponse.next()` before any session check |
| A contact with a valid `df_portal` cookie | Redirected straight to `safePortalNext(next)` (usually `/portal`) | `src/app/portal/login/page.tsx:10` |
| A contact whose `df_portal` token is expired or whose customer is archived | Page renders (they are treated as logged out) | `getPortalUser` returns `null` — `src/lib/auth/portal.ts:50` |
| **An internal user with a valid `df_session` cookie** | Page renders, exactly as if they were a stranger | `src/app/portal/login/page.tsx:10` calls `getPortalUser()`, which reads **only** `PORTAL_COOKIE` (`src/lib/auth/portal.ts:47`). `df_session` is never consulted anywhere under `/portal` |
| An internal user who navigates to `/portal/q/<id>` with only `df_session` | Redirected here with `?next=/portal/q/<id>` | `src/middleware.ts:19-20` (no valid `df_portal`) then `:37` |

### Why the two worlds cannot be confused

This is the mechanism the spec's hardest requirement rests on, so read it slowly.

**Two cookies, two paths.**

```
df_session   path "/"        src/lib/auth/internal.ts:44   → session.token       → app_user
df_portal    path "/portal"  src/lib/auth/portal.ts:34     → portal_session.token → customer_contact → customer
```

Because `df_portal` is set with `path: "/portal"`, the browser **will not send it** to `/dashboard` or `/quotes` at all. The internal side cannot see it even by accident.

`df_session` has `path: "/"`, so the browser *does* send it to `/portal/...`. That is the dangerous direction, and it is closed by a single decision at `src/middleware.ts:17`:

```ts
const cookieName = portal ? PORTAL_COOKIE : SESSION_COOKIE;
```

`portal` is computed once at `:14` purely from the URL (`pathname === "/portal" || pathname.startsWith("/portal/")`). One cookie name is picked. There is **no `||`, no fallback, no "try the other one"**. Lines `:19-33` are an `if (portal) { … } else if (token) { … }` — the two branches never touch each other's cookie:

* portal branch (`:19-20`) → `portalSessionValid(token)` → `prisma.portalSession.findUnique` (`:52`)
* internal branch (`:21-32`) → `sessionRole(token)` → `prisma.session.findUnique` (`:47`)

Different tables. A `session.token` value simply does not exist in `portal_session`, so even if you pasted an internal token into a cookie named `df_portal`, `findUnique` returns `null` and you are redirected.

The same split is repeated at the page layer, so the middleware is not the only line of defence: every portal page calls `requirePortal()` (`src/lib/auth/portal.ts:55`) and every portal server action calls `requirePortalAction()` (`:62`); neither ever imports anything from `src/lib/auth/internal.ts`.

**Cleanup is also path-scoped.** When a bad cookie is found, `src/middleware.ts:41` deletes it with `path: portal ? "/portal" : "/"` — the exact path it was set with. Visiting `/portal/x` with a stale `df_portal` clears only `df_portal`; your internal `df_session` is untouched, and vice versa. You can be logged into both worlds in one browser at once and neither will ever leak into the other.

---

## 3. Everything on the screen, and where each value comes from

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
|---|---|---|---|---|
| Brand mark, links to `/portal/login` | "DealFlow360" | `src/app/portal/login/page.tsx:14` → `src/components/shell/brand.tsx` | — | Hardcoded |
| "Customer portal" eyebrow | static | `login/page.tsx:19` | — | Hardcoded |
| "Your quotation, ready to review." | static | `login/page.tsx:20` | — | Hardcoded |
| Three bullet points | "Line-by-line prices with tax included", … | `login/page.tsx:27,30,33` | — | Hardcoded |
| "Log in" card title + subtitle | static | `login/page.tsx:39-40` | — | Hardcoded |
| Email field | `acme@test.com` (also the placeholder) | `src/components/portal/login-form.tsx:18` | you type it → matched against `customer_contact.email` | The seed creates it: `prisma/seed/a-customers.ts:19,24` creates Acme Corp with contact `acme@test.com` / "Nisha Acme" |
| Password field | `demo1234` | `login-form.tsx:27` | you type it → compared to `customer_contact.password_hash` | `prisma/seed/a-customers.ts` bcrypt-hashes `demo1234` for every seeded contact (`prisma/seed.ts:25` prints this) |
| Field error under email | "Enter a valid email" | `login-form.tsx:20` from `state.fieldErrors.email` | — | `zEmail` in `src/lib/validation/common.ts:31`, surfaced by `parseInput` (`src/lib/contract.ts:86-95`) |
| Field error under password | "Invalid email or password" | `login-form.tsx:29` | — | `src/app/portal/actions.ts:29` — deliberately attached to `password`, and identical for unknown email and wrong password |
| Banner error (no field errors) | "Something went wrong. Please try again." | `login-form.tsx:35` | — | `toActionError` fallback, `src/lib/contract.ts:158` |
| "Log In" button, spinner while pending | — | `login-form.tsx:39-42` | — | `useActionState`'s `pending` flag (`:11`) |
| Small print under the button | "Your access details were shared with the quotation link…" | `login-form.tsx:43` | — | Hardcoded. This is the honest stand-in for the magic link that was never built |
| Footer | "Internal user? Sign in at the DealFlow360 workspace instead." | `login/page.tsx:46` | — | Hardcoded. It is **text, not a link** — the only real link between the two worlds points the other way, from the internal login at `src/components/auth/auth-form.tsx:117` |

**Seeded contacts you can log in with** (all password `demo1234`, all created by `prisma/seed/a-customers.ts`):

| Email | `customer_contact.name` | Customer | Tier | `customer_tier.discount_ceiling_bp` |
|---|---|---|---|---|
| `acme@test.com` | Nisha Acme | Acme Corp (Ahmedabad) | Gold | 1500 (15 %) |
| `beta@test.com` | Rahul Beta | Beta Industries (Kolkata) | Silver | 1000 (10 %) |
| `gamma@test.com` | Sana Gamma | Gamma Retail (Pune) | Bronze | 500 (5 %) |

*(Verified read-only against the running database: `customer_contact` ids 1–3. Row id 4, `mgr-mtomm7q6@test.com` for "MgrCo mtomm7q6", and customers 4–8 are leftovers from earlier automated test runs, not seed data — ignore them.)*

---

## 4. The queries this page runs

**On render (server component):**

1. `getPortalUser()` — `src/lib/auth/portal.ts:46-52`
   ```sql
   SELECT … FROM portal_session
     JOIN customer_contact ON …
     JOIN customer ON …
    WHERE portal_session.token = $1
   ```
   Runs only if a `df_portal` cookie exists (`:48` returns `null` first otherwise). If it resolves, the page redirects instead of rendering (`login/page.tsx:10`).

**On submit (`portalLoginAction`):**

2. `prisma.customerContact.findUnique({ where: { email }, include: { customer: true } })` — `src/lib/auth/portal.ts:16`. `email` is already trimmed and lowercased twice: by `zEmail` (`src/lib/validation/common.ts:31`) and again at `:16`.
3. `bcrypt.compare(password, c.passwordHash)` — `:18`. No database work; CPU only.
4. `prisma.portalSession.create({ data: { token, contactId, expiresAt } })` — `:25`. `token` comes from `sessionToken()` (`src/lib/ids.ts`), `expiresAt` is `now + SESSION_TTL_MS` = **24 hours** (`src/lib/auth/constants.ts:5`).

**Note what does *not* happen:** no audit row. `src/lib/audit.ts` is never called from any login path, internal or portal. Logins are invisible in the audit trail.

---

## 5. Every condition on this page

| # | Condition | Where | Result |
|---|---|---|---|
| 1 | Path is `/portal/login` or under `/portal/auth` | `src/middleware.ts:15` | Skip all session checks |
| 2 | A valid portal session already exists | `login/page.tsx:10` | `redirect(safePortalNext(next))` |
| 3 | `next` must start with `/portal/` | `src/lib/auth/portal.ts:70` | otherwise `/portal` |
| 4 | `next` must not start with `/portal//` | `:70` | otherwise `/portal` — blocks `//evil.com` protocol-relative open redirects |
| 5 | `next` must not start with `/portal/login` | `:70` | otherwise `/portal` — blocks a redirect loop |
| 6 | Email must parse as an email | `zEmail`, `src/lib/validation/common.ts:31` | `fieldErrors.email` |
| 7 | Password must be non-empty | `portalLoginSchema`, `src/lib/validation/portal.ts:6` | `fieldErrors.password` = "Enter your password" |
| 8 | Contact row must exist for that email | `src/lib/auth/portal.ts:17` | `null` → generic failure |
| 9 | `customer.archivedAt` must be null | `:17` | `null` → generic failure. An archived customer's contacts are locked out immediately, without deleting anything |
| 10 | bcrypt hash must match | `:18` | `null` → generic failure |
| 11 | All three failures (8, 9, 10) return the **same** message | `src/app/portal/actions.ts:29` | "Invalid email or password" — the portal never confirms whether an email is a customer of yours |

**No lockout, no rate limit, no CAPTCHA.** Nothing counts failed attempts. bcrypt's cost factor (10 rounds, `src/lib/auth/internal.ts:15`) is the only brake. Fine for a hackathon build; say so out loud if you are asked.

---

## 6. Every action you can take here

### Log In

| Step | Detail |
|---|---|
| Button | "Log In" — `src/components/portal/login-form.tsx:39` |
| Server action | `portalLoginAction` — `src/app/portal/actions.ts:24` (bound with `useActionState` at `login-form.tsx:11`) |
| Zod schema | `portalLoginSchema` — `src/lib/validation/portal.ts:6` (`email: zEmail`, `password: min(1)`) |
| Service | `authenticatePortal` — `src/lib/auth/portal.ts:15` |
| Guards, in order | 1. `parseInput` shape check (`actions.ts:25`) → 2. contact exists (`portal.ts:17`) → 3. customer not archived (`portal.ts:17`) → 4. bcrypt compare (`portal.ts:18`) |
| Tables written | `portal_session` — one INSERT (`portal.ts:25`): `token`, `contact_id`, `expires_at`, `created_at` |
| Cookie written | `df_portal` — httpOnly, sameSite lax, `secure` only in production, **path `/portal`**, `expires = expiresAt` (`portal.ts:30-36`) |
| Audit row | **None** |
| What changes on screen | `redirect(safePortalNext(next))` — `actions.ts:35`. Straight to `/portal` (Screen 11c list) or back to the quotation you were trying to open |

Note the ordering quirk at `actions.ts:32-35`: `redirect()` is called **after** the `try/catch`, not inside it. That is required — Next implements `redirect()` by throwing, and a `catch` would swallow it into a generic "Something went wrong".

### Sign out (from any signed-in portal page, not this one)

| Step | Detail |
|---|---|
| Button | "Sign out" — `src/app/portal/(customer)/layout.tsx:24` |
| Server action | `portalLogoutAction` — `src/app/portal/actions.ts:38` |
| Service | `clearPortalCookie` — `src/lib/auth/portal.ts:39` |
| Tables written | `portal_session` — `deleteMany({ where: { token } })` (`:42`). The row is **destroyed**, not just expired, so a copied cookie is dead immediately |
| Cookie | `df_portal` deleted at path `/portal` (`:43`) |
| Audit row | None |
| Result | `redirect("/portal/login")` |

---

## 7. Scenarios

1. **Nisha logs in normally.** `acme@test.com` / `demo1234`. Schema passes; `customer_contact` id 1 found; `customer.archived_at` is null; bcrypt matches. INSERT into `portal_session` with a fresh token and `expires_at = now + 24h`. `df_portal` set at path `/portal`. Redirect to `/portal`. She now sees Acme Corp's quotations and no one else's.

2. **Wrong password.** bcrypt fails at `portal.ts:18`, `authenticatePortal` returns `null`, `actions.ts:29` returns `fail("VALIDATION", "Invalid email or password", { password: [...] })`. The message renders under the password field (`login-form.tsx:29`). No row written, no cookie set.

3. **Email that is not a customer contact at all.** `findUnique` at `portal.ts:16` returns `null` → exactly the same message as scenario 2. There is no way to tell from the outside whether `someone@else.com` is a customer of this business. That is deliberate.

4. **Archived customer.** Admin sets `customer.archived_at`. Next login attempt: the contact row is found, but `c.customer.archivedAt` is truthy at `portal.ts:17` → `null` → same generic message. Existing sessions die too: `portalSessionValid` in the middleware checks `contact.customer.archivedAt === null` on **every request** (`src/middleware.ts:53`), so an already-open tab is bounced on its next navigation.

5. **Deep link while logged out.** Nisha clicks `/portal/q/PNSv0xq2Vvd0` from an email. Middleware: `portal = true` (`:14`), not in `PORTAL_OPEN`, no `df_portal` cookie → `:37` sets pathname `/portal/login`, `:39` appends `?next=%2Fportal%2Fq%2FPNSv0xq2Vvd0`. She logs in; `safePortalNext` accepts it (starts with `/portal/`, is not `//`, is not `/portal/login`) and `actions.ts:35` redirects her to the quotation she originally wanted.

6. **Open-redirect attempt.** Someone crafts `/portal/login?next=//evil.example.com`. `safePortalNext` (`portal.ts:70`) rejects it — it does not start with `/portal/` — and returns `/portal`. Same for `?next=/dashboard`: the portal will not send you into the internal app.

7. **Already logged in, visits the login page.** `getPortalUser()` resolves at `login/page.tsx:10` → `redirect("/portal")`. The form is never rendered.

8. **Internal user with `df_session` opens `/portal/login`.** The page renders normally. `getPortalUser()` reads only `df_portal` (`portal.ts:47`), which does not exist for them. Their internal session is irrelevant here; to see a portal they must know a contact's password. The footer at `login/page.tsx:46` politely points them back to the workspace.

9. **Internal user with `df_session` opens `/portal/q/<id>` directly.** Middleware `:14` sets `portal = true`; `:17` picks `PORTAL_COOKIE`; `req.cookies.get("df_portal")` is `undefined`; `:19-20` cannot pass; fall through to `:35-42` → redirect to `/portal/login?next=…`. Line `:41` runs only `if (token)`, and `token` is undefined here, so **their `df_session` is not deleted** — they stay logged into the workspace.

10. **Portal contact with `df_portal` opens `/dashboard`.** The browser does not even send `df_portal` (path `/portal`). Middleware `:17` picks `SESSION_COOKIE`, finds nothing, redirects to `/login?next=%2Fdashboard`. At `/login` they have no `app_user` row, so no password will work. The two worlds are not just guarded separately — they have no overlapping credential.

11. **Session expires mid-visit.** 24 hours after login, `expiresAt > new Date()` fails in `portalSessionValid` (`src/middleware.ts:53`). Next navigation redirects to `/portal/login?next=…` and `:41` deletes the stale `df_portal` cookie at path `/portal`. The dead `portal_session` row stays in the table — nothing prunes expired sessions.

12. **Sign out, then press Back.** `clearPortalCookie` deleted the `portal_session` row (`portal.ts:42`), so even a cached cookie value is useless: `findUnique` returns `null` for a token that no longer exists.

---

## 8. Schema behind this screen

```
customer_tier ─┐
               ├─< customer ──< customer_contact ──< portal_session
               │                       │
               │                       └──< portal_login_token   (UNUSED)
               │                       └──< portal_request       (Screen 11b)
```

| Table | Column | Notes |
|---|---|---|
| `customer` | `id`, `name`, `city`, `tier_id`, `archived_at` | `prisma/schema.prisma:236-255`. `archived_at` is the kill switch for every contact under it |
| `customer_contact` | `id`, `customer_id`, `email` **UNIQUE**, `name`, `password_hash`, `is_primary` | `prisma/schema.prisma:257-273`. Email is unique **globally**, not per customer, which is what lets `findUnique({ where: { email } })` work at `portal.ts:16`. `onDelete: Cascade` from `customer` |
| `portal_session` | `id`, `token` **UNIQUE**, `contact_id`, `expires_at`, `created_at` | `prisma/schema.prisma:275-286`. Cascades when the contact is deleted |
| `portal_login_token` | `token_hash` UNIQUE, `contact_id`, `quotation_id`, `expires_at`, `used_at` | `prisma/schema.prisma:288-300`. **Dead table.** No code reads or writes it |
| `session` (internal, for contrast) | `token` UNIQUE, `user_id`, `expires_at` | `prisma/schema.prisma:210-221`. Completely separate table from `portal_session` |

There is no `role` column on `customer_contact`. Every portal contact has exactly the same powers; the only thing that varies is which `customer_id` they hang off, and that one integer is the whole authorisation model of the portal (see Screen 11b, §2).

---

## 9. How this screen connects to the others

* **From the internal login** — `src/components/auth/auth-form.tsx:117` links to `/portal/login`. The only in-app crossing point, and it goes one way.
* **From a rep sending a quotation** — `sendToCustomer` (`src/services/order.service.ts:19-31`) sets `status = SENT`, stamps `sent_at`, and returns `portalUrl: "/portal/q/" + publicId` (`:29`). The rep reads that URL off the quotation detail screen (`src/app/(internal)/quotes/[publicId]/page.tsx:245`) and passes it to the customer by hand. **There is no email in this build** — the comment at `order.service.ts:18` says so.
* **To Screen 11c** (`/portal`, My Quotations) — the default landing page after login.
* **To Screen 11b** (`/portal/q/<publicId>`) — when a `next` parameter survived the login.
* **Middleware** — the same file (`src/middleware.ts`) that guards this page guards Screens 01–14; `:25-30` additionally keeps non-Admin/Manager/Finance roles out of `/admin`, which has nothing to do with the portal but lives in the same `else` branch.

---

## 10. Gotchas

1. **The spec's magic link does not exist.** `PortalLoginToken` is a table with no code. If asked "how does a customer get in", the honest answer is: the rep tells them their email and password out of band. Do not claim magic links work.
2. **`/portal/auth` is whitelisted but empty.** `src/middleware.ts:10` lets anything under `/portal/auth` through with no session check, and `src/app/portal/auth/` contains only `.gitkeep`. Harmless today (Next returns 404), but if anyone ever adds a page there it will be **public by default**. That is the single riskiest line in the portal's routing.
3. **Cookie path is the whole trick.** If someone ever "simplifies" `path: "/portal"` (`portal.ts:34`) to `path: "/"`, the portal cookie would start being sent to internal routes. It still would not authenticate anything (the middleware picks by path, not by which cookies exist), but the isolation guarantee gets much harder to argue. Leave it alone.
4. **`secure: false` in development.** `portal.ts:33` sets `secure: process.env.NODE_ENV === "production"`. Correct for `localhost`, but it means a dev deployment over plain HTTP hands the cookie to anyone on the network.
5. **Expired sessions are never cleaned up.** No cron, no `deleteMany({ where: { expiresAt: { lt: now } } })` anywhere. `portal_session` grows forever. Cosmetic at hackathon scale.
6. **The error message is identical for three different failures** on purpose (unknown email, archived customer, wrong password). If you "improve" it to be more helpful, you turn the login form into a customer-list oracle.
7. **Login is not audited.** Every state change in the app writes an `audit_log` row; authentication does not. "Who looked at this quotation" is not answerable from the audit trail — only "who acted on it".
8. **`portalLoginAction` returns `ActionError | null`, never a success value** — success is expressed as a redirect (`actions.ts:35`). That is why `login-form.tsx:12` only ever reads `state.fieldErrors`.
