import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import { knowledgeArticles, users, products, articleTicketLinks, tickets } from "@/db/schema";
import { type Actor, assertCan, can } from "../actor";
import { audit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { notifyUsers, usersWithRole } from "../notify";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export const KB_CATEGORIES = ["Getting started", "Billing", "Integrations", "Troubleshooting", "Administration", "Sales playbook", "Onboarding playbook", "Support runbook", "Policies"];

function visibility(actor: Actor): SQL | undefined {
  if (can(actor, "kb.view_internal")) return can(actor, "kb.edit", "kb.publish") ? undefined : eq(knowledgeArticles.status, "published");
  return and(eq(knowledgeArticles.audience, "customer"), eq(knowledgeArticles.status, "published"));
}

export type KbFilters = { q?: string; category?: string; status?: string; audience?: string; sop?: string };

export async function listArticles(db: DB, actor: Actor, f: KbFilters = {}) {
  const conds: (SQL | undefined)[] = [visibility(actor)];
  if (f.q) conds.push(or(ilike(knowledgeArticles.title, `%${f.q}%`), ilike(knowledgeArticles.summary, `%${f.q}%`), ilike(knowledgeArticles.body, `%${f.q}%`), sql`${knowledgeArticles.tags}::text ilike ${`%${f.q}%`}`));
  if (f.category) conds.push(eq(knowledgeArticles.category, f.category));
  if (f.status) conds.push(eq(knowledgeArticles.status, f.status));
  else if (!f.q) conds.push(sql`${knowledgeArticles.status} <> 'archived'`);
  if (f.audience) conds.push(eq(knowledgeArticles.audience, f.audience));
  if (f.sop) conds.push(eq(knowledgeArticles.isSop, true));
  return db.select({
    id: knowledgeArticles.id, title: knowledgeArticles.title, summary: knowledgeArticles.summary, category: knowledgeArticles.category,
    tags: knowledgeArticles.tags, audience: knowledgeArticles.audience, status: knowledgeArticles.status, isSop: knowledgeArticles.isSop,
    updatedAt: knowledgeArticles.updatedAt, version: knowledgeArticles.version, owner: users.name, helpful: knowledgeArticles.helpfulCount, notHelpful: knowledgeArticles.notHelpfulCount,
  }).from(knowledgeArticles).leftJoin(users, eq(users.id, knowledgeArticles.ownerId)).where(and(...conds)).orderBy(desc(knowledgeArticles.updatedAt)).limit(200);
}

export async function getArticle(db: DB, actor: Actor, id: string) {
  const [a] = await db.select().from(knowledgeArticles).where(and(eq(knowledgeArticles.id, id), visibility(actor)));
  if (!a) throw notFound("Article");
  const people = await db.select({ id: users.id, name: users.name }).from(users);
  const name = (x: string | null) => people.find((p) => p.id === x)?.name ?? "—";
  const [product] = a.productId ? await db.select().from(products).where(eq(products.id, a.productId)) : [];
  const linked = can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned")
    ? await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject }).from(articleTicketLinks).innerJoin(tickets, eq(tickets.id, articleTicketLinks.ticketId)).where(eq(articleTicketLinks.articleId, id))
    : [];
  const isAuthor = a.authorId === actor.id || a.ownerId === actor.id;
  return {
    a, product, linked, author: name(a.authorId), owner: name(a.ownerId), reviewer: name(a.reviewerId),
    canEdit: can(actor, "kb.edit") && (isAuthor || can(actor, "kb.publish")) && a.status !== "archived",
    canSubmit: can(actor, "kb.edit") && a.status === "draft",
    canReview: can(actor, "kb.publish") && a.status === "in_review",
    canArchive: can(actor, "kb.publish") && a.status === "published",
  };
}

export type ArticleInput = { title: string; summary: string | null; body: string; category: string; productId: string | null; tags: string[]; audience: string; isSop: boolean };

function check(v: ArticleInput) {
  const e: Record<string, string> = {};
  if (!v.title?.trim()) e.title = "Title is required.";
  if (!v.body?.trim() || v.body.trim().length < 20) e.body = "Write the article body (at least 20 characters).";
  if (!v.category) e.category = "Choose a category.";
  if (!["internal", "customer"].includes(v.audience)) e.audience = "Choose an audience.";
  if (Object.keys(e).length) throw invalid("Please complete the article.", e);
}

export async function createArticle(db: DB, actor: Actor, v: ArticleInput) {
  assertCan(actor, "kb.edit");
  check(v);
  const [a] = await db.insert(knowledgeArticles).values({ ...v, status: "draft", authorId: actor.id, ownerId: actor.id }).returning();
  await audit(db, actor, "kb.created", "article", a.id);
  return a;
}

export async function updateArticle(db: DB, actor: Actor, id: string, v: ArticleInput, expected?: Version) {
  const { a, canEdit } = await getArticle(db, actor, id);
  await assertFresh(db, actor, "article", id, a.updatedAt, expected, "article");
  if (!canEdit) throw forbidden("You can edit your own articles; publishers can edit any article.");
  check(v);
  // Editing a published article sends the new revision back through review unless a publisher makes the change.
  const status = a.status === "published" && !can(actor, "kb.publish") ? "in_review" : a.status;
  assertUpdated(await db.update(knowledgeArticles).set({ ...v, status, updatedAt: new Date() })
    .where(and(eq(knowledgeArticles.id, id), sameVersion(knowledgeArticles.updatedAt, a.updatedAt))).returning({ id: knowledgeArticles.id }), "article");
  await audit(db, actor, "kb.updated", "article", id, status !== a.status ? { status: { from: a.status, to: status } } : null);
}

export async function submitArticle(db: DB, actor: Actor, id: string, reviewerId: string | null) {
  assertCan(actor, "kb.edit");
  const { a } = await getArticle(db, actor, id);
  if (a.status !== "draft") throw conflict("Only drafts can be submitted for review.");
  await db.update(knowledgeArticles).set({ status: "in_review", reviewerId, updatedAt: new Date() }).where(eq(knowledgeArticles.id, id));
  await audit(db, actor, "kb.submitted", "article", id, { status: { from: "draft", to: "in_review" } });
  await notifyUsers(db, reviewerId ? [reviewerId] : await usersWithRole(db, ["support_lead", "super_admin"]), { kind: "kb", title: `Article ready for review: ${a.title}`, link: `/kb/${id}` });
}

export async function reviewArticle(db: DB, actor: Actor, id: string, publish: boolean, comment: string | null) {
  assertCan(actor, "kb.publish");
  const { a } = await getArticle(db, actor, id);
  if (a.status !== "in_review") throw conflict("This article is not in review.");
  if (!publish && !comment?.trim()) throw invalid("Explain what needs to change.", { comment: "Required to return an article." });
  await db.update(knowledgeArticles).set({
    status: publish ? "published" : "draft", reviewerId: actor.id, reviewComment: comment, publishedAt: publish ? new Date() : a.publishedAt,
    version: publish ? a.version + (a.publishedAt ? 1 : 0) : a.version, updatedAt: new Date(),
  }).where(eq(knowledgeArticles.id, id));
  await audit(db, actor, publish ? "kb.published" : "kb.returned", "article", id, { status: { from: "in_review", to: publish ? "published" : "draft" } }, comment);
  await notifyUsers(db, [a.authorId], { kind: "kb", title: `Article ${publish ? "published" : "returned"}: ${a.title}`, body: comment ?? undefined, link: `/kb/${id}` });
}

export async function archiveArticle(db: DB, actor: Actor, id: string) {
  assertCan(actor, "kb.publish");
  const { a } = await getArticle(db, actor, id);
  await db.update(knowledgeArticles).set({ status: "archived", updatedAt: new Date() }).where(eq(knowledgeArticles.id, id));
  await audit(db, actor, "kb.archived", "article", id, { status: { from: a.status, to: "archived" } });
}

export async function articleFeedback(db: DB, id: string, helpful: boolean) {
  await db.update(knowledgeArticles).set(helpful ? { helpfulCount: sql`${knowledgeArticles.helpfulCount} + 1` } : { notHelpfulCount: sql`${knowledgeArticles.notHelpfulCount} + 1` })
    .where(and(eq(knowledgeArticles.id, id), eq(knowledgeArticles.status, "published")));
}

/** Customer-facing help centre: published, customer-audience articles only. */
export async function publicArticles(db: DB, q?: string) {
  return db.select({ id: knowledgeArticles.id, title: knowledgeArticles.title, summary: knowledgeArticles.summary, category: knowledgeArticles.category, body: knowledgeArticles.body, updatedAt: knowledgeArticles.updatedAt })
    .from(knowledgeArticles).where(and(eq(knowledgeArticles.audience, "customer"), eq(knowledgeArticles.status, "published"),
      q ? or(ilike(knowledgeArticles.title, `%${q}%`), ilike(knowledgeArticles.body, `%${q}%`)) : undefined)).orderBy(knowledgeArticles.category, knowledgeArticles.title);
}
