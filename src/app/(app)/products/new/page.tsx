import { eq } from "drizzle-orm";
import { ctx, requirePerm } from "@/server/page";
import { getSettings } from "@/server/settings";
import { users } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { ProductFields } from "@/components/product-form";
import { createProductAction } from "@/app/actions/products";

export const metadata = { title: "Add product" };

export default async function NewProduct() {
  const { actor, db } = await ctx();
  requirePerm(actor, "products.manage");
  const settings = await getSettings(db);
  const us = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(users.name);
  return (
    <>
      <PageHeader title="Add product or service" crumbs={[{ href: "/products", label: "Products" }]} subtitle="Once added, staff can select it on deals, tickets, onboarding templates and training programs." />
      <Card><ActionForm action={createProductAction} successPath="/products/{id}"><ProductFields users={us} currencies={settings.currencies} /></ActionForm></Card>
    </>
  );
}
