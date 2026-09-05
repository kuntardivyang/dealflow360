// Placeholder home by B for the shell hand-off. A replaces this file in feature 85
// (Sales Dashboard / Home). Counts are live from the database so the frame is never empty.
import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { createQuotationAndOpen } from "@/app/(internal)/actions/quotation";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, StatTile } from "@/components/shared";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [pendingApprovals, openQuotations, atRisk, recent] = await Promise.all([
    prisma.quotation.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.quotation.count({ where: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "UNDER_NEGOTIATION"] } } }),
    prisma.dealAlert.count({ where: { resolvedAt: null } }),
    prisma.auditLog.findMany({
      orderBy: { at: "desc" },
      take: 6,
      include: { quotation: { select: { number: true, publicId: true, customer: { select: { name: true } } } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Dashboard"
        description="Central hub: pending approvals, open deals and everything Deal Health has flagged."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<Link href="/approvals" />}>
              View Approvals
            </Button>
            <form action={createQuotationAndOpen}>
              <Button type="submit">
                <Plus /> New Quotation
              </Button>
            </form>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Pending Approvals"
          value={pendingApprovals}
          caption={`${pendingApprovals === 1 ? "quotation" : "quotations"} waiting for a reviewer`}
          href="/approvals"
          tone={pendingApprovals > 0 ? "warning" : "default"}
        />
        <StatTile label="Open Quotations" value={openQuotations} caption="active deals not yet confirmed" href="/quotes" />
        <StatTile
          label="At-Risk Deals"
          value={atRisk}
          caption="flagged by Deal Health"
          href="/health"
          tone={atRisk > 0 ? "danger" : "default"}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState className="py-8" title="No activity yet" description="Every approval, edit, portal request and payment shows up here." />
          ) : (
            <ul className="divide-y">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span>
                    <span className="font-medium">{a.actorName}</span> {a.action.toLowerCase().replaceAll("_", " ")}
                    {a.quotation ? (
                      <>
                        {" "}
                        <Link href={`/quotes/${a.quotation.publicId}`} className="text-primary hover:underline">
                          {a.quotation.number}
                        </Link>{" "}
                        <span className="text-muted-foreground">({a.quotation.customer?.name ?? "no customer"})</span>
                      </>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
