import { ctx, requirePerm } from "@/server/page";
import { simpleUsers } from "@/server/services/admin";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { CompanyFields } from "@/components/company-form";
import { createCompanyAction } from "@/app/actions/crm";

export const metadata = { title: "New company" };

export default async function NewCompany() {
  const { actor, db } = await ctx();
  requirePerm(actor, "accounts.edit");
  return (
    <>
      <PageHeader title="New company" crumbs={[{ href: "/companies", label: "Companies" }]} />
      <Card><ActionForm action={createCompanyAction} successPath="/companies/{id}"><CompanyFields users={await simpleUsers(db)} /></ActionForm></Card>
    </>
  );
}
