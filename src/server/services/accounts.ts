import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import {
  companies, contacts, users, deals, pipelineStages, handoverRecords, onboardingProjects, trainingSessions, trainingParticipants,
  trainingPrograms, tickets, activities, files, auditLogs, customerHealthSnapshots, renewals, expansionOpportunities, tasks,
  dealStageHistory, handoverReviews, customFields, customFieldValues,
} from "@/db/schema";
import { companySchema, contactSchema } from "@/lib/schemas";
import { type Actor, assertCan, can } from "../actor";
import { audit, diff } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { parse } from "../validate";
import { companyScope, contactScope, dealScope, ticketScope } from "./scope";
import { paging } from "./sales";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export type CompanyFilters = { q?: string; segment?: string; tier?: string; lifecycle?: string; owner?: string; region?: string; page?: string; sort?: string };

export async function listCompanies(db: DB, actor: Actor, f: CompanyFilters, all = false) {
  const conds: (SQL | undefined)[] = [isNull(companies.deletedAt), companyScope(db, actor)];
  if (f.q) conds.push(or(ilike(companies.name, `%${f.q}%`), ilike(companies.city, `%${f.q}%`)));
  if (f.segment) conds.push(eq(companies.segment, f.segment));
  if (f.tier) conds.push(eq(companies.tier, f.tier));
  if (f.lifecycle) conds.push(eq(companies.lifecycle, f.lifecycle));
  if (f.region) conds.push(eq(companies.region, f.region));
  if (f.owner) conds.push(f.owner === "me" ? or(eq(companies.ownerId, actor.id), eq(companies.csmId, actor.id)) : eq(companies.ownerId, f.owner));
  const where = and(...conds);
  const { limit, offset } = paging(f.page);
  const order = { name: asc(companies.name), created: desc(companies.createdAt), segment: asc(companies.segment) }[f.sort ?? "name"] ?? asc(companies.name);
  const q = db.select({
    id: companies.id, name: companies.name, industry: companies.industry, segment: companies.segment, tier: companies.tier,
    lifecycle: companies.lifecycle, region: companies.region, city: companies.city, ownerName: users.name, createdAt: companies.createdAt,
    health: sql<string | null>`(select status from customer_health_snapshots h where h.company_id = ${companies.id} order by computed_at desc limit 1)`,
    openTickets: sql<number>`(select count(*) from tickets t where t.company_id = ${companies.id} and t.status not in ('resolved','closed') and t.deleted_at is null)::int`,
  }).from(companies).leftJoin(users, eq(users.id, companies.ownerId)).where(where).orderBy(order);
  const rows = all ? await q.limit(5000) : await q.limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(companies).where(where);
  return { rows, total };
}

export async function getCompany(db: DB, actor: Actor, id: string) {
  const [c] = await db.select().from(companies).where(and(eq(companies.id, id), isNull(companies.deletedAt), companyScope(db, actor)));
  if (!c) throw notFound("Company");
  return c;
}

export async function createCompany(db: DB, actor: Actor, input: unknown) {
  assertCan(actor, "accounts.edit");
  const v = parse(companySchema, input);
  const [dupe] = await db.select({ id: companies.id }).from(companies).where(and(ilike(companies.name, v.name), isNull(companies.deletedAt)));
  if (dupe) throw invalid("A company with this name already exists.", { name: "Duplicate name — open the existing record instead." });
  const [c] = await db.insert(companies).values({ ...v, ownerId: v.ownerId ?? actor.id }).returning();
  await audit(db, actor, "company.created", "company", c.id);
  return c;
}

export async function updateCompany(db: DB, actor: Actor, id: string, input: unknown, expected?: Version) {
  assertCan(actor, "accounts.edit");
  const before = await getCompany(db, actor, id);
  await assertFresh(db, actor, "company", id, before.updatedAt, expected, "company");
  const v = parse(companySchema, input);
  assertUpdated(await db.update(companies).set({ ...v, updatedAt: new Date() }).where(and(eq(companies.id, id), sameVersion(companies.updatedAt, before.updatedAt))).returning({ id: companies.id }), "company");
  await audit(db, actor, "company.updated", "company", id, diff(before, v, ["name", "segment", "tier", "lifecycle", "ownerId", "csmId"]));
}

export async function updateBilling(db: DB, actor: Actor, id: string, input: { billingStatus: string | null; billingNotes: string | null }, expected?: Version) {
  assertCan(actor, "finance.edit");
  const before = await getCompany(db, actor, id);
  await assertFresh(db, actor, "company", id, before.updatedAt, expected, "company");
  if (input.billingStatus && !["current", "overdue", "unpaid", "n/a"].includes(input.billingStatus)) throw invalid("Unknown billing status.");
  assertUpdated(await db.update(companies).set({ ...input, updatedAt: new Date() }).where(and(eq(companies.id, id), sameVersion(companies.updatedAt, before.updatedAt))).returning({ id: companies.id }), "company");
  await audit(db, actor, "company.billing_updated", "company", id, diff(before, input, ["billingStatus", "billingNotes"]));
}

export async function softDeleteCompany(db: DB, actor: Actor, id: string, reason: string) {
  assertCan(actor, "data.delete");
  await getCompany(db, actor, id);
  if (!reason?.trim()) throw invalid("A reason is required for deletion.", { reason: "Required." });
  await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, id));
  await audit(db, actor, "company.deleted", "company", id, null, reason);
}

export type ContactFilters = { q?: string; company?: string; role?: string; page?: string };

export async function listContacts(db: DB, actor: Actor, f: ContactFilters, all = false) {
  const conds: (SQL | undefined)[] = [isNull(contacts.deletedAt), contactScope(db, actor)];
  if (f.q) conds.push(or(ilike(contacts.firstName, `%${f.q}%`), ilike(contacts.lastName, `%${f.q}%`), ilike(contacts.email, `%${f.q}%`), ilike(companies.name, `%${f.q}%`)));
  if (f.company) conds.push(eq(contacts.companyId, f.company));
  if (f.role) conds.push(sql`${contacts.contactRoles} ? ${f.role}`);
  const where = and(...conds);
  const { limit, offset } = paging(f.page);
  const q = db.select({
    id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone,
    jobTitle: contacts.jobTitle, contactRoles: contacts.contactRoles, companyId: companies.id, companyName: companies.name,
  }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId)).where(where).orderBy(asc(contacts.lastName));
  const rows = all ? await q.limit(5000) : await q.limit(limit).offset(offset);
  const [{ total }] = await db.select({ total: count() }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId)).where(where);
  return { rows, total };
}

export async function getContact(db: DB, actor: Actor, id: string) {
  const [row] = await db.select({ c: contacts, companyName: companies.name }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(eq(contacts.id, id), isNull(contacts.deletedAt), contactScope(db, actor)));
  if (!row) throw notFound("Contact");
  return row;
}

export async function createContact(db: DB, actor: Actor, input: unknown) {
  assertCan(actor, "accounts.edit");
  const v = parse(contactSchema, input);
  if (v.companyId) await getCompany(db, actor, v.companyId);
  if (v.email) {
    const [dupe] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.email, v.email), isNull(contacts.deletedAt)));
    if (dupe) throw invalid("A contact with this email already exists.", { email: "Duplicate email." });
  }
  const [c] = await db.insert(contacts).values({ ...v, ownerId: v.ownerId ?? actor.id }).returning();
  await audit(db, actor, "contact.created", "contact", c.id);
  return c;
}

export async function updateContact(db: DB, actor: Actor, id: string, input: unknown, expected?: Version) {
  assertCan(actor, "accounts.edit");
  const { c: before } = await getContact(db, actor, id);
  await assertFresh(db, actor, "contact", id, before.updatedAt, expected, "contact");
  const v = parse(contactSchema, input);
  // Forms that don't show the owner field must not unassign the contact.
  if (!(input && typeof input === "object" && "ownerId" in input)) v.ownerId = before.ownerId;
  assertUpdated(await db.update(contacts).set({ ...v, updatedAt: new Date() }).where(and(eq(contacts.id, id), sameVersion(contacts.updatedAt, before.updatedAt))).returning({ id: contacts.id }), "contact");
  await audit(db, actor, "contact.updated", "contact", id, diff(before, v, ["email", "phone", "companyId", "contactRoles", "marketingConsent", "ownerId", "leadStatus", "lifecycleStage", "referralSource", "city"]));
}

export type TimelineItem = { at: Date; kind: string; title: string; detail?: string | null; by?: string | null; link?: string };

/** Customer 360: everything linked to one account, each section filtered by the viewer's own permissions. */
export async function customer360(db: DB, actor: Actor, id: string) {
  const company = await getCompany(db, actor, id);
  const owner = company.ownerId ? (await db.select({ name: users.name }).from(users).where(eq(users.id, company.ownerId)))[0] : null;
  const csm = company.csmId ? (await db.select({ name: users.name }).from(users).where(eq(users.id, company.csmId)))[0] : null;
  const cs = await db.select().from(contacts).where(and(eq(contacts.companyId, id), isNull(contacts.deletedAt))).orderBy(asc(contacts.lastName));
  const ds = await db.select({
    id: deals.id, name: deals.name, amount: deals.amount, currency: deals.currency, stage: pipelineStages.name, isWon: pipelineStages.isWon,
    isLost: pipelineStages.isLost, expectedCloseDate: deals.expectedCloseDate, ownerName: users.name, closedAt: deals.closedAt,
  }).from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(users, eq(users.id, deals.ownerId))
    .where(and(eq(deals.companyId, id), isNull(deals.deletedAt), dealScope(actor))).orderBy(desc(deals.createdAt));
  const hs = can(actor, "handover.view")
    ? await db.select({ id: handoverRecords.id, status: handoverRecords.status, completeness: handoverRecords.completeness, dealName: deals.name, updatedAt: handoverRecords.updatedAt })
        .from(handoverRecords).innerJoin(deals, eq(deals.id, handoverRecords.dealId)).where(eq(handoverRecords.companyId, id))
    : [];
  const ps = can(actor, "onboarding.view", "handover.view")
    ? await db.select({ id: onboardingProjects.id, name: onboardingProjects.name, stage: onboardingProjects.stage, state: onboardingProjects.state, riskLevel: onboardingProjects.riskLevel, targetGoLive: onboardingProjects.targetGoLive, actualGoLive: onboardingProjects.actualGoLive })
        .from(onboardingProjects).where(eq(onboardingProjects.companyId, id))
    : [];
  const ss = await db.select({
    id: trainingSessions.id, title: trainingSessions.title, startsAt: trainingSessions.startsAt, status: trainingSessions.status, program: trainingPrograms.name,
    isRefresher: trainingSessions.isRefresher, topicsCovered: trainingSessions.topicsCovered,
    participants: sql<number>`(select count(*) from training_participants p where p.session_id = ${trainingSessions.id})::int`,
    attended: sql<number>`(select count(*) from training_participants p where p.session_id = ${trainingSessions.id} and p.attendance = 'attended')::int`,
    completed: sql<number>`(select count(*) from training_participants p where p.session_id = ${trainingSessions.id} and p.completed)::int`,
    avgFeedback: sql<number | null>`(select round(avg(feedback_score)::numeric, 1)::float from training_participants p where p.session_id = ${trainingSessions.id})`,
  }).from(trainingSessions).innerJoin(trainingPrograms, eq(trainingPrograms.id, trainingSessions.programId)).where(eq(trainingSessions.companyId, id)).orderBy(desc(trainingSessions.startsAt));
  // Tickets: summary fields only (never internal notes). Viewers without ticket scope still see the account's ticket list for context.
  const tsAll = await db.select({
    id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status, priority: tickets.priority, createdAt: tickets.createdAt,
    resolvedAt: tickets.resolvedAt, resolutionBreached: tickets.resolutionBreached, csatScore: tickets.csatScore,
  }).from(tickets).where(and(eq(tickets.companyId, id), isNull(tickets.deletedAt))).orderBy(desc(tickets.createdAt));
  const openable = new Set((await db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.companyId, id), ticketScope(db, actor)))).map((t) => t.id));
  const ts = tsAll.map((t) => ({ ...t, canOpen: openable.has(t.id) }));
  const acts = await db.select({
    id: activities.id, type: activities.type, subject: activities.subject, body: activities.body, outcome: activities.outcome,
    occurredAt: activities.occurredAt, simulated: activities.simulated, by: users.name, dealId: activities.dealId, contactId: activities.contactId,
  }).from(activities).leftJoin(users, eq(users.id, activities.createdBy)).where(eq(activities.companyId, id)).orderBy(desc(activities.occurredAt)).limit(200);
  const fs = await db.select({ id: files.id, filename: files.filename, sizeBytes: files.sizeBytes, restricted: files.restricted, createdAt: files.createdAt, by: users.name, entityType: files.entityType })
    .from(files).leftJoin(users, eq(users.id, files.uploadedBy)).where(eq(files.companyId, id)).orderBy(desc(files.createdAt));
  const visibleFiles = fs.filter((f) => !f.restricted || can(actor, "finance.view", "handover.review", "admin.settings"));
  const [health] = await db.select().from(customerHealthSnapshots).where(eq(customerHealthSnapshots.companyId, id)).orderBy(desc(customerHealthSnapshots.computedAt)).limit(1);
  const rs = await db.select().from(renewals).where(eq(renewals.companyId, id)).orderBy(asc(renewals.renewalDate));
  const xs = await db.select().from(expansionOpportunities).where(eq(expansionOpportunities.companyId, id));
  const openTasks = await db.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, status: tasks.status, ownerName: users.name, priority: tasks.priority })
    .from(tasks).innerJoin(users, eq(users.id, tasks.ownerId)).where(and(eq(tasks.companyId, id), eq(tasks.status, "open"))).orderBy(asc(tasks.dueAt));
  const auditRows = can(actor, "audit.view")
    ? await db.select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, changes: auditLogs.changes, reason: auditLogs.reason, createdAt: auditLogs.createdAt, actor: auditLogs.actorLabel })
        .from(auditLogs).where(or(
          and(eq(auditLogs.entityType, "company"), eq(auditLogs.entityId, id)),
          ds.length ? and(eq(auditLogs.entityType, "deal"), inArray(auditLogs.entityId, ds.map((d) => d.id))) : sql`false`,
          hs.length ? and(eq(auditLogs.entityType, "handover"), inArray(auditLogs.entityId, hs.map((h) => h.id))) : sql`false`,
          ps.length ? and(eq(auditLogs.entityType, "onboarding"), inArray(auditLogs.entityId, ps.map((p) => p.id))) : sql`false`,
          ts.length ? and(eq(auditLogs.entityType, "ticket"), inArray(auditLogs.entityId, ts.map((t) => t.id))) : sql`false`,
        )).orderBy(desc(auditLogs.createdAt)).limit(200)
    : null;

  const timeline: TimelineItem[] = [
    ...acts.map((a) => ({ at: a.occurredAt, kind: a.type, title: a.subject, detail: [a.outcome, a.body].filter(Boolean).join(" — ") || null, by: a.by, link: a.dealId ? `/deals/${a.dealId}` : undefined })),
    ...ts.map((t) => ({ at: t.createdAt, kind: "ticket", title: `Ticket AFL-${t.number} opened: ${t.subject}`, detail: `${t.priority}`, link: `/tickets/${t.id}` })),
    ...ts.filter((t) => t.resolvedAt).map((t) => ({ at: t.resolvedAt!, kind: "ticket", title: `Ticket AFL-${t.number} resolved`, link: `/tickets/${t.id}` })),
    ...ss.filter((s) => s.status === "completed").map((s) => ({ at: s.startsAt, kind: "training", title: `Training delivered: ${s.title}`, detail: `${s.attended}/${s.participants} attended`, link: `/training/sessions/${s.id}` })),
  ];
  if (ds.length) {
    const hist = await db.select({ at: dealStageHistory.changedAt, stage: pipelineStages.name, dealId: dealStageHistory.dealId, by: users.name })
      .from(dealStageHistory).innerJoin(pipelineStages, eq(pipelineStages.id, dealStageHistory.toStageId)).leftJoin(users, eq(users.id, dealStageHistory.changedBy))
      .where(inArray(dealStageHistory.dealId, ds.map((d) => d.id)));
    const names = new Map(ds.map((d) => [d.id, d.name]));
    timeline.push(...hist.map((h) => ({ at: h.at, kind: "deal", title: `${names.get(h.dealId)} → ${h.stage}`, by: h.by, link: `/deals/${h.dealId}` })));
  }
  if (hs.length) {
    const rev = await db.select({ at: handoverReviews.createdAt, action: handoverReviews.action, handoverId: handoverReviews.handoverId, by: users.name, comment: handoverReviews.comment })
      .from(handoverReviews).leftJoin(users, eq(users.id, handoverReviews.actorId)).where(inArray(handoverReviews.handoverId, hs.map((h) => h.id)));
    timeline.push(...rev.filter((r) => !r.action.startsWith("correction")).map((r) => ({ at: r.at, kind: "handover", title: `Handover ${r.action.replace(/_/g, " ")}`, detail: r.comment, by: r.by, link: `/handovers/${r.handoverId}` })));
  }
  timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

  const cfDefs = await db.select().from(customFields).where(eq(customFields.entityType, "company"));
  const cfVals = cfDefs.length ? await db.select().from(customFieldValues).where(and(eq(customFieldValues.entityId, id), inArray(customFieldValues.fieldId, cfDefs.map((d) => d.id)))) : [];

  return {
    company, owner, csm, contacts: cs, deals: ds, handovers: hs, projects: ps, sessions: ss, tickets: ts, activities: acts,
    files: visibleFiles, hiddenFiles: fs.length - visibleFiles.length, health: health ?? null, renewals: rs, expansions: xs,
    tasks: openTasks, audit: auditRows, timeline, customFields: cfDefs.map((d) => ({ ...d, value: cfVals.find((v) => v.fieldId === d.id)?.value ?? null })),
    canEdit: can(actor, "accounts.edit"), canBilling: can(actor, "finance.edit"), canSeeBilling: can(actor, "finance.view", "finance.edit"),
  };
}

export async function setCustomFieldValues(db: DB, actor: Actor, entityType: string, entityId: string, values: Record<string, string>) {
  // Custom fields exist only on companies (see addCustomField); reject anything else so no unscoped record can be written.
  if (entityType !== "company") throw invalid("Custom fields are currently supported on companies.");
  assertCan(actor, "accounts.edit");
  await getCompany(db, actor, entityId);
  const defs = await db.select().from(customFields).where(eq(customFields.entityType, entityType));
  const errs: Record<string, string> = {};
  for (const d of defs) {
    const v = (values[d.key] ?? "").trim();
    if (d.required && !v) errs[`cf_${d.key}`] = `${d.label} is required.`;
    if (v && d.fieldType === "number" && !Number.isFinite(Number(v))) errs[`cf_${d.key}`] = "Enter a number.";
    if (v && d.fieldType === "select" && !(d.options ?? []).includes(v)) errs[`cf_${d.key}`] = "Choose an option.";
  }
  if (Object.keys(errs).length) throw invalid("Please correct the custom fields.", errs);
  for (const d of defs) {
    await db.insert(customFieldValues).values({ fieldId: d.id, entityId, value: values[d.key] ?? null })
      .onConflictDoUpdate({ target: [customFieldValues.fieldId, customFieldValues.entityId], set: { value: values[d.key] ?? null } });
  }
  await audit(db, actor, "custom_fields.updated", entityType, entityId);
}

export function assertCompanyAccessForFile(actor: Actor, restricted: boolean) {
  if (restricted && !can(actor, "finance.view", "handover.review", "admin.settings")) throw forbidden("This file is restricted.");
}
