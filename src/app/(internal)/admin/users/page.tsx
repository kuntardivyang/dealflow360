// Owner: B. Users and roles (Admin only). Role is read from this row on every request,
// so a change here applies on the user's next click.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared";
import { EntityForm, type FieldDef } from "@/components/admin/entity-form";
import { setUserRole } from "@/app/(internal)/actions/admin";
import { requireUser } from "@/lib/auth/internal";
import { ROLE_LABEL } from "@/lib/labels";
import { getUsers } from "@/services/admin.service";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  await requireUser(["ADMIN"]);
  const users = await getUsers();
  const managers = users.filter((u) => u.role === "SALES_MANAGER" || u.role === "ADMIN");
  const fields: FieldDef[] = [
    { name: "role", label: "Role", type: "select", width: "w-40", options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) },
    { name: "managerId", label: "Reports to", type: "select", width: "w-44", nullable: true, options: managers.map((m) => ({ value: String(m.id), label: m.name })) },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Users and roles" description="Sign-ups start as Sales Rep. Promote reviewers here and assign each rep a manager for approvals and deal-health nudges." />
      <Card>
        <CardHeader>
          <CardTitle>Internal users</CardTitle>
          <CardDescription>{users.length} users. Every change is logged with before and after.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Quotations</TableHead>
                <TableHead className="px-4">Role and manager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="px-4 font-medium">{u.name}{!u.isActive ? <span className="ml-2 text-xs text-muted-foreground">inactive</span> : null}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell className="tabular-nums">{u._count.quotations}</TableCell>
                  <TableCell className="px-4">
                    <EntityForm layout="inline" fields={fields} initial={{ role: u.role, managerId: u.managerId ?? "" }} hidden={{ userId: u.id }} action={setUserRole} successMessage={`${u.name} updated`} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
