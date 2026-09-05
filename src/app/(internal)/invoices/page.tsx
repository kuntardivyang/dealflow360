import { EmptyState, PageHeader } from "@/components/shared";

export const metadata = { title: "Invoices" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Every invoice generated from one-time and recurring orders." />
      <EmptyState title="No invoices yet" description="Invoices are generated when an order is confirmed: one for one-time lines, one per recurring period." />
    </div>
  );
}
