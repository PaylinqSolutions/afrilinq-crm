import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  products, dealProducts, deals, pipelineStages, companies, tickets, trainingPrograms, onboardingTemplates, onboardingProjects, users, renewals,
} from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { zh } from "@/lib/schemas";
import { type Actor, assertCan, can } from "../actor";
import { audit, diff } from "../audit";
import { conflict, invalid, notFound } from "../errors";
import { parse } from "../validate";
import { dealScope } from "./scope";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export const PRODUCT_CATEGORIES = ["Finance software", "Payments", "HR software", "Logistics software", "Professional services", "Training", "Support plan", "Hardware", "Other"];

export const productSchema = z.object({
  code: z.string().trim().min(2, "Code is required.").max(24).transform((v) => v.toUpperCase().replace(/\s+/g, "-"))
    .refine((v) => /^[A-Z0-9][A-Z0-9-]*$/.test(v), "Use letters, numbers and hyphens (e.g. AFQ-PAY)."),
  name: z.string().trim().min(2, "Name is required.").max(120),
  kind: z.enum(["product", "service"], { error: "Choose product or service." }),
  category: zh.optStr(60),
  description: zh.optStr(2000),
  listPrice: zh.optNum.refine((v) => v === null || v >= 0, "Price can't be negative."),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code."),
  billingFrequency: zh.optStr(40),
  unit: zh.optStr(60),
  managerId: zh.optUuid,
  active: zh.bool,
});

/** Catalogue with live usage figures so staff can see how each product is doing. */
export async function listProducts(db: DB, actor: Actor, f: { q?: string; kind?: string; status?: string; category?: string } = {}) {
  const conds: (SQL | undefined)[] = [];
  if (f.q) conds.push(or(ilike(products.name, `%${f.q}%`), ilike(products.code, `%${f.q}%`), ilike(products.description, `%${f.q}%`)));
  if (f.kind) conds.push(eq(products.kind, f.kind));
  if (f.category) conds.push(eq(products.category, f.category));
  if (f.status === "retired") conds.push(eq(products.active, false));
  else if (f.status !== "all") conds.push(eq(products.active, true));
  const rows = await db.select({ p: products, manager: users.name }).from(products).leftJoin(users, eq(users.id, products.managerId))
    .where(and(...conds)).orderBy(asc(products.kind), asc(products.name));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.p.id);
  const usage = await db.select({
    productId: dealProducts.productId,
    openDeals: sql<number>`count(distinct ${deals.id}) filter (where not ${pipelineStages.isWon} and not ${pipelineStages.isLost})::int`,
    openValue: sql<number>`coalesce(sum(${dealProducts.quantity} * ${dealProducts.unitPrice}) filter (where not ${pipelineStages.isWon} and not ${pipelineStages.isLost}), 0)::float`,
    wonValue: sql<number>`coalesce(sum(${dealProducts.quantity} * ${dealProducts.unitPrice}) filter (where ${pipelineStages.isWon}), 0)::float`,
    customers: sql<number>`count(distinct ${deals.companyId}) filter (where ${pipelineStages.isWon})::int`,
  }).from(dealProducts).innerJoin(deals, eq(deals.id, dealProducts.dealId)).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(and(inArray(dealProducts.productId, ids), isNull(deals.deletedAt), dealScope(actor))).groupBy(dealProducts.productId);
  const tix = can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned", "reports.support", "reports.executive")
    ? await db.select({ productId: tickets.productId, n: count() }).from(tickets).where(and(inArray(tickets.productId, ids), inArray(tickets.status, OPEN_STATUSES), isNull(tickets.deletedAt))).groupBy(tickets.productId)
    : [];
  return rows.map(({ p, manager }) => {
    const u = usage.find((x) => x.productId === p.id);
    return { ...p, manager, openDeals: u?.openDeals ?? 0, openValue: u?.openValue ?? 0, wonValue: u?.wonValue ?? 0, customers: u?.customers ?? 0, openTickets: tix.find((t) => t.productId === p.id)?.n ?? null };
  });
}

export async function getProduct(db: DB, id: string) {
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) throw notFound("Product");
  return p;
}

export async function productDetail(db: DB, actor: Actor, id: string) {
  const p = await getProduct(db, id);
  const [manager] = p.managerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.managerId)) : [];
  const ds = await db.select({
    id: deals.id, name: deals.name, company: companies.name, companyId: companies.id, stage: pipelineStages.name, isWon: pipelineStages.isWon, isLost: pipelineStages.isLost,
    quantity: dealProducts.quantity, unitPrice: dealProducts.unitPrice, currency: deals.currency, owner: users.name, close: deals.expectedCloseDate,
  }).from(dealProducts).innerJoin(deals, eq(deals.id, dealProducts.dealId)).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .innerJoin(companies, eq(companies.id, deals.companyId)).innerJoin(users, eq(users.id, deals.ownerId))
    .where(and(eq(dealProducts.productId, id), isNull(deals.deletedAt), dealScope(actor))).orderBy(desc(deals.updatedAt)).limit(200);
  const customerIds = [...new Set(ds.filter((d) => d.isWon).map((d) => d.companyId))];
  const customers = customerIds.length ? await db.select({ id: companies.id, name: companies.name, segment: companies.segment, city: companies.city }).from(companies).where(inArray(companies.id, customerIds)) : [];
  const canTickets = can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned");
  const ts = canTickets ? await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, priority: tickets.priority, status: tickets.status, company: companies.name })
    .from(tickets).leftJoin(companies, eq(companies.id, tickets.companyId)).where(and(eq(tickets.productId, id), isNull(tickets.deletedAt))).orderBy(desc(tickets.createdAt)).limit(50) : null;
  const programs = await db.select({ id: trainingPrograms.id, name: trainingPrograms.name, audienceRole: trainingPrograms.audienceRole, required: trainingPrograms.requiredForGoLive })
    .from(trainingPrograms).where(eq(trainingPrograms.productId, id));
  const templates = await db.select({ id: onboardingTemplates.id, name: onboardingTemplates.name, durationDays: onboardingTemplates.durationDays }).from(onboardingTemplates).where(eq(onboardingTemplates.productId, id));
  const projects = await db.select({ id: onboardingProjects.id, name: onboardingProjects.name, stage: onboardingProjects.stage, state: onboardingProjects.state, riskLevel: onboardingProjects.riskLevel })
    .from(onboardingProjects).where(eq(onboardingProjects.productId, id));
  const rs = await db.select({ id: renewals.id, company: companies.name, companyId: companies.id, date: renewals.renewalDate, amount: renewals.amount, status: renewals.status })
    .from(renewals).innerJoin(companies, eq(companies.id, renewals.companyId)).where(eq(renewals.productId, id)).orderBy(asc(renewals.renewalDate));
  const sum = (xs: typeof ds) => xs.reduce((a, d) => a + d.quantity * d.unitPrice, 0);
  return {
    p, manager: manager ?? null, deals: ds, customers, tickets: ts, programs, templates, projects, renewals: rs,
    stats: { openDeals: ds.filter((d) => !d.isWon && !d.isLost).length, openValue: sum(ds.filter((d) => !d.isWon && !d.isLost)), wonValue: sum(ds.filter((d) => d.isWon)), customers: customers.length, openTickets: ts?.filter((t) => (OPEN_STATUSES as string[]).includes(t.status)).length ?? null },
    canManage: can(actor, "products.manage"),
  };
}

export async function createProduct(db: DB, actor: Actor, input: unknown) {
  assertCan(actor, "products.manage");
  const v = parse(productSchema, input);
  const [dupe] = await db.select({ id: products.id }).from(products).where(eq(products.code, v.code));
  if (dupe) throw invalid("That product code is already used.", { code: "Codes must be unique." });
  const [p] = await db.insert(products).values({ ...v, active: true }).returning();
  await audit(db, actor, "product.created", "product", p.id, { code: { from: null, to: p.code }, listPrice: { from: null, to: p.listPrice } });
  return p;
}

export async function updateProduct(db: DB, actor: Actor, id: string, input: unknown, expected?: Version) {
  assertCan(actor, "products.manage");
  const before = await getProduct(db, id);
  await assertFresh(db, actor, "product", id, before.updatedAt, expected, "product");
  const v = parse(productSchema, input);
  if (v.code !== before.code) {
    const [dupe] = await db.select({ id: products.id }).from(products).where(eq(products.code, v.code));
    if (dupe) throw invalid("That product code is already used.", { code: "Codes must be unique." });
  }
  assertUpdated(await db.update(products).set({ ...v, active: before.active, updatedAt: new Date() })
    .where(and(eq(products.id, id), sameVersion(products.updatedAt, before.updatedAt))).returning({ id: products.id }), "product");
  await audit(db, actor, "product.updated", "product", id, diff(before as Record<string, unknown>, v as Record<string, unknown>, ["code", "name", "kind", "category", "listPrice", "currency", "billingFrequency", "unit", "managerId"]));
}

/** Products are retired, never deleted, so history (deals, tickets, training) stays intact. */
export async function setProductActive(db: DB, actor: Actor, id: string, active: boolean, reason: string | null) {
  assertCan(actor, "products.manage");
  const p = await getProduct(db, id);
  if (p.active === active) throw conflict(active ? "Already active." : "Already retired.");
  if (!active && !reason?.trim()) throw invalid("Give a reason for retiring this product.", { reason: "Required." });
  await db.update(products).set({ active, updatedAt: new Date() }).where(eq(products.id, id));
  await audit(db, actor, active ? "product.reactivated" : "product.retired", "product", id, { active: { from: p.active, to: active } }, reason);
}
