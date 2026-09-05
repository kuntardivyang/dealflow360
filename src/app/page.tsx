import { redirect } from "next/navigation";

// The workspace lives under /dashboard. Once auth lands, unauthenticated users are
// redirected to /login by the internal layout.
export default function Home() {
  redirect("/dashboard");
}
