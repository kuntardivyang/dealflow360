import { EmptyState, PageHeader } from "@/components/shared";

export const metadata = { title: "Subscriptions" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Subscriptions" description="Every recurring plan across every customer, regardless of which order it came from." />
      <EmptyState title="No subscriptions yet" description="Recurring lines on a confirmed order create subscriptions with a billing schedule." />
    </div>
  );
}
