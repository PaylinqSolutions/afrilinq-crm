"use server";

import { act, type ActionResult } from "@/server/action";
import { assertCan } from "@/server/actor";
import * as ws from "@/server/services/deals-workspace";
import { moveDealStage } from "@/server/services/sales";
import { logActivity, createTask } from "@/server/services/activities";

const P = ["/deals"];

export async function previewAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => ({ data: { preview: JSON.parse(JSON.stringify(await ws.dealPreview(db, actor, id))) } }));
}
export async function patchDealAction(id: string, patch: ws.DealPatch, version: string): Promise<ActionResult> {
  return act(async (actor, db) => ({ message: "Saved.", data: { version: await ws.patchDeal(db, actor, id, patch, version) } }), P);
}
export async function moveOneAction(id: string, stageId: string, version: string | null, lossReason: string | null): Promise<ActionResult> {
  return act(async (actor, db) => {
    const r = await moveDealStage(db, actor, id, stageId, { lossReason, expected: version });
    if (r.handoverCreated) {
      const { handoverRecords } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const [h] = await db.select({ id: handoverRecords.id }).from(handoverRecords).where(eq(handoverRecords.dealId, id));
      return { message: "Closed Won. Next step: complete and submit the handover so Onboarding can start.", data: { handoverId: h?.id } };
    }
    return r.unchanged ? "Already in that stage." : "Deal moved.";
  }, P);
}
export async function bulkAssignAction(ids: string[], ownerId: string): Promise<ActionResult> {
  return act(async (actor, db) => { const r = await ws.assignDeals(db, actor, ids, ownerId); return `${r.assigned} deal(s) assigned to ${r.to}.`; }, P);
}
export async function bulkMoveAction(ids: string[], stageId: string, lossReason: string | null): Promise<ActionResult> {
  return act(async (actor, db) => {
    const r = await ws.moveDeals(db, actor, ids, stageId, lossReason);
    const ok = r.filter((x) => x.ok).length;
    const failed = r.filter((x) => !x.ok);
    return { ok: failed.length === 0, message: `${ok} moved${failed.length ? `, ${failed.length} not moved` : ""}.`, data: { results: r }, fieldErrors: failed.length ? Object.fromEntries(failed.map((f) => [f.id, `${f.name}: ${f.message}`])) : undefined };
  }, P);
}
export async function bulkDeleteAction(ids: string[], reason: string): Promise<ActionResult> {
  return act(async (actor, db) => `${await ws.deleteDeals(db, actor, ids, reason)} deal(s) deleted (soft delete, audit-logged).`, P);
}
export async function restoreAction(ids: string[]): Promise<ActionResult> {
  return act(async (actor, db) => `${await ws.restoreDeals(db, actor, ids)} deal(s) restored.`, P);
}
export async function createInStageAction(input: Record<string, string>, stageId: string | null): Promise<ActionResult> {
  return act(async (actor, db) => {
    const r = await ws.createDealInStage(db, actor, input, stageId);
    return { message: r.warning ?? "Deal created.", data: { id: r.id, warning: r.warning } };
  }, P);
}
export async function exportAction(ids: string[]): Promise<ActionResult> {
  return act(async (actor, db) => { const r = await ws.exportDealsCsv(db, actor, ids); return { message: `Exported ${r.count} deal(s).`, data: { csv: r.csv } }; });
}

type LogInput = { dealId: string; type: string; subject: string; body?: string; outcome?: string; contactId?: string; at?: string; scheduledFor?: string; durationMinutes?: number; followUpTitle?: string; followUpDue?: string; send?: boolean; confirmSimulated?: boolean };
export async function logAction(v: LogInput): Promise<ActionResult> {
  return act(async (actor, db) => {
    await logActivity(db, actor, {
      type: v.type, subject: v.subject, body: v.body || null, outcome: v.outcome || null, dealId: v.dealId, contactId: v.contactId || null,
      occurredAt: v.at || null, scheduledFor: v.scheduledFor || null, durationMinutes: v.durationMinutes ?? null,
      followUpTitle: v.followUpTitle || null, followUpDue: v.followUpDue || null,
    }, { send: v.send, confirmSimulated: v.confirmSimulated });
    const label = { note: "Note", email: "Email", call: "Call", meeting: "Meeting", whatsapp: "WhatsApp" }[v.type] ?? "Activity";
    return v.send ? `${label} recorded as SIMULATED (no provider configured) — nothing was delivered.` : v.scheduledFor ? `${label} scheduled.` : `${label} logged.`;
  }, P);
}
export async function taskAction(v: { dealId: string; companyId: string; title: string; dueAt: string; priority: string; ownerId: string; description: string; type: string }): Promise<ActionResult> {
  return act(async (actor, db) => {
    assertCan(actor, "activities.log");
    await createTask(db, actor, { title: v.title, taskType: v.type, dueAt: v.dueAt || null, priority: v.priority, ownerId: v.ownerId || null, description: v.description || null, relatedType: "deal", relatedId: v.dealId, companyId: v.companyId });
    return "Task created.";
  }, P);
}

/** The current user's scheduled meetings and training sessions in a date window (for the meeting planner). */
export async function myScheduleAction(fromIso: string, toIso: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { and, eq, gte, lt } = await import("drizzle-orm");
    const { activities, trainingSessions } = await import("@/db/schema");
    const from = new Date(fromIso), to = new Date(toIso);
    const meetings = await db.select({ subject: activities.subject, at: activities.scheduledFor, mins: activities.durationMinutes }).from(activities)
      .where(and(eq(activities.createdBy, actor.id), gte(activities.scheduledFor, from), lt(activities.scheduledFor, to)));
    const sessions = await db.select({ subject: trainingSessions.title, at: trainingSessions.startsAt, mins: trainingSessions.durationMinutes }).from(trainingSessions)
      .where(and(eq(trainingSessions.facilitatorId, actor.id), gte(trainingSessions.startsAt, from), lt(trainingSessions.startsAt, to)));
    return { data: { events: [...meetings, ...sessions].map((e) => ({ subject: e.subject, at: e.at!.toISOString(), mins: e.mins ?? 60 })) } };
  });
}

// ---------------------------------------------------------------- Saved board views (per user)
export async function saveDealViewAction(name: string, state: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { invalid } = await import("@/server/errors");
    if (!name.trim()) throw invalid("Name the view.", { name: "Required." });
    if (state.length > 4000) throw invalid("This view is too large to save.");
    const [v] = await db.insert(savedViews).values({ userId: actor.id, entity: "deals-board", name: name.trim().slice(0, 40), query: state }).returning();
    return { message: `View “${v.name}” saved.`, data: { id: v.id } };
  }, P);
}
export async function deleteDealViewAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, actor.id)));
    return "View deleted.";
  }, P);
}
