import Link from "next/link";
import { ArrowRight, Gauge, Package, Percent, Repeat, Users, Warehouse, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/shared";
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";

export const metadata = { title: "Back-end" };

const SECTIONS: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  { title: "Discount tiers and approval chains", description: "Tier and category ceilings, and which discount range needs which approvers.", href: "/admin/tiers", icon: Percent },
  { title: "Warehouses and stock", description: "Warehouses, shipping cost weighting, stock levels and reorder points.", href: "/admin/warehouses", icon: Warehouse },
  { title: "Subscription plans", description: "Billing intervals, proration, cancellation and refund rules.", href: "/admin/plans", icon: Repeat },
  { title: "Products and price lists", description: "Catalogue, variants, tax and tier-based price rules.", href: "/admin/products", icon: Package },
  { title: "Users and roles", description: "Internal users, their roles and reporting managers.", href: "/admin/users", icon: Users },
  { title: "Risk configuration", description: "Score weights, normalisers, margin floor, stalled-deal and anomaly thresholds.", href: "/admin/tiers#risk", icon: Gauge },
];

export default async function AdminPage() {
  await requireUser(BACKEND_ROLES);
  return (
    <div className="space-y-6">
      <PageHeader title="Back-end configuration" description="Everything the deal engine reads at runtime lives in these tables. Nothing is hard-coded." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <div className="surface surface-interactive flex h-full flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <s.icon className="size-[18px]" strokeWidth={1.75} />
                </span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div>
                <h2 className="font-heading text-[15px] font-bold tracking-tight">{s.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
