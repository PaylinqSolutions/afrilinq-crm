"use server";

import { act, type ActionResult } from "@/server/action";
import { assertCan } from "@/server/actor";
import * as ws from "@/server/services/companies-workspace";
import { createCompany } from "@/server/services/accounts";
import { createTask, logActivity } from "@/server/services/activities";

const P = ["/companies"];
const LABELS: Record<string, string> = { name: "Name", phone: "Phone number", website: "Company domain", industry: "Industry", ownerId: "Company owner", csmId: "Customer success owner", lifecycle: "Lifecycle stage", leadStatus: "Lead status", segment: "Type / segment", tier: "Tier", city: "City", region: "State/Region", postalCode: "Postal code", employees: "Number of employees", annualRevenue: "Annual revenue", timeZone: "Time zone", notes: "Description", linkedinUrl: "LinkedIn company page", address: "Address" };

export async function patchCompanyAction(id: string, patch: ws.CompanyPatch, version: string | null): Promise<ActionResult> {
  return act(async (actor, db) => {
    const row = await ws.patchCompany(db, actor, id, patch, version);
    const keys = Object.keys(patch);
    return { message: keys.length === 1 ? `${LABELS[keys[0]] ?? "Company"} updated.` : "Company updated.", data: { updatedAt: row.updatedAt.toISOString(), row: { phone: row.phone, website: row.website } } };
  }, P);
}
export async function quickCreateCompanyAction(input: Record<string, string>): Promise<ActionResult> {
  return act(async (actor, db) => {
    const c = await createCompany(db, actor, { segment: "SME", tier: "Standard", lifecycle: "prospect", ...input });
    return { message: `${c.name} added.`, data: { id: c.id } };
  }, P);
}
export async function bulkCompaniesAction(ids: string[], patch: { ownerId?: string | null; leadStatus?: string | null; lifecycle?: string }): Promise<ActionResult> {
  return act(async (actor, db) => { const n = await ws.bulkUpdateCompanies(db, actor, ids, patch); return `Updated ${n} compan${n === 1 ? "y" : "ies"}.`; }, P);
}
export async function deleteCompaniesAction(ids: string[], reason: string): Promise<ActionResult> {
  return act(async (actor, db) => { const n = await ws.deleteCompanies(db, actor, ids, reason); return `Deleted ${n} compan${n === 1 ? "y" : "ies"}. You can undo this now.`; }, P);
}
export async function restoreCompaniesAction(ids: string[]): Promise<ActionResult> {
  return act(async (actor, db) => { const n = await ws.restoreCompanies(db, actor, ids); return `Restored ${n} compan${n === 1 ? "y" : "ies"}.`; }, P);
}
export async function exportCompaniesAction(ids: string[]): Promise<ActionResult> {
  return act(async (actor, db) => { const r = await ws.exportCompaniesCsv(db, actor, ids); return { message: `Exported ${r.count} compan${r.count === 1 ? "y" : "ies"}.`, data: { csv: r.csv } }; });
}
export async function companyDuplicatesAction(): Promise<ActionResult> {
  return act(async (actor, db) => ({ data: { groups: await ws.duplicateCompanies(db, actor) } }));
}
export async function companyPreviewAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const r = await ws.companyRecord(db, actor, id);
    return { data: {
      contacts: r.contactsDetail.slice(0, 6).map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, jobTitle: c.jobTitle })),
      deals: r.deals.slice(0, 5).map((d) => ({ id: d.id, name: d.name, stage: d.stage, amount: d.amount, currency: d.currency })),
      activities: r.activitiesFull.slice(0, 5).map((a) => ({ id: a.id, type: a.type, subject: a.subject, at: (a.scheduledFor ?? a.occurredAt).toISOString(), by: a.by })),
      summary: { lines: r.summary.lines, next: r.summary.next, missing: r.summary.missing },
    } };
  });
}

type LogInput = { companyId: string; type: string; subject: string; body?: string; outcome?: string; at?: string; scheduledFor?: string; durationMinutes?: number; followUpTitle?: string; followUpDue?: string };
export async function logCompanyActivityAction(v: LogInput): Promise<ActionResult> {
  return act(async (actor, db) => {
    await logActivity(db, actor, { type: v.type, subject: v.subject, body: v.body || null, outcome: v.outcome || null, companyId: v.companyId, occurredAt: v.at || null, scheduledFor: v.scheduledFor || null, durationMinutes: v.durationMinutes ?? null, followUpTitle: v.followUpTitle || null, followUpDue: v.followUpDue || null });
    return `${v.type === "note" ? "Note created" : v.scheduledFor ? "Meeting scheduled" : "Activity logged"}${v.followUpTitle ? " with a follow-up task" : ""}.`;
  }, P);
}
export async function companyTaskAction(v: { companyId: string; title: string; type: string; dueAt: string; remindAt: string; priority: string; ownerId: string; description: string }): Promise<ActionResult> {
  return act(async (actor, db) => {
    assertCan(actor, "activities.log");
    await createTask(db, actor, { title: v.title, taskType: v.type, dueAt: v.dueAt || null, remindAt: v.remindAt || null, priority: v.priority, ownerId: v.ownerId || null, description: v.description || null, relatedType: "company", relatedId: v.companyId, companyId: v.companyId });
    return "Task created. It's also on the Tasks page.";
  }, P);
}

export async function saveCompanyViewAction(name: string, state: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { invalid } = await import("@/server/errors");
    if (!name.trim()) throw invalid("Name the view.", { name: "Required." });
    if (state.length > 4000) throw invalid("This view is too large to save.");
    const [v] = await db.insert(savedViews).values({ userId: actor.id, entity: "companies-table", name: name.trim().slice(0, 40), query: state }).returning();
    return { message: `View “${v.name}” saved.`, data: { id: v.id } };
  }, P);
}
export async function deleteCompanyViewAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const { savedViews } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, actor.id)));
    return "View deleted.";
  }, P);
}
