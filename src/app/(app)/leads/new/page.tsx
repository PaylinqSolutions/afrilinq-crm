import { eq } from "drizzle-orm";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { products } from "@/db/schema";
import { usersInRoles } from "@/server/services/admin";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { createLeadAction } from "@/app/actions/crm";
import { LeadFields } from "@/components/lead-form";

export const metadata = { title: "New lead" };

export default async function NewLead() {
  const { actor, db } = await ctx();
  requirePerm(actor, "leads.edit");
  const users = await usersInRoles(db, ["sales_executive", "sales_manager"]);
  const ps = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.active, true));
  return (
    <>
      <PageHeader title="New lead" crumbs={[{ href: "/leads", label: "Leads" }]} />
      <Card><ActionForm action={createLeadAction} successPath="/leads/{id}"><LeadFields users={users} products={ps} canAssign={can(actor, "leads.assign")} /></ActionForm></Card>
    </>
  );
}
