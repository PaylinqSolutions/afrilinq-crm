"use server";

import { act, type ActionResult } from "@/server/action";
import { assertCan } from "@/server/actor";
import * as ws from "@/server/services/contacts-workspace";
import { createTask, completeTask, logActivity } from "@/server/services/activities";
import { createContact } from "@/server/services/accounts";

const P = ["/contacts"];

export async function patchContactAction(id: string, patch: ws.ContactPatch, version: string | null): Promise<ActionResult> {
  return act(async (actor, db) => {
    const row = await ws.patchContact(db, actor, id, patch, version);
    const keys = Object.keys(patch);
    return { message: keys.length === 1 ? `${LABELS[keys[0]] ?? "Contact"} updated.` : "Contact updated.", data: { updatedAt: row.updatedAt.toISOString(), row: { phone: row.phone, whatsapp: row.whatsapp, email: row.email } } };
  }, P);
}
const LABELS: Record<string, string> = { phone: "Phone number", email: "Email", leadStatus: "Lead status", referralSource: "Referral source", ownerId: "Contact owner", lifecycleStage: "Lifecycle stage", companyId: "Company", city: "City", jobTitle: "Job title", firstName: "Name", lastName: "Name", whatsapp: "WhatsApp", preferredChannel: "Preferred channel", marketingConsent: "Marketing consent", contactRoles: "Buying role" };

export async function quickCreateContactAction(input: Record<string, string | boolean>): Promise<ActionResult> {
  return act(async (actor, db) => {
    const c = await createContact(db, actor, { ...input, contactRoles: [], marketingConsent: input.marketingConsent === true });
    return { message: `${c.firstName} ${c.lastName} added.`, data: { id: c.id } };
  }, P);
}
export async function bulkContactsAction(ids: string[], patch: { ownerId?: string | null; leadStatus?: string | null; lifecycleStage?: string }): Promise<ActionResult> {
  return act(async (actor, db) => { const n = await ws.bulkUpdateContacts(db, actor, ids, patch); return `Updated ${n} contact${n === 1 ? "" : "s"}.`; }, P);
}
export async function deleteContactsAction(ids: string[], reason: string): Promise<ActionResult> {
  return act(async (actor, db) => { const n = await ws.deleteContacts(db, actor, ids, reason); return `Deleted ${n} contact${n === 1 ? "" : "s"}. You can undo this now.`; }, P);
}
export async function restoreContactsAction(ids: string[]): Promise<ActionResult> {
  return act(async (actor, db) => { const n = await ws.restoreContacts(db, actor, ids); return `Restored ${n} contact${n === 1 ? "" : "s"}.`; }, P);
}
export async function exportContactsAction(ids: string[]): Promise<ActionResult> {
  return act(async (actor, db) => { const r = await ws.exportContactsCsv(db, actor, ids); return { message: `Exported ${r.count} contact${r.count === 1 ? "" : "s"}.`, data: { csv: r.csv } }; });
}
export async function duplicatesAction(): Promise<ActionResult> {
  return act(async (actor, db) => ({ data: { groups: await ws.duplicateContacts(db, actor) } }));
}

type LogInput = { contactId: string; type: string; subject: string; body?: string; outcome?: string; at?: string; scheduledFor?: string; durationMinutes?: number; followUpTitle?: string; followUpDue?: string };
const TYPE_LABEL: Record<string, string> = { note: "Note", email: "Email", call: "Call", meeting: "Meeting", whatsapp: "WhatsApp message", sms: "SMS", linkedin: "LinkedIn message", postal: "Postal mail" };
export async function logContactActivityAction(v: LogInput): Promise<ActionResult> {
  return act(async (actor, db) => {
    await logActivity(db, actor, {
      type: v.type, subject: v.subject, body: v.body || null, outcome: v.outcome || null, contactId: v.contactId, occurredAt: v.at || null,
      scheduledFor: v.scheduledFor || null, durationMinutes: v.durationMinutes ?? null, followUpTitle: v.followUpTitle || null, followUpDue: v.followUpDue || null,
    });
    const label = TYPE_LABEL[v.type] ?? "Activity";
    return `${label} ${v.scheduledFor ? "scheduled" : v.type === "note" ? "created" : "logged"}${v.followUpTitle ? " with a follow-up task" : ""}.`;
  }, P);
}
export async function contactTaskAction(v: { contactId: string; title: string; type: string; dueAt: string; remindAt: string; priority: string; ownerId: string; description: string }): Promise<ActionResult> {
  return act(async (actor, db) => {
    assertCan(actor, "activities.log");
    const c = await ws.requireContact(db, actor, v.contactId);
    await createTask(db, actor, { title: v.title, taskType: v.type, dueAt: v.dueAt || null, remindAt: v.remindAt || null, priority: v.priority, ownerId: v.ownerId || null, description: v.description || null, relatedType: "contact", relatedId: v.contactId, companyId: c.companyId });
    return "Task created. It's also on the Tasks page.";
  }, P);
}
export async function completeContactTaskAction(id: string, cancel = false): Promise<ActionResult> {
  return act(async (actor, db) => { await completeTask(db, actor, id, null, cancel); return cancel ? "Task cancelled." : "Task completed."; }, P);
}
export async function pinActivityAction(id: string, pinned: boolean): Promise<ActionResult> {
  return act(async (actor, db) => { await ws.setActivityPinned(db, actor, id, pinned); return pinned ? "Pinned to the top of the record." : "Unpinned."; }, P);
}
export async function associateDealAction(contactId: string, dealId: string): Promise<ActionResult> {
  return act(async (actor, db) => { await ws.associateDeal(db, actor, contactId, dealId); return "Deal associated."; }, P);
}

// Saved table views (per user)
export async function saveContactViewAction(name: string, state: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { invalid } = await import("@/server/errors");
    if (!name.trim()) throw invalid("Name the view.", { name: "Required." });
    if (state.length > 4000) throw invalid("This view is too large to save.");
    const [v] = await db.insert(savedViews).values({ userId: actor.id, entity: "contacts-table", name: name.trim().slice(0, 40), query: state }).returning();
    return { message: `View “${v.name}” saved.`, data: { id: v.id } };
  }, P);
}
export async function deleteContactViewAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, actor.id)));
    return "View deleted.";
  }, P);
}

export async function contactPreviewAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const r = await ws.contactRecord(db, actor, id);
    return { data: {
      activities: r.activities.slice(0, 6).map((a) => ({ id: a.id, type: a.type, subject: a.subject, occurredAt: a.occurredAt.toISOString(), scheduledFor: a.scheduledFor?.toISOString() ?? null, by: a.by })),
      tasks: r.tasks.filter((t) => t.status === "open").map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt?.toISOString() ?? null, ownerName: t.ownerName })),
      deals: r.deals?.map((d) => ({ id: d.id, name: d.name, stage: d.stage, amount: d.amount, currency: d.currency })) ?? null,
      summary: { lines: r.summary.lines, next: r.summary.next, missing: r.summary.missing },
    } };
  });
}

export async function uploadContactFileAction(contactId: string, fd: FormData): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { uploadContactFile } = await import("@/server/services/files");
    const f = await uploadContactFile(db, actor, contactId, fd.get("file") as File);
    return `${f.filename} attached.`;
  }, P);
}
