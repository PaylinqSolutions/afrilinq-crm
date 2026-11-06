import { ctx, requirePerm } from "@/server/page";
import { products } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { ProgramFields } from "@/components/program-form";
import { saveProgramAction } from "@/app/actions/training";

export const metadata = { title: "New training program" };

export default async function NewProgram() {
  const { actor, db } = await ctx();
  requirePerm(actor, "training.programs");
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  return (<><PageHeader title="New training program" crumbs={[{ href: "/training?view=programs", label: "Programs" }]} /><Card><ActionForm action={saveProgramAction.bind(null, null)} successPath="/training/programs/{id}"><ProgramFields products={ps} /></ActionForm></Card></>);
}
