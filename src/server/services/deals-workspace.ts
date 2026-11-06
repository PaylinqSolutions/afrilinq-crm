import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  deals, companies, contacts, users, pipelineStages, dealProducts, dealContacts, activities, tasks, tickets, handoverRecords, products,
} from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { effectiveProbability } from "@/lib/rules/sales";
import { ticketRef } from "@/lib/format";
import { type Actor, assertCan, can } from "../actor";
import { audit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { dealScope } from "./scope";
import { createDeal, getDeal, getStages, moveDealStage, updateDeal } from "./sales";
import type { Version } from "../concurrency";

/** Everything the Deals board needs in one round trip, already scoped to the viewer. */
export async function workspaceDeals(db: DB, actor: Actor) {
  const rows = await db.select({
    id: deals.id, name: deals.name, amount: deals.amount, currency: deals.currency, stageId: deals.stageId, ownerId: deals.ownerId,
    ownerName: users.name, companyId: deals.companyId, companyName: companies.name, segment: companies.segment,
    expectedCloseDate: deals.expectedCloseDate, closedAt: deals.closedAt, createdAt: deals.createdAt, updatedAt: deals.updatedAt,
    lastActivityAt: deals.lastActivityAt, stageEnteredAt: deals.stageEnteredAt, billingFrequency: deals.billingFrequency,
    nextStep: deals.nextStep, nextStepDue: deals.nextStepDue, discountStatus: deals.discountStatus, probabilityOverride: deals.probabilityOverride,
    forecastCategory: deals.forecastCategory, primaryContactId: deals.primaryContactId,
    contactFirst: contacts.firstName, contactLast: contacts.lastName, contactPhone: contacts.phone, contactEmail: contacts.email,
  }).from(deals).innerJoin(companies, eq(companies.id, deals.companyId)).innerJoin(users, eq(users.id, deals.ownerId))
    .leftJoin(contacts, eq(contacts.id, deals.primaryContactId))
    .where(and(isNull(deals.deletedAt), dealScope(actor))).orderBy(asc(deals.expectedCloseDate)).limit(2000);
  const ids = rows.map((r) => r.id);
  const lines = ids.length ? await db.select({ dealId: dealProducts.dealId, productId: dealProducts.productId }).from(dealProducts).where(inArray(dealProducts.dealId, ids)) : [];
  // Next upcoming touchpoint per deal: earliest open task or future scheduled meeting.
  const nextTask = ids.length ? await db.select({ id: tasks.relatedId, at: sql<string>`min(${tasks.dueAt})` }).from(tasks)
    .where(and(eq(tasks.relatedType, "deal"), inArray(tasks.relatedId, ids), eq(tasks.status, "open"))).groupBy(tasks.relatedId) : [];
  const nextMeeting = ids.length ? await db.select({ id: activities.dealId, at: sql<string>`min(${activities.scheduledFor})` }).from(activities)
    .where(and(inArray(activities.dealId, ids), sql`${activities.scheduledFor} > now()`)).groupBy(activities.dealId) : [];
  const nextOf = (id: string) => [nextTask.find((x) => x.id === id)?.at, nextMeeting.find((x) => x.id === id)?.at].filter(Boolean).map((x) => new Date(x!).toISOString()).sort()[0] ?? null;
  return rows.map((r) => ({
    nextActivityAt: nextOf(r.id),
    ...r, productIds: lines.filter((l) => l.dealId === r.id).map((l) => l.productId),
    contactName: r.contactFirst ? `${r.contactFirst} ${r.contactLast}` : null,
  }));
}

export async function dealPreview(db: DB, actor: Actor, id: string) {
  const deal = await getDeal(db, actor, id);
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, deal.stageId));
  const [company] = await db.select({ id: companies.id, name: companies.name, city: companies.city, segment: companies.segment, tier: companies.tier, phone: companies.phone, website: companies.website })
    .from(companies).where(eq(companies.id, deal.companyId));
  const [owner] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, deal.ownerId));
  const cs = await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle, email: contacts.email, phone: contacts.phone, whatsapp: contacts.whatsapp, role: dealContacts.role })
    .from(dealContacts).innerJoin(contacts, eq(contacts.id, dealContacts.contactId)).where(eq(dealContacts.dealId, id));
  const companyContacts = await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone })
    .from(contacts).where(and(eq(contacts.companyId, deal.companyId), isNull(contacts.deletedAt)));
  const acts = await db.select({ id: activities.id, type: activities.type, subject: activities.subject, body: activities.body, outcome: activities.outcome, occurredAt: activities.occurredAt, scheduledFor: activities.scheduledFor, simulated: activities.simulated, by: users.name })
    .from(activities).leftJoin(users, eq(users.id, activities.createdBy)).where(eq(activities.dealId, id)).orderBy(desc(activities.occurredAt)).limit(60);
  const openTasks = await db.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority, ownerName: users.name })
    .from(tasks).innerJoin(users, eq(users.id, tasks.ownerId)).where(and(eq(tasks.relatedType, "deal"), eq(tasks.relatedId, id), eq(tasks.status, "open"))).orderBy(asc(tasks.dueAt));
  const ts = await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, priority: tickets.priority, status: tickets.status })
    .from(tickets).where(and(eq(tickets.companyId, deal.companyId), inArray(tickets.status, OPEN_STATUSES), isNull(tickets.deletedAt))).orderBy(asc(tickets.priority)).limit(10);
  const lines = await db.select({ name: products.name, quantity: dealProducts.quantity, unitPrice: dealProducts.unitPrice }).from(dealProducts).innerJoin(products, eq(products.id, dealProducts.productId)).where(eq(dealProducts.dealId, id));
  const [handover] = await db.select({ id: handoverRecords.id, status: handoverRecords.status, completeness: handoverRecords.completeness }).from(handoverRecords).where(eq(handoverRecords.dealId, id));
  const [lastContacted] = await db.select({ at: sql<Date | null>`max(${activities.occurredAt})` }).from(activities)
    .where(and(eq(activities.dealId, id), inArray(activities.type, ["call", "email", "meeting", "demo", "whatsapp"]), sql`${activities.occurredAt} <= now()`));
  const { CLOSED_WON_REQUIRED, DEAL_REQUIRABLE_FIELDS } = await import("@/lib/rules/sales");
  const { getSettings } = await import("../settings");
  const threshold = (await getSettings(db)).discountApprovalThreshold;
  // What's still needed before this deal can be moved to Closed Won (same rules the server enforces).
  const wonReadiness = [
    ...CLOSED_WON_REQUIRED.map((f) => ({ key: f, label: DEAL_REQUIRABLE_FIELDS[f] ?? f, ok: f === "products" ? lines.length > 0 : f === "amount" ? (deal.amount ?? 0) > 0 : !!(deal as Record<string, unknown>)[f] })),
    ...((deal.discountPct ?? 0) > threshold ? [{ key: "discount", label: `Manager approval for the ${deal.discountPct}% discount`, ok: deal.discountStatus === "approved" }] : []),
  ];
  return {
    wonReadiness,
    deal: { ...deal, version: deal.updatedAt.toISOString() }, stage, company, owner, contacts: cs, companyContacts, activities: acts, openTasks,
    tickets: ts.map((t) => ({ ...t, ref: ticketRef(t.number) })), lines, handover: handover ?? null,
    probability: effectiveProbability(stage.probability, deal.probabilityOverride), lastContactedAt: lastContacted?.at ?? null,
    perms: { edit: can(actor, "deals.edit"), reassign: can(actor, "deals.reassign"), delete: can(actor, "data.delete"), log: can(actor, "activities.log"), ticket: can(actor, "tickets.create") },
  };
}

export type DealPatch = Partial<{ name: string; amount: number | null; expectedCloseDate: string | null; ownerId: string; nextStep: string | null; nextStepDue: string | null; forecastCategory: string; billingFrequency: string | null }>;

/** Inline edit of one or more fields. Goes through updateDeal so validation, permissions, audit and conflict checks all apply. */
export async function patchDeal(db: DB, actor: Actor, id: string, patch: DealPatch, expected: Version) {
  const d = await getDeal(db, actor, id);
  const merged = {
    name: d.name, companyId: d.companyId, primaryContactId: d.primaryContactId, ownerId: d.ownerId, amount: d.amount, currency: d.currency,
    expectedCloseDate: d.expectedCloseDate, probabilityOverride: d.probabilityOverride, nextStep: d.nextStep, nextStepDue: d.nextStepDue,
    competitor: d.competitor, forecastCategory: d.forecastCategory, contractReference: d.contractReference, billingFrequency: d.billingFrequency,
    startDate: d.startDate, discountPct: d.discountPct, leadSource: d.leadSource, ...patch,
  };
  if (patch.ownerId && patch.ownerId !== d.ownerId && !can(actor, "deals.reassign")) throw forbidden("Only a sales manager can reassign deals.");
  await updateDeal(db, actor, id, merged, expected);
  return (await getDeal(db, actor, id)).updatedAt.toISOString();
}

export async function assignDeals(db: DB, actor: Actor, ids: string[], ownerId: string) {
  assertCan(actor, "deals.reassign");
  const [u] = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, ownerId), eq(users.active, true)));
  if (!u) throw invalid("Choose an active user.");
  let n = 0;
  for (const id of ids) {
    const d = await getDeal(db, actor, id);
    if (d.ownerId === ownerId) continue;
    await db.update(deals).set({ ownerId, updatedAt: new Date() }).where(eq(deals.id, id));
    await audit(db, actor, "deal.updated", "deal", id, { ownerId: { from: d.ownerId, to: ownerId } }, "Bulk assign");
    n++;
  }
  return { assigned: n, to: u.name };
}

export async function moveDeals(db: DB, actor: Actor, ids: string[], stageId: string, lossReason: string | null) {
  const results: { id: string; name: string; ok: boolean; message?: string; fromStageId?: string }[] = [];
  for (const id of ids) {
    try {
      const before = await getDeal(db, actor, id);
      const r = await moveDealStage(db, actor, id, stageId, { lossReason });
      results.push({ id, name: before.name, ok: true, message: r.handoverCreated ? "handover created" : undefined, fromStageId: before.stageId });
    } catch (e) {
      const d = await db.select({ name: deals.name }).from(deals).where(eq(deals.id, id));
      results.push({ id, name: d[0]?.name ?? id, ok: false, message: (e as Error).message });
    }
  }
  return results;
}

export async function deleteDeals(db: DB, actor: Actor, ids: string[], reason: string) {
  assertCan(actor, "data.delete");
  if (!reason?.trim()) throw invalid("Give a reason for deleting.", { reason: "Required." });
  for (const id of ids) {
    const d = await getDeal(db, actor, id);
    const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, d.stageId));
    if (stage.isWon) throw conflict(`“${d.name}” is Closed Won and owned by the handover workflow; it can't be deleted.`);
  }
  await db.update(deals).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(deals.id, ids));
  for (const id of ids) await audit(db, actor, "deal.deleted", "deal", id, null, reason);
  return ids.length;
}

export async function restoreDeals(db: DB, actor: Actor, ids: string[]) {
  assertCan(actor, "data.delete");
  await db.update(deals).set({ deletedAt: null, updatedAt: new Date() }).where(and(inArray(deals.id, ids), isNotNull(deals.deletedAt)));
  for (const id of ids) await audit(db, actor, "deal.restored", "deal", id);
  return ids.length;
}

/** "+ Deal" inside a column: creates the deal, then moves it into the chosen stage through the normal stage gates. */
export async function createDealInStage(db: DB, actor: Actor, input: Record<string, unknown>, stageId: string | null) {
  const d = await createDeal(db, actor, input);
  const pid = typeof input.productId === "string" && input.productId ? input.productId : null;
  if (pid) {
    const [p] = await db.select().from(products).where(eq(products.id, pid));
    if (p) await db.insert(dealProducts).values({ dealId: d.id, productId: p.id, quantity: 1, unitPrice: d.amount ?? p.listPrice ?? 0 });
  }
  const stages = await getStages(db);
  if (!stageId || stageId === stages[0].id) return { id: d.id, warning: null };
  try { await moveDealStage(db, actor, d.id, stageId); return { id: d.id, warning: null }; }
  catch (e) { return { id: d.id, warning: `Created in “${stages[0].name}”. It couldn't enter the chosen stage yet: ${(e as Error).message}` }; }
}

export async function exportDealsCsv(db: DB, actor: Actor, ids: string[]) {
  assertCan(actor, "data.export");
  if (!ids.length) throw invalid("Nothing to export.");
  const rows = await db.select({ name: deals.name, company: companies.name, stage: pipelineStages.name, amount: deals.amount, currency: deals.currency, close: deals.expectedCloseDate, owner: users.name, nextStep: deals.nextStep })
    .from(deals).innerJoin(companies, eq(companies.id, deals.companyId)).innerJoin(users, eq(users.id, deals.ownerId)).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(and(inArray(deals.id, ids), isNull(deals.deletedAt), dealScope(actor)));
  const esc = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [["Deal", "Company", "Stage", "Amount", "Currency", "Expected close", "Owner", "Next step"], ...rows.map((r) => [r.name, r.company, r.stage, r.amount, r.currency, r.close, r.owner, r.nextStep])]
    .map((r) => r.map(esc).join(",")).join("\n");
  await audit(db, actor, "data.exported", "export", "deals", { rows: { from: null, to: rows.length } }, "Deals board selection");
  return { csv, count: rows.length };
}

export async function requireDeal(db: DB, actor: Actor, id: string) {
  try { return await getDeal(db, actor, id); } catch { throw notFound("Deal"); }
}
