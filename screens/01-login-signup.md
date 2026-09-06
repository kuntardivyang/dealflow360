# Screen 01 — Login / Signup

## 1. What this screen is

| | |
|---|---|
| Routes | `/login`, `/signup` |
| Page files | `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx` |
| Shared frame | `src/app/(auth)/layout.tsx` |
| Form component | `src/components/auth/auth-form.tsx` (client) |
| Mockup | Screen 1, "Login / Signup" |
| Type | Neither list nor detail — it is the entry point |

The one screen in the app with **no business data on it**. Its whole job is to turn an email and a password into a `session` row and a cookie. Everything else in DealFlow360 depends on that cookie existing.

`(auth)` is a **route group**. The parentheses mean the folder does not appear in the URL — `/login`, not `/auth/login`. It exists only to give both pages the same split-screen frame.

---

## 2. Who can open it, and who enforces that

| Who | Can reach it | Enforced where |
|---|---|---|
| Anyone, logged out | Yes | The middleware matcher **excludes** `login` and `signup` — `src/middleware.ts:59` |
| Internal user, logged in | Redirected to `/dashboard` | `login/page.tsx:10`, `signup/page.tsx:8` — `if (await getSessionUser()) redirect(...)` |
| Portal contact | Yes, but pointless | The portal has its own login at `/portal/login`; a link points there from `auth-form.tsx:128` |

This is the inverse of every other screen: instead of requiring a session, it **refuses** one. If you are already logged in there is nothing here for you.

The matcher at `src/middleware.ts:59` is the reason:

```
"/((?!login|signup|api|_next|favicon.ico|.*\\..*).*)"
```

Everything except the auth pages, `/api`, Next internals, and files with an extension. If `login` were not in that exclusion list you would have an infinite redirect loop — the middleware would bounce you to `/login`, which would need a session, which would bounce you to `/login`.

---

## 3. Everything on the screen, and where each value comes from

| What you see | Example value | Where it comes from | Notes |
|---|---|---|---|
| "Log in to DealFlow360" | static | `login/page.tsx:15` | hardcoded copy |
| Left panel headline and blurb | static | `(auth)/layout.tsx:19-27` | the mockup's "Entry point for internal users and customers" line is at `:18` |
| Ledger illustration | static SVG | `src/components/auth/ledger-hero.tsx` | decorative |
| Log In / Sign Up tabs | static | `auth-form.tsx:53-70` | `aria-current="page"` marks the active one |
| Email field | you type it | `auth-form.tsx:76-88` | `name="email"` |
| Password field | you type it | `auth-form.tsx:90-102` | `name="password"` |
| "Forgot Password?" | static, **does nothing** | `auth-form.tsx:123` | `onClick={() => undefined}`, `title="Not available in this build"` |
| "Customer? Open your portal" | link to `/portal/login` | `auth-form.tsx:128` | the only crossing point between the two worlds |
| Field errors under inputs | "Enter a valid email" | `auth-form.tsx:29-33` | from the action's `fieldErrors` |
| Generic error banner | "Invalid email or password" | `auth-form.tsx:104` | shown when the failure has no field errors |
| Footer line | static | `(auth)/layout.tsx:52` | mirrors the mockup exactly |

**So where does the account itself come from?** Two origins only:

1. **The seed** — `prisma/seed/b-users.ts` creates the six demo users with `bcrypt` hashes of `demo1234`. That is where `riya@test.com`, `meera@test.com`, `farhan@test.com` and `admin@test.com` come from.
2. **This screen's own signup**, which inserts an `app_user` row directly.

There is no third path. A customer contact is a different table entirely (`customer_contact`) and is created by a rep when they create a customer (`quotation.service.ts:58`).

---

## 4. What runs when the page loads

Both pages are Server Components and do exactly one thing before rendering:

```ts
// login/page.tsx:10
if (await getSessionUser()) redirect(safeNextPath(next));
```

`getSessionUser` (`src/lib/auth/session.ts:14-21`) reads the `df_session` cookie and runs one query:

```ts
prisma.session.findUnique({ where: { token }, include: { user: true } })
```

It returns `null` — meaning "not logged in" — in four cases: no cookie, no matching row, `expiresAt <= now`, or `user.isActive === false`. That last one matters: **deactivating a user logs them out on their next request**, because the role and active flag are read from the database every single time rather than trusted from the cookie.

---

## 5. Every condition on this screen

| Condition | Where | What it means |
|---|---|---|
| `if (await getSessionUser())` | `login/page.tsx:10` | already logged in → go to `next` or `/dashboard` |
| `next && safeNextPath(next) !== "/dashboard"` | `login/page.tsx:11` | only carry a `?next=` through if it is a real destination |
| `mode === "signup"` | `auth-form.tsx:72` | the Full name field exists only on signup |
| `state && !state.ok` | `auth-form.tsx:49` | the action came back with an error |
| `!state.fieldErrors` | `auth-form.tsx:50` | no per-field errors → show one generic banner instead |
| `pending` | `auth-form.tsx:47` | disables the button and shows a spinner |
| `minLength={mode === "signup" ? 8 : 1}` | `auth-form.tsx:97` | signup demands 8 characters; login accepts any non-empty string, because an old account might have a shorter one |

That last row is a small but deliberate piece of design: **validation on login is looser than on signup on purpose**. You are not creating a password, you are checking one.

---

## 6. Every action you can take here

### Log In

```
form submit
  → loginAction(prev, FormData)                    actions/auth.ts:23
  → parseInput(loginSchema, values)                contract.ts:86 · validation/auth.ts:7
      email: zEmail       (trimmed, lowercased, must be an email)
      password: min 1     ("Enter your password")
  → authenticate(email, password)                  lib/auth/internal.ts:19
      prisma.user.findUnique({ where: { email } })
      reject if !user OR !user.isActive
      bcrypt.compare(password, user.passwordHash)   10 rounds
  → createSession(user.id)                         internal.ts:28
      INSERT session (token, user_id, expires_at = now + 24h)
  → setSessionCookie(token, expiresAt)             internal.ts:38
      df_session · httpOnly · sameSite lax · path "/" · secure in production
  → redirect(safeNextPath(form.next))              internal.ts:57
```

**Tables written:** `session` — one row. Nothing else. **No audit row** (a login is not a business event here).

### Sign Up

Same shape, with two differences that matter:

```
  → parseInput(signupSchema, values)               validation/auth.ts:8
      name: zName (2-120 chars), email: zEmail, password: zPassword (8-72)
  → hashPassword(password)                         internal.ts:16
  → prisma.user.create({ name, email, passwordHash })   actions/auth.ts:43
      role is NOT passed — the Prisma default SALES_REP applies
  → createSession + setSessionCookie
  → redirect("/dashboard")
```

**There is no role picker, deliberately.** Every account created here is a `SALES_REP`; an Admin promotes it later at `/admin/users`. If signup let you choose your own role, the whole permission model would be self-service.

Duplicate email is caught specifically at `actions/auth.ts:47`: Prisma error `P2002` (unique violation) becomes a friendly field error — *"An account with this email already exists. Log in instead."* Everything else falls through to `toActionError`.

### Close Workspace (logout)

Lives in the header of the internal app, not on this screen, but it is the other half:

```
logoutAction()                                     actions/auth.ts:57
  → clearSessionCookie()                           internal.ts:46
      DELETE FROM session WHERE token = ...        ← the row is destroyed, not just the cookie
      cookie deleted
  → redirect("/login")
```

Deleting the row matters. If logout only cleared the cookie, a copied token would still work until it expired.

---

## 7. Scenarios

**1. Correct credentials.** `riya@test.com` / `demo1234` → session row created, cookie set, land on `/dashboard`. Time: one `findUnique` plus one bcrypt compare (deliberately slow, ~60 ms).

**2. Wrong password.** `authenticate` returns `null` at `internal.ts:23` → the action returns `fail("VALIDATION", "Invalid email or password", { password: [...] })` at `actions/auth.ts:29`. Error shown under the password field.

**3. Email that does not exist.** `authenticate` returns `null` at `internal.ts:21` → **exactly the same message**. This is intentional: if unknown-email and wrong-password gave different answers, anyone could discover who has an account.

**4. Deactivated user.** `isActive === false` → treated as if the account does not exist (`internal.ts:21`). Same generic message. And an already-logged-in user who gets deactivated is ejected on their next page load, because `getSessionUser` re-checks `isActive` every request (`session.ts:18`).

**5. Malformed email.** `zEmail` fails, so the action returns before any database work at `actions/auth.ts:25`. You get "Enter a valid email" under the field. **Nothing touched the database** — validation runs first, always.

**6. Signup with an existing email.** Zod passes, `prisma.user.create` throws `P2002`, caught at `actions/auth.ts:47`, becomes a field error on `email`.

**7. Signup with a 6-character password.** `zPassword` requires 8. Rejected before hashing.

**8. Already logged in, visiting `/login`.** Redirected at `login/page.tsx:10` before anything renders.

**9. Deep link while logged out.** You click `/quotes/abc123XYZ789`. The middleware has no valid cookie, so it redirects to `/login?next=%2Fquotes%2Fabc123XYZ789` (`middleware.ts:35-42`). After you log in, `safeNextPath` returns you there. The `next` value rides through the form as a hidden input (`auth-form.tsx:71`).

**10. Open-redirect attempt.** Someone sends you `/login?next=https://evil.example`. `safeNextPath` (`internal.ts:57-62`) rejects anything not starting with a single `/`, plus `//`, `/\`, `/login` and `/signup`. You land on `/dashboard` instead. Try `next=//evil.example` — also rejected.

**11. Expired session.** 24 hours after login, `expiresAt <= new Date()` at `session.ts:17` → treated as logged out, bounced to `/login`. The stale row stays in the table; nothing prunes it.

**12. Two people, same account.** Both get their own `session` row with its own token. Logging out on one device deletes only that row, so the other stays logged in.

---

## 8. Schema behind this screen

```prisma
model User {                                   // table: app_user — "user" is near-reserved in Postgres
  id           Int      @id @default(autoincrement())
  email        String   @unique                // the login handle; lowercased before lookup
  name         String
  passwordHash String   @map("password_hash")  // bcrypt, 10 rounds — never the password itself
  role         Role     @default(SALES_REP)    // ← why signup needs no role field
  managerId    Int?     @map("manager_id")     // self-link; used to name the approver on the approvals list
  isActive     Boolean  @default(true)         // false = cannot log in, and existing sessions stop working
  createdAt    DateTime @default(now())
  sessions     Session[]
  @@map("app_user")
}

model Session {
  id        Int      @id @default(autoincrement())
  token     String   @unique                   // 43 random chars; the ONLY thing in the cookie
  userId    Int      @map("user_id")
  expiresAt DateTime @map("expires_at")        // now + 24h, checked on every request
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("session")
}

enum Role { ADMIN  SALES_REP  SALES_MANAGER  FINANCE }
```

Note what is **not** in the cookie: no role, no user id, no signature, no JWT. Just an opaque token that means nothing without the `session` row. That is why an Admin demoting someone takes effect on their very next click.

---

## 9. How this screen connects to the others

**In:** every protected route redirects here when the cookie is missing or invalid (`middleware.ts:35-42`), carrying `?next=`.

**Out:**
- `/dashboard` — the default landing page for all four internal roles.
- Whatever `?next=` asked for, if it survived `safeNextPath`.
- `/portal/login` — the separate customer entrance, via the link at `auth-form.tsx:128`.

**Sideways:** the `session` row this screen creates is read by `src/middleware.ts:47` on every subsequent request, and by `requireUser` / `requireActionUser` in every page and action. This one row is the root of the entire permission model.

---

## 10. Gotchas

**Signup is the only mutation in the app that bypasses the service layer.** `actions/auth.ts:43` calls `prisma.user.create` directly. Every other write in DealFlow360 goes through `src/services/*` inside a transaction and writes an `AuditLog` row. **Creating a user writes no audit row at all** — so "who created this account, and when" is answerable only from `app_user.created_at`.

**The redirect must sit outside the try/catch.** At `actions/auth.ts:35` and `:54`, `redirect()` is called *after* the try block closes. Next implements `redirect()` by throwing a special control-flow exception; if it were inside the `catch`, `toActionError` would swallow it and the redirect would silently never happen. This pattern repeats in every form action in the codebase.

**"Forgot Password?" is a dead button.** `auth-form.tsx:123`. It renders because the mockup has it. There is no password reset flow anywhere in the project.

**Login has a timing side-channel.** `authenticate` returns at `internal.ts:21` *before* running bcrypt when the email is unknown, so a miss answers in about a millisecond while a wrong password takes ~60 ms. The messages are identical, but the response time still distinguishes them. The same pattern exists in the portal login. The fix is a dummy bcrypt compare on the miss path.

**The form does not echo back what you typed.** `useActionState` re-renders with the error, but the action's return value carries only the error — never the submitted email — so anything that remounts the form loses it.

**`SESSION_SECRET` is not a thing.** It used to be in `.env.example` and the README. Nothing ever read it; sessions are opaque database tokens and nothing is signed. It has been removed — do not put it back, and do not claim it works.

**Sessions are never pruned.** Expired rows accumulate. Harmless at hackathon scale; a real deployment wants a sweep.
