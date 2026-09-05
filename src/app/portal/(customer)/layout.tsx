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
      <header className="border-b bg-card" data-print-hide>
        <div className="mx-auto flex h-16 w-full max-w-[1040px] items-center gap-6 px-6">
          <Brand href="/portal" />
          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
          <span className="hidden text-sm sm:block">
            <span className="block font-semibold leading-tight">{user.customerName}</span>
            <span className="block text-xs text-muted-foreground">Customer portal · {user.contactName}</span>
          </span>
          <div className="ml-auto flex items-center gap-4">
            <PortalNav />
            <form action={portalLogoutAction}>
              <Button type="submit" variant="outline" size="sm">
                <LogOut /> Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1040px] flex-1 px-6 py-8">{children}</main>
      <footer className="mx-auto w-full max-w-[1040px] px-6 pb-8 text-xs text-muted-foreground" data-print-hide>
        Questions about a quotation? Use Messages and your sales representative will answer here.
      </footer>
    </div>
  );
}
