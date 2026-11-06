"use server";

import { and, eq, isNull } from "drizzle-orm";
import { act, all, bool, num, optional, str, type ActionResult } from "@/server/action";
import { formToObject } from "@/lib/schemas";
import * as sales from "@/server/services/sales";
import * as accounts from "@/server/services/accounts";
import * as activities from "@/server/services/activities";
import { notifications, savedViews } from "@/db/schema";
import { invalid } from "@/server/errors";

type A = ActionResult | null;

export async function createLeadAction(_: A, fd: FormData) {
  return act(async (actor, db) => { const l = await sales.createLead(db, actor, formToObject(fd)); return { message: "Lead created.", data: { id: l.id } }; }, ["/leads"]);
}
export async function updateLeadAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await sales.updateLead(db, actor, id, formToObject(fd), optional(fd, "_version")); return "Lead saved."; }, ["/leads"]);
}
export async function convertLeadAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const r = await sales.convertLead(db, actor, id, { companyId: optional(fd, "companyId"), dealName: str(fd, "dealName"), amount: num(fd, "amount"), newContact: bool(fd, "newContact"), createDeal: bool(fd, "createDeal") });
    const who = r.reusedContact ? `linked to existing contact ${r.reusedContact.name} (same ${r.reusedContact.matchedBy}), no duplicate created` : "new contact created";
    return { message: `Lead converted: ${who}${r.companyId ? ", company linked" : ""}${r.dealId ? ", deal opened" : ""}.`, data: { next: r.dealId ? `/deals/${r.dealId}` : `/contacts/${r.contactId}` } };
  }, ["/leads", "/deals", "/contacts", "/companies"]);
}

export async function createCompanyAction(_: A, fd: FormData) {
  return act(async (actor, db) => { const c = await accounts.createCompany(db, actor, formToObject(fd)); return { message: "Company created.", data: { id: c.id } }; }, ["/companies"]);
}
export async function updateCompanyAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await accounts.updateCompany(db, actor, id, formToObject(fd), optional(fd, "_version")); return "Company saved."; }, ["/companies"]);
}
export async function updateBillingAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await accounts.updateBilling(db, actor, id, { billingStatus: optional(fd, "billingStatus"), billingNotes: optional(fd, "billingNotes") }, optional(fd, "_version")); return "Billing status recorded."; }, ["/companies"]);
}
export async function saveCustomFieldsAction(entityType: string, id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const values: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("cf_") && typeof v === "string") values[k.slice(3)] = v;
    await accounts.setCustomFieldValues(db, actor, entityType, id, values);
    return "Custom fields saved.";
  });
}
export async function deleteCompanyAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await accounts.softDeleteCompany(db, actor, id, str(fd, "reason")); return { message: "Company deleted (soft delete, audit-logged)." }; }, ["/companies"]);
}

export async function createContactAction(_: A, fd: FormData) {
  return act(async (actor, db) => { const c = await accounts.createContact(db, actor, formToObject(fd, ["contactRoles"])); return { message: "Contact created.", data: { id: c.id } }; }, ["/contacts"]);
}
export async function updateContactAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await accounts.updateContact(db, actor, id, formToObject(fd, ["contactRoles"]), optional(fd, "_version")); return "Contact saved."; }, ["/contacts"]);
}

export async function createDealAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    const d = await sales.createDeal(db, actor, formToObject(fd));
    const pid = optional(fd, "productId");
    if (pid) await sales.setDealProducts(db, actor, d.id, [{ productId: pid, quantity: num(fd, "quantity") ?? 1, unitPrice: num(fd, "unitPrice") ?? d.amount ?? 0 }]);
    return { message: "Deal created.", data: { id: d.id } };
  }, ["/deals"]);
}
export async function updateDealAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await sales.updateDeal(db, actor, id, formToObject(fd), optional(fd, "_version")); return "Deal saved."; }, ["/deals"]);
}
export async function moveStageAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const r = await sales.moveDealStage(db, actor, id, str(fd, "stageId"), { lossReason: optional(fd, "lossReason"), lossNotes: optional(fd, "lossNotes"), expected: optional(fd, "_version") });
    if (r.unchanged) return "No change.";
    return r.handoverCreated ? "Closed Won 🎉 A handover has been created — complete it so onboarding can begin." : "Stage updated.";
  }, ["/deals", "/handovers"]);
}
/** Used by the Kanban board (drag & drop or the keyboard “Move to” menu). */
export async function moveStageDirect(id: string, stageId: string, lossReason?: string, expected?: string): Promise<ActionResult> {
  return act(async (actor, db) => {
    const r = await sales.moveDealStage(db, actor, id, stageId, { lossReason: lossReason ?? null, expected });
    return r.handoverCreated ? "Closed Won — handover created." : "Stage updated.";
  }, ["/deals"]);
}
export async function decideDiscountAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await sales.decideDiscount(db, actor, id, str(fd, "decision") === "approve", optional(fd, "comment")); return "Decision recorded."; }, ["/deals"]);
}
export async function setDealProductsAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const ids = fd.getAll("productId").map(String); const qty = fd.getAll("quantity").map(Number); const price = fd.getAll("unitPrice").map((x) => Number(String(x).replace(/[, ]/g, "")));
    const lines = ids.map((p, i) => ({ productId: p, quantity: qty[i], unitPrice: price[i] })).filter((l) => l.productId);
    await sales.setDealProducts(db, actor, id, lines, optional(fd, "_version"));
    return "Products updated.";
  }, ["/deals"]);
}

export async function logActivityAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    const send = str(fd, "intent") === "send";
    await activities.logActivity(db, actor, formToObject(fd), { send, confirmSimulated: bool(fd, "confirmSimulated") });
    return send && bool(fd, "confirmSimulated") ? "Recorded as a SIMULATED message (demo mode) — nothing was delivered." : "Activity logged.";
  });
}

export async function createTaskAction(_: A, fd: FormData) {
  return act(async (actor, db) => { await activities.createTask(db, actor, formToObject(fd)); return "Task created."; }, ["/tasks", "/"]);
}
export async function completeTaskAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await activities.completeTask(db, actor, id, optional(fd, "outcome"), str(fd, "cancel") === "1"); return "Task updated."; }, ["/tasks", "/"]);
}

export async function markNotificationsReadAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    const ids = all(fd, "id");
    if (ids.length) for (const id of ids) await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, actor.id)));
    else await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
    return "Marked as read.";
  }, ["/notifications"]);
}

export async function saveViewAction(entity: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const name = str(fd, "name"); const query = str(fd, "query");
    if (!name) throw invalid("Name the view.", { name: "Required." });
    await db.insert(savedViews).values({ userId: actor.id, entity, name: name.slice(0, 60), query: query.slice(0, 1000) });
    return "View saved.";
  });
}
export async function deleteViewAction(id: string) {
  return act(async (actor, db) => { await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.userId, actor.id))); return "View removed."; });
}

export async function uploadCompanyFileAction(companyId: string, _: A, fd: FormData) {
  const { uploadCompanyFile } = await import("@/server/services/files");
  return act(async (actor, db) => { await uploadCompanyFile(db, actor, companyId, fd.get("file") as File, bool(fd, "restricted")); return "File uploaded."; }, ["/companies"]);
}
