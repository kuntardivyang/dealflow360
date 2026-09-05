import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { PortalLoginForm } from "@/components/portal/login-form";
import { getPortalUser, safePortalNext } from "@/lib/auth/portal";

export const metadata = { title: "Log in" };

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getPortalUser()) redirect(safePortalNext(next));
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)]">
      <header className="mx-auto w-full max-w-[1100px] px-4 py-5">
        <Brand href="/portal/login" />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16">
        <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-sm ring-1 ring-foreground/10">
          <div className="mb-6 space-y-1">
            <h1 className="font-heading text-xl font-semibold">Your quotation portal</h1>
            <p className="text-sm text-muted-foreground">Review, negotiate and confirm the quotations your sales representative sent you.</p>
          </div>
          <PortalLoginForm next={next ? safePortalNext(next) : undefined} />
        </div>
      </main>
      <footer className="pb-6 text-center text-xs text-muted-foreground">Internal user? Sign in at the DealFlow360 workspace instead.</footer>
    </div>
  );
}
