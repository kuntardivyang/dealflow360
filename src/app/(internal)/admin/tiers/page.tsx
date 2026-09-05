// Owner: B. Screen 18, Discount tiers and approval chains (PDF A3). Tier ceilings,
// category ceilings, the approval rules that turn a risk result into a chain, and the
// risk configuration. Everything here is read live by the quote engine.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";
import { EntityForm, type FieldDef } from "@/components/admin/entity-form";
import { saveApprovalRule, saveCategory, saveRiskConfig, saveTier } from "@/app/(internal)/actions/admin";
import { getGovernanceConfig, jsonChain } from "@/services/admin.service";

export const metadata = { title: "Discount tiers and approval chains" };

const TIER_FIELDS: FieldDef[] = [
  { name: "name", label: "Tier", type: "text", width: "w-40" },
  { name: "discountCeilingBp", label: "Max discount", type: "percent", width: "w-32" },
  { name: "sortOrder", label: "Order", type: "number", width: "w-20" },
];
const CATEGORY_FIELDS: FieldDef[] = [
  { name: "name", label: "Category", type: "text", width: "w-40" },
  { name: "discountCeilingBp", label: "Max discount", type: "percent", nullable: true, width: "w-32", placeholder: "tier only" },
  { name: "minMarginBp", label: "Min margin for upsell", type: "percent", width: "w-40" },
];
const RULE_FIELDS: FieldDef[] = [
  { name: "sequence", label: "Seq", type: "number", width: "w-16" },
  { name: "name", label: "Discount range", type: "text", width: "w-56" },
  { name: "minScore", label: "Score ≥", type: "number", width: "w-20" },
  { name: "maxWorstOverageBp", label: "Worst line over (pt)", type: "percent", nullable: true, width: "w-36" },
  { name: "maxOrderTotal", label: "Order total above", type: "rupees", nullable: true, width: "w-40" },
  { name: "chain", label: "Approval needed", type: "roles" },
  { name: "isActive", label: "Active", type: "checkbox" },
];
const RISK_FIELDS: FieldDef[] = [
  { name: "wWorst", label: "Weight: worst line (%)", type: "number", hint: "Weights add up to 100." },
  { name: "wBlended", label: "Weight: blended overage (%)", type: "number" },
  { name: "wMargin", label: "Weight: margin shortfall (%)", type: "number" },
  { name: "normWorstBp", label: "Worst overage that scores full (pt)", type: "percent" },
  { name: "normBlendedBp", label: "Blended overage that scores full (pt)", type: "percent" },
  { name: "normMarginBp", label: "Margin shortfall that scores full (pt)", type: "percent" },
  { name: "floorMarginBp", label: "Margin floor", type: "percent" },
  { name: "stalledDays", label: "Stalled after (days)", type: "number" },
  { name: "anomalyZ", label: "Anomaly z-score", type: "number", step: 0.1 },
  { name: "anomalyAbsBp", label: "Anomaly: points above rep average", type: "percent" },
  { name: "minHistory", label: "Minimum quotes for a rep average", type: "number" },
];

export default async function TiersPage() {
  await requireUser(BACKEND_ROLES);
  const { tiers, categories, rules, riskConfig } = await getGovernanceConfig();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Discount tiers and approval chains"
        description="Each line is checked against the stricter of its customer tier and product category ceiling. When a quote mixes categories, the blended risk score routes it to the highest level any rule below demands. Every save is logged."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tier Discount Ceilings</CardTitle>
            <CardDescription>Bronze up to 5 %, Silver 10 %, Gold 15 % in the demo seed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {tiers.map((t) => (
              <EntityForm key={t.id} layout="inline" fields={TIER_FIELDS} initial={t} hidden={{ id: t.id }} action={saveTier} successMessage={`${t.name} saved`} />
            ))}
            <div className="border-t pt-3">
              <EntityForm layout="inline" fields={TIER_FIELDS} initial={{ sortOrder: tiers.length + 1 }} action={saveTier} submitLabel="Add tier" successMessage="Tier created" resetOnSuccess />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Category Discount Ceilings</CardTitle>
            <CardDescription>Some categories allow more discretion than others. Leave the ceiling empty to use the tier ceiling alone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {categories.map((c) => (
              <EntityForm key={c.id} layout="inline" fields={CATEGORY_FIELDS} initial={c} hidden={{ id: c.id }} action={saveCategory} successMessage={`${c.name} saved`} />
            ))}
            <div className="border-t pt-3">
              <EntityForm layout="inline" fields={CATEGORY_FIELDS} action={saveCategory} submitLabel="Add category" successMessage="Category created" resetOnSuccess />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approval chain</CardTitle>
          <CardDescription>
            Within tier and category limits: no approval needed. Otherwise every rule whose trigger fires (score, worst line overage, or order total) contributes its chain and the
            longest one wins. Change a threshold here and re-confirm a quote: the steps change without a restart.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Within tier / category limit → no approval needed (built in: an empty chain).</div>
          {rules.map((r) => (
            <EntityForm
              key={r.id}
              layout="inline"
              fields={RULE_FIELDS}
              initial={{ ...r, chain: jsonChain(r.chain) }}
              hidden={{ id: r.id }}
              action={saveApprovalRule}
              successMessage={`Rule ${r.sequence} saved`}
            />
          ))}
          <div className="border-t pt-3">
            <EntityForm
              layout="inline"
              fields={RULE_FIELDS}
              initial={{ sequence: (rules.at(-1)?.sequence ?? 0) + 1, minScore: 0, chain: ["SALES_MANAGER"], isActive: true }}
              action={saveApprovalRule}
              submitLabel="Add rule"
              successMessage="Rule created"
              resetOnSuccess
            />
          </div>
        </CardContent>
      </Card>

      <Card id="risk">
        <CardHeader>
          <CardTitle>Risk configuration</CardTitle>
          <CardDescription>
            score = worst-line weight × worst overage + blended weight × value-weighted overage + margin weight × shortfall under the floor, each scaled by the amount that scores full,
            clamped to 0..100. Stalled-deal and anomaly thresholds for Deal Health live here too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EntityForm fields={RISK_FIELDS} initial={riskConfig ?? {}} action={saveRiskConfig} submitLabel="Save configuration" successMessage="Risk configuration saved" className="lg:grid-cols-3" />
        </CardContent>
      </Card>
    </div>
  );
}
