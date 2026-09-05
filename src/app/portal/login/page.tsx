import { redirect } from "next/navigation";
import { Brand } from "@/components/shell/brand";
import { PortalLoginForm } from "@/components/portal/login-form";
import { getPortalUser, safePortalNext } from "@/lib/auth/portal";

export const metadata = { title: "Log in" };

export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getPortalUser()) redirect(safePortalNext(next));
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto w-full max-w-[1040px] px-6 py-6">
        <Brand href="/portal/login" />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="grid w-full max-w-3xl items-center gap-10 md:grid-cols-[1fr_360px]">
          <div className="max-w-sm">
            <p className="text-sm font-medium text-link">Customer portal</p>
            <h1 className="mt-2 font-heading text-[34px] leading-[1.1] font-bold tracking-[-0.025em]">Your quotation, ready to review.</h1>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Read every line, ask a question, counter a discount or move a delivery date, then confirm when the terms are right. No email
              threads.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-link" /> Line-by-line prices with tax included
              </li>
              <li className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-link" /> Counter-offers answered inside the portal
              </li>
              <li className="flex gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-link" /> One click to confirm, recorded with your name
              </li>
            </ul>
          </div>
          <div className="surface p-6">
            <div className="mb-5">
              <h2 className="font-heading text-lg font-bold tracking-tight">Log in</h2>
              <p className="mt-1 text-sm text-muted-foreground">Use the details your sales representative shared with the quotation link.</p>
            </div>
            <PortalLoginForm next={next ? safePortalNext(next) : undefined} />
          </div>
        </div>
      </main>
      <footer className="pb-6 text-center text-xs text-muted-foreground">Internal user? Sign in at the DealFlow360 workspace instead.</footer>
    </div>
  );
}
