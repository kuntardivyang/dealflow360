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
    <div className="flex items-center gap-2" title={user.email}>
      <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {initials(user.name)}
      </span>
      <span className="hidden leading-tight lg:block">
        <span className="block text-sm font-medium">{user.name}</span>
        <span className="block text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</span>
      </span>
    </div>
  );
}
