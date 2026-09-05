// Owner: B. Subscription / recurring plan setup (PDF A5): interval, proration, cancellation and refund rules.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";
import { EntityForm, type FieldDef } from "@/components/admin/entity-form";
import { savePlan } from "@/app/(internal)/actions/admin";
import { getPlans } from "@/services/admin.service";

export const metadata = { title: "Subscription plans" };

export default async function PlansPage() {
  await requireUser(BACKEND_ROLES);
  const { plans, products } = await getPlans();
  const fields: FieldDef[] = [
    { name: "name", label: "Plan", type: "text", width: "w-36" },
    {
      name: "interval",
      label: "Cycle",
      type: "select",
      width: "w-28",
      options: [
        { value: "WEEK", label: "Weekly" },
        { value: "MONTH", label: "Monthly" },
        { value: "QUARTER", label: "Quarterly" },
        { value: "YEAR", label: "Yearly" },
      ],
    },
    { name: "periods", label: "Schedule periods", type: "number", width: "w-28", min: 1 },
    {
      name: "prorationMode",
      label: "Proration",
      type: "select",
      width: "w-32",
      options: [
        { value: "DAY_BASED", label: "Day based" },
        { value: "NONE", label: "None" },
      ],
    },
    { name: "billChangeDay", label: "Bill the change day", type: "checkbox" },
    {
      name: "cancelPolicy",
      label: "Cancellation",
      type: "select",
      width: "w-48",
      options: [
        { value: "END_OF_PERIOD", label: "End of period" },
        { value: "IMMEDIATE_PRORATED_REFUND", label: "Immediate, prorated refund" },
        { value: "NO_REFUND", label: "Immediate, no refund" },
      ],
    },
    {
      name: "refundMethod",
      label: "Refund as",
      type: "select",
      width: "w-36",
      options: [
        { value: "CREDIT_NOTE", label: "Credit note" },
        { value: "REFUND_PAYMENT", label: "Refund payment" },
      ],
    },
    { name: "productId", label: "Limited to product", type: "select", nullable: true, width: "w-44", options: products.map((p) => ({ value: String(p.id), label: p.name })) },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription plans"
        description="Recurring plans attach to subscription products on a quotation. Proration and cancellation rules here drive mid-cycle changes and credit notes."
      />
      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>Day-based proration charges or credits the remaining calendar days of the real period; the change day is billed when ticked.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plans.map((p) => (
            <EntityForm key={p.id} layout="inline" fields={fields} initial={{ ...p, productId: p.productId ?? "" }} hidden={{ id: p.id }} action={savePlan} successMessage={`${p.name} saved`} />
          ))}
          <div className="border-t pt-3">
            <EntityForm
              layout="inline"
              fields={fields}
              initial={{ interval: "MONTH", periods: 12, prorationMode: "DAY_BASED", billChangeDay: true, cancelPolicy: "IMMEDIATE_PRORATED_REFUND", refundMethod: "CREDIT_NOTE" }}
              action={savePlan}
              submitLabel="Add plan"
              successMessage="Plan created"
              resetOnSuccess
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
