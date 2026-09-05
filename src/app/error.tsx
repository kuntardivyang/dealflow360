"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// Error boundary for the whole app: a retry panel instead of a white screen.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <div className="surface w-full max-w-md p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <TriangleAlert className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="mt-5 font-heading text-xl font-bold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {error.message || "An unexpected error occurred."}
          {error.digest ? <span className="mt-1 block text-xs tabular-nums">ref {error.digest}</span> : null}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </main>
  );
}
