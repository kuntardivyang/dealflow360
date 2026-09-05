// Owner: B. Screen 11, Customer Portal Negotiation: the quotation as the customer sees it
// (whitelist DTO only), line-level comments, counter discount, Submit Request, Confirm.
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Money, PageHeader, StatusBadge } from "@/components/shared";
import { NegotiationForm } from "@/components/portal/negotiation-form";
import { requirePortal } from "@/lib/auth/portal";
import { NotFoundError, type PortalQuotationDTO } from "@/lib/contract";
import { formatBp, formatDateTime } from "@/lib/format";
import { getPortalQuotation } from "@/services/portal.service";

export const metadata = { title: "Quotation" };

const STATUS_CODE: Record<PortalQuotationDTO["status"], string> = {
  Sent: "SENT",
  "Under Negotiation": "UNDER_NEGOTIATION",
  "Awaiting internal approval": "PENDING_APPROVAL",
  Confirmed: "CONFIRMED",
};
const TYPE_LABEL = { COMMENT: "Comment", CHANGE_REQUEST: "Change request", COUNTER_DISCOUNT: "Counter" } as const;

export default async function PortalQuotationPage({ params }: { params: Promise<{ publicId: string }> }) {
  const [{ publicId }, user] = await Promise.all([params, requirePortal()]);
  let q: PortalQuotationDTO;
  try {
    q = await getPortalQuotation(publicId, user);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const latestForLine = (lineId: number) => q.requests.find((r) => r.lineId === lineId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            Quotation {q.number} <span className="text-muted-foreground">for {q.customerName}</span>
          </>
        }
        description="Review the lines, ask questions or counter a discount, then confirm. No email needed."
        actions={<StatusBadge status={STATUS_CODE[q.status]} label={q.status} className="h-7 px-3 text-sm" />}
      />

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="px-4">Line</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Line total</TableHead>
              <TableHead className="px-4">Customer Comment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.lines.map((l) => {
              const r = latestForLine(l.id);
              return (
                <TableRow key={l.id}>
                  <TableCell className="px-4 font-medium">{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                  <TableCell className="text-right">
                    <Money paise={l.unitPrice} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBp(l.discountBp)}</TableCell>
                  <TableCell className="text-right">
                    <Money paise={l.lineTotal} />
                    <span className="block text-xs text-muted-foreground">incl. {formatBp(l.taxBp)} tax</span>
                  </TableCell>
                  <TableCell className="px-4 whitespace-normal text-muted-foreground">
                    {r ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className="text-foreground">{r.message ?? `${TYPE_LABEL[r.type]}${r.proposedDiscountBp !== null ? ` ${formatBp(r.proposedDiscountBp)}` : ""}`}</span>
                        <StatusBadge status={r.status} />
                      </span>
                    ) : (
                      "–"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-end gap-6 border-t bg-muted/30 px-4 py-3 text-sm">
          <span>
            Subtotal <Money paise={q.netTotal} className="font-medium" />
          </span>
          <span>
            Tax <Money paise={q.taxTotal} className="font-medium" />
          </span>
          <span className="text-base">
            Total <Money paise={q.total} className="font-semibold" />
          </span>
        </div>
      </div>

      <NegotiationForm quotation={q} />

      {q.requests.length > 0 ? (
        <section id="messages" className="space-y-2">
          <h2 className="font-heading text-base font-semibold">Your requests</h2>
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {q.requests.map((r) => {
              const line = r.lineId ? q.lines.find((l) => l.id === r.lineId) : null;
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{TYPE_LABEL[r.type]}</span>
                      {line ? <span className="text-muted-foreground">· {line.name}</span> : null}
                      {r.proposedDiscountBp !== null ? <span className="text-muted-foreground">· {formatBp(r.proposedDiscountBp)} proposed</span> : null}
                      <StatusBadge status={r.status} />
                    </div>
                    {r.message ? <p>{r.message}</p> : null}
                    {r.responseNote ? <p className="text-muted-foreground">Reply: {r.responseNote}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
