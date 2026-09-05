import { EmptyState, PageHeader } from "@/components/shared";

export const metadata = { title: "Products" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="Product catalog" description="Every product, variant and price list in one place." />
      <EmptyState title="Catalogue screen arrives with the admin merge" description="The seed already holds 8 products in 3 categories; the editor is on its way." />
    </div>
  );
}
