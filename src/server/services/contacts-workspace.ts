import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  activities, auditLogs, companies, contacts, dealContacts, deals, dealStageHistory, files, onboardingProjects, pipelineStages, tasks, tickets, trainingParticipants, trainingSessions, users,
} from "@/db/schema";
import { CONTACT_LEAD_STATUSES, DEFAULT_REFERRAL_SOURCES, LIFECYCLE_STAGES, leadStatusLabel, lifecycleLabel, normalisePhone } from "@/lib/rules/contacts";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { type Actor, assertCan, can } from "../actor";
import { audit, diff } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { contactScope, dealScope, ticketScope } from "./scope";
export { contactScope };
import { getCompany } from "./accounts";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

async function requireContact(db: DB, actor: Actor, id: string) {
  const [c] = await db.select({ c: contacts }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(eq(contacts.id, id), isNull(contacts.deletedAt), contactScope(db, actor)));
  if (!c) throw notFound("Contact");
  return c.c;
}

/** Everything the Contacts table needs, already scoped to the viewer. */
export async function workspaceContacts(db: DB, actor: Actor) {
  const last = db.select({ contactId: activities.contactId, at: sql<Date>`max(${activities.occurredAt})`.as("last_at") }).from(activities)
    .where(and(isNotNull(activities.contactId), isNull(activities.scheduledFor))).groupBy(activities.contactId).as("last");
  const rows = await db.select({
    id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone, whatsapp: contacts.whatsapp,
    jobTitle: contacts.jobTitle, companyId: contacts.companyId, companyName: companies.name, city: contacts.city, leadStatus: contacts.leadStatus,
    lifecycleStage: contacts.lifecycleStage, referralSource: contacts.referralSource, ownerId: contacts.ownerId, ownerName: users.name,
    contactRoles: contacts.contactRoles, marketingConsent: contacts.marketingConsent, createdAt: contacts.createdAt, updatedAt: contacts.updatedAt, lastActivityAt: last.at,
  }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId)).leftJoin(users, eq(users.id, contacts.ownerId))
    .leftJoin(last, eq(last.contactId, contacts.id))
    .where(and(isNull(contacts.deletedAt), contactScope(db, actor))).orderBy(desc(contacts.createdAt)).limit(5000);
  return rows.map((r) => ({ ...r, lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt) : null }));
}

/** Referral sources in use plus the defaults, so new ones added inline become choices for everyone. */
export async function referralSources(db: DB) {
  const used = await db.selectDistinct({ s: contacts.referralSource }).from(contacts).where(isNotNull(contacts.referralSource));
  return [...new Set([...DEFAULT_REFERRAL_SOURCES, ...used.map((u) => u.s!)])].sort((a, b) => a.localeCompare(b));
}

export const CONTACT_PATCH_FIELDS = ["firstName", "lastName", "email", "phone", "whatsapp", "jobTitle", "companyId", "city", "leadStatus", "lifecycleStage", "referralSource", "ownerId", "preferredChannel", "marketingConsent", "contactRoles"] as const;
export type ContactPatch = Partial<Record<(typeof CONTACT_PATCH_FIELDS)[number], string | boolean | string[] | null>>;

const patchSchema = z.object({
  firstName: z.string().trim().min(1, "First name can't be empty.").max(80), lastName: z.string().trim().min(1, "Last name can't be empty.").max(80),
  email: z.string().trim().toLowerCase().max(200).nullable().refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
  phone: z.string().trim().max(40).nullable(), whatsapp: z.string().trim().max(40).nullable(), jobTitle: z.string().trim().max(120).nullable(),
  companyId: z.string().uuid().nullable(), city: z.string().trim().max(60).nullable(),
  leadStatus: z.string().nullable().refine((v) => !v || CONTACT_LEAD_STATUSES.some((s) => s.key === v), "Unknown lead status."),
  lifecycleStage: z.string().refine((v) => LIFECYCLE_STAGES.some((s) => s.key === v), "Unknown lifecycle stage."),
  referralSource: z.string().trim().max(80).nullable(), ownerId: z.string().uuid().nullable(),
  preferredChannel: z.enum(["email", "phone", "whatsapp"]).nullable(), marketingConsent: z.boolean(), contactRoles: z.array(z.string()),
}).partial();

/** Inline edit of one or more properties, with conflict detection and an audit entry. */
export async function patchContact(db: DB, actor: Actor, id: string, patch: ContactPatch, expected: Version) {
  assertCan(actor, "accounts.edit");
  const before = await requireContact(db, actor, id);
  await assertFresh(db, actor, "contact", id, before.updatedAt, expected, "contact");
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" ? null : v]));
  const r = patchSchema.safeParse(clean);
  if (!r.success) throw invalid(r.error.issues[0].message, Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
  const v = r.data;
  for (const k of ["phone", "whatsapp"] as const) if (v[k]) { const n = normalisePhone(v[k]!); if (!n.valid) throw invalid("That doesn't look like a phone number.", { [k]: "Use 10–15 digits, e.g. 0803 481 9348." }); v[k] = n.value; }
  if (v.email && v.email !== before.email) {
    const [dupe] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.email, v.email), isNull(contacts.deletedAt)));
    if (dupe && dupe.id !== id) throw invalid("Another contact already uses this email.", { email: "Duplicate email." });
  }
  if (v.companyId) await getCompany(db, actor, v.companyId);
  if (v.ownerId !== undefined && v.ownerId !== before.ownerId && v.ownerId !== actor.id && !can(actor, "leads.assign", "deals.reassign", "accounts.view_all")) throw forbidden("You can only assign contacts to yourself.");
  const rows = await db.update(contacts).set({ ...v, updatedAt: new Date() }).where(and(eq(contacts.id, id), sameVersion(contacts.updatedAt, before.updatedAt))).returning();
  assertUpdated(rows, "contact");
  const row = rows[0];
  await audit(db, actor, "contact.updated", "contact", id, diff(before as Record<string, unknown>, v as Record<string, unknown>));
  return row;
}

export async function bulkUpdateContacts(db: DB, actor: Actor, ids: string[], patch: { ownerId?: string | null; leadStatus?: string | null; lifecycleStage?: string }) {
  assertCan(actor, "accounts.edit");
  if (!ids.length) throw invalid("Select at least one contact.");
  if (patch.ownerId && patch.ownerId !== actor.id && !can(actor, "leads.assign", "deals.reassign", "accounts.view_all")) throw forbidden("You can only assign contacts to yourself.");
  const r = patchSchema.pick({ ownerId: true, leadStatus: true, lifecycleStage: true }).safeParse(patch);
  if (!r.success) throw invalid(r.error.issues[0].message);
  const visible = await db.select({ id: contacts.id }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt), contactScope(db, actor)));
  if (!visible.length) throw notFound("Contacts");
  await db.update(contacts).set({ ...r.data, updatedAt: new Date() }).where(inArray(contacts.id, visible.map((v) => v.id)));
  for (const v of visible) await audit(db, actor, "contact.updated", "contact", v.id, Object.fromEntries(Object.entries(r.data).map(([k, x]) => [k, { from: null, to: x }])), "Bulk edit");
  return visible.length;
}

export async function deleteContacts(db: DB, actor: Actor, ids: string[], reason: string) {
  assertCan(actor, "data.delete");
  if (!reason.trim()) throw invalid("Give a reason for deleting.", { reason: "Required." });
  const visible = await db.select({ id: contacts.id }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt), contactScope(db, actor)));
  await db.update(contacts).set({ deletedAt: new Date() }).where(inArray(contacts.id, visible.map((v) => v.id)));
  for (const v of visible) await audit(db, actor, "contact.deleted", "contact", v.id, null, reason);
  return visible.length;
}

export async function restoreContacts(db: DB, actor: Actor, ids: string[]) {
  assertCan(actor, "data.delete");
  await db.update(contacts).set({ deletedAt: null }).where(inArray(contacts.id, ids));
  for (const id of ids) await audit(db, actor, "contact.restored", "contact", id);
  return ids.length;
}

export async function exportContactsCsv(db: DB, actor: Actor, ids: string[]) {
  assertCan(actor, "data.export");
  if (!ids.length) throw invalid("Nothing to export.");
  const rows = (await workspaceContacts(db, actor)).filter((r) => ids.includes(r.id));
  const esc = (v: unknown) => { let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [["First name", "Last name", "Email", "Phone", "Company", "Job title", "City", "Lead status", "Lifecycle stage", "Referral source", "Owner", "Created", "Last activity"],
    ...rows.map((r) => [r.firstName, r.lastName, r.email, r.phone, r.companyName, r.jobTitle, r.city, leadStatusLabel(r.leadStatus), lifecycleLabel(r.lifecycleStage), r.referralSource, r.ownerName, r.createdAt, r.lastActivityAt])]
    .map((r) => r.map(esc).join(",")).join("\n");
  await audit(db, actor, "data.exported", "export", "contacts", { rows: { from: null, to: rows.length } }, "Contacts table selection");
  return { csv, count: rows.length };
}

/** Groups of visible contacts sharing an email or phone number. */
export async function duplicateContacts(db: DB, actor: Actor) {
  const rows = await workspaceContacts(db, actor);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) for (const key of [r.email ? `email:${r.email.toLowerCase()}` : null, r.phone ? `phone:${r.phone.replace(/\D/g, "").slice(-10)}` : null]) {
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].filter(([, g]) => g.length > 1).map(([key, g]) => ({ key, ids: g.map((x) => ({ id: x.id, name: `${x.firstName} ${x.lastName}`, company: x.companyName })) }));
}

/** The contact record: properties, associations, activity, tasks and a rule-based summary. */
export async function contactRecord(db: DB, actor: Actor, id: string, now = new Date()) {
  const c = await requireContact(db, actor, id);
  const [company] = c.companyId ? await db.select({ id: companies.id, name: companies.name, city: companies.city, segment: companies.segment, lifecycle: companies.lifecycle, industry: companies.industry, region: companies.region, website: companies.website, notes: companies.notes }).from(companies).where(eq(companies.id, c.companyId)) : [];
  const colleagues = c.companyId ? await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle, email: contacts.email, phone: contacts.phone })
    .from(contacts).where(and(eq(contacts.companyId, c.companyId), isNull(contacts.deletedAt), sql`${contacts.id} <> ${id}`)).orderBy(asc(contacts.lastName)).limit(50) : [];
  const attachments = await db.select({ id: files.id, filename: files.filename, sizeBytes: files.sizeBytes, createdAt: files.createdAt, by: users.name }).from(files).leftJoin(users, eq(users.id, files.uploadedBy))
    .where(and(eq(files.entityType, "contact"), eq(files.entityId, id))).orderBy(desc(files.createdAt));
  const [owner] = c.ownerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, c.ownerId)) : [];
  const acts = await db.select({
    id: activities.id, type: activities.type, subject: activities.subject, body: activities.body, outcome: activities.outcome, occurredAt: activities.occurredAt,
    scheduledFor: activities.scheduledFor, durationMinutes: activities.durationMinutes, simulated: activities.simulated, pinnedAt: activities.pinnedAt, by: users.name, byId: activities.createdBy,
  }).from(activities).leftJoin(users, eq(users.id, activities.createdBy)).where(eq(activities.contactId, id)).orderBy(desc(activities.occurredAt)).limit(300);
  const ts = await db.select({ id: tasks.id, title: tasks.title, description: tasks.description, dueAt: tasks.dueAt, remindAt: tasks.remindAt, status: tasks.status, priority: tasks.priority, ownerId: tasks.ownerId, ownerName: users.name, createdAt: tasks.createdAt, completedAt: tasks.completedAt })
    .from(tasks).innerJoin(users, eq(users.id, tasks.ownerId)).where(and(eq(tasks.relatedType, "contact"), eq(tasks.relatedId, id))).orderBy(asc(tasks.dueAt));
  const ds = can(actor, "deals.view_all", "deals.view_own") ? await db.selectDistinct({ id: deals.id, name: deals.name, amount: deals.amount, currency: deals.currency, stage: pipelineStages.name, isWon: pipelineStages.isWon, isLost: pipelineStages.isLost, close: deals.expectedCloseDate, ownerName: users.name })
    .from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(users, eq(users.id, deals.ownerId)).leftJoin(dealContacts, eq(dealContacts.dealId, deals.id))
    .where(and(isNull(deals.deletedAt), or(eq(dealContacts.contactId, id), eq(deals.primaryContactId, id)), dealScope(actor))) : null;
  const tk = can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned", "tickets.view_escalated") ? await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status, priority: tickets.priority, createdAt: tickets.createdAt })
    .from(tickets).where(and(eq(tickets.contactId, id), isNull(tickets.deletedAt), ticketScope(db, actor))).orderBy(desc(tickets.createdAt)) : null;
  const training = await db.select({ id: trainingSessions.id, title: trainingSessions.title, startsAt: trainingSessions.startsAt, attendance: trainingParticipants.attendance, completed: trainingParticipants.completed })
    .from(trainingParticipants).innerJoin(trainingSessions, eq(trainingSessions.id, trainingParticipants.sessionId)).where(eq(trainingParticipants.contactId, id));
  const projects = c.companyId && can(actor, "onboarding.view", "handover.view") ? await db.select({ id: onboardingProjects.id, name: onboardingProjects.name, stage: onboardingProjects.stage, riskLevel: onboardingProjects.riskLevel }).from(onboardingProjects).where(eq(onboardingProjects.companyId, c.companyId)) : null;
  const history = await db.select({ at: auditLogs.createdAt, action: auditLogs.action, changes: auditLogs.changes, by: users.name, reason: auditLogs.reason })
    .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(and(eq(auditLogs.entityType, "contact"), eq(auditLogs.entityId, id))).orderBy(desc(auditLogs.createdAt)).limit(100);
  const dealEvents = ds?.length ? await db.select({ id: dealStageHistory.id, dealId: dealStageHistory.dealId, dealName: deals.name, stage: pipelineStages.name, at: dealStageHistory.changedAt, by: users.name })
    .from(dealStageHistory).innerJoin(deals, eq(deals.id, dealStageHistory.dealId)).innerJoin(pipelineStages, eq(pipelineStages.id, dealStageHistory.toStageId)).leftJoin(users, eq(users.id, dealStageHistory.changedBy))
    .where(inArray(dealStageHistory.dealId, ds.map((d) => d.id))).orderBy(desc(dealStageHistory.changedAt)).limit(100) : [];
  const done = acts.filter((a) => !a.scheduledFor || a.scheduledFor <= now);
  const lastActivityAt = done[0]?.occurredAt ?? null;
  return {
    c, company: company ?? null, owner: owner ?? null, colleagues, attachments, dealEvents, activities: acts, tasks: ts, deals: ds, tickets: tk, training, projects, history, lastActivityAt,
    summary: summarise({ c, company, acts: done, tasks: ts, deals: ds, tickets: tk, training, now }),
  };
}

type SummaryIn = {
  c: typeof contacts.$inferSelect; company?: { name: string } | undefined; acts: { type: string; occurredAt: Date; outcome: string | null }[];
  tasks: { status: string; dueAt: Date | null }[]; deals: { isWon: boolean; isLost: boolean; amount: number | null }[] | null; tickets: { status: string }[] | null;
  training: { completed: boolean }[]; now: Date;
};
/** Deterministic summary + next best action — explainable, no AI involved. */
export function summarise({ c, company, acts, tasks: ts, deals: ds, tickets: tk, training, now }: SummaryIn) {
  const DAY = 86400000;
  const recent30 = acts.filter((a) => now.getTime() - a.occurredAt.getTime() < 30 * DAY).length;
  const last = acts[0];
  const daysSince = last ? Math.floor((now.getTime() - last.occurredAt.getTime()) / DAY) : null;
  const openDeals = ds?.filter((d) => !d.isWon && !d.isLost) ?? [];
  const overdue = ts.filter((t) => t.status === "open" && t.dueAt && t.dueAt < now).length;
  const openTickets = tk?.filter((t) => (OPEN_STATUSES as string[]).includes(t.status)).length ?? 0;
  const lines: string[] = [];
  lines.push(`${c.firstName} ${c.lastName} is a ${lifecycleLabel(c.lifecycleStage)?.toLowerCase()}${company ? ` at ${company.name}` : " not yet linked to a company"}${c.referralSource ? `, sourced from ${c.referralSource}` : ""}.`);
  lines.push(last ? `Last touch was a ${last.type} ${daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`}${last.outcome ? ` (${last.outcome})` : ""}; ${recent30} activit${recent30 === 1 ? "y" : "ies"} in the last 30 days.` : "No activity has been logged yet.");
  if (openDeals.length) lines.push(`${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"} involve this contact.`);
  if (openTickets) lines.push(`${openTickets} support ticket${openTickets === 1 ? " is" : "s are"} open.`);
  if (training.length) lines.push(`Completed ${training.filter((t) => t.completed).length} of ${training.length} training session${training.length === 1 ? "" : "s"}.`);
  const missing = [!c.email && "email", !c.phone && "phone", !c.leadStatus && "lead status", !c.ownerId && "owner", !c.companyId && "company"].filter(Boolean) as string[];
  let next: string;
  if (!c.ownerId) next = "Assign an owner so someone follows up.";
  else if (overdue) next = `Clear ${overdue} overdue task${overdue === 1 ? "" : "s"}.`;
  else if (!last) next = "Make first contact — log a call or send an intro email.";
  else if (daysSince !== null && daysSince > 30) next = "Re-engage: no contact in over 30 days.";
  else if (c.leadStatus === "call_back") next = "Call back as agreed.";
  else if (!c.leadStatus) next = "Set a lead status after the next conversation.";
  else next = "Keep momentum: schedule the next step.";
  const engagement = Math.min(100, recent30 * 15 + (openDeals.length ? 20 : 0) + (daysSince !== null && daysSince < 14 ? 20 : 0));
  return { lines, next, missing, engagement, recent30, daysSince, overdue, openTickets, generatedAt: now };
}

export async function setActivityPinned(db: DB, actor: Actor, activityId: string, pinned: boolean) {
  assertCan(actor, "activities.log");
  const [a] = await db.select({ contactId: activities.contactId, companyId: activities.companyId }).from(activities).where(eq(activities.id, activityId));
  if (!a || (!a.contactId && !a.companyId)) throw notFound("Activity");
  // One pinned activity per record: the contact's if it has one, otherwise the company's.
  if (a.contactId) await requireContact(db, actor, a.contactId); else await getCompany(db, actor, a.companyId!);
  if (pinned) await db.update(activities).set({ pinnedAt: null }).where(a.contactId ? eq(activities.contactId, a.contactId) : and(eq(activities.companyId, a.companyId!), isNull(activities.contactId)));
  await db.update(activities).set({ pinnedAt: pinned ? new Date() : null }).where(eq(activities.id, activityId));
}

/** Links an existing deal to this contact (adds them to the deal's buying group). */
export async function associateDeal(db: DB, actor: Actor, contactId: string, dealId: string) {
  assertCan(actor, "deals.edit");
  await requireContact(db, actor, contactId);
  const [d] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.id, dealId), isNull(deals.deletedAt), dealScope(actor)));
  if (!d) throw notFound("Deal");
  await db.insert(dealContacts).values({ dealId, contactId }).onConflictDoNothing();
  await audit(db, actor, "deal.contact_added", "deal", dealId, { contactId: { from: null, to: contactId } });
}

export { requireContact };
