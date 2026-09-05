// Owner: A. Screen 9, Subscriptions list: every recurring plan across every customer.
import { DataTable, EmptyState, PageHeader, StatTile, StatusBadge, type Column } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

const CYCLE = { WEEK: "Weekly", MONTH: "Monthly", QUARTER: "Quarterly", YEAR: "Yearly" } as const;

export default async function SubscriptionsPage() {
  await requireUser(undefined, "/subscriptions");
  const subs = await prisma.subscription.findMany({
    include: { customer: true, product: true, plan: true, schedule: { where: { status: "SCHEDULED" }, orderBy: { billDate: "asc" }, take: 1 } },
    orderBy: [{ status: "asc" }, { id: "desc" }],
  });
  const count = (s: string) => subs.filter((x) => x.status === s).length;
  type Row = (typeof subs)[number];
  const columns: Column<Row>[] = [
    { key: "customer", header: "Customer", cell: (s) => s.customer.name },
    { key: "plan", header: "Plan", cell: (s) => `${s.product.name} × ${s.qty}` },
    { key: "cycle", header: "Cycle", cell: (s) => CYCLE[s.plan.interval] },
    { key: "next", header: "Next bill", cell: (s) => (s.schedule[0] ? formatDate(s.schedule[0].billDate) : "–") },
    { key: "status", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Subscriptions" description="Every recurring plan across every customer, regardless of which order it came from." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Active" value={String(count("ACTIVE"))} />
        <StatTile label="Paused" value={String(count("PAUSED"))} />
        <StatTile label="Cancelled" value={String(count("CANCELLED"))} />
      </div>
      <DataTable columns={columns} rows={subs} rowKey={(s) => s.id} rowHref={(s) => `/subscriptions/${s.publicId}`} empty={<EmptyState title="No subscriptions yet" description="A confirmed order with a recurring line starts one." />} />
    </div>
  );
}
