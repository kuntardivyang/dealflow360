import { EmptyState, PageHeader } from "@/components/shared";

export const metadata = { title: "Approvals" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Approvals" description="Every quotation that needed, needs, or is going through discount approval." />
      <EmptyState title="No approvals to show yet" description="Confirming a quotation above its discount ceilings creates the first approval request automatically." />
    </div>
  );
}
