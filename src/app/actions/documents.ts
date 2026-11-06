"use server";

import { act, num, optional, str, type ActionResult } from "@/server/action";
import * as docs from "@/server/services/documents";
import { getDb } from "@/db";
import { clientIp } from "@/server/session";
import { rateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import type { DocLine, DocSection } from "@/db/schema";

const P = ["/billing", "/documents", "/companies", "/contacts", "/deals"];
type A = ActionResult | null;

export async function createDocumentAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    const d = await docs.createDocument(db, actor, { type: str(fd, "type") as docs.DocType, companyId: str(fd, "companyId"), contactId: optional(fd, "contactId"), dealId: optional(fd, "dealId"), sourceId: optional(fd, "sourceId") });
    return { message: `${d.number} created as a draft.`, data: { id: d.id } };
  }, P);
}
export async function saveDocumentAction(id: string, patch: docs.DocPatch & { lines?: DocLine[]; sections?: DocSection[] }, version: string): Promise<ActionResult> {
  return act(async (actor, db) => { const d = await docs.updateDocument(db, actor, id, patch, version); return { message: "Saved.", data: { version: d.updatedAt.toISOString(), total: d.total } }; }, P);
}
export async function sendDocumentAction(id: string): Promise<ActionResult> {
  return act(async (actor, db) => { const r = await docs.sendDocument(db, actor, id); return { message: "Marked as sent. Share the link with the client (copied for you).", data: { token: r.token } }; }, P);
}
export async function attachSignedAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const f = await docs.attachSignedCopy(db, actor, id, fd.get("file") as File, { name: str(fd, "signedByName"), title: optional(fd, "signedByTitle") });
    return `Signed copy attached to the customer's record (${f.filename}).`;
  }, P);
}
export async function recordPaymentAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const status = await docs.recordPayment(db, actor, id, { amount: num(fd, "amount") ?? 0, method: str(fd, "method"), reference: optional(fd, "reference"), paidOn: str(fd, "paidOn"), notes: optional(fd, "notes") });
    return status === "paid" ? "Payment recorded. The invoice is fully paid." : "Payment recorded. A balance remains.";
  }, P);
}
export async function voidDocumentAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await docs.voidDocument(db, actor, id, str(fd, "reason")); return "Voided."; }, P);
}
export async function duplicateDocumentAction(id: string, asType: string | null): Promise<ActionResult> {
  return act(async (actor, db) => { const d = await docs.duplicateDocument(db, actor, id, (asType ?? undefined) as docs.DocType | undefined); return { message: `${d.number} created.`, data: { id: d.id } }; }, P);
}

// --------------------------------------------------------------- Client-facing (no login; the link is the key)
async function pub(token: string, fn: (ip: string | null) => Promise<string>): Promise<ActionResult> {
  const ip = await clientIp();
  if (!rateLimit(`doc:${ip}:${token.slice(0, 8)}`, 15, 10 * 60000)) return { ok: false, message: "Too many attempts. Please wait a few minutes.", at: Date.now() };
  try { return { ok: true, message: await fn(ip), at: Date.now() }; }
  catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors, at: Date.now() };
    console.error("[document] unexpected error", e);
    return { ok: false, message: "Something went wrong. Please try again or contact us.", at: Date.now() };
  }
}
export async function publicAcceptAction(token: string, _: A, fd: FormData) {
  return pub(token, async (ip) => { await docs.publicAccept(await getDb(), token, { name: str(fd, "name"), title: str(fd, "title"), agree: fd.get("agree") === "on" }, ip); return "Thank you — your acceptance has been recorded. A copy stays available at this link."; });
}
export async function publicDeclineAction(token: string, _: A, fd: FormData) {
  return pub(token, async () => { await docs.publicDecline(await getDb(), token, str(fd, "reason")); return "Thanks for letting us know. Your account manager will be in touch."; });
}
