import { ctx, requirePerm } from "@/server/page";
import { listCompanies } from "@/server/services/accounts";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { ContactFields } from "@/components/contact-form";
import { createContactAction } from "@/app/actions/crm";

export const metadata = { title: "New contact" };

export default async function NewContact({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { actor, db } = await ctx();
  requirePerm(actor, "accounts.edit");
  const { company } = await searchParams;
  const { rows } = await listCompanies(db, actor, {}, true);
  return (
    <>
      <PageHeader title="New contact" crumbs={[{ href: "/contacts", label: "Contacts" }]} />
      <Card><ActionForm action={createContactAction} successPath="/contacts/{id}"><ContactFields companies={rows} c={company ? ({ companyId: company, contactRoles: [] } as never) : undefined} /></ActionForm></Card>
    </>
  );
}
