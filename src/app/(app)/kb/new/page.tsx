import { ctx, requirePerm } from "@/server/page";
import { products } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { ArticleFields } from "@/components/article-form";
import { createArticleAction } from "@/app/actions/kb";

export const metadata = { title: "New article" };
export default async function NewArticle() {
  const { actor, db } = await ctx();
  requirePerm(actor, "kb.edit");
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  return (<><PageHeader title="New article" crumbs={[{ href: "/kb", label: "Knowledge base" }]} /><Card><ActionForm action={createArticleAction} successPath="/kb/{id}"><ArticleFields products={ps} /></ActionForm></Card></>);
}
