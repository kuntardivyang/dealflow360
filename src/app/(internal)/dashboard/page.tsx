// Placeholder home by B for the shell hand-off. A replaces this file in feature 85
// (Sales Dashboard / Home). Counts are live from the database so the frame is never empty.
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
            <Link href="/quotes" className={buttonVariants()}>
              <Plus /> New Quotation
            </Link>
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
        <CardHeader className="border-b">
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Every approval, edit, portal request and payment, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {recent.length === 0 ? (
            <EmptyState className="mx-4 border-0 bg-transparent py-8" title="No activity yet" description="Every approval, edit, portal request and payment shows up here." />
          ) : (
            <ol className="divide-y divide-border/80">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{a.actorName}</span>{" "}
                    <span className="text-muted-foreground">{a.action.toLowerCase().replaceAll("_", " ")}</span>
                    {a.quotation ? (
                      <>
                        {" "}
                        <Link href={`/quotes/${a.quotation.publicId}`} className="inline-flex items-center gap-0.5 font-medium text-link hover:underline">
                          {a.quotation.number}
                          <ArrowUpRight className="size-3.5" />
                        </Link>{" "}
                        <span className="text-muted-foreground">{a.quotation.customer.name}</span>
                      </>
                    ) : null}
                  </span>
                  <time className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(a.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
