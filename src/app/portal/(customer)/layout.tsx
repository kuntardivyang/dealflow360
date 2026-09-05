// Owner: B. Signed-in customer frame: My Quotations / Messages / Profile (mockup screen 11).
import { PortalNav } from "@/components/portal/portal-nav";
import { Brand } from "@/components/shell/brand";
import { portalLogoutAction } from "@/app/portal/actions";
import { Button } from "@/components/ui/button";
import { requirePortal } from "@/lib/auth/portal";
import { LogOut } from "lucide-react";

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePortal();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur" data-print-hide>
        <div className="mx-auto flex h-14 w-full max-w-[1100px] items-center gap-4 px-4">
          <Brand href="/portal" />
          <PortalNav />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {user.contactName} · <span className="font-medium text-foreground">{user.customerName}</span>
            </span>
            <form action={portalLogoutAction}>
              <Button type="submit" variant="outline" size="sm">
                <LogOut /> Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
