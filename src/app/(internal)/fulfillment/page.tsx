import { EmptyState, PageHeader } from "@/components/shared";

export const metadata = { title: "Fulfillment" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Fulfillment and Stock" description="Live stock per warehouse, plus every order that still needs fulfilling." />
      <EmptyState title="Nothing to fulfil yet" description="Confirmed orders appear here with their recommended warehouse split." />
    </div>
  );
}
