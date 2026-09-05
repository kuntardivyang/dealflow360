import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="surface w-full max-w-md p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <SearchX className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="mt-5 font-heading text-xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">The page you asked for does not exist or is not yours to see.</p>
        <div className="mt-6">
          <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </main>
  );
}
