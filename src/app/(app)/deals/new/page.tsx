import { eq } from "drizzle-orm";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { listCompanies, listContacts } from "@/server/services/accounts";
import { usersInRoles } from "@/server/services/admin";
import { products } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Grid, Input, Select } from "@/components/forms";
import { DealFields } from "@/components/deal-form";
import { createDealAction } from "@/app/actions/crm";

export const metadata = { title: "New deal" };

export default async function NewDeal({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { actor, db, settings } = await ctx();
  requirePerm(actor, "deals.edit");
  const { company } = await searchParams;
  const { rows: cos } = await listCompanies(db, actor, {}, true);
  const { rows: cs } = await listContacts(db, actor, company ? { company } : {}, true);
  const ps = await db.select().from(products).where(eq(products.active, true));
  return (
    <>
      <PageHeader title="New deal" crumbs={[{ href: "/deals", label: "Deals" }]} />
      <Card>
        <ActionForm action={createDealAction} successPath="/deals/{id}">
          <fieldset className="mb-4 rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold text-slate-700">First product / service (optional)</legend>
            <Grid cols={3}>
              <Select name="productId" label="Product" placeholder="—" options={ps.map((p) => ({ value: p.id, label: `${p.name}` }))} />
              <Input name="quantity" label="Quantity" type="number" min={1} defaultValue={1} />
              <Input name="unitPrice" label="Unit price" inputMode="decimal" hint="Defaults to deal value" />
            </Grid>
          </fieldset>
          <DealFields d={company ? ({ companyId: company, currency: settings.currency } as never) : undefined} companies={cos} contacts={cs} users={await usersInRoles(db, ["sales_executive", "sales_manager"])} currencies={settings.currencies} canReassign={can(actor, "deals.reassign")} />
        </ActionForm>
      </Card>
    </>
  );
}
