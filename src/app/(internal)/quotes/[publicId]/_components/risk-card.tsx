// Feature 35: the approval preview. Score, band, the three components, and the chain
// confirm would trigger. Plain component, used by the server page and the client builder.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared";
import type { RiskPreview } from "@/lib/contract";
import { formatBp, formatPoints } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = { SALES_MANAGER: "Sales Manager", FINANCE: "Finance" };

export function chainLabel(chain: readonly string[]): string {
  return chain.length === 0 ? "No approval needed" : chain.map((r) => ROLE_LABEL[r] ?? r).join(" → ");
}

export function RiskCard({ risk, hasLines }: { risk: RiskPreview | null; hasLines: boolean }) {
  return (
    <Card data-print-hide>
      <CardHeader>
        <CardTitle className="text-base">Approval preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!risk || !hasLines ? (
          <p className="text-muted-foreground">Add lines to see the blended risk score.</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="font-heading text-[34px] leading-none font-bold tracking-[-0.03em] tabular-nums">{risk.score}</span>
              <div>
                <p className="text-xs text-muted-foreground">Blended risk / 100</p>
                <StatusBadge status={risk.band} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-y-1.5 border-t pt-3 tabular-nums">
              <dt className="text-muted-foreground">Worst line overage</dt>
              <dd className="text-right">{formatPoints(risk.worstOverageBp)}</dd>
              <dt className="text-muted-foreground">Blended overage</dt>
              <dd className="text-right">{formatPoints(risk.blendedOverageBp)}</dd>
              <dt className="text-muted-foreground">Margin</dt>
              <dd className="text-right">{formatBp(risk.marginBp)}</dd>
              <dt className="text-muted-foreground">Margin penalty</dt>
              <dd className="text-right">{formatPoints(risk.marginPenaltyBp)}</dd>
            </dl>
            <p className={risk.chain.length ? "font-medium text-warning" : "font-medium text-success"}>
              {risk.chain.length ? `On confirm, routes to: ${chainLabel(risk.chain)}` : "Within every limit: confirm goes straight through."}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
