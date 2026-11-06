import { and, asc, desc, eq, gte, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import { activities, tasks, deals, leads, contacts, users, companies } from "@/db/schema";
import { activitySchema, taskSchema } from "@/lib/schemas";
import { type Actor, assertCan, can } from "../actor";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { parse } from "../validate";
import { notifyUsers } from "../notify";
import { getDeal, getLead } from "./sales";
import { getContact, getCompany } from "./accounts";
import { emit } from "./workflows";
import { sendViaAdapter } from "./integrations";
import { todayIn } from "@/lib/format";
import { zonedToUtc } from "@/lib/rules/sla";

/**
 * Logs an interaction and links it to company/contact/deal/lead so it appears on every relevant timeline.
 * Access to each linked record is checked with the actor's own scope.
 */
export async function logActivity(db: DB, actor: Actor, input: unknown, opts: { send?: boolean; confirmSimulated?: boolean } = {}) {
  assertCan(actor, "activities.log");
  const v = parse(activitySchema, input);
  let companyId = v.companyId;
  if (v.dealId) companyId = (await getDeal(db, actor, v.dealId)).companyId;
  if (v.contactId) { const { c } = await getContact(db, actor, v.contactId); companyId ??= c.companyId; }
  if (v.leadId) { const l = await getLead(db, actor, v.leadId); companyId ??= l.convertedCompanyId; }
  if (companyId && !v.dealId && !v.contactId) await getCompany(db, actor, companyId);
  if (!companyId && !v.contactId && !v.leadId && !v.ticketId && !v.onboardingProjectId) throw invalid("Link the activity to a lead, contact, company or deal.", { companyId: "Required." });

  let simulated = false;
  if (opts.send) {
    if (!["email", "whatsapp"].includes(v.type)) throw invalid("Only email and WhatsApp can be sent.");
    const recipient = v.contactId ? (await db.select().from(contacts).where(eq(contacts.id, v.contactId)))[0] : null;
    const to = v.type === "email" ? recipient?.email : recipient?.whatsapp ?? recipient?.phone;
    if (!to) throw invalid(`The contact has no ${v.type === "email" ? "email address" : "WhatsApp number"}.`, { contactId: "Missing recipient details." });
    const r = await sendViaAdapter(db, actor, { channel: v.type, to, subject: v.subject, body: v.body ?? "", relatedType: "activity", confirmSimulated: !!opts.confirmSimulated });
    simulated = r.status === "simulated";
  }

  const at = v.occurredAt ?? new Date();
  const [a] = await db.insert(activities).values({
    type: v.type, subject: v.subject, body: v.body, outcome: v.outcome, occurredAt: at, scheduledFor: v.scheduledFor,
    durationMinutes: v.durationMinutes, companyId, contactId: v.contactId, dealId: v.dealId, leadId: v.leadId,
    ticketId: v.ticketId, onboardingProjectId: v.onboardingProjectId, simulated, createdBy: actor.id,
  }).returning();
  if (v.dealId) await db.update(deals).set({ lastActivityAt: new Date() }).where(eq(deals.id, v.dealId));
  if (v.leadId) {
    await db.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, v.leadId));
    const l = await getLead(db, actor, v.leadId);
    if (l.status === "New" && ["call", "email", "whatsapp", "meeting"].includes(v.type))
      await db.update(leads).set({ status: v.type === "meeting" ? "Contacted" : "Attempting Contact" }).where(eq(leads.id, v.leadId));
  }
  if (v.followUpTitle) {
    const fuType = /^Call: /.test(v.followUpTitle) ? "call" : /^Email: /.test(v.followUpTitle) ? "email" : "todo";
    await db.insert(tasks).values({
      title: fuType === "todo" ? v.followUpTitle : v.followUpTitle.replace(/^(Call|Email): /, ""), taskType: fuType, ownerId: actor.id, dueAt: v.followUpDue ?? new Date(Date.now() + 2 * 86400000),
      relatedType: v.dealId ? "deal" : v.leadId ? "lead" : v.contactId ? "contact" : "company", relatedId: v.dealId ?? v.leadId ?? v.contactId ?? companyId, companyId, createdBy: actor.id,
    });
  }
  // A logged call moves an untouched contact's lead status forward, so the list reflects reality without extra clicks.
  if (v.contactId && v.type === "call" && v.outcome && !v.scheduledFor) {
    const reached = ["Connected", "Meeting booked", "Left live message"].includes(v.outcome);
    const [cur] = await db.select({ s: contacts.leadStatus }).from(contacts).where(eq(contacts.id, v.contactId));
    if (!cur?.s || ["new", "open", "attempted", "not_connected"].includes(cur.s)) await db.update(contacts).set({ leadStatus: reached ? "connected" : "attempted" }).where(eq(contacts.id, v.contactId));
  }
  const owner = v.dealId ? (await getDeal(db, actor, v.dealId)).ownerId : actor.id;
  await emit(db, "activity.logged", {
    entityId: a.id, type: a.type, ownerId: owner, relatedType: v.dealId ? "deal" : v.leadId ? "lead" : "company",
    relatedId: v.dealId ?? v.leadId ?? companyId ?? undefined, companyId, subject: a.subject, link: v.dealId ? `/deals/${v.dealId}` : v.contactId ? `/contacts/${v.contactId}` : companyId ? `/companies/${companyId}` : undefined,
  });
  return a;
}

export async function activitiesFor(db: DB, where: SQL) {
  return db.select({
    id: activities.id, type: activities.type, subject: activities.subject, body: activities.body, outcome: activities.outcome,
    occurredAt: activities.occurredAt, scheduledFor: activities.scheduledFor, simulated: activities.simulated, by: users.name,
  }).from(activities).leftJoin(users, eq(users.id, activities.createdBy)).where(where).orderBy(desc(activities.occurredAt)).limit(200);
}

// ---------------------------------------------------------------------------- Tasks

export type TaskFilters = { scope?: string; status?: string; due?: string; owner?: string };

export async function listTasks(db: DB, actor: Actor, f: TaskFilters, tz: string, now = new Date()) {
  const conds: (SQL | undefined)[] = [];
  const viewAll = can(actor, "tasks.view_all") && f.scope === "all";
  if (!viewAll) conds.push(eq(tasks.ownerId, actor.id));
  else if (f.owner) conds.push(eq(tasks.ownerId, f.owner));
  conds.push(eq(tasks.status, f.status ?? "open"));
  const [y, m, d] = todayIn(tz, now).split("-").map(Number);
  const endOfToday = zonedToUtc(y, m, d, 23, 59, tz);
  if (f.due === "overdue") conds.push(lt(tasks.dueAt, now));
  if (f.due === "today") conds.push(and(gte(tasks.dueAt, now), lte(tasks.dueAt, endOfToday)));
  if (f.due === "week") conds.push(lte(tasks.dueAt, new Date(now.getTime() + 7 * 86400000)));
  return db.select({
    id: tasks.id, title: tasks.title, description: tasks.description, dueAt: tasks.dueAt, priority: tasks.priority, status: tasks.status,
    outcome: tasks.outcome, relatedType: tasks.relatedType, relatedId: tasks.relatedId, companyId: tasks.companyId, companyName: companies.name,
    ownerId: tasks.ownerId, ownerName: users.name, completedAt: tasks.completedAt,
  }).from(tasks).innerJoin(users, eq(users.id, tasks.ownerId)).leftJoin(companies, eq(companies.id, tasks.companyId))
    .where(and(...conds)).orderBy(asc(tasks.dueAt)).limit(300);
}

export async function createTask(db: DB, actor: Actor, input: unknown) {
  const v = parse(taskSchema, input);
  const ownerId = v.ownerId && v.ownerId !== actor.id ? (can(actor, "tasks.view_all", "leads.assign", "tickets.reassign") ? v.ownerId : null) : actor.id;
  if (!ownerId) throw forbidden("You can only assign tasks to yourself.");
  const done = v.stage === "completed";
  const [t] = await db.insert(tasks).values({ ...v, ownerId, createdBy: actor.id, status: done ? "done" : "open", completedAt: done ? new Date() : null }).returning();
  if (ownerId !== actor.id) await notifyUsers(db, [ownerId], { kind: "task.assigned", title: `${actor.name} assigned you a task: ${t.title}`, body: t.dueAt ? `Due ${t.dueAt.toISOString().slice(0, 10)}` : undefined, link: `/tasks?task=${t.id}`, dedupeKey: `task-assigned:${t.id}` });
  return t;
}

export async function completeTask(db: DB, actor: Actor, id: string, outcome: string | null, cancel = false) {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!t) throw notFound("Task");
  if (t.ownerId !== actor.id && !can(actor, "tasks.view_all")) throw forbidden("Only the task owner can complete this task.");
  await db.update(tasks).set({ status: cancel ? "cancelled" : "done", stage: cancel ? "deferred" : "completed", outcome, completedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, id));
  await audit(db, actor, cancel ? "task.cancelled" : "task.completed", "task", id, null, outcome);
  if (!cancel && t.createdBy && t.createdBy !== actor.id && t.status === "open") await notifyUsers(db, [t.createdBy], { kind: "task.completed", title: `${actor.name} completed: ${t.title}`, link: `/tasks?task=${id}`, dedupeKey: `task-done:${id}` });
}

export async function tasksForRecord(db: DB, relatedType: string, relatedId: string) {
  return db.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, status: tasks.status, priority: tasks.priority, ownerName: users.name, outcome: tasks.outcome })
    .from(tasks).innerJoin(users, eq(users.id, tasks.ownerId))
    .where(and(eq(tasks.relatedType, relatedType), eq(tasks.relatedId, relatedId))).orderBy(sql`${tasks.status} = 'open' desc`, asc(tasks.dueAt));
}

export function overdueOrDue(now: Date) {
  return or(lt(tasks.dueAt, now));
}
