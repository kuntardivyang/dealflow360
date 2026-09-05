import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/shared";
import { requirePortal } from "@/lib/auth/portal";
import { formatBp, formatDateTime } from "@/lib/format";
import { listPortalQuotations } from "@/services/portal.service";

export const metadata = { title: "Messages" };

const TYPE_LABEL = { COMMENT: "Comment", CHANGE_REQUEST: "Change request", COUNTER_DISCOUNT: "Counter discount" } as const;

export default async function MessagesPage() {
  const user = await requirePortal();
  const quotes = await listPortalQuotations(user);
  const items = quotes.flatMap((q) => q.requests.map((r) => ({ ...r, quotation: q })));
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="space-y-6">
      <PageHeader title="Messages" description="Everything you asked your sales representative, and their answers." />
      {items.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No messages yet" description="Comments, change requests and counter-offers you submit on a quotation show up here." />
      ) : (
        <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
          {items.map((r) => {
            const line = r.lineId ? r.quotation.lines.find((l) => l.id === r.lineId) : null;
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/portal/q/${r.quotation.publicId}`} className="font-medium text-primary hover:underline">
                      {r.quotation.number}
                    </Link>
                    <span className="text-muted-foreground">{TYPE_LABEL[r.type]}</span>
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
      )}
    </div>
  );
}
