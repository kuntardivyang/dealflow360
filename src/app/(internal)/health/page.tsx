import { EmptyState, PageHeader } from "@/components/shared";

export const metadata = { title: "Deal Health" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Deal Health and Anomaly Dashboard" description="Real-time flags for stalled deals, unusual discount patterns and delivery slippage." />
      <EmptyState title="No alerts" description="Stalled quotes, discount anomalies and promise-date slippage will be listed here as they are detected." />
    </div>
  );
}
