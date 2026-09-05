// Owner: B. The back-end configuration area is for Admin, Sales Manager and Finance.
// A Sales Rep who types the URL gets a clear "no access" panel, not the screens.
import { requireUser } from "@/lib/auth/internal";
import { BACKEND_ROLES } from "@/lib/contract";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireUser(BACKEND_ROLES);
  return <>{children}</>;
}
