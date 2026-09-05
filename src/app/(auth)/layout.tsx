// Owner: B. Frame for login and signup: no workspace navigation, centered card.
import { Brand } from "@/components/shell/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)]">
      <header className="mx-auto w-full max-w-[1400px] px-4 py-5">
        <Brand href="/" />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6">
        <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-sm ring-1 ring-foreground/10">{children}</div>
      </main>
      <footer className="pb-6 text-center text-xs text-muted-foreground">
        Internal users land on the Sales Dashboard. Customers use their quotation portal.
      </footer>
    </div>
  );
}
