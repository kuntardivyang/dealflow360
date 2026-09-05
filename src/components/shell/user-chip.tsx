import Link from "next/link";
import type { SessionUser } from "@/lib/contract";
import { ROLE_LABEL } from "@/lib/labels";
import { initials } from "@/lib/format";

/** Who is signed in, with their role. */
export function UserChip({ user }: { user: SessionUser | null }) {
  if (!user) {
    return (
      <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
        Not signed in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2.5" title={user.email}>
      <span className="flex size-8 items-center justify-center rounded-full bg-ink font-heading text-xs font-bold tracking-wide text-ink-foreground">
        {initials(user.name)}
      </span>
      <span className="hidden shrink-0 leading-tight whitespace-nowrap xl:block">
        <span className="block text-sm font-semibold">{user.name}</span>
        <span className="block text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</span>
      </span>
    </div>
  );
}
