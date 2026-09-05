import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";

export const metadata = { title: "Back-end" };

const SECTIONS = [
  { title: "Discount tiers and approval chains", description: "Tier and category ceilings, and which discount range needs which approvers.", href: "/admin/tiers" },
  { title: "Warehouses and stock", description: "Warehouses, shipping cost weighting, stock levels and reorder points.", href: "/admin/warehouses" },
  { title: "Subscription plans", description: "Billing intervals, proration, cancellation and refund rules.", href: "/admin/plans" },
  { title: "Products and price lists", description: "Catalogue, variants, tax and tier-based price rules.", href: "/admin/products" },
  { title: "Users and roles", description: "Internal users, their roles and reporting managers.", href: "/admin/users" },
  { title: "Risk configuration", description: "Score weights, normalisers, margin floor, stalled-deal and anomaly thresholds.", href: "/admin/tiers#risk" },
];

export default async function AdminPage() {
  await requireUser(BACKEND_ROLES);
  return (
    <div className="space-y-6">
      <PageHeader title="Back-end configuration" description="Everything the deal engine reads at runtime lives in these tables. Nothing is hard-coded." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <Card size="sm" className="h-full transition-shadow group-hover:ring-foreground/20">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {s.title}
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
