import { redirect } from "next/navigation";
import { loginAction } from "@/app/(internal)/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { getSessionUser, safeNextPath } from "@/lib/auth/internal";

export const metadata = { title: "Log In" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSessionUser()) redirect(safeNextPath(next));
  const safeNext = next && safeNextPath(next) !== "/dashboard" ? safeNextPath(next) : undefined;
  return (
    <>
      <div className="mb-7">
        <h1 className="font-heading text-[28px] leading-tight font-bold tracking-[-0.02em]">Log in to DealFlow360</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sales reps, managers, finance and admins sign in here.</p>
      </div>
      <AuthForm mode="login" action={loginAction} next={safeNext} />
    </>
  );
}
