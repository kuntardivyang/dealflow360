# Screen 15 — Admin / Reporting Dashboard

Route: `/reports`, plus the download route `/api/reports/export`
Page file: `src/app/(internal)/reports/page.tsx`
Service: `src/services/reports.service.ts`
Route handler: `src/app/api/reports/export/route.ts`
Spec: `docs/DealFlow360.txt` section A7
Mockup: `docs/MOCKUP_SCREENS.md` screen 15, image `docs/mockup/15-admin-reporting.png`

---

## 1. What this screen is

One filtered list of quotations, three summary tiles above it, and two export buttons.

Spec A7 asks for exactly four filters — Period, Sales Team / Rep, Approval Status, Product / Category — and "Export options: PDF / XLS". All four filters exist. The two exports exist, but they are very different animals: **XLS is a real generated file, PDF is the browser's print dialog.**

Everything on the page comes from one function, `runReport` (`src/services/reports.service.ts:33`). The page calls it, and the XLSX route calls it with the same parsed filters, which is why the spreadsheet always matches what is on screen.

---

## 2. Who can open it, and who enforces that

| Role | `/reports` | `/api/reports/export` | Enforced at |
| --- | --- | --- | --- |
| ADMIN | yes | yes | `src/lib/contract.ts:63` `BACKEND_ROLES = ["ADMIN","SALES_MANAGER","FINANCE"]` |
| SALES_MANAGER | yes | yes | same |
| FINANCE | yes | yes | same |
| **SALES_REP** | **no — redirected to `/dashboard?forbidden=1`** | **no — HTTP 401 "Unauthorized"** | page: `src/app/(internal)/reports/page.tsx:18` → `src/lib/auth/internal.ts:78`; route: `src/app/api/reports/export/route.ts:9-12` |
| not logged in | redirected to `/login?next=/reports` | 401 | `src/middleware.ts:12-43` / `route.ts:9` |

Three details worth knowing.

**The page guard is `requireUser(BACKEND_ROLES)`** at `page.tsx:18`. `requireUser` *redirects* rather than throwing (`src/lib/auth/internal.ts:78`), because a page cannot return an error object to a browser. A SALES_REP lands on `/dashboard?forbidden=1`.

**The middleware does not help here.** `src/middleware.ts:25` only role-checks paths starting with `/admin`. `/reports` does not, so the middleware confirms the session and waves the rep through — `page.tsx:18` is the only thing that stops them.

**The nav tab is visible to reps.** `src/lib/nav.ts:16` lists Reports with no `roles` field, so `visibleNavItems` (`src/lib/nav.ts:21`) shows it to a SALES_REP, who then gets bounced when they click it. Compare `Product` on the line below (`nav.ts:17`), which *is* restricted. This is a small inconsistency between the nav and the page guard; the page guard is the one that is correct.

**Why the API route guards itself.** `src/middleware.ts:59`:

```
matcher: ["/((?!login|signup|api|_next|favicon.ico|.*\\..*).*)"]
```

`api` is in the negative lookahead, so **the middleware never runs for `/api/*`**. `/api/reports/export` is the only HTTP route handler in the whole application (everything else is a server action), so it is the only place that has to do its own session check. That is what `route.ts:9-12` is:

```ts
try { await requireActionUser(BACKEND_ROLES); }
catch { return new Response("Unauthorized", { status: 401 }); }
```

`requireActionUser` throws (`src/lib/auth/internal.ts:86-91`) instead of redirecting, which is right for a download URL — a redirect to `/login` would hand the browser an HTML login page with an `.xlsx` filename.

---

## 3. Everything on the screen, and where each value comes from

| What you see | Example value | Which query produced it (file:line) | table.column | How that value came to exist |
| --- | --- | --- | --- | --- |
| Title / description | "Admin / Reporting Dashboard" | hard-coded `page.tsx:44-45` | — | — |
| Period dropdown | "Last 30 days" selected | `page.tsx:59` `defaultValue={filter.period}` | — | Parsed from the URL query string by `reportFilterSchema` (`src/lib/validation/reports.ts:7`); defaults to `"month"` |
| From / To date inputs | empty, or `2026-08-01` | `page.tsx:68,72` | — | `filter.from` / `filter.to`, `zISODate.optional()` (`validation/reports.ts:8-9`) |
| "Sales Team / Rep" options | "Priya Rep", "Arun Rep" | `reports.service.ts:48` | `user.id`, `user.name` | `WHERE role = 'SALES_REP' AND is_active = true ORDER BY name` — created on the Users admin screen or by the seed |
| "Approval Status" options | All / Pending / Approved / Rejected | hard-coded `page.tsx:89-92` | — | Must match the enum at `validation/reports.ts:11` |
| "Product" options | "Docking Station" | `reports.service.ts:49` | `product.id`, `product.name` | `WHERE archived_at IS NULL ORDER BY name` — the Product admin screen |
| "Category" options | "Hardware" | `reports.service.ts:50` | `product_category.id`, `.name` | `ORDER BY sort_order` |
| Tile **Quotes Created** | 148 | `reports.service.ts:83` `quotesCreated: rows.length` | count of `quotation` rows matching `where` | **Not a `COUNT(*)`.** It is the length of the page-1 array, and the query has `take: 500` (`reports.service.ts:39`). See gotcha 2. |
| Tile caption "8 Aug 2026 to 6 Sep 2026" | | `page.tsx:127` from `report.range` | computed | `periodRange()` (`reports.service.ts:11`) |
| Tile **Avg Approval Time** | "6.4 h" | `reports.service.ts:53-54` | `approval_request.created_at`, `.resolved_at`, `.status` | Each approval round: `created_at` stamped when the quotation was submitted for approval, `resolved_at` stamped when the last required approver acted. Only rows with `status = 'APPROVED'` and a non-null `resolved_at` count. |
| Tile **Top Upsold Product** | "Care Plan 2yr" | `reports.service.ts:47` groupBy + `:55` name lookup | `quotation_line.product_id` where `source = 'UPSELL'` | `source` is set to `UPSELL` (`LineSource` enum, `prisma/schema.prisma:75-79`) when the rep accepts a suggestion from the upsell panel in the quotation builder. Manually typed lines are `MANUAL`; lines added by the customer through the portal are `PORTAL`. |
| Tile caption "5 upsell lines in the period" | | `page.tsx:132` | `_count._all` from the groupBy | Number of UPSELL lines for the winning product |
| Table → Quotation | `Q-2026-0144` | `reports.service.ts:60` | `quotation.number` | Allocated from the `counter` table at creation |
| Table → Customer | "Acme Corp" or "–" | `reports.service.ts:61` | `customer.name` | `customer_id` is nullable, hence the `?? "–"` |
| Table → Rep | "Priya Rep" | `reports.service.ts:62` | `user.name` via `rep_user_id` | The logged-in rep at creation |
| Table → Status | "Sent" badge | `reports.service.ts:63` | `quotation.status` | The quotation state machine |
| Table → Created | "24 Aug 2026" | `reports.service.ts:64` | `quotation.created_at` | Row insert time |
| Table → Discount | ₹12,500.00 | `reports.service.ts:67` | `quotation.discount_total` (paise) | Recalculated by the pricing service on every line change |
| Table → Total | ₹1,18,000.00 | `reports.service.ts:66` | `quotation.total` (paise, net + tax) | same |
| Table → Margin | "34.2%" | `reports.service.ts:68` | `quotation.margin_bp` (nullable) | Pricing service; null when net is 0, rendered "n/a" by `formatBp` (`src/lib/format.ts:46`) |
| Table → Risk | 62 or "–" | `reports.service.ts:69` | `quotation.risk_score` | Written by the risk engine when the quotation was submitted for approval; null if it never was |
| Table → Upsell lines | 2 or "–" | `reports.service.ts:71` | count of `quotation_line` with `source = 'UPSELL'` | Counted in JS from the included lines |
| Footer "148 quotations · Discount … Net … Total …" | | `reports.service.ts:73-78` | sums over the loaded rows | Summed in JS, **over the same capped 500 rows** |
| Empty state | "No quotations match" | `page.tsx:155`, rendered by `DataTable` when `rows.length === 0` | — | |

Not rendered but computed: `rows[].id`, `rows[].publicId` (used for the row link, `page.tsx:140`), `rows[].approvals` (only used by the XLSX "Approval rounds" column, `route.ts:30`), `rows[].netTotal` (footer and XLSX).

Dev-database reality check — these numbers are **polluted test data** from earlier agents, not a clean seed: 178 quotations, 44 products, 58 approval requests of which 17 are APPROVED with a `resolved_at`, average resolution **0.02 hours** (test scripts approve within seconds), and only 6 UPSELL lines in total (5 on "Docking Station", 1 on a junk product called `RepGood2 admmtompdkh`). So on this machine the "Avg Approval Time" tile reads "0.0 h" and "Top Upsold Product" reads "Docking Station" — neither number means anything about real sales behaviour.

---

## 4. The queries this page runs

`runReport` (`src/services/reports.service.ts:33`) fires five queries with `Promise.all` (`:35`), then does two follow-ups.

### 4a. The quotation list (`reports.service.ts:36-46`)
```
SELECT * FROM quotation
WHERE <the filter, see section 5>
ORDER BY created_at DESC
LIMIT 500
```
with four includes: `customer.name`, `rep.name`, `approvalRequests(status, createdAt, resolvedAt)`, `lines(source, product.name)`.

### 4b. The top upsold product (`reports.service.ts:47`)
```
SELECT product_id, COUNT(*) FROM quotation_line
WHERE source = 'UPSELL' AND quotation MATCHES <the same where>
GROUP BY product_id ORDER BY COUNT(product_id) DESC LIMIT 1
```
Note `where: { source: "UPSELL", quotation: where }` — it reuses the *same* `Prisma.QuotationWhereInput` object as a nested relation filter, so the tile always agrees with the table. And unlike the table, this groupBy has **no 500-row cap** — it counts across the whole matching set. So on a large dataset, "Top Upsold Product" is correct while "Quotes Created" is not.

### 4c–4e. The three dropdown option lists
`reports.service.ts:48-50`: active sales reps, non-archived products, all categories. These are **unfiltered** — they are the contents of the select boxes, not report data, so they must not shrink when you narrow the report.

### 4f. Average approval time (`reports.service.ts:53-54`, in JS)
```ts
durations = quotes
  .flatMap(q => q.approvalRequests
    .filter(r => r.status === "APPROVED" && r.resolvedAt)
    .map(r => (r.resolvedAt.getTime() - r.createdAt.getTime()) / 3_600_000))
avgApprovalHours = durations.length ? mean(durations) : null
```

Read this carefully:
- The unit is **hours** (`3_600_000` ms).
- It averages **approval requests, not quotations**. A quotation that went round three times contributes three durations, so it weighs three times as much.
- Only `APPROVED` requests count. `REJECTED` and `RETURNED` rounds are excluded, which means the tile measures "how fast do we say yes", not "how fast do we decide".
- Still-pending requests have `resolved_at = NULL` and are excluded.
- `null` when nothing qualifies, rendered as "–" (`page.tsx:128`).
- Because it only looks at `quotes` (the capped 500), it inherits the 500-row cap.

An approval request's clock starts at `approval_request.created_at`, stamped when the rep submits the quotation for approval, and stops at `resolved_at`, stamped when the final required approver in the chain acts (`prisma/schema.prisma:526-544`).

### 4g. The product name for the top upsell (`reports.service.ts:55`)
A single `product.findUnique` on the id the groupBy returned. Skipped entirely when there are no upsell lines.

---

## 5. Every condition on this page

### 5.1 Parsing the URL — `reportFilterSchema`

`src/lib/validation/reports.ts:5-15`:

```ts
period:     z.enum(["today","week","month","custom"]).default("month")
from, to:   zISODate.optional()
repUserId:  zId.optional()            // z.coerce.number().int().positive().max(2_147_483_647)
approval:   z.enum(["all","pending","approved","rejected"]).default("all")
productId:  zId.optional()
categoryId: zId.optional()
.refine(v => v.period !== "custom" || (v.from && v.to), { path: ["from"], message: "Pick both dates" })
```

The page (`page.tsx:19-20`) uses `safeParse` and **falls back to the defaults on any failure**:

```ts
const parsed = reportFilterSchema.safeParse(sp);
const filter = parsed.success ? parsed.data : reportFilterSchema.parse({});
```

So a broken URL never shows an error message — it silently reports the last 30 days for everyone. Nothing on the screen tells you your filter was ignored. (This is a design choice: a report page should render something rather than a stack trace. But it does hide typos.)

The export route (`route.ts:14-15`) is stricter: `parseInput` returns `{ ok:false, code:"VALIDATION", fieldErrors }` and the route answers **400 JSON** instead of falling back.

### 5.2 Period → date window (`reports.service.ts:11-17`)

```ts
const today = todayISO("Asia/Kolkata", now);          // e.g. "2026-09-06"
"today"  -> { from: today,           to: today }      // 1 day
"week"   -> { from: addDays(today,-6), to: today }    // 7 days inclusive
"custom" -> { from: f.from, to: f.to }                // only if BOTH are set
default  -> { from: addDays(today,-29), to: today }   // "month" = last 30 days inclusive
```

"month" is not a calendar month; it is a rolling 30 days. The tile caption spells the actual window out (`page.tsx:127`), so trust the caption over the dropdown label.

Note the `custom` line requires **both** `f.from` and `f.to`; if either is missing it falls through to the 30-day default. The schema's `.refine` (`validation/reports.ts:15`) already rejects that combination on the export route, but on the page the fallback at `page.tsx:20` means `period=custom` with one date silently becomes the 30-day default.

Then `whereFor` turns the window into SQL (`reports.service.ts:22`):

```ts
createdAt: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${addDays(to,1)}T00:00:00Z`) }
```

Half-open interval, so the `to` day is fully included. (`lt` next-midnight rather than `lte` end-of-day is the right pattern; there is no rounding hole.)

### 5.3 Sales Team / Rep (`reports.service.ts:24`)
```ts
if (f.repUserId) where.repUserId = f.repUserId;
```
Exact match on `quotation.rep_user_id`. Despite the label "Sales Team / Rep", **there is no team filter** — the dropdown lists individual reps only (`reports.service.ts:48`). Spec A7 asks for "responsible rep or team"; only the rep half is built. `user.manager_id` exists in the schema, so a team roll-up is possible, but nothing here uses it.

`repUserId` is `zId`, i.e. `z.coerce.number()` — the form submits a string, Zod coerces it. An empty string coerces to `0`, which fails `.positive()`, which fails the whole `safeParse`, which triggers the fallback. But the form's "Whole team" option has `value=""` (`page.tsx:77`)… see 5.7.

### 5.4 Approval Status (`reports.service.ts:25-27`)
```ts
"pending"  -> where.status = "PENDING_APPROVAL"
"approved" -> where.status = { in: APPROVED_LIKE }
"rejected" -> where.status = "REJECTED"
"all"      -> no status clause at all
```

`APPROVED_LIKE` (`reports.service.ts:9`) is `["APPROVED","SENT","UNDER_NEGOTIATION","CONFIRMED","FULFILLMENT","PAID"]`.

This is the subtle one. "Approved" does **not** mean "currently in the APPROVED state" — it means "has got past approval", so a quote that was approved and has since been confirmed, fulfilled and paid still counts. That is almost certainly what a manager wants ("how many did we approve?"), but it means the numbers here will not match a naive `WHERE status = 'APPROVED'`.

`DRAFT` appears under none of them: a draft has never entered approval. So `all` ≠ `pending + approved + rejected`.

The filter reads the **quotation's current status**, not the `approval_request` table. A quotation whose first round was rejected and whose second round was approved is now `APPROVED` and counts as approved. History is in `approval_request`; this filter does not look at it.

### 5.5 Product / Category (`reports.service.ts:28-29`)
```ts
if (f.productId)       where.lines = { some: { productId: f.productId } };
else if (f.categoryId) where.lines = { some: { product: { categoryId: f.categoryId } } };
```

`some` = "the quotation has at least one line with this product". The row still shows the **whole quotation's** totals, not just that product's share. A ₹5,00,000 quote containing one ₹2,000 dock still contributes ₹5,00,000 to the footer when filtered to "Docking Station".

`else if` matters: **product wins over category.** Pick both and the category is ignored. Both dropdowns still show your selection, so the screen looks like both are active. The spec (A7) writes it as one filter, "Product / Category", so this is defensible — but nothing in the UI says so.

### 5.6 Everything ANDs
`whereFor` builds one object; Prisma ANDs its keys. Rep + approved + custom range + category = all four conditions at once. There is no OR anywhere.

### 5.7 The form is a plain GET form
`page.tsx:56`, `<form method="get">`. No JavaScript, no server action. Pressing "Apply filters" navigates to `/reports?period=month&from=&to=&repUserId=&approval=all&productId=&categoryId=` — **every field, including the ones you left blank, as an empty string.** That is standard HTML form behaviour and it is the direct cause of the bug in section 5.8.

"Reset" is a plain `<Link href="/reports">` (`page.tsx:120`) — no query string at all.

The export link (`page.tsx:49`) rebuilds the query string at `page.tsx:22`:
```ts
const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined && v !== "")).toString()
```
It **drops the empty values**, which is why the export link never carries `from=&to=` and never trips the stricter validation in the route. Lucky, but load-bearing.

### 5.8 How a validation bug reached the user — worked example

This is the best small example in the codebase of a bug travelling from a two-line schema to a white screen. Read it as a case study.

**The intent.** Commit `8e7ff57` ("Fixes from the test round … calendar dates must exist") tightened `zISODate`. Before, it was just a regex:

```ts
export const zISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
```

which happily accepted `2026-02-31`. The commit added a round-trip check:

```ts
.refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, "Not a real calendar date")
```

Correct idea: build the date, print it back, and if it does not come out identical, the calendar rejected it.

**The flaw.** In Zod, a failed `.regex()` marks the result **dirty**, not **aborted** — so the chained `.refine()` **still runs**, on the string that already failed the format check. Feed it `""` and the refine evaluates:

```js
new Date("T00:00:00Z")       // Invalid Date
  .toISOString()             // throws RangeError: Invalid time value
```

`toISOString()` on an Invalid Date does not return `NaN`; it **throws**. The throw happens inside the refinement function, so it propagates straight out of `safeParse`. The whole promise of `safeParse` — "never throws, returns `{success:false}`" — was broken for this one schema.

**The delivery mechanism.** Section 5.7: the filter form is plain HTML, the From/To inputs stay in the DOM regardless of the Period selection, so **every single "Apply filters" click submitted `from=` and `to=` as empty strings.** Then at `page.tsx:19`:

```ts
const parsed = reportFilterSchema.safeParse(sp);   // <- RangeError escapes here
```

The fallback on the next line never ran. The exception escaped the server component, and the user got a 500 / error boundary. Not on an edge case — **on every use of the filter bar.** Meanwhile the default `/reports` with no query string worked perfectly, which is exactly why it survived to a test round: nobody hits Apply until they want to filter.

**The fix** (`src/lib/validation/common.ts:22-30`, current state):

```ts
// The refine still runs when the regex fails, so it must never assume `s` is date-shaped:
// `new Date("T00:00:00Z").toISOString()` throws a RangeError, which would escape safeParse.
export const zISODate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real calendar date");
```

One extra guard — `!Number.isNaN(d.getTime())` — short-circuits before `toISOString()` can throw. The refine now *returns false* for malformed input instead of exploding, `safeParse` reports a normal validation failure, the fallback at `page.tsx:20` kicks in, and the page renders the 30-day default.

**The pin.** `src/lib/validation/__tests__/common.test.ts`:
- `:11-16` asserts `zISODate.safeParse(bad)` **does not throw** and returns `success: false` for `""`, `"   "`, `"nonsense"`, `"2026-9-5"`, `"05-09-2026"`, `"2026-09-05T00:00:00Z"`. The `.not.toThrow()` is the real test — a plain `success === false` assertion would have passed on the broken version too, because the throw *is* the failure.
- `:18-24` keeps the original intent alive: `2024-02-29` (leap year) passes, `2026-02-29`, `2026-02-31` and `2026-13-01` all fail.
- `:30-35` reproduces the exact payload the form submits — `{ period:"month", from:"", to:"", repUserId:"", approval:"all", productId:"", categoryId:"" }` — and asserts it fails cleanly rather than throwing.

**The lessons, in order of usefulness.**
1. A refinement runs on input that already failed an earlier check. Never assume the shape.
2. `new Date(x).toISOString()` is a throwing API. `Number.isNaN(d.getTime())` first, always.
3. `safeParse` is only safe if your own refinements are.
4. Plain HTML GET forms submit every field, including hidden-by-intent ones. A "custom range only" field is not optional at the wire level.
5. The regression test asserts **"does not throw"**, not just "fails validation". Test the failure *mode*, not only the failure.

**Status:** the fix and its test are in the working tree but **not yet committed** (`git status` shows ` M src/lib/validation/common.ts` and `?? src/lib/validation/__tests__/`). `KNOWN_ISSUES.md:29` documents it. Note that the *broken* refine is what is in git history at `8e7ff57`; if anyone reverts that file, the crash comes back.

---

## 6. Every action you can take here

### 6.1 Apply filters
Submits the GET form (`page.tsx:117`). Full page navigation, full re-query. Every filter is in the URL, so the view is shareable and bookmarkable.

### 6.2 Reset
`<Link href="/reports">` (`page.tsx:120`). Back to last-30-days / all / everyone.

### 6.3 Click a table row
`rowHref={(r) => "/quotes/" + r.publicId}` (`page.tsx:140`) → the quotation detail screen.

### 6.4 Export PDF
`src/components/reports/print-button.tsx:84`:

```tsx
<Button variant="outline" onClick={() => window.print()} data-print-hide>
```

**This generates no file.** It opens the browser's print dialog. Whether you get a PDF depends on the user picking "Save as PDF" in their own OS print dialog. There is no PDF library in the project.

What makes the printout presentable:
- `src/app/globals.css:274-300` — the print stylesheet: 14 mm page margins, white background, black text, `[data-print-hide] { display: none !important }`, borders instead of shadows on `.surface`, `break-inside: avoid` on cards, and `thead { display: table-header-group }` so column headers repeat on every printed page.
- `page.tsx:42` — an inline `<style>` forcing `@page { size: A4 landscape }`, because the table has ten columns.
- `data-print-hide` is on the print button itself (`print-button.tsx:84`), the XLS button (`page.tsx:49`) and the whole filter form (`page.tsx:56`), so the printed page shows title, tiles and table only.

Naming it "Export PDF" matches the mockup's wording. Just know what it actually is.

### 6.5 Export XLS
`page.tsx:49` renders a plain `<a href="/api/reports/export?<qs>">`. No JavaScript, no fetch — a normal browser download driven by the `Content-Disposition` header.

`src/app/api/reports/export/route.ts`:

1. `requireActionUser(BACKEND_ROLES)` (`:9`) — the self-guard, because the middleware skips `/api`.
2. `Object.fromEntries(new URL(req.url).searchParams)` (`:13`) — the same shape the page gets from `searchParams`.
3. `parseInput(reportFilterSchema, sp)` (`:14`) — the **same schema** as the page. On failure, 400 with the field errors (`:15`), no fallback.
4. `runReport(parsed.data)` (`:17`) — the **same function** as the page. This is why the file always matches the screen, provided the query string matches.
5. Sheet "Quotations" (`:18-33`) — one row per quotation, twelve columns. Money is divided by 100 (paise → rupees) so Excel gets real numbers; `margin_bp` is divided by 100 into percent; nulls become `""`; `status` is passed through `QUOTATION_STATUS_LABEL` (`:23`) so the file says "Under Negotiation" rather than `UNDER_NEGOTIATION`; `created_at` is truncated to `YYYY-MM-DD` (`:24`).
6. A totals row appended with `sheet_add_aoa(..., { origin: -1 })` (`:34`).
7. Sheet "Summary" (`:35-40`) — the period, and the three tile values.
8. Filename `dealflow360-report-{from}-to-{to}.xlsx` (`:48`).

The XLSX columns are **not** the on-screen columns: the file adds "Net (INR)" and "Approval rounds", and drops nothing. Both sides derive from the same `rows` array (`reports.service.ts:57-72`).

Because the page drops empty query values when building the link (`page.tsx:22`), a URL that the page fell back on can still export cleanly. But the reverse holds too: if you hand-edit the export URL with a bad date, you get a 400 JSON body instead of a spreadsheet, where the page would have silently reported 30 days.

---

## 7. Scenarios

Assume "today" in Asia/Kolkata is 2026-09-06.

### 7.1 Period alone — "Last 7 days"
URL: `/reports?period=week&from=&to=&repUserId=&approval=all&productId=&categoryId=`

`safeParse` fails (the empty `from`/`to` do not match `zISODate`), so `page.tsx:20` falls back to `reportFilterSchema.parse({})` → `{ period: "month", approval: "all" }`. **You asked for 7 days and got 30.** The tile caption says "8 Aug 2026 to 6 Sep 2026", which is the only clue.

To actually get the week you need `/reports?period=week` with no `from`/`to` keys at all — which is what the export link produces (`page.tsx:22` drops empties) but not what the form produces. This is the surviving tail of the section 5.8 bug: it no longer crashes, but the form still cannot express "week" or "today". **Every Apply lands on the 30-day default unless you pick a custom range with both dates filled.**

With a clean `?period=week`:
```
periodRange -> { from: "2026-08-31", to: "2026-09-06" }
where.createdAt >= 2026-08-31T00:00:00Z AND < 2026-09-07T00:00:00Z
```

### 7.2 Rep alone
`/reports?repUserId=7`. `zId` coerces `"7"` → `7`. `whereFor` adds `where.repUserId = 7` (`reports.service.ts:24`). Everything narrows together: the table, the footer sums, "Quotes Created", "Avg Approval Time" (only rep 7's approval rounds), and "Top Upsold Product" (the groupBy nests the same `where`, `reports.service.ts:47`). The three dropdowns keep all their options (`:48-50` are unfiltered).

### 7.3 Approval Status alone — "Approved"
`/reports?approval=approved`. `where.status = { in: ["APPROVED","SENT","UNDER_NEGOTIATION","CONFIRMED","FULFILLMENT","PAID"] }` (`reports.service.ts:26`).

On the current dev database that is 15 + 18 + 3 + 32 + 16 + 7 = **91** of the 178 quotations. Pick "Pending" instead and you get 17 (`PENDING_APPROVAL`); "Rejected" gives 11. 91 + 17 + 11 = 119, leaving 59 DRAFT quotations that no approval filter can reach.

Now try to reconcile with "Avg Approval Time": that tile counts *approval requests*, of which there are 58 in the database, only 17 resolved-and-approved. The tile and the row count answer different questions and will not add up.

### 7.4 Product alone
`/reports?productId=12` (Docking Station). `where.lines = { some: { productId: 12 } }` (`reports.service.ts:28`). Every quotation containing at least one dock line, showing its full totals. "Top Upsold Product" almost certainly comes back "Docking Station" — the groupBy is restricted to quotations containing a dock, and the docks in them are the UPSELL lines.

Add `categoryId=3` on top and the `else if` at `reports.service.ts:29` **ignores it**. The Category dropdown still displays your choice.

### 7.5 A custom range
`/reports?period=custom&from=2026-08-01&to=2026-08-31`.

- `zISODate` accepts both (regex passes, the round-trip refine passes).
- `.refine` at `validation/reports.ts:15` passes — period is custom and both dates are set.
- `periodRange` returns them verbatim (`reports.service.ts:15`).
- `whereFor` (`:22`): `createdAt >= 2026-08-01T00:00:00Z AND < 2026-09-01T00:00:00Z`.
- Tile caption: "1 Aug 2026 to 31 Aug 2026".
- Export link: `/api/reports/export?period=custom&from=2026-08-01&to=2026-08-31`, filename `dealflow360-report-2026-08-01-to-2026-08-31.xlsx`.

This is the **only** path through the form that reliably gives you the period you asked for.

Set `to=2026-02-31` and `zISODate`'s refine rejects it (`new Date("2026-02-31T00:00:00Z")` normalises to 3 March, which does not round-trip). The page falls back to 30 days; the export route returns 400 `{ ok:false, code:"VALIDATION", fieldErrors:{ to:["Not a real calendar date"] } }`.

Set `period=custom` with only `from` and the `.refine` fails with `"Pick both dates"` on path `from`; the page falls back to 30 days, and — because `f.to` is missing — `periodRange`'s custom branch (`:15`) would also have fallen through to the default anyway.

### 7.6 An empty result
`/reports?period=custom&from=2020-01-01&to=2020-01-02`. No quotations exist then.

- `quotes` is `[]`, so `rows` is `[]`.
- `durations` is `[]` → `avgApprovalHours = null` (`:54`) → the tile shows "–" (`page.tsx:128`).
- The upsell groupBy returns `[]` → `upsell[0]` is undefined → the `findUnique` at `:55` is skipped → `topUpsold = null` → the tile shows "–" with caption "no upsell lines in the period" (`page.tsx:132`).
- "Quotes Created" shows 0.
- `DataTable` sees `rows.length === 0` **and** an `empty` prop, so it returns the `EmptyState` instead of the table — the footer with the totals is not rendered at all (`src/components/shared/data-table.tsx:38`).
- "Export XLS" still works and produces a file with a header row, no data rows, a totals row of zeros, and a Summary sheet.

### 7.7 Exporting the XLSX
Manager has `/reports?period=custom&from=2026-08-01&to=2026-08-31&repUserId=7` on screen and clicks "Export XLS".

1. Browser GETs `/api/reports/export?period=custom&from=2026-08-01&to=2026-08-31&repUserId=7`. The `df_session` cookie rides along (same origin, `sameSite: lax`, `path: "/"` — `src/lib/auth/internal.ts:40-46`).
2. The middleware **does not run** (`api` is excluded at `src/middleware.ts:59`).
3. `route.ts:9` `requireActionUser(BACKEND_ROLES)` reads the cookie, loads the session and the user's *current* role from the database. A manager demoted to SALES_REP a minute ago gets 401 here.
4. `parseInput` succeeds — same schema, same result as the page.
5. `runReport` runs the **identical five queries**. The file matches the screen row for row, provided nobody created a quotation in between.
6. Two sheets are written and returned as a `Uint8Array` with the spreadsheet MIME type and `Content-Disposition: attachment; filename="dealflow360-report-2026-08-01-to-2026-08-31.xlsx"`.

A SALES_REP who pastes that URL gets the plain text body `Unauthorized` with status 401 (`route.ts:11`).

### 7.8 The historical crash — reproducing it in your head
Before the fix in section 5.8, on any build from commit `8e7ff57`:

1. Manager opens `/reports`. No query string → `safeParse({})` succeeds → page renders fine.
2. Manager sets Period to "Last 7 days" and clicks **Apply filters**.
3. The browser navigates to `/reports?period=week&from=&to=&repUserId=&approval=all&productId=&categoryId=`.
4. `page.tsx:19` calls `reportFilterSchema.safeParse(sp)`.
5. Zod checks `from: ""` against `zISODate`. The regex fails → issue added, status **dirty**, not aborted.
6. Zod runs the chained `.refine` anyway, on `""`.
7. `new Date("T00:00:00Z")` → Invalid Date. `.toISOString()` → **`RangeError: Invalid time value`**.
8. The RangeError propagates out of `safeParse`, out of the server component, into the Next.js error boundary. Blank/error screen. `page.tsx:20`'s carefully written fallback never executes.
9. Every subsequent Apply does the same. Reset (a plain link to `/reports`) works, which makes it look intermittent.

After the fix, step 7 becomes "the refine returns `false`", step 8 becomes "`parsed.success === false`", and step 9 becomes "the page renders the 30-day default". The page no longer crashes; it just quietly ignores the period you chose (scenario 7.1).

### 7.9 More than 500 matching quotations
`take: 500` at `reports.service.ts:39`, and `tiles.quotesCreated = rows.length` at `:83`.

With 640 matching quotations, the page shows **500** in "Quotes Created", **500** in the footer count, the sum of only those 500 in the money totals, and the average approval time of only those 500. Nothing says "500 of 640". Because the order is `created_at DESC`, you get the *newest* 500 — so a report covering a busy month silently truncates its oldest days.

The one number that stays correct is "Top Upsold Product", because its groupBy is not capped (`reports.service.ts:47`).

The dev database has 178 quotations, so this cannot be reproduced locally today.

### 7.10 The 5.5-hour timezone skew
`periodRange` computes the calendar date in **Asia/Kolkata** (`reports.service.ts:12` → `todayISO("Asia/Kolkata")`, `src/domain/dates.ts:31`). `whereFor` then builds the SQL bounds in **UTC** (`reports.service.ts:22`, the literal `T00:00:00Z`). India is UTC+5:30, so the whole window is shifted 5½ hours late.

Concretely, "Today" on 6 September:
```
periodRange  -> { from: "2026-09-06", to: "2026-09-06" }
SQL          -> created_at >= 2026-09-06T00:00:00Z  AND  < 2026-09-07T00:00:00Z
in IST       -> 2026-09-06 05:30 IST  ...  2026-09-07 05:30 IST
```

Consequences:
- A quotation created at **02:00 IST on 6 Sep** is **missing** from the "Today" report. Its rep will swear they created it today.
- A quotation created at **02:00 IST on 7 Sep** (tomorrow, for the user) **is included** in the "Today" report.
- Between 00:00 and 05:30 IST, "Today" contains yesterday's late-evening work and none of this morning's.

Same skew on every period, including a custom range: `from=2026-08-01` really means "from 1 Aug 05:30 IST".

The fix would be to build the bounds in the same zone the dates were computed in. Not done; documented here and in gotcha 1.

### 7.11 A SALES_REP clicks the "Reports" tab
The tab is visible (`src/lib/nav.ts:16` has no `roles`). Middleware passes (not `/admin`). `requireUser(BACKEND_ROLES)` at `page.tsx:18` fails the role check and `src/lib/auth/internal.ts:78` calls `redirect("/dashboard?forbidden=1")`. The rep lands back on the dashboard with a `forbidden` flag in the URL. No data is queried — `requireUser` is awaited before `runReport` runs.

### 7.12 Printing
Manager filters to one rep, clicks "Export PDF", picks "Save as PDF" in the OS dialog. The `@media print` block (`src/app/globals.css:274`) hides the filter bar and both export buttons, forces black-on-white, replaces card shadows with 1 px borders, and repeats the table header on each page. `page.tsx:42` forces A4 landscape. The result is title + tiles + table, with the period visible only in the "Quotes Created" tile caption — so the printed page does carry its own date range, but **not** which rep or product filter produced it. If you print two filtered reports they are indistinguishable on paper.

---

## 8. Schema behind this screen

### `quotation` (`prisma/schema.prisma:439-483`)
The main table. Columns read here: `id`, `public_id` (`:441`, the row link), `number` (`:442`), `customer_id` (nullable), `rep_user_id` (`:444`), `status` (`:445`), `gross_total` / `discount_total` / `net_total` / `total` (`:448-452`, all integer paise), `margin_bp` (`:454`, nullable), `risk_score` (`:455`, nullable 0..100), `created_at` (`:467`, the filter axis). Indexed on `status` (`:481`) and `(rep_user_id, last_activity_at)` (`:482`). **There is no index on `created_at` alone**, which is the column every report filters on.

### `quotation_line` (`prisma/schema.prisma:489-515`)
`product_id` (`:491`) and `source` (`:494`, `LineSource` enum: `MANUAL` / `UPSELL` / `PORTAL`, `:75-79`). `source = 'UPSELL'` is the entire basis of the "Top Upsold Product" tile and the "Upsell lines" column. It is set when the rep accepts a suggestion from the upsell panel in the quotation builder — so the tile measures *what the upsell engine successfully sold*, not what customers happened to buy.

### `approval_request` (`prisma/schema.prisma:526-544`)
`status` (`ApprovalRequestStatus`), `created_at` (clock start), `resolved_at` (clock stop), unique on `(quotation_id, version)` (`:541`) so each re-approval round is its own row. The only source for "Avg Approval Time". Its sibling `approval_step` (`:546`) holds the per-approver detail and is **not** read here — the tile measures the whole round, not individual approver latency.

### `user`, `product`, `product_category`
Only for the dropdown options and for display names (`reports.service.ts:48-50`). `user.role = 'SALES_REP' AND is_active`; `product.archived_at IS NULL`; categories ordered by `sort_order`.

Nothing on this screen writes to the database. It is the only pure-read screen in the app.

---

## 9. How this screen connects to the others

- **← Quotation builder** — creates the `quotation` rows and their `created_at`, and sets `quotation_line.source = 'UPSELL'` when a suggestion is accepted. Without that, the Top Upsold tile is permanently "–".
- **← Approval screens** — every submit/approve cycle writes an `approval_request` with `created_at` and `resolved_at`, which is the entire Avg Approval Time tile.
- **← Pricing** — `total`, `net_total`, `discount_total`, `margin_bp` are recomputed on every line change and simply read here.
- **← Risk engine** — `risk_score` in the Risk column.
- **← Product admin** — the Product dropdown is the non-archived catalogue. Archive a product and it vanishes from the filter, but quotations containing it still appear under other filters.
- **→ Quotation detail** — every row links to `/quotes/{publicId}` (`page.tsx:140`).
- **→ The filesystem** — the only screen that produces a downloadable file.
- **Deal Health (`/health`)** — no link either way. Health reads `deal_alert` and `risk_config`; Reports reads `quotation` and `approval_request`. They share only the `quotation` table.
- **`src/lib/validation/common.ts`** is shared by *every* schema in the app, which is why a bug in `zISODate` (section 5.8) is worth understanding well beyond this screen.

---

## 10. Gotchas

1. **The date window is 5½ hours out.** `periodRange` computes dates in Asia/Kolkata (`reports.service.ts:12`); `whereFor` builds bounds as `T00:00:00Z` (`:22`). Every period is shifted 5:30 later than the calendar day it claims. Scenario 7.10 has the arithmetic. **Known, unfixed.**
2. **"Quotes Created" silently undercounts past 500.** `take: 500` (`reports.service.ts:39`) plus `quotesCreated: rows.length` (`:83`). The footer count and all three money totals inherit the cap; so does Avg Approval Time. Only Top Upsold Product is uncapped. Nothing on screen warns you. **Known, unfixed.**
3. **The filter form cannot express "today" or "week".** It always submits `from=` and `to=`, `safeParse` fails, and `page.tsx:20` falls back to the 30-day default (scenario 7.1). The crash is fixed; the silent fallback is not.
4. **A rejected filter shows no error.** `page.tsx:19-20` swallows every validation failure. The tile caption is your only evidence of what was actually queried.
5. **"Approved" means "got past approval", not "status = APPROVED".** `APPROVED_LIKE` at `reports.service.ts:9` includes SENT, UNDER_NEGOTIATION, CONFIRMED, FULFILLMENT and PAID.
6. **DRAFT quotations are unreachable by any approval filter**, so the three approval buckets do not sum to "all".
7. **Product beats Category** — the `else if` at `reports.service.ts:29`. Select both and the category is ignored, with no visual cue.
8. **Product/Category filtering does not apportion money.** A filtered row still shows the whole quotation's totals.
9. **"Sales Team / Rep" has no team.** Only individual reps (`reports.service.ts:48`); spec A7 asks for both.
10. **Avg Approval Time averages requests, not quotations**, and only successful ones. A quote approved after three rounds counts three times; rejections and returns are invisible.
11. **"Export PDF" generates no PDF.** `window.print()` (`print-button.tsx:84`). There is no PDF library in the project.
12. **The printed page does not record its filters.** The filter bar is `data-print-hide` (`page.tsx:56`), so only the date range survives, inside a tile caption.
13. **`/api/reports/export` is the only HTTP route handler in the app**, and the middleware matcher excludes `/api` (`src/middleware.ts:59`) — which is exactly why `route.ts:9` has to check the session itself. Delete that line and the export becomes public.
14. **The page falls back on bad filters; the export route returns 400.** Same schema, different failure policy. Hand-edited export URLs can 400 where the page would have rendered.
15. **No index on `quotation.created_at`.** Every report is a range scan on an unindexed column.
16. **The fix in section 5.8 is uncommitted** (`git status`: ` M src/lib/validation/common.ts`, `?? src/lib/validation/__tests__/`). Reverting that file reintroduces the crash on every Apply.
