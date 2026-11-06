import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db";
import {
  leads, deals, pipelineStages, pipelines, dealStageHistory, dealProducts, dealContacts, companies, contacts, products, users, activities,
} from "@/db/schema";
import { leadSchema, dealSchema } from "@/lib/schemas";
import { validateStageEntry, effectiveProbability } from "@/lib/rules/sales";
import { type Actor, assertCan, can } from "../actor";
import { audit, diff } from "../audit";
import { invalid, notFound, forbidden, conflict } from "../errors";
import { parse } from "../validate";
import { getSettings } from "../settings";
import { notifyRoles } from "../notify";
import { leadScope, dealScope } from "./scope";
import { emit } from "./workflows";
import { ensureHandoverForDeal } from "./handover";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export const PAGE_SIZE = 25;
export const paging = (page?: string | number) => {
  const p = Math.max(1, Number(page) || 1);
  return { limit: PAGE_SIZE, offset: (p - 1) * PAGE_SIZE, page: p };
};

// ---------------------------------------------------------------------------- Leads

export type LeadFilters = { q?: string; status?: string; owner?: string; source?: string; segment?: string; page?: string; sort?: string };

export async function listLeads(db: DB, actor: Actor, f: LeadFilters) {
  const conds: (SQL | undefined)[] = [isNull(leads.deletedAt), leadScope(actor)];
  if (f.q) conds.push(or(ilike(leads.name, `%${f.q}%`), ilike(leads.organization, `%${f.q}%`), ilike(leads.contactName, `%${f.q}%`)));
  if (f.status) conds.push(eq(leads.status, f.status));
  else conds.push(sql`${leads.status} not in ('Converted','Disqualified')`);
  if (f.owner) conds.push(f.owner === "me" ? eq(leads.ownerId, actor.id) : eq(leads.ownerId, f.owner));
  if (f.source) conds.push(eq(leads.source, f.source));
  if (f.segment) conds.push(eq(leads.segment, f.segment));
  const where = and(...conds);
  const { limit, offset } = paging(f.page);
  const order = {
    created: desc(leads.createdAt), name: asc(leads.name), due: asc(leads.nextActionDue), status: asc(leads.status),
  }[f.sort ?? "due"] ?? asc(leads.nextActionDue);
  const rows = await db.select({
    id: leads.id, name: leads.name, organization: leads.organization, contactName: leads.contactName, status: leads.status,
    source: leads.source, segment: leads.segment, nextAction: leads.nextAction, nextActionDue: leads.nextActionDue,
    createdAt: leads.createdAt, ownerName: users.name, product: products.name,
  }).from(leads).leftJoin(users, eq(users.id, leads.ownerId)).leftJoin(products, eq(products.id, leads.productInterestId))
    .where(where).orderBy(order, desc(leads.createdAt)).limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(leads).where(where);
  return { rows, total };
}

export async function getLead(db: DB, actor: Actor, id: string) {
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), isNull(leads.deletedAt), leadScope(actor)));
  if (!lead) throw notFound("Lead");
  return lead;
}

function leadValues(v: ReturnType<typeof leadSchema.parse>) {
  const { need, fit, timing, decisionProcess, budget, painPoints, ...rest } = v;
  return { ...rest, qualification: { need, fit, timing, decisionProcess, budget, painPoints } as Record<string, string | null> };
}

export async function createLead(db: DB, actor: Actor, input: unknown) {
  assertCan(actor, "leads.edit");
  const v = parse(leadSchema, input);
  const ownerId = can(actor, "leads.assign") ? v.ownerId : actor.id;
  const vals = leadValues(v);
  const [lead] = await db.insert(leads).values({
    ...vals, qualification: vals.qualification as never, ownerId, status: v.status === "Converted" ? "New" : v.status,
  }).returning();
  await audit(db, actor, "lead.created", "lead", lead.id);
  await emit(db, "lead.created", {
    entityId: lead.id, relatedType: "lead", ownerId: lead.ownerId, name: lead.name, organization: lead.organization ?? lead.contactName,
    source: lead.source, region: lead.region, link: `/leads/${lead.id}`,
  });
  return lead;
}

export async function updateLead(db: DB, actor: Actor, id: string, input: unknown, expected?: Version) {
  assertCan(actor, "leads.edit");
  const before = await getLead(db, actor, id);
  await assertFresh(db, actor, "lead", id, before.updatedAt, expected, "lead");
  if (before.status === "Converted") throw conflict("Converted leads are read-only. Edit the company, contact or deal instead.");
  const v = parse(leadSchema, input);
  const vals = leadValues(v);
  const next = {
    ...vals, qualification: vals.qualification as never,
    ownerId: can(actor, "leads.assign") ? v.ownerId : before.ownerId,
    status: v.status === "Converted" ? before.status : v.status, updatedAt: new Date(),
  };
  assertUpdated(await db.update(leads).set(next).where(and(eq(leads.id, id), sameVersion(leads.updatedAt, before.updatedAt))).returning({ id: leads.id }), "lead");
  await audit(db, actor, "lead.updated", "lead", id, diff(before, next, ["status", "ownerId", "source", "nextAction"]));
}

/**
 * An existing contact who is the same person as the lead: same email (any case) first, then same phone number
 * (last 10 digits, formatting ignored), then the same full name at the company with the lead's organisation name.
 */
export async function findMatchingContact(db: Executor, email: string | null | undefined, phone: string | null | undefined, name?: string | null, organization?: string | null) {
  const cols = { id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone, companyId: contacts.companyId, companyName: companies.name, lifecycleStage: contacts.lifecycleStage };
  const base = () => db.select(cols).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId));
  if (email?.trim()) {
    const [m] = await base().where(and(sql`lower(${contacts.email}) = ${email.trim().toLowerCase()}`, isNull(contacts.deletedAt))).limit(1);
    if (m) return { ...m, matchedBy: "email" as const };
  }
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length >= 7) {
    const [m] = await base().where(and(sql`right(regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`, isNull(contacts.deletedAt))).limit(1);
    if (m) return { ...m, matchedBy: "phone" as const };
  }
  if (name?.trim() && organization?.trim()) {
    const [m] = await base().where(and(sql`lower(trim(${contacts.firstName} || ' ' || ${contacts.lastName})) = ${name.trim().toLowerCase().replace(/\s+/g, " ")}`,
      sql`lower(trim(${companies.name})) = ${organization.trim().toLowerCase()}`, isNull(contacts.deletedAt))).limit(1);
    if (m) return { ...m, matchedBy: "name at the same company" as const };
  }
  return null;
}

export async function convertLead(db: DB, actor: Actor, id: string, opts: { companyId?: string | null; dealName?: string; amount?: number | null; newContact?: boolean; createDeal?: boolean }) {
  // A lead always becomes a contact; a company and a deal are created only when there is one to create.
  const createDeal = opts.createDeal ?? true;
  assertCan(actor, "leads.edit");
  assertCan(actor, "accounts.edit");
  if (createDeal) assertCan(actor, "deals.edit");
  const lead = await getLead(db, actor, id);
  if (lead.status === "Converted") throw conflict("This lead has already been converted.");
  if (lead.status === "Disqualified") throw conflict("Disqualified leads cannot be converted. Change the status first.");
  const result = await db.transaction(async (tx) => {
    // Reuse the person if they're already a contact (unless the user explicitly asked for a separate contact).
    const match = opts.newContact ? null : await findMatchingContact(tx, lead.email, lead.phone, lead.contactName, lead.organization);
    let companyId = opts.companyId ?? match?.companyId ?? null;
    if (!companyId && lead.organization?.trim()) {
      const [existing] = await tx.select({ id: companies.id }).from(companies)
        .where(and(ilike(companies.name, lead.organization.trim()), isNull(companies.deletedAt)));
      companyId = existing?.id ?? (await tx.insert(companies).values({
        name: lead.organization.trim(), segment: lead.segment ?? "SME", region: lead.region, ownerId: lead.ownerId ?? actor.id, lifecycle: "prospect",
      }).returning({ id: companies.id }))[0].id;
    }
    if (createDeal && !companyId) throw invalid("A deal needs a company. Add the organisation, pick a company, or convert to a contact only.", { companyId: "Required to open a deal." });
    const [first, ...rest] = lead.contactName.trim().split(/\s+/);
    const EARLY = ["subscriber", "lead", "mql", "sql"];
    let contact: { id: string };
    if (match) {
      // Fill gaps only; never overwrite what's already on the contact.
      const fill: Partial<typeof contacts.$inferInsert> = { leadStatus: createDeal ? "open_deal" : "in_progress", updatedAt: new Date() };
      if (!match.companyId && companyId) fill.companyId = companyId;
      if (!match.email && lead.email) fill.email = lead.email;
      if (!match.phone && lead.phone) fill.phone = lead.phone;
      if (EARLY.includes(match.lifecycleStage)) fill.lifecycleStage = createDeal ? "opportunity" : "sql";
      await tx.update(contacts).set(fill).where(eq(contacts.id, match.id));
      await audit(tx, actor, "contact.updated", "contact", match.id, Object.fromEntries(Object.entries(fill).filter(([k]) => k !== "updatedAt").map(([k, v]) => [k, { from: (match as Record<string, unknown>)[k] ?? null, to: v }])), `Linked from converted lead "${lead.name}" (matched by ${match.matchedBy})`);
      contact = { id: match.id };
    } else {
      [contact] = await tx.insert(contacts).values({
        companyId, firstName: first, lastName: rest.join(" ") || "-", email: lead.email, phone: lead.phone,
        contactRoles: ["decision_maker"], ownerId: lead.ownerId ?? actor.id, leadStatus: createDeal ? "open_deal" : "in_progress", lifecycleStage: createDeal ? "opportunity" : "sql", referralSource: lead.source,
      }).returning({ id: contacts.id });
    }
    // Activity logged while it was a lead follows the person.
    await tx.update(activities).set({ contactId: contact.id, companyId }).where(and(eq(activities.leadId, id), isNull(activities.contactId)));
    let deal: { id: string } | null = null;
    if (createDeal && companyId) {
    const [pipe] = await tx.select().from(pipelines).where(eq(pipelines.isDefault, true));
    const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipe.id)).orderBy(asc(pipelineStages.position)).limit(1);
    [deal] = await tx.insert(deals).values({
      name: opts.dealName || `${lead.organization || lead.contactName} — ${lead.name}`, companyId, primaryContactId: contact.id,
      ownerId: lead.ownerId ?? actor.id, pipelineId: pipe.id, stageId: stage.id, amount: opts.amount ?? null,
      nextStep: lead.nextAction, nextStepDue: lead.nextActionDue?.toISOString().slice(0, 10) ?? null, leadSource: lead.source,
    }).returning();
    await tx.insert(dealContacts).values({ dealId: deal.id, contactId: contact.id, role: "decision_maker" });
    if (lead.productInterestId) {
      const [p] = await tx.select().from(products).where(eq(products.id, lead.productInterestId));
      if (p) await tx.insert(dealProducts).values({ dealId: deal.id, productId: p.id, quantity: 1, unitPrice: p.listPrice ?? 0 });
    }
    await tx.insert(dealStageHistory).values({ dealId: deal.id, toStageId: stage.id, changedBy: actor.id });
    }
    await tx.update(leads).set({
      status: "Converted", convertedAt: new Date(), convertedCompanyId: companyId, convertedContactId: contact.id,
      convertedDealId: deal?.id ?? null, updatedAt: new Date(),
    }).where(eq(leads.id, id));
    await audit(tx, actor, "lead.converted", "lead", id, { status: { from: lead.status, to: "Converted" } }, match ? `Reused existing contact ${match.firstName} ${match.lastName} (same ${match.matchedBy})` : null);
    return { companyId, contactId: contact.id, dealId: deal?.id ?? null, reusedContact: match ? { name: `${match.firstName} ${match.lastName}`, matchedBy: match.matchedBy } : null };
  });
  return result;
}

// ---------------------------------------------------------------------------- Deals

export type DealFilters = { q?: string; owner?: string; stage?: string; product?: string; segment?: string; status?: string; closeFrom?: string; closeTo?: string; page?: string; sort?: string };

function dealConds(actor: Actor, f: DealFilters) {
  const conds: (SQL | undefined)[] = [isNull(deals.deletedAt), dealScope(actor)];
  if (f.q) conds.push(or(ilike(deals.name, `%${f.q}%`), ilike(companies.name, `%${f.q}%`)));
  if (f.owner) conds.push(f.owner === "me" ? eq(deals.ownerId, actor.id) : eq(deals.ownerId, f.owner));
  if (f.stage) conds.push(eq(deals.stageId, f.stage));
  if (f.segment) conds.push(eq(companies.segment, f.segment));
  if (f.product) conds.push(sql`exists (select 1 from deal_products dp where dp.deal_id = ${deals.id} and dp.product_id = ${f.product})`);
  if (f.status === "open") conds.push(sql`${pipelineStages.isWon} = false and ${pipelineStages.isLost} = false`);
  if (f.status === "won") conds.push(eq(pipelineStages.isWon, true));
  if (f.status === "lost") conds.push(eq(pipelineStages.isLost, true));
  if (f.closeFrom) conds.push(sql`${deals.expectedCloseDate} >= ${f.closeFrom}`);
  if (f.closeTo) conds.push(sql`${deals.expectedCloseDate} <= ${f.closeTo}`);
  return and(...conds);
}

const dealCols = {
  id: deals.id, name: deals.name, amount: deals.amount, currency: deals.currency, expectedCloseDate: deals.expectedCloseDate,
  nextStep: deals.nextStep, nextStepDue: deals.nextStepDue, stageId: deals.stageId, stageEnteredAt: deals.stageEnteredAt,
  probabilityOverride: deals.probabilityOverride, lastActivityAt: deals.lastActivityAt, discountStatus: deals.discountStatus,
  forecastCategory: deals.forecastCategory, closedAt: deals.closedAt, createdAt: deals.createdAt, updatedAt: deals.updatedAt,
  companyId: companies.id, companyName: companies.name, segment: companies.segment,
  ownerId: deals.ownerId, ownerName: users.name, stageName: pipelineStages.name, stagePosition: pipelineStages.position,
  probability: pipelineStages.probability, isWon: pipelineStages.isWon, isLost: pipelineStages.isLost, staleAfterDays: pipelineStages.staleAfterDays,
};

export async function listDeals(db: DB, actor: Actor, f: DealFilters, all = false) {
  const where = dealConds(actor, f);
  const { limit, offset } = paging(f.page);
  const order = {
    close: asc(deals.expectedCloseDate), amount: desc(deals.amount), name: asc(deals.name), stage: asc(pipelineStages.position),
    created: desc(deals.createdAt),
  }[f.sort ?? "close"] ?? asc(deals.expectedCloseDate);
  const base = db.select(dealCols).from(deals)
    .innerJoin(companies, eq(companies.id, deals.companyId)).innerJoin(users, eq(users.id, deals.ownerId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).where(where).orderBy(order, desc(deals.createdAt));
  const rows = all ? await base.limit(1000) : await base.limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(deals)
    .innerJoin(companies, eq(companies.id, deals.companyId)).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).where(where);
  return { rows: rows.map((r) => ({ ...r, effectiveProbability: effectiveProbability(r.probability, r.probabilityOverride) })), total };
}

export async function getStages(db: DB, pipelineId?: string) {
  const pid = pipelineId ?? (await db.select().from(pipelines).where(eq(pipelines.isDefault, true)))[0]?.id;
  return db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pid)).orderBy(asc(pipelineStages.position));
}

export async function getDeal(db: DB, actor: Actor, id: string) {
  const [deal] = await db.select().from(deals).where(and(eq(deals.id, id), isNull(deals.deletedAt), dealScope(actor)));
  if (!deal) throw notFound("Deal");
  return deal;
}

export async function getDealDetail(db: DB, actor: Actor, id: string) {
  const deal = await getDeal(db, actor, id);
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, deal.stageId));
  const [company] = await db.select().from(companies).where(eq(companies.id, deal.companyId));
  const lines = await db.select({ id: dealProducts.id, productId: products.id, name: products.name, code: products.code, quantity: dealProducts.quantity, unitPrice: dealProducts.unitPrice })
    .from(dealProducts).innerJoin(products, eq(products.id, dealProducts.productId)).where(eq(dealProducts.dealId, id));
  const dContacts = await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, role: dealContacts.role })
    .from(dealContacts).innerJoin(contacts, eq(contacts.id, dealContacts.contactId)).where(eq(dealContacts.dealId, id));
  const history = await db.select({ id: dealStageHistory.id, toStage: pipelineStages.name, changedAt: dealStageHistory.changedAt, durationSeconds: dealStageHistory.durationSeconds, by: users.name, fromStageId: dealStageHistory.fromStageId })
    .from(dealStageHistory).innerJoin(pipelineStages, eq(pipelineStages.id, dealStageHistory.toStageId)).leftJoin(users, eq(users.id, dealStageHistory.changedBy))
    .where(eq(dealStageHistory.dealId, id)).orderBy(desc(dealStageHistory.changedAt));
  const [owner] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, deal.ownerId));
  return { deal, stage, company, lines, contacts: dContacts, history, owner };
}

async function discountState(db: DB, before: { discountPct: number | null; discountStatus: string } | null, pct: number | null) {
  const { discountApprovalThreshold } = await getSettings(db);
  if (!pct || pct <= discountApprovalThreshold) return { status: "none", requested: false };
  if (before && before.discountPct === pct && ["approved", "rejected", "pending"].includes(before.discountStatus))
    return { status: before.discountStatus, requested: false };
  return { status: "pending", requested: true };
}

export async function createDeal(db: DB, actor: Actor, input: unknown) {
  assertCan(actor, "deals.edit");
  const v = parse(dealSchema, input);
  const [company] = await db.select().from(companies).where(eq(companies.id, v.companyId));
  if (!company) throw invalid("Choose a company.", { companyId: "Company not found." });
  const ownerId = can(actor, "deals.reassign") && v.ownerId ? v.ownerId : actor.id;
  const stages = await getStages(db);
  const stage = stages[0];
  const errors = validateStageEntry({ ...v, lossReason: null, discountStatus: "none", productCount: 1 }, stage, 100);
  if (errors.nextStep || errors.nextStepDue) throw invalid("Every open deal needs a next step and due date.", errors);
  const disc = await discountState(db, null, v.discountPct);
  const [deal] = await db.insert(deals).values({
    ...v, ownerId, pipelineId: stage.pipelineId, stageId: stage.id, discountStatus: disc.status, lastActivityAt: new Date(),
  }).returning();
  await db.insert(dealStageHistory).values({ dealId: deal.id, toStageId: stage.id, changedBy: actor.id });
  if (v.primaryContactId) await db.insert(dealContacts).values({ dealId: deal.id, contactId: v.primaryContactId, role: "primary" }).onConflictDoNothing();
  await audit(db, actor, "deal.created", "deal", deal.id, { amount: { from: null, to: deal.amount } });
  if (disc.requested) await requestDiscountNotify(db, deal);
  return deal;
}

async function requestDiscountNotify(db: DB, deal: { id: string; name: string; discountPct: number | null; ownerId: string }) {
  await notifyRoles(db, ["sales_manager"], {
    kind: "approval", title: `Discount approval needed: ${deal.name}`, body: `${deal.discountPct}% discount requested.`,
    link: `/deals/${deal.id}`, dedupeKey: `discount:${deal.id}:${deal.discountPct}`,
  });
  await emit(db, "deal.discount_requested", { entityId: deal.id, dedupe: `${deal.id}:${deal.discountPct}`, ownerId: deal.ownerId, name: deal.name, link: `/deals/${deal.id}` });
}

const AUDITED_DEAL_FIELDS = ["amount", "currency", "discountPct", "contractReference", "billingFrequency", "startDate", "ownerId", "expectedCloseDate", "probabilityOverride", "forecastCategory"] as const;

export async function updateDeal(db: DB, actor: Actor, id: string, input: unknown, expected?: Version) {
  assertCan(actor, "deals.edit");
  const before = await getDeal(db, actor, id);
  await assertFresh(db, actor, "deal", id, before.updatedAt, expected, "deal");
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, before.stageId));
  const v = parse(dealSchema, input);
  if (stage.isWon && !can(actor, "admin.pipelines")) {
    const changed = diff(before as Record<string, unknown>, v as Record<string, unknown>, ["amount", "contractReference", "billingFrequency", "startDate", "discountPct", "companyId"]);
    if (Object.keys(changed).length) throw forbidden("Commercial fields on a Closed Won deal are locked. Request a handover correction instead.");
  }
  if (!stage.isWon && !stage.isLost && (!v.nextStep || !v.nextStepDue))
    throw invalid("Every open deal needs a next step and due date.", { nextStep: v.nextStep ? "" : "Next step is required.", nextStepDue: v.nextStepDue ? "" : "Due date is required." });
  const ownerId = can(actor, "deals.reassign") && v.ownerId ? v.ownerId : before.ownerId;
  const disc = await discountState(db, before, v.discountPct);
  const next = { ...v, ownerId, discountStatus: disc.status, discountApprovedBy: disc.status === "approved" ? before.discountApprovedBy : null, updatedAt: new Date() };
  assertUpdated(await db.update(deals).set(next).where(and(eq(deals.id, id), sameVersion(deals.updatedAt, before.updatedAt))).returning({ id: deals.id }), "deal");
  await audit(db, actor, "deal.updated", "deal", id, diff(before, next, [...AUDITED_DEAL_FIELDS, "discountStatus"]));
  if (disc.requested) await requestDiscountNotify(db, { ...before, ...next });
}

export async function decideDiscount(db: DB, actor: Actor, id: string, approve: boolean, comment: string | null) {
  assertCan(actor, "deals.approve_discount");
  const deal = await getDeal(db, actor, id);
  if (deal.discountStatus !== "pending") throw conflict("There is no pending discount request on this deal.");
  const status = approve ? "approved" : "rejected";
  await db.update(deals).set({ discountStatus: status, discountApprovedBy: approve ? actor.id : null, updatedAt: new Date() }).where(eq(deals.id, id));
  await audit(db, actor, `deal.discount_${status}`, "deal", id, { discountStatus: { from: "pending", to: status } }, comment);
  const { notifyUsers } = await import("../notify");
  await notifyUsers(db, [deal.ownerId], { kind: "approval", title: `Discount ${status}: ${deal.name}`, body: comment ?? undefined, link: `/deals/${id}` });
}

export async function setDealProducts(db: DB, actor: Actor, dealId: string, lines: { productId: string; quantity: number; unitPrice: number }[], expected?: Version) {
  assertCan(actor, "deals.edit");
  const deal = await getDeal(db, actor, dealId);
  await assertFresh(db, actor, "deal", dealId, deal.updatedAt, expected, "deal");
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, deal.stageId));
  if (stage.isWon) throw forbidden("Products on a Closed Won deal are locked.");
  for (const l of lines) if (!(l.quantity > 0) || !(l.unitPrice >= 0)) throw invalid("Quantity and price must be positive.");
  await db.transaction(async (tx) => {
    // Product lines are part of the deal's version: bump it (guarded) so concurrent edits are detected.
    assertUpdated(await tx.update(deals).set({ updatedAt: new Date() }).where(and(eq(deals.id, dealId), sameVersion(deals.updatedAt, deal.updatedAt))).returning({ id: deals.id }), "deal");
    await tx.delete(dealProducts).where(eq(dealProducts.dealId, dealId));
    if (lines.length) await tx.insert(dealProducts).values(lines.map((l) => ({ ...l, dealId })));
    await audit(tx, actor, "deal.products_updated", "deal", dealId, { products: { from: null, to: lines.map((l) => `${l.quantity}× ${l.productId}`) } });
  });
}

export async function moveDealStage(
  db: DB, actor: Actor, dealId: string, stageId: string,
  extra: { lossReason?: string | null; lossNotes?: string | null; expected?: Version } = {},
) {
  assertCan(actor, "deals.edit");
  const deal = await getDeal(db, actor, dealId);
  const [current] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, deal.stageId));
  const [target] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.pipelineId, deal.pipelineId)));
  if (!target) throw invalid("That stage does not belong to this deal's pipeline.");
  if (current.id === target.id) return { deal, handoverCreated: false, unchanged: true };
  if (current.isWon) throw conflict("Closed Won deals cannot be moved. The handover workflow now owns this deal.");
  await assertFresh(db, actor, "deal", dealId, deal.updatedAt, extra.expected, "deal");

  const merged = { ...deal, lossReason: extra.lossReason ?? deal.lossReason, lossNotes: extra.lossNotes ?? deal.lossNotes };
  const [{ n: productCount }] = await db.select({ n: count() }).from(dealProducts).where(eq(dealProducts.dealId, dealId));
  const { discountApprovalThreshold } = await getSettings(db);
  const errors = validateStageEntry({ ...merged, productCount }, target, discountApprovalThreshold);
  if (Object.keys(errors).length) throw invalid(`This deal can't move to “${target.name}” yet.`, errors);

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(deals).set({
      stageId: target.id, stageEnteredAt: now, lossReason: target.isLost ? merged.lossReason : deal.lossReason,
      lossNotes: target.isLost ? merged.lossNotes : deal.lossNotes,
      closedAt: target.isWon || target.isLost ? now : null,
      forecastCategory: target.isWon ? "closed" : target.isLost ? "omitted" : deal.forecastCategory === "closed" || deal.forecastCategory === "omitted" ? "pipeline" : deal.forecastCategory,
      lastActivityAt: now, updatedAt: now,
    }).where(and(eq(deals.id, dealId), sameVersion(deals.updatedAt, deal.updatedAt))).returning();
    assertUpdated(updated ? [updated] : [], "deal");
    await tx.insert(dealStageHistory).values({
      dealId, fromStageId: current.id, toStageId: target.id, changedBy: actor.id,
      durationSeconds: Math.round((now.getTime() - deal.stageEnteredAt.getTime()) / 1000),
    });
    await audit(tx, actor, "deal.stage_changed", "deal", dealId, { stage: { from: current.name, to: target.name } }, target.isLost ? merged.lossReason : null);
    let handoverCreated = false;
    if (target.isWon) {
      await tx.update(companies).set({ lifecycle: "customer", updatedAt: now }).where(eq(companies.id, deal.companyId));
      handoverCreated = (await ensureHandoverForDeal(tx, actor, updated)).created;
    }
    return { deal: updated, handoverCreated, unchanged: false };
  });

  if (target.isWon) {
    const [owner] = await db.select({ managerId: users.managerId }).from(users).where(eq(users.id, deal.ownerId));
    await emit(db, "deal.closed_won", {
      entityId: dealId, relatedType: "deal", ownerId: deal.ownerId, managerId: owner?.managerId, name: deal.name,
      companyId: deal.companyId, amount: deal.amount, link: `/handovers?deal=${dealId}`,
    });
  }
  return result;
}

export async function dealIdsByOwner(db: DB, ownerIds: string[]) {
  if (!ownerIds.length) return [];
  return (await db.select({ id: deals.id }).from(deals).where(inArray(deals.ownerId, ownerIds))).map((d) => d.id);
}
