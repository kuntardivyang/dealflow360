import { EmptyState, PageHeader } from "@/components/shared";

export const metadata = { title: "Reports" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Admin / Reporting Dashboard" description="Sales trends, approval bottlenecks and platform usage, with PDF and XLS export." />
      <EmptyState title="No report data yet" description="Filter by period, sales team, approval status and product once quotations start flowing." />
    </div>
  );
}
