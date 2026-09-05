"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { portalLoginAction, type PortalLoginState } from "@/app/portal/actions";

export function PortalLoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(portalLoginAction, null as PortalLoginState);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="portal-email">Email</Label>
        <Input id="portal-email" name="email" type="email" autoComplete="email" required placeholder="acme@test.com" aria-invalid={!!errors.email} />
        {errors.email ? <p role="alert" className="text-xs text-destructive">{errors.email[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="portal-password">Password</Label>
        <Input id="portal-password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!errors.password} />
        {errors.password ? <p role="alert" className="text-xs text-destructive">{errors.password[0]}</p> : null}
      </div>
      {state && !state.ok && !state.fieldErrors ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Log In
      </Button>
      <p className="text-xs text-muted-foreground">Your access details were shared with the quotation link. Ask your sales representative if you need them again.</p>
    </form>
  );
}
