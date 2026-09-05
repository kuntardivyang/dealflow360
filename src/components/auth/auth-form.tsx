"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFormState } from "@/app/(internal)/actions/auth";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

function Field({
  id,
  label,
  errors,
  children,
}: {
  id: string;
  label: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {errors?.length ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

/** Log In / Sign Up form (mockup screen 1). Field errors come back from the server action. */
export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: Mode;
  action: (prev: AuthFormState, form: FormData) => Promise<AuthFormState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const generic = state && !state.ok && !state.fieldErrors ? state.message : null;

  return (
    <div className="space-y-6">
      <nav aria-label="Log in or sign up" className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm font-medium">
        {(["login", "signup"] as const).map((m) => (
          <Link
            key={m}
            href={m === "login" ? (next ? `/login?next=${encodeURIComponent(next)}` : "/login") : "/signup"}
            aria-current={mode === m ? "page" : undefined}
            className={cn(
              "rounded-md py-1.5 text-center transition-colors",
              mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "login" ? "Log In" : "Sign Up"}
          </Link>
        ))}
      </nav>

      <form action={formAction} className="space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {mode === "signup" ? (
          <Field id="name" label="Full name" errors={errors.name}>
            <Input id="name" name="name" autoComplete="name" required aria-invalid={!!errors.name} placeholder="Riya Rao" />
          </Field>
        ) : null}
        <Field id="email" label="Email" errors={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={!!errors.email}
            placeholder="riya@test.com"
            defaultValue={mode === "login" ? "" : undefined}
          />
        </Field>
        <Field id="password" label="Password" errors={errors.password}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : 1}
            aria-invalid={!!errors.password}
            placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
          />
        </Field>
        {generic ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {generic}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {mode === "login" ? "Log In" : "Create account"}
        </Button>
        {mode === "login" ? (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button type="button" className="hover:text-foreground" title="Not available in this build" onClick={() => undefined}>
              Forgot Password?
            </button>
            <Link href="/portal/login" className="hover:text-foreground">
              Customer? Open your portal
            </Link>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">New accounts start as Sales Rep. An Admin can change the role later.</p>
        )}
      </form>
    </div>
  );
}
