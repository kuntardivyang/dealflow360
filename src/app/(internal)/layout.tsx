// Owner: B. Internal workspace frame: brand, module tabs, workspace actions, user.
// requireUser() redirects anonymous visitors to /login; tab visibility follows the role.
import { Separator } from "@/components/ui/separator";
import { AppNav } from "@/components/shell/app-nav";
import { Brand } from "@/components/shell/brand";
import { UserChip } from "@/components/shell/user-chip";
import { WorkspaceActions } from "@/components/shell/workspace-actions";
import { requireUser } from "@/lib/auth/internal";
import { canOpenBackend, visibleNavItems } from "@/lib/nav";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = visibleNavItems(user.role).map(({ label, href }) => ({ label, href }));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/80" data-print-hide>
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-4 px-4">
          <Brand />
          <AppNav items={items} />
          <div className="ml-auto flex items-center gap-3">
            <WorkspaceActions canOpenBackend={canOpenBackend(user.role)} />
            <Separator orientation="vertical" className="h-6" />
            <UserChip user={user} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
