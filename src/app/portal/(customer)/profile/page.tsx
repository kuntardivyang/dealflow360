import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared";
import { requirePortal } from "@/lib/auth/portal";
import { prisma } from "@/lib/db";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requirePortal();
  const contact = await prisma.customerContact.findUniqueOrThrow({ where: { id: user.contactId }, include: { customer: { include: { tier: true } } } });
  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Who you are signed in as." />
      <Card size="sm" className="max-w-md">
        <CardHeader>
          <CardTitle>{contact.name}</CardTitle>
          <CardDescription>{contact.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Company</span> {contact.customer.name}
            {contact.customer.city ? <span className="text-muted-foreground">, {contact.customer.city}</span> : null}
          </p>
          <p>
            <span className="text-muted-foreground">Customer tier</span> {contact.customer.tier.name}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
