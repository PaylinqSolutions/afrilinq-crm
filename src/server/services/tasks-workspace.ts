import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { activities, companies, contacts, deals, leads, onboardingProjects, tasks, tickets, users } from "@/db/schema";
import { fromLocalInput } from "@/lib/format";
import { type Actor, assertCan, can } from "../actor";
import { audit, diff } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export const TASK_STAGES = [
  { key: "not_started", label: "Not started" }, { key: "in_progress", label: "In progress" }, { key: "waiting", label: "Waiting" },
  { key: "completed", label: "Completed" }, { key: "deferred", label: "Deferred" },
] as const;
export const TASK_TYPES = [{ key: "todo", label: "To-do" }, { key: "call", label: "Call" }, { key: "email", label: "Email" }, { key: "meeting", label: "Meeting" }, { key: "whatsapp", label: "WhatsApp" }] as const;
export const DEFAULT_QUEUES = ["Sales follow-ups", "Onboarding", "Support callbacks", "Renewals", "Training"];
const statusFor = (stage: string) => (stage === "completed" ? "done" : stage === "deferred" ? "cancelled" : "open");

/** Who may see a task: managers with tasks.view_all see everything; others see tasks assigned to them or created by them. */
function taskScope(a: Actor): SQL | undefined {
  if (can(a, "tasks.view_all")) return undefined;
  return or(eq(tasks.ownerId, a.id), eq(tasks.createdBy, a.id));
}

/** Open tasks plus anything closed in the last 60 days, with the contact/company/record each task is about. */
export async function workspaceTasks(db: DB, actor: Actor, now = new Date()) {
  const creator = sql<string | null>`(select name from users u where u.id = ${tasks.createdBy})`;
  const rows = await db.select({
    id: tasks.id, title: tasks.title, description: tasks.description, dueAt: tasks.dueAt, remindAt: tasks.remindAt, priority: tasks.priority, status: tasks.status,
    stage: tasks.stage, taskType: tasks.taskType, queue: tasks.queue, outcome: tasks.outcome, ownerId: tasks.ownerId, ownerName: users.name, createdBy: tasks.createdBy, createdByName: creator,
    relatedType: tasks.relatedType, relatedId: tasks.relatedId, companyId: tasks.companyId, companyName: companies.name, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt, completedAt: tasks.completedAt,
  }).from(tasks).innerJoin(users, eq(users.id, tasks.ownerId)).leftJoin(companies, eq(companies.id, tasks.companyId))
    .where(and(taskScope(actor), or(eq(tasks.status, "open"), gte(tasks.updatedAt, new Date(now.getTime() - 60 * 86400000))))).orderBy(tasks.dueAt).limit(5000);

  // Resolve the record each task is about, in one query per type.
  const ids = (type: string) => [...new Set(rows.filter((r) => r.relatedType === type && r.relatedId).map((r) => r.relatedId!))];
  const contactIds = ids("contact");
  const cs = contactIds.length ? await db.select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, companyId: contacts.companyId }).from(contacts).where(inArray(contacts.id, contactIds)) : [];
  const ds = ids("deal").length ? await db.select({ id: deals.id, name: deals.name }).from(deals).where(inArray(deals.id, ids("deal"))) : [];
  const ls = ids("lead").length ? await db.select({ id: leads.id, name: leads.name }).from(leads).where(inArray(leads.id, ids("lead"))) : [];
  const ts = ids("ticket").length ? await db.select({ id: tickets.id, name: sql<string>`'#' || ${tickets.number} || ' ' || ${tickets.subject}` }).from(tickets).where(inArray(tickets.id, ids("ticket"))) : [];
  const os = ids("onboarding").length ? await db.select({ id: onboardingProjects.id, name: onboardingProjects.name }).from(onboardingProjects).where(inArray(onboardingProjects.id, ids("onboarding"))) : [];
  const names = new Map<string, string>([...ds, ...ls, ...ts, ...os].map((x) => [x.id, x.name]));
  // "Last contacted": the latest completed activity with the task's contact, otherwise its company.
  const lastC = contactIds.length ? await db.select({ id: activities.contactId, at: sql<string>`max(${activities.occurredAt})` }).from(activities).where(and(inArray(activities.contactId, contactIds), isNull(activities.scheduledFor))).groupBy(activities.contactId) : [];
  const coIds = [...new Set(rows.map((r) => r.companyId).filter(Boolean))] as string[];
  const lastCo = coIds.length ? await db.select({ id: activities.companyId, at: sql<string>`max(${activities.occurredAt})` }).from(activities).where(and(inArray(activities.companyId, coIds), isNull(activities.scheduledFor))).groupBy(activities.companyId) : [];
  return rows.map((r) => {
    const c = r.relatedType === "contact" ? cs.find((x) => x.id === r.relatedId) : undefined;
    const lc = (c && lastC.find((x) => x.id === c.id)?.at) || (r.companyId && lastCo.find((x) => x.id === r.companyId)?.at) || null;
    return {
      ...r, contactId: c?.id ?? null, contactName: c ? `${c.first} ${c.last}` : null,
      relatedName: r.relatedType === "contact" ? (c ? `${c.first} ${c.last}` : null) : r.relatedType === "company" ? r.companyName : r.relatedId ? names.get(r.relatedId) ?? null : null,
      lastContactedAt: lc ? new Date(lc) : null,
    };
  });
}

async function requireTask(db: DB, actor: Actor, id: string) {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!t) throw notFound("Task");
  if (t.ownerId !== actor.id && t.createdBy !== actor.id && !can(actor, "tasks.view_all")) throw notFound("Task");
  return t;
}

const patchSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(300), description: z.string().trim().max(5000).nullable(),
  dueAt: z.string().nullable(), remindAt: z.string().nullable(), priority: z.enum(["low", "normal", "high", "urgent"]),
  stage: z.enum(["not_started", "in_progress", "waiting", "completed", "deferred"]), taskType: z.enum(["todo", "call", "email", "meeting", "whatsapp"]),
  queue: z.string().trim().max(60).nullable(), ownerId: z.string().uuid(), outcome: z.string().trim().max(500).nullable(),
}).partial();
export type TaskPatch = z.input<typeof patchSchema>;

/** Edit a task from the Tasks page or a record page; stage drives open/closed so both places always agree. */
export async function patchTask(db: DB, actor: Actor, id: string, patch: TaskPatch, expected: Version) {
  const before = await requireTask(db, actor, id);
  await assertFresh(db, actor, "task", id, before.updatedAt, expected, "task");
  const r = patchSchema.safeParse(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "string" && v.trim() === "" && k !== "title" ? null : v])));
  if (!r.success) throw invalid(r.error.issues[0].message, Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
  const v = r.data;
  if (v.ownerId && v.ownerId !== before.ownerId && v.ownerId !== actor.id && !can(actor, "tasks.view_all", "leads.assign", "tickets.reassign")) throw forbidden("You can only assign tasks to yourself.");
  const toDate = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : fromLocalInput(s));
  const due = toDate(v.dueAt), remind = toDate(v.remindAt);
  if (due && Number.isNaN(due.getTime())) throw invalid("Invalid due date.", { dueAt: "Invalid date." });
  const set: Partial<typeof tasks.$inferInsert> = { ...v, dueAt: due, remindAt: remind, updatedAt: new Date() };
  if (v.stage) { set.status = statusFor(v.stage); set.completedAt = v.stage === "completed" ? before.completedAt ?? new Date() : null; }
  const rows = await db.update(tasks).set(set).where(and(eq(tasks.id, id), sameVersion(tasks.updatedAt, before.updatedAt))).returning();
  assertUpdated(rows, "task");
  await audit(db, actor, "task.updated", "task", id, diff(before as Record<string, unknown>, set as Record<string, unknown>, ["title", "dueAt", "priority", "stage", "taskType", "queue", "ownerId"]));
  if (v.ownerId && v.ownerId !== before.ownerId && v.ownerId !== actor.id) await notifyUsers(db, [v.ownerId], { kind: "task.assigned", title: `${actor.name} assigned you a task: ${rows[0].title}`, link: `/tasks?task=${id}`, dedupeKey: `task-assigned:${id}:${v.ownerId}` });
  if (v.stage === "completed" && before.createdBy && before.createdBy !== actor.id && before.status !== "done") await notifyUsers(db, [before.createdBy], { kind: "task.completed", title: `${actor.name} completed: ${rows[0].title}`, link: `/tasks?task=${id}`, dedupeKey: `task-done:${id}` });
  return rows[0];
}

export async function bulkTasks(db: DB, actor: Actor, ids: string[], patch: { stage?: string; ownerId?: string; dueAt?: string; priority?: string; queue?: string | null }) {
  if (!ids.length) throw invalid("Select at least one task.");
  let n = 0;
  for (const id of ids) {
    const t = await requireTask(db, actor, id);
    await patchTask(db, actor, id, patch as TaskPatch, t.updatedAt.toISOString());
    n++;
  }
  return n;
}

export async function exportTasksCsv(db: DB, actor: Actor, ids: string[]) {
  assertCan(actor, "data.export");
  const rows = (await workspaceTasks(db, actor)).filter((r) => ids.includes(r.id));
  if (!rows.length) throw invalid("Nothing to export.");
  const esc = (v: unknown) => { let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [["Title", "Stage", "Type", "Priority", "Due", "Assigned to", "Contact", "Company", "Related", "Queue", "Created by", "Completed"],
    ...rows.map((r) => [r.title, r.stage, r.taskType, r.priority, r.dueAt, r.ownerName, r.contactName, r.companyName, r.relatedName, r.queue, r.createdByName, r.completedAt])].map((r) => r.map(esc).join(",")).join("\n");
  await audit(db, actor, "data.exported", "export", "tasks", { rows: { from: null, to: rows.length } }, "Tasks table selection");
  return { csv, count: rows.length };
}

export async function taskQueues(db: DB) {
  const used = await db.selectDistinct({ q: tasks.queue }).from(tasks).where(sql`${tasks.queue} is not null`);
  return [...new Set([...DEFAULT_QUEUES, ...used.map((u) => u.q!)])].sort();
}

export { desc };
