"use server";

import { act, type ActionResult } from "@/server/action";
import { assertCan } from "@/server/actor";
import * as ws from "@/server/services/tasks-workspace";
import { createTask } from "@/server/services/activities";
import { getContact, getCompany } from "@/server/services/accounts";
import { getDeal } from "@/server/services/sales";

const P = ["/tasks", "/contacts", "/companies", "/"];

export async function patchTaskAction(id: string, patch: ws.TaskPatch, version: string | null): Promise<ActionResult> {
  return act(async (actor, db) => {
    const t = await ws.patchTask(db, actor, id, patch, version);
    const msg = patch.stage === "completed" ? "Task completed." : patch.stage === "deferred" ? "Task deferred." : patch.ownerId ? "Task reassigned — they've been notified." : "Task updated.";
    return { message: msg, data: { updatedAt: t.updatedAt.toISOString() } };
  }, P);
}
export async function bulkTasksAction(ids: string[], patch: { stage?: string; ownerId?: string; dueAt?: string; priority?: string; queue?: string | null }): Promise<ActionResult> {
  return act(async (actor, db) => { const n = await ws.bulkTasks(db, actor, ids, patch); return `Updated ${n} task${n === 1 ? "" : "s"}.`; }, P);
}
export async function exportTasksAction(ids: string[]): Promise<ActionResult> {
  return act(async (actor, db) => { const r = await ws.exportTasksCsv(db, actor, ids); return { message: `Exported ${r.count} task${r.count === 1 ? "" : "s"}.`, data: { csv: r.csv } }; });
}
/** Create a task from the Tasks page, optionally tied to a contact, company or deal so it shows on that record too. */
export async function newTaskAction(v: { title: string; taskType: string; dueAt: string; remindAt: string; priority: string; ownerId: string; description: string; queue: string; link: string }): Promise<ActionResult> {
  return act(async (actor, db) => {
    assertCan(actor, "activities.log");
    const [kind, id] = v.link ? v.link.split(":") : [null, null];
    let relatedType: string | null = null, relatedId: string | null = null, companyId: string | null = null;
    if (kind === "contact" && id) { const { c } = await getContact(db, actor, id); relatedType = "contact"; relatedId = id; companyId = c.companyId; }
    if (kind === "company" && id) { await getCompany(db, actor, id); relatedType = "company"; relatedId = id; companyId = id; }
    if (kind === "deal" && id) { const d = await getDeal(db, actor, id); relatedType = "deal"; relatedId = id; companyId = d.companyId; }
    const t = await createTask(db, actor, { title: v.title, taskType: v.taskType, dueAt: v.dueAt || null, remindAt: v.remindAt || null, priority: v.priority, ownerId: v.ownerId || null, description: v.description || null, queue: v.queue || null, relatedType, relatedId, companyId });
    return { message: relatedType ? `Task created and added to the ${relatedType}'s record.` : "Task created.", data: { id: t.id } };
  }, P);
}
export async function saveTaskViewAction(name: string, state: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { invalid } = await import("@/server/errors");
    if (!name.trim()) throw invalid("Name the view.", { name: "Required." });
    const [v] = await db.insert(savedViews).values({ userId: actor.id, entity: "tasks-table", name: name.trim().slice(0, 40), query: state.slice(0, 4000) }).returning();
    return { message: `View “${v.name}” saved.`, data: { id: v.id } };
  }, P);
}
export async function deleteTaskViewAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, actor.id)));
    return "View deleted.";
  }, P);
}
