# Screen 18 — Discount tiers and approval chains (`/admin/tiers`)

## 1. What this screen is

Four cards on one page. Together they are the entire governance configuration of the product:

1. **Tier Discount Ceilings** — how much discount each customer tier may be given.
2. **Category Discount Ceilings** — how much discount each product category tolerates, plus the minimum margin an upsell suggestion must clear.
3. **Approval chain** — the grid of rules that turns a risk result into a list of approvers.
4. **Risk configuration** — the singleton row of weights and thresholds that produces the risk score in the first place.

This is the screen that proves the spec's central claim. Spec A3 (docs/DealFlow360.txt:117-131) asks for configurable ceilings and a configurable approval chain, and notes that a mixed-category quote must "compute a blended risk score and route to the highest required level". Every number in that sentence is a row you can edit here, read live by the engine on the next confirm, with no restart and no deploy.

The page header says it in one line: "Each line is checked against the stricter of its customer tier and product category ceiling… Every save is logged." (`src/app/(internal)/admin/tiers/page.tsx:54`).

## 2. Who can open it, and who enforces that

| Role | Can open? | Enforced where |
| --- | --- | --- |
| ADMIN | Yes | `src/middleware.ts:25`, `src/app/(internal)/admin/layout.tsx:7`, `src/app/(internal)/admin/tiers/page.tsx:48` |
| SALES_MANAGER | Yes | same |
| FINANCE | Yes | same |
| SALES_REP | No — `/dashboard?forbidden=admin` | `src/middleware.ts:25-30` |

`BACKEND_ROLES = ["ADMIN", "SALES_MANAGER", "FINANCE"]` (`src/lib/contract.ts:63`). All four server actions on this page (`saveTier`, `saveCategory`, `saveApprovalRule`, `saveRiskConfig`) use the default role list (`src/app/(internal)/actions/admin.ts:54-65`, defaulting at `:35`), so they too accept all three.

**Wider than the spec, and materially so here.** Spec A3 gives discount-ceiling and approval-chain setup to the configuration area (the Admin). In this code a **Sales Manager can raise the ceiling that governs their own approvals**, and can edit the approval rules that decide whether a quote needs Finance. Nothing prevents it. If you want a clean separation of duties, the change is `tiers/page.tsx:48` and the four action calls at `actions/admin.ts:54-65` (pass `["ADMIN"]` as the fifth argument the way `setUserRole` does at `:82`).

## 3. Everything on the screen, and where each value comes from

One query feeds all four cards: `getGovernanceConfig()` at `src/services/admin.service.ts:235-243`.

### Card 1 — Tier Discount Ceilings (`tiers/page.tsx:57-70`)

Fields at `tiers/page.tsx:14-18`.

| What you see | Example (seed) | Which query | table.column | How it came to exist | FORWARD trace |
| --- | --- | --- | --- | --- | --- |
| Tier | `Bronze`, `Silver`, `Gold` | `admin.service.ts:237` | `customer_tier.name` | typed here; seeded at `prisma/seed/b-governance.ts:80-82` | shown next to the customer on the quote builder (`quotes/[publicId]/page.tsx:198`) |
| Max discount (%) | `5`, `10`, `15` shown; `500`, `1000`, `1500` stored | same | `customer_tier.discount_ceiling_bp` | typed as a percent, ×100 by the form (`entity-form.tsx:59`) | **→ half of `quotation_line.ceiling_bp`**: `Math.min(tier.discountCeilingBp, category.discountCeilingBp)` (`quotation.service.ts:151-152`); also shown raw as the customer's ceiling in the builder header (`quotes/[publicId]/page.tsx:198`) and in the customer picker (`components/quotes/customer-field.tsx:92`) |
| Order | `1`, `2`, `3` | same | `customer_tier.sort_order` | typed | the only ordering for tier lists (`admin.service.ts:237,307`); no business meaning |
| the blank "Add tier" row | | initial `sortOrder: tiers.length + 1` (`tiers/page.tsx:67`) | | | |

### Card 2 — Category Discount Ceilings (`tiers/page.tsx:71-84`)

Fields at `tiers/page.tsx:19-23`.

| What you see | Example (seed) | Which query | table.column | FORWARD trace |
| --- | --- | --- | --- | --- |
| Category | `Hardware`, `Services`, `Subscriptions` | `admin.service.ts:238` | `product_category.name` | shown on Screen 16 and in the quote builder's product picker (`quotes/[publicId]/page.tsx:92`) |
| Max discount (%) | `15`, `10`, `12` shown; `1500`, `1000`, `1200` stored. **Nullable** — placeholder "tier only" | same | `product_category.discount_ceiling_bp` (`Int?`) | **→ the other half of `quotation_line.ceiling_bp`** (`quotation.service.ts:151-152`). A `null` here means the tier ceiling applies alone — that exact branch is `category.discountCeilingBp === null ? tier.discountCeilingBp : Math.min(...)`. The pure version is `lineCeilingBp` (`src/domain/risk.ts:60-62`). |
| Min margin for upsell (%) | `15`, `20`, `30` shown; `1500`, `2000`, `3000` stored | same | `product_category.min_margin_bp` | **→ the upsell filter**: a suggestion is dropped when its own margin is under its category's minimum — `.filter((s) => (s.marginBp ?? 0) >= (minMargin.get(s.productId) ?? 0) && s.score > 0)` (`upsell.service.ts:80`). Nothing else reads it. In particular it is **not** the `floorMarginBp` used by the risk score; that one lives in the Risk configuration card. |

### Card 3 — Approval chain (`tiers/page.tsx:87-120`)

Fields at `tiers/page.tsx:24-32`. One inline form per rule (`:97-107`), plus a blank "Add rule" row (`:109-117`).

| What you see | Example (seed) | Which query | table.column | Meaning at run time |
| --- | --- | --- | --- | --- |
| the grey banner "Within tier / category limit → no approval needed (built in: an empty chain)" | | hardcoded text (`tiers/page.tsx:96`) | — | This is not a row. It is `needsReview()` returning false → `routeApproval` returns `[]` (`src/domain/route.ts:7-9,29`). The mockup draws it as the first row of the grid; the code makes it the default. |
| Seq | `1`, `2` | `admin.service.ts:239` (ordered by `sequence`) | `approval_rule.sequence` (`@unique`) | sorts the rules before evaluation (`src/domain/route.ts:30`); also decides which rule is the "lowest sequence" fallback (`:32`) |
| Discount range (the rule's name) | `Over limit`, `High risk or large order` | same | `approval_rule.name` | label only — never read by the engine |
| Score ≥ | `1`, `50` | same | `approval_rule.min_score` | trigger 1: `r.score >= rule.minScore` (`src/domain/route.ts:14`) |
| Worst line over (pt) (%) | blank on rule 1; `10` shown / `1000` stored on rule 2 | same | `approval_rule.max_worst_overage_bp` (nullable) | trigger 2: `rule.maxWorstOverageBp !== null && r.worstOverageBp > rule.maxWorstOverageBp` (`route.ts:15`) |
| Order total above (₹) | blank; `10,00,000` shown / `100000000` paise stored | same | `approval_rule.max_order_total` (nullable) | trigger 3: `rule.maxOrderTotal !== null && orderTotal > rule.maxOrderTotal` (`route.ts:16`) |
| Approval needed — two checkboxes | `Sales manager`; `Sales manager` + `Finance` | same, unwrapped by `jsonChain` (`admin.service.ts:268`) | `approval_rule.chain` (`Json`) | the ordered approver list. Parsed back at run time by `approverRoleSchema.array().catch([]).parse(r.chain)` (`quotation.service.ts:435`) |
| Active | ticked | same | `approval_rule.is_active` | `loadRoutingRules` only selects `isActive: true` (`quotation.service.ts:429`) — the switch that takes a rule out of play without deleting it |

`jsonChain` (`admin.service.ts:268`) is a tiny guard: `Array.isArray(chain) ? chain as string[] : []`. It stops a malformed JSON value from crashing the form.

### Card 4 — Risk configuration (`tiers/page.tsx:122-133`)

Fields at `tiers/page.tsx:33-45`. One form, one row, `initial={riskConfig ?? {}}`.

`riskConfig` comes from `prisma.riskConfig.findUnique({ where: { id: 1 } })` (`admin.service.ts:240`) — the singleton.

**The seven numbers the risk score uses** (they are exactly the `RiskWeights` interface at `src/lib/contract.ts:223-231`, and exactly what `loadRiskWeights` selects at `quotation.service.ts:424`):

| Field on screen | Seed value | Column | What it does |
| --- | --- | --- | --- |
| Weight: worst line (%) | `50` | `risk_config.w_worst` | multiplier on the worst single line overage — `(cfg.wWorst / 100) * ratio(worst, cfg.normWorstBp)` (`src/domain/risk.ts:86`) |
| Weight: blended overage (%) | `40` | `w_blended` | multiplier on the value-weighted overage (`risk.ts:87`) |
| Weight: margin shortfall (%) | `10` | `w_margin` | multiplier on the margin penalty (`risk.ts:88`) |
| Worst overage that scores full (pt) | `10` shown / `1000` stored | `norm_worst_bp` | the denominator: a 10-point overage saturates that term (`risk.ts:65,86`) |
| Blended overage that scores full (pt) | `5` / `500` | `norm_blended_bp` | same for the blended term |
| Margin shortfall that scores full (pt) | `10` / `1000` | `norm_margin_bp` | same for the margin term |
| Margin floor (%) | `20` / `2000` | `floor_margin_bp` | `penalty = max(0, floorMarginBp - orderMarginBp)` (`risk.ts:84`) |

**Four more on the same form, used by Deal Health, not by the score** (they are the `HealthConfig` interface, `contract.ts:336-341`):

| Field | Seed | Column | Used by |
| --- | --- | --- | --- |
| Stalled after (days) | `3` | `stalled_days` | `src/services/health.service.ts` — a quote untouched for this many days raises a `STALLED` alert |
| Anomaly z-score | `2.0` | `anomaly_z` | the discount-anomaly detector (`src/domain/anomaly.ts`) |
| Anomaly: points above rep average | `10` / `1000` | `anomaly_abs_bp` | same |
| Minimum quotes for a rep average | `5` | `min_history` | same — below this many quotes a rep has no baseline |

Note the field types: `anomalyZ` is `type: "number"` with `step: 0.1` (`tiers/page.tsx:42`), so it is passed through `Number(v)` (`entity-form.tsx:60`) and stored as a `Float` (`schema.prisma:418`). The three weights are also plain `number` — **not** percent — so `50` is stored as `50`, not `5000`. Everything labelled `(pt)` or `(%)` on this card *is* a `percent` field and gets ×100.

The card's own description spells out the formula (`tiers/page.tsx:126-127`).

### Worked example of the score

Gold customer (tier ceiling 1500). Two lines:

- `Laptop 14"` (Hardware, ceiling `min(1500,1500) = 1500`), gross ₹1,20,000, effective discount 18% → overage `1800 - 1500 = 300` bp.
- `Setup Service` (Services, ceiling `min(1500,1000) = 1000`), gross ₹8,000, effective discount 18% → overage `1800 - 1000 = 800` bp.

`worst = 800` (`risk.ts:80`).
`blended = divRound(300×12000000 + 800×800000, 12800000) = divRound(4240000000, 12800000) = 331` bp (`risk.ts:81-83`).
Say the order margin is 2600 bp, above the 2000 floor → `penalty = 0` (`risk.ts:84`).

```
raw   = 0.50 × (800/1000) + 0.40 × (331/500) + 0.10 × 0
      = 0.40 + 0.2648 + 0
      = 0.6648
score = round(100 × 0.6648) = 66          (risk.ts:85-89)
```

Band `HIGH` (`≥ 50`, `contract.ts:247`). Rule 1 fires (`66 >= 1`), rule 2 fires (`66 >= 50`) → longest chain wins → `["SALES_MANAGER","FINANCE"]` (`src/domain/route.ts:33`). This is the spec's "mixes categories → blended score → highest required level", executed.

## 4. The queries this page runs

`getGovernanceConfig()` — `src/services/admin.service.ts:235-243`:

```ts
const [tiers, categories, rules, riskConfig] = await Promise.all([
  prisma.customerTier.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  prisma.productCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  prisma.approvalRule.findMany({ orderBy: { sequence: "asc" } }),
  prisma.riskConfig.findUnique({ where: { id: 1 } }),
]);
```

Four queries, no filters. Archived rows do not exist for these tables — none of them has an `archived_at` column. `approvalRule.findMany` here has **no** `isActive` filter, so inactive rules are listed and editable; the run-time loader does filter (`quotation.service.ts:429`).

After any save, `revalidatePath` fires for `/admin/tiers` and `/admin` (`actions/admin.ts:49`, applied at `:42`), and `EntityForm` calls `router.refresh()` (`entity-form.tsx:111`).

## 5. Every condition on this page

| Condition | Where | Effect |
| --- | --- | --- |
| role not in `BACKEND_ROLES` | `middleware.ts:25`, `tiers/page.tsx:48` | redirected out |
| category ceiling left blank | `tiers/page.tsx:21` (`nullable: true`) → `entity-form.tsx:58` | sent as `null`; `categorySchema` accepts it (`validation/admin.ts:13`); at run time the tier ceiling applies alone (`quotation.service.ts:151`) |
| `maxWorstOverageBp` left blank | `tiers/page.tsx:28` (`nullable`) | `null` → that trigger never fires (`route.ts:15`) |
| `maxOrderTotal` left blank | `tiers/page.tsx:29` (`nullable`) | `null` → that trigger never fires (`route.ts:16`) |
| chain checkbox set empty | `validation/admin.ts:24` | `.min(1, "Pick at least one approver")` — the save is rejected before any query |
| weights do not sum to 100 | `validation/admin.ts:42` | field error on `wWorst`: "Weights must add up to 100"; nothing written |
| `minScore` outside 0..100 | `validation/admin.ts:21`, backed by `CHECK "approval_rule_min_score_range"` (`migration.sql:1026`) | rejected |
| any bp field outside 0..10000 | `zBp` (`validation/common.ts:7-11`), backed by CHECKs at `migration.sql:1014-1019` | rejected |
| `riskConfig` row missing | `tiers/page.tsx:131` (`riskConfig ?? {}`) | the whole form renders blank |
| `riskConfig` row missing at run time | `quotation.service.ts:423` | hardcoded fallback `{50, 40, 10, 1000, 500, 1000, 2000}` — the score keeps working |
| every approval rule deleted or deactivated | `route.ts:32,34` | `pool` falls back to the first rule; if that yields nothing, `FALLBACK_CHAIN = ["SALES_MANAGER"]` — an over-limit quote can never slip through unreviewed |
| duplicate `sequence` | `approval_rule.sequence @unique` (`schema.prisma:395`) | Prisma `P2002` → "A record with this value already exists" with a field error on `sequence` (`contract.ts:140-143`) |
| duplicate tier or category `name` | `@unique` (`schema.prisma:225`, `:308`) | same |
| adding a tier | `tiers/page.tsx:67` | `sortOrder` pre-filled to `tiers.length + 1` |
| adding a rule | `tiers/page.tsx:112` | `sequence` pre-filled to `(last sequence) + 1`, `minScore: 0`, `chain: ["SALES_MANAGER"]`, `isActive: true` |

## 6. Every action you can take here

All four forms are `EntityForm` (`src/components/admin/entity-form.tsx:66-222`). The `percent` / `rupees` conversion is described in `17-admin-product-detail.md` §6 — short version: `toRaw` divides by 100 on read (`entity-form.tsx:46`), `toInput` does `Math.round(Number(v) * 100)` on write (`:59`). So `15` becomes `1500` bp, and `10,00,000` becomes `100000000` paise.

### 6.1 Save a tier

| Step | Path |
| --- | --- |
| button | "Save" per row / "Add tier" (`tiers/page.tsx:64,67`) |
| action | `saveTier` — `actions/admin.ts:54-56` |
| Zod | `tierSchema` — `validation/admin.ts:8`: `{ id?, name: zName, discountCeilingBp: zBp, sortOrder: int default 0 }` |
| guards | `parseInput` (`actions/admin.ts:37`), then `requireActionUser(BACKEND_ROLES)` (`:40`). None in the service. |
| service | `admin.saveTier` — `admin.service.ts:50-61`, through `saveRow` |
| tables | `customer_tier`, `audit_log` |
| audit | `entityType: "CustomerTier"`, action `CREATE`/`UPDATE`, before/after `{ name, discountCeilingBp, sortOrder }` (`:59`), `reason: null` |
| on screen | toast "`Gold` saved"; `router.refresh()` re-runs `getGovernanceConfig` |
| downstream | every **new or re-priced** quotation line picks up the new ceiling (`quotation.service.ts:151`); existing lines keep their snapshot |

Deleting is not possible from the UI. Note `PricelistRule.tier` is `onDelete: Cascade` (`schema.prisma:367`), so a SQL-level tier delete would silently take its price rules with it; `Customer.tier` is a plain required relation, so a tier with customers cannot be deleted at all.

### 6.2 Save a category

| Step | Path |
| --- | --- |
| action | `saveCategory` — `actions/admin.ts:57-59` |
| Zod | `categorySchema` — `validation/admin.ts:10-15`: `{ id?, name, discountCeilingBp: zBp.nullable(), minMarginBp: zBp.default(0) }` |
| service | `admin.saveCategory` — `admin.service.ts:63-74` |
| tables | `product_category`, `audit_log` |
| audit | before/after `{ name, discountCeilingBp, minMarginBp }` (`:72`) — note `sortOrder` is **not** in the projection, and is also not writable from this form, so a category's sort order can only be set by seed or SQL |
| downstream | new lines re-derive `ceiling_bp` (`quotation.service.ts:151`); upsell suggestions re-filter on the next builder load (`upsell.service.ts:80`) |

### 6.3 Save an approval rule — how a grid row becomes a routing rule

| Step | Path |
| --- | --- |
| action | `saveApprovalRule` — `actions/admin.ts:60-62` |
| Zod | `approvalRuleSchema` — `validation/admin.ts:17-26` |
| service | `admin.saveApprovalRule` — `admin.service.ts:76-95` |
| tables | `approval_rule`, `audit_log` |
| audit | before/after `{ sequence, name, minScore, maxWorstOverageBp, maxOrderTotal, chain, isActive }` (`:93`) — the only complete projection in the file |

The schema:

```ts
sequence:          z.coerce.number().int().min(1)
name:              zName
minScore:          z.coerce.number().int().min(0).max(100)
maxWorstOverageBp: zBp.nullable().default(null)
maxOrderTotal:     zMoney.nullable().default(null)
chain:             z.array(z.enum(["SALES_MANAGER","FINANCE"])).min(1, "Pick at least one approver")
isActive:          z.coerce.boolean().default(true)
```

The service writes `chain: [...input.chain]` into a `Json` column (`admin.service.ts:83`, `schema.prisma:401`).

**And then, at run time — with no restart:**

```ts
export async function loadRoutingRules(tx: Tx): Promise<RoutingRule[]> {
  const rows = await tx.approvalRule.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } });
  return rows.map((r) => ({
    sequence: r.sequence, minScore: r.minScore,
    maxWorstOverageBp: r.maxWorstOverageBp, maxOrderTotal: r.maxOrderTotal,
    chain: approverRoleSchema.array().catch([]).parse(r.chain),
  }));
}
```

(`src/services/quotation.service.ts:428-437`.) Called from `recompute` (`:362`), which runs at the end of **every** quotation mutation, and therefore also on the confirm path. `.catch([])` means a corrupted `chain` value degrades to an empty chain instead of throwing.

`routeApproval` then does the deciding (`src/domain/route.ts:28-35`):

```ts
if (!needsReview(r)) return [];
const ordered = [...rules].sort((a, b) => a.sequence - b.sequence);
const fired   = ordered.filter((rule) => ruleFires(rule, r, orderTotal));
const pool    = fired.length > 0 ? fired : ordered.slice(0, 1);
const longest = pool.reduce((best, rule) => (rule.chain.length > best.length ? rule.chain : best), []);
return [...(longest.length > 0 ? longest : FALLBACK_CHAIN)];
```

Three things worth reading twice: it is **max, not sum** — the longest single chain wins, chains are never concatenated; if something is over a limit but no rule fires, the lowest-sequence rule reviews it anyway (`:32`); and `FALLBACK_CHAIN` (`:21`) is the last safety net.

### 6.4 Save the risk configuration

| Step | Path |
| --- | --- |
| button | "Save configuration" (`tiers/page.tsx:131`) |
| action | `saveRiskConfig` — `actions/admin.ts:63-65` |
| Zod | `riskConfigSchema` — `validation/admin.ts:28-42`, ending in the `.refine` that enforces the sum of 100 |
| service | `admin.saveRiskConfig` — `admin.service.ts:97-104`. **Not** `saveRow` — it is a hand-written upsert on `id: 1`, because the row is a singleton and has no create/update distinction. |
| tables | `risk_config`, `audit_log` |
| audit | `entityType: "RiskConfig"`, `entityId: 1`, action always `"UPDATE"`, before = the whole previous row, after = the whole input (`admin.service.ts:101`). This is the one admin audit that is **not** lossy. |
| also written | `risk_config.updated_by_id = user.id` (`:100`) and `updated_at` via `@updatedAt` (`schema.prisma:420`) |
| downstream | `loadRiskWeights` (`quotation.service.ts:421-426`) reads the row on every recompute; `health.service.ts` reads the four Deal Health numbers |

## 7. Scenarios

The group-wide walkthroughs (create a product, add a variant, price-rule precedence, raise a ceiling, add an approval rule, weights ≠ 100, on-hand below reserved, create a plan, change a role) are numbered 1-9 in `16-admin-products.md` §7. Scenarios 4, 5 and 6 there are this screen's. These are the extras specific to Screen 18.

### S18-1 — Making a category strictly stricter than every tier

Set `Services` ceiling to 5% (`500` bp). Now even a Gold customer (1500) is capped at `min(1500, 500) = 500` on Services lines (`quotation.service.ts:151-152`). A 6% discount on Setup Service becomes a 100 bp overage, which makes `needsReview` true (`route.ts:8`) and routes the quote to a manager even though Gold "may give 15%".

That is the intent of the spec's "some product categories allow higher discretion than others" (docs/DealFlow360.txt:122), read in the strict direction.

### S18-2 — Clearing a category ceiling

Blank the Hardware ceiling. `nullable: true` on the field (`tiers/page.tsx:21`) makes `toInput` send `null` (`entity-form.tsx:58`), `categorySchema` accepts `zBp.nullable()` (`validation/admin.ts:13`), and the column is `Int?` (`schema.prisma:309`).

At run time the `null` branch fires: `category.discountCeilingBp === null ? tier.discountCeilingBp : ...` (`quotation.service.ts:151`). Hardware lines are now governed by the tier alone — Gold gets the full 15%. Screen 17's footer changes to "Ceiling for this category: tier ceiling" (`products/[id]/page.tsx:179`).

### S18-3 — Deactivating a rule instead of deleting it

Untick "Active" on rule 2 and save. The row stays in the table and stays on this screen (`getGovernanceConfig` does not filter, `admin.service.ts:239`), but `loadRoutingRules` skips it (`quotation.service.ts:429`). A quote scoring 80 now only fires rule 1 and routes to `["SALES_MANAGER"]` — Finance drops out of the chain on the next confirm. Re-tick it and Finance is back. This is the only "delete" available anywhere in the admin area.

### S18-4 — You cannot put Finance first

The chain checkboxes are a `roles` field (`tiers/page.tsx:30`). Ticking a box does this (`entity-form.tsx:159`):

```ts
[...ROLE_OPTIONS.map((r) => r.value).filter((v) => v === o.value || arr.includes(v))]
```

It rebuilds the array from `ROLE_OPTIONS`, which is `[SALES_MANAGER, FINANCE]` in that fixed order (`entity-form.tsx:34-37`). So whatever you click, the stored chain is `["SALES_MANAGER"]`, `["FINANCE"]` or `["SALES_MANAGER","FINANCE"]` — never `["FINANCE","SALES_MANAGER"]`. The approval service walks the chain in order, so Finance-then-Manager is simply not expressible through this UI (the seed test data does contain a hand-inserted `["FINANCE","SALES_MANAGER","FINANCE"]` row, proving the column allows it).

Also: only two roles exist as approvers (`approverRoleSchema`, `validation/admin.ts:5`; `APPROVER_ROLES`, `contract.ts:59`). ADMIN and SALES_REP can never be in a chain.

### S18-5 — Setting `minScore` to 0 on any rule

`minScore: 0` makes `r.score >= 0` always true (`route.ts:14`), so that rule fires on **every** quote that needs review at all. Combined with a two-role chain, that means every overage of any size goes to Manager + Finance. The "Add rule" form pre-fills `minScore: 0` (`tiers/page.tsx:112`), so this is easy to do by accident. The seeded rule 1 deliberately uses `1`, not `0` — because `needsReview` has already filtered out the clean quotes, `1` and `0` behave the same in practice, but `1` documents the intent.

### S18-6 — A tiny overage that rounds the score to zero

A 1 bp overage on a small line: `worst = 1`, `blended` rounds to 0, no margin penalty. `raw = 0.5 × (1/1000) = 0.0005`, `score = round(100 × 0.0005) = 0` (`risk.ts:89`). No rule with `minScore >= 1` fires. But `needsReview` is still true because `worstOverageBp > 0` (`route.ts:8`), so `pool` falls back to `ordered.slice(0, 1)` — the lowest-sequence rule — and the quote goes to a Sales Manager (`route.ts:32`). The comment at `route.ts:25-27` says exactly this: "a violation can never slip through unreviewed".

### S18-7 — Setting a normaliser to zero

Set "Worst overage that scores full" to `0`. `zBp` allows it. At run time `ratio(value, 0)` returns `1` when the value is positive and `0` otherwise (`risk.ts:65`) — the guard against dividing by zero. Effect: **any** overage instantly saturates that whole term, so with the seeded weights a single 1 bp overage yields at least `0.50 × 1 = 0.50` → score 50 → `HIGH` band → rule 2 fires. A zero normaliser turns a soft gradient into a hard trip-wire. Nothing warns you.

### S18-8 — Two rules with the same sequence

Not possible: `sequence` is `@unique` (`schema.prisma:395`). The insert fails with `P2002` and you get "A record with this value already exists" with the error attached to `sequence` (`contract.ts:140-143`). Nothing is written, and the audit row rolls back with the transaction (`admin.service.ts:34-47`).

## 8. Schema behind this screen

**CustomerTier** — `prisma/schema.prisma:223-234`, table `customer_tier`. `name` unique. `customers` and `pricelistRules` relations. CHECK: `customer_tier_ceiling_bp_range` — `discount_ceiling_bp BETWEEN 0 AND 10000` (`migration.sql:1014`).

**ProductCategory** — `prisma/schema.prisma:306-318`, table `product_category`. `name` unique. `discountCeilingBp` is `Int?` with the schema comment "null = only the tier ceiling applies" (`:309`); `minMarginBp` has the comment "upsell suggestions below this are hidden" (`:310`). CHECKs: `product_category_ceiling_bp_range` (allows NULL) and `product_category_min_margin_range` (`migration.sql:1015-1016`).

**ApprovalRule** — `prisma/schema.prisma:393-406`, table `approval_rule`:

```prisma
model ApprovalRule {
  id                Int      @id @default(autoincrement())
  sequence          Int      @unique
  name              String
  minScore          Int      @map("min_score")               // 0..100
  maxWorstOverageBp Int?     @map("max_worst_overage_bp")     // fires when worst overage exceeds this
  maxOrderTotal     Int?     @map("max_order_total")          // paise; fires when the order total exceeds this
  chain             Json                                      // ordered Role[] e.g. ["SALES_MANAGER","FINANCE"]
  isActive          Boolean  @default(true) @map("is_active")
  updatedAt         DateTime @updatedAt @map("updated_at")
}
```

The model comment above it (`:392`) is the routing rule in one line: "One row per trigger; routing takes the longest chain among fired rules." CHECK: `approval_rule_min_score_range` (`migration.sql:1026`).

**RiskConfig** — `prisma/schema.prisma:408-426`, table `risk_config`, comment "Singleton (id = 1). Weights are integer percent, normalisers are basis points."

```prisma
model RiskConfig {
  id            Int      @id @default(1)
  wWorst        Int      @default(50)   @map("w_worst")
  wBlended      Int      @default(40)   @map("w_blended")
  wMargin       Int      @default(10)   @map("w_margin")
  normWorstBp   Int      @default(1000) @map("norm_worst_bp")
  normBlendedBp Int      @default(500)  @map("norm_blended_bp")
  normMarginBp  Int      @default(1000) @map("norm_margin_bp")
  floorMarginBp Int      @default(2000) @map("floor_margin_bp")
  stalledDays   Int      @default(3)    @map("stalled_days")
  anomalyZ      Float    @default(2.0)  @map("anomaly_z")
  anomalyAbsBp  Int      @default(1000) @map("anomaly_abs_bp")
  minHistory    Int      @default(5)    @map("min_history")
  updatedAt     DateTime @updatedAt     @map("updated_at")
  updatedById   Int?     @map("updated_by_id")
}
```

Two CHECK constraints hold it together (`prisma/migrations/20260905095100_init/migration.sql:1046-1047`):

```sql
ALTER TABLE "risk_config" ADD CONSTRAINT "risk_config_singleton"       CHECK ("id" = 1);
ALTER TABLE "risk_config" ADD CONSTRAINT "risk_config_weights_sum_100" CHECK ("w_worst" + "w_blended" + "w_margin" = 100);
```

The weights-sum constraint is the database's own copy of the Zod `.refine` at `validation/admin.ts:42`. Two independent guards for the same invariant, and a friendly message for the database one at `contract.ts:128`. `updated_by_id` has no foreign key and is never read back or displayed.

**AuditLog** — `prisma/schema.prisma:564-588`, table `audit_log`. Columns that matter here: `entity_type`, `entity_id`, `action`, `actor_type`, `actor_id`, `actor_name`, `actor_role`, `reason`, `before_json`, `after_json`, `at`. Indexed on `(entity_type, entity_id, at)` (`:582`), so "show me every change to approval rule 2" is a fast query.

## 9. How this screen connects to the others

- **← Screen 16 / 17**: the "Manage Price fields" button and the Pricelists tile land here. Screen 17's Category select and its "Ceiling for this category" footer read rows defined here.
- **→ Screen 4, the quote builder**: `quotation_line.ceiling_bp` is `min(tier, category)` from these two cards (`quotation.service.ts:151-152`), and the builder shows it as the "Limit" column (`quotes/[publicId]/page.tsx:145`). The risk preview under the totals is `riskPreview(...)` using this page's weights and rules (`quotation.service.ts:368`).
- **→ Screen 5 / 6, approvals**: the chain stored here becomes the `approval_step` rows created on confirm. The approval detail page recomputes the per-line overage from the snapshot (`approvals/[publicId]/page.tsx:47,113`).
- **→ Screen 14, Deal Health**: `stalledDays`, `anomalyZ`, `anomalyAbsBp`, `minHistory` from card 4 (`contract.ts:336-341`, `src/services/health.service.ts`).
- **→ Screen 4's upsell rail**: `min_margin_bp` from card 2 (`upsell.service.ts:80`).
- **→ Screen 17's price rules**: the Tier select there lists the rows from card 1 (`admin.service.ts:307`).

## 10. Gotchas

1. **Ceilings are snapshotted, routing is not.** Change a ceiling and existing quote lines keep their old `ceiling_bp` until the line is re-added or the customer is re-selected (`quotation.service.ts:106-111,151`). Change an approval rule or a weight and the very next recompute picks it up (`quotation.service.ts:361-362`). Two different freshness models on one screen. Scenario 4 in `16-admin-products.md` §7 walks it through.

2. **A Sales Manager can edit the rules that govern their own approvals.** See §2. This is the most consequential place where `BACKEND_ROLES` is wider than the spec's role table.

3. **`minMarginBp` is not the margin floor.** Card 2's "Min margin for upsell" (`product_category.min_margin_bp`) only filters upsell suggestions (`upsell.service.ts:80`). Card 4's "Margin floor" (`risk_config.floor_margin_bp`) is what the risk score penalises against (`risk.ts:84`). Similar names, unrelated mechanisms.

4. **The mockup's approval grid is three fixed rows; the code's is unbounded.** The mockup (docs/mockup/18-discount-tiers-and-approval-chain-setup.png) draws "Within tier/Category limit → No approval needed", "Over Limit, blended risk medium → Sales manager", "Over limit, blended high risk → Sales manager then finance". The code makes row 1 a built-in behaviour (the grey banner at `tiers/page.tsx:96`) and rows 2 and 3 ordinary editable `approval_rule` rows — and lets you add a fourth, a fifth, or delete them all. The mockup's "medium / high risk" wording maps onto `minScore` thresholds plus the `riskBand` helper (`contract.ts:247`: `>= 50` is HIGH, `> 0` is MEDIUM, else LOW), but the band itself is display-only; routing keys off `minScore`, not the band.

5. **Card 2 cannot set a category's `sortOrder`.** It is not a form field (`tiers/page.tsx:19-23`) and not in the save payload (`admin.service.ts:64`). New categories therefore all get `sortOrder = 0` (`schema.prisma:311`) and fall back to id order (`admin.service.ts:238`). The tier form does expose `sortOrder`.

6. **No admin save records a reason.** `saveRow` never passes one (`admin.service.ts:38-45`), so `audit_log.reason` is null for every configuration change (`audit.ts:36`). The spec's A3 note asks for edits to be logged "with user, timestamp, and reason" (docs/DealFlow360.txt:130-131). User (`actor_name`, `actor_role`) and timestamp (`at`) are there; reason is not. Adding it would mean a text field on each form plus one extra argument through `saveRow`.

7. **`admin.service.ts` still has no role guard of its own.** Same finding as Screens 16 and 17: `saveTier`, `saveCategory`, `saveApprovalRule` and `saveRiskConfig` all take a `SessionUser` and never inspect `user.role` (`admin.service.ts:50,63,76,97`). Called directly with a `SALES_REP` session they succeed, and the audit row records that rep as the actor. Enforcement lives only at `middleware.ts:25`, `admin/layout.tsx:7`, `tiers/page.tsx:48` and `actions/admin.ts:40`.

8. **There is no delete anywhere.** No tier, category or approval rule can be removed from the UI. `isActive` is the only off-switch, and only rules have it.
