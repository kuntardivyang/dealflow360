// Owner: B. Frame for login and signup (mockup screen 1, "Login / Signup").
// Split layout: the left panel shows the one idea the product is built on, a quotation
// whose lines are checked against their own ceilings; the right column holds the form.
import { Brand } from "@/components/shell/brand";
import { LedgerHero } from "@/components/auth/ledger-hero";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="ink-panel relative hidden overflow-hidden lg:flex lg:flex-col" aria-label="About DealFlow360">
        <div aria-hidden className="ledger-grid absolute inset-0" />
        <div className="relative flex h-full flex-col px-12 py-10 xl:px-16">
          <Brand href="/" tone="inverse" />
          <div className="my-auto max-w-xl py-10">
            <p className="text-sm font-medium text-ink-foreground/60">Login / Signup. Entry point for internal users and customers.</p>
            <h2 className="mt-4 font-heading text-[40px] leading-[1.05] font-extrabold tracking-[-0.03em] text-ink-foreground xl:text-[46px]">
              Quote to cash, with the guardrails already in the quote.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-foreground/70">
              Every line is checked against its own discount ceiling as it is typed. Anything over is routed to the right approver by blended
              risk, then split across warehouses, billed as one-time and recurring, and confirmed by the customer in their own portal.
            </p>
            <LedgerHero className="mt-10" />
          </div>
          <dl className="grid grid-cols-3 gap-6 border-t border-ink-foreground/15 pt-6 text-ink-foreground/70">
            <div>
              <dt className="text-xs">Discount governance</dt>
              <dd className="mt-1 text-sm font-semibold text-ink-foreground">Tier and category ceilings</dd>
            </div>
            <div>
              <dt className="text-xs">Approvals</dt>
              <dd className="mt-1 text-sm font-semibold text-ink-foreground">Routed by blended risk</dd>
            </div>
            <div>
              <dt className="text-xs">After the yes</dt>
              <dd className="mt-1 text-sm font-semibold text-ink-foreground">Splits, hybrid billing, portal</dd>
            </div>
          </dl>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="px-6 py-5 lg:hidden">
          <Brand href="/" />
        </header>
        <main className="flex flex-1 items-center justify-center px-6 py-8">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>
        <footer className="px-6 pb-6 text-center text-xs leading-relaxed text-muted-foreground">
          After login, internal users land on the Sales Dashboard. Customers land on their Quotation Portal.
        </footer>
      </div>
    </div>
  );
}
