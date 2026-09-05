// Owner: B. Screen 6, Approval detail: why the quote was flagged, the approval steps,
// the audit trail, and Approve / Return for Revision / Reject for the reviewer whose
// turn it is.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AuditTrail, EmptyState, Money, PageHeader, StatusBadge } from "@/components/shared";
import { ApprovalStepper } from "@/components/approvals/stepper";
import { DecisionPanel } from "@/components/approvals/decision-panel";
import { requireUser } from "@/lib/auth/internal";
import { riskBand } from "@/lib/contract";
import { formatBp, formatDateTime, formatPoints } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { actionableStep } from "@/lib/state";
import { getApprovalDetail } from "@/services/approval.service";

export const metadata = { title: "Approval Detail" };

export default async function ApprovalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ audit?: string }>;
}) {
  const [{ publicId }, { audit: highlightAudit }, user] = await Promise.all([params, searchParams, requireUser()]);
  const detail = await getApprovalDetail(publicId);
  if (!detail) notFound();
  const { quotation: q, current, chain, history } = detail;

  const band = riskBand(current.riskScore);
  const next = current.status === "PENDING" ? actionableStep(current.steps) : null;
  const canDecide =
    !!next && user.id !== q.repUserId && (user.role === "ADMIN" || user.role === next.requiredRole) && (q.status === "PENDING_APPROVAL");
  const blockedWhy = next
    ? user.id === q.repUserId
      ? "You submitted this quotation, so someone else has to review it."
      : user.role !== "ADMIN" && user.role !== next.requiredRole
        ? `This step is waiting for a ${ROLE_LABEL[next.requiredRole]}.`
        : null
    : null;

  const worst = q.lines.reduce((m, l) => Math.max(m, l.effectiveDiscountBp - l.ceilingBp), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            Approval Detail: {q.number} <span className="text-muted-foreground">({q.customer!.name})</span>
          </>
        }
        description={`Submitted by ${q.rep.name}. Request v${current.version}${history.length ? `, ${history.length} earlier version${history.length > 1 ? "s" : ""} superseded` : ""}.`}
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href={`/quotes/${q.publicId}`} />}>
            Open quotation <ArrowUpRight />
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="inline-flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 ring-1 ring-foreground/10">
          Blended Risk <StatusBadge status={band} /> <span className="tabular-nums text-muted-foreground">score {current.riskScore}</span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 ring-1 ring-foreground/10">
          Customer Tier <span className="font-medium">{q.customer!.tier.name}</span>
          <span className="text-muted-foreground">(ceiling {formatBp(q.customer!.tier.discountCeilingBp)})</span>
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 ring-1 ring-foreground/10">
          Quotation <StatusBadge status={q.status} />
          <span className="text-muted-foreground">
            total <Money paise={q.total} /> · margin {formatBp(q.marginBp)}
          </span>
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(280px,340px)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Why This Quote Was Flagged</CardTitle>
              <CardDescription>
                Every line is checked against its own limit, the stricter of the customer tier and the product category. The worst single line
                ({formatPoints(worst)} over) plus the value-weighted pattern across the order set the blended score. One bad line is enough to require
                approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">Line</TableHead>
                    <TableHead className="text-right">Discount Given</TableHead>
                    <TableHead className="text-right">Limit Allowed</TableHead>
                    <TableHead className="px-4 text-right">Over By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.lines.map((l) => {
                    const over = l.effectiveDiscountBp - l.ceilingBp;
                    return (
                      <TableRow key={l.id} className={cn(over > 0 && "bg-destructive/5 hover:bg-destructive/10")}>
                        <TableCell className="px-4">
                          <span className="font-medium">{l.description}</span>{" "}
                          <span className="text-muted-foreground">({l.product.category.name})</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBp(l.effectiveDiscountBp)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBp(l.ceilingBp)}</TableCell>
                        <TableCell className="px-4 text-right">
                          {over > 0 ? (
                            <StatusBadge status="OVER" label={`${formatPoints(over)} OVER`} />
                          ) : (
                            <StatusBadge status="OK" label="0 pt - OK" />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit Trail</CardTitle>
              <CardDescription>Every approval, rejection, edit and portal request, with user, time and reason.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {q.auditLogs.length === 0 ? <EmptyState className="mx-4 py-8" title="No entries yet" /> : <AuditTrail className="px-3" entries={q.auditLogs} subject={q.number} highlightId={highlightAudit} />}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Approval Steps</CardTitle>
              <CardDescription>{chain.length === 1 ? "Sales Manager only." : "Sales Manager, then Finance."}</CardDescription>
            </CardHeader>
            <CardContent>
              <ApprovalStepper
                steps={current.steps.map((s) => ({
                  stepNo: s.stepNo,
                  role: ROLE_LABEL[s.requiredRole],
                  status: s.status,
                  actedBy: s.actedBy?.name ?? null,
                  actedAt: s.actedAt ? formatDateTime(s.actedAt) : null,
                  note: s.note,
                }))}
                requestStatus={current.status}
                quotationStatus={q.status}
                submittedAt={formatDateTime(current.createdAt)}
              />
            </CardContent>
          </Card>

          {next ? (
            <DecisionPanel requestId={current.id} stepId={next.id} stepRole={ROLE_LABEL[next.requiredRole]} canDecide={canDecide} blockedWhy={blockedWhy} />
          ) : (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Decision</CardTitle>
                <CardDescription>
                  {current.status === "APPROVED" && "Approved. The rep can now send it to the customer."}
                  {current.status === "REJECTED" && `Rejected${current.reason ? `: ${current.reason}` : ""}.`}
                  {current.status === "RETURNED" && `Returned for revision${current.reason ? `: ${current.reason}` : ""}. The rep edits and confirms again.`}
                  {current.status === "SUPERSEDED" && "Superseded by a newer version."}
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
