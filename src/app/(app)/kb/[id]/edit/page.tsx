import { notFound } from "next/navigation";
import { ctx, load } from "@/server/page";
import { getArticle } from "@/server/services/kb";
import { products } from "@/db/schema";
import { Card, PageHeader, VersionField } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { ArticleFields } from "@/components/article-form";
import { updateArticleAction } from "@/app/actions/kb";

export default async function EditArticle({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db } = await ctx();
  const d = await load(() => getArticle(db, actor, id));
  if (!d.canEdit) notFound();
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  return (<><PageHeader title={`Edit: ${d.a.title}`} crumbs={[{ href: "/kb", label: "Knowledge base" }, { href: `/kb/${id}`, label: "Article" }]} subtitle={d.a.status === "published" ? "Saving a published article without publish rights sends it back to review." : undefined} />
    <Card><ActionForm action={updateArticleAction.bind(null, id)} successPath="/kb/{id}"><VersionField at={d.a.updatedAt} /><ArticleFields a={d.a} products={ps} /></ActionForm></Card></>);
}
