import { redirect } from "next/navigation";
import { signupAction } from "@/app/(internal)/actions/auth";
import { AuthForm } from "@/components/auth/auth-form";
import { getSessionUser } from "@/lib/auth/internal";

export const metadata = { title: "Sign Up" };

export default async function SignupPage() {
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <>
      <div className="mb-6 space-y-1">
        <h1 className="font-heading text-xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted-foreground">For internal users. Customer access comes from the quotation link your rep sends.</p>
      </div>
      <AuthForm mode="signup" action={signupAction} />
    </>
  );
}
