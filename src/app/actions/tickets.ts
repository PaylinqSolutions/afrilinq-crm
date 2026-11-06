"use server";

import { act, bool, num, optional, str, type ActionResult } from "@/server/action";
import { formToObject } from "@/lib/schemas";
import * as tickets from "@/server/services/tickets";
import { getDb } from "@/db";
import { invalid } from "@/server/errors";
import { AppError } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/session";
import type { Priority } from "@/lib/rules/tickets";
import { fromLocalInput } from "@/lib/format";

type A = ActionResult | null;
const paths = ["/tickets", "/escalations"];

export async function createTicketAction(_: A, fd: FormData) {
  return act(async (actor, db) => { const t = await tickets.createTicket(db, actor, formToObject(fd)); return { message: `Ticket AFL-${t.number} created as ${t.priority}.`, data: { id: t.id } }; }, paths);
}
export async function triageAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    await tickets.updateTriage(db, actor, id, {
      category: str(fd, "category"), subcategory: optional(fd, "subcategory"), impact: str(fd, "impact"), urgency: str(fd, "urgency"), productId: optional(fd, "productId"),
      workaroundAvailable: bool(fd, "workaroundAvailable"), workaround: optional(fd, "workaround"), affectedUsers: num(fd, "affectedUsers"), businessImpact: optional(fd, "businessImpact"), incidentType: optional(fd, "incidentType"),
    }, optional(fd, "_version"));
    return "Triage saved; priority recalculated from impact × urgency.";
  }, paths);
}
export async function overridePriorityAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.overridePriority(db, actor, id, str(fd, "priority") as Priority, str(fd, "reason"), optional(fd, "_version")); return "Priority overridden and logged."; }, paths);
}
export async function assignAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.assignTicket(db, actor, id, optional(fd, "ownerId"), optional(fd, "teamId"), optional(fd, "_version")); return "Assignment saved."; }, paths);
}
export async function takeTicketAction(id: string) {
  return act(async (actor, db) => { await tickets.assignTicket(db, actor, id, actor.id, null); return "Assigned to you."; }, paths);
}
export async function statusAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const f = optional(fd, "followUpAt");
    await tickets.changeTicketStatus(db, actor, id, str(fd, "status"), { reason: optional(fd, "reason"), waitingReason: optional(fd, "waitingReason"), followUpAt: f ? fromLocalInput(f) : null, expected: optional(fd, "_version") });
    return "Status updated.";
  }, paths);
}
export async function replyAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    if (str(fd, "kind") === "note") { await tickets.addInternalNote(db, actor, id, str(fd, "body")); return "Internal note added (not visible to the customer)."; }
    const r = await tickets.replyToTicket(db, actor, id, str(fd, "body"));
    return r.delivery === "simulated" ? "Reply recorded and visible on the customer ticket page. Email is not configured — delivery was simulated, not sent." : "Reply sent.";
  }, paths);
}
export async function resolveAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    await tickets.resolveTicket(db, actor, id, { resolutionSummary: optional(fd, "resolutionSummary"), resolutionCode: optional(fd, "resolutionCode"), rootCause: optional(fd, "rootCause"), rootCauseFollowUpOwnerId: optional(fd, "rootCauseFollowUpOwnerId"), workaround: optional(fd, "workaround"), incidentEvidence: optional(fd, "incidentEvidence"), expected: optional(fd, "_version") });
    return "Resolved — pending customer confirmation.";
  }, paths);
}
export async function closeAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.closeTicket(db, actor, id, optional(fd, "reason")); return "Ticket closed."; }, paths);
}
export async function reopenAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.reopenTicket(db, actor, id, str(fd, "reason")); return "Reopened. The previous resolution is preserved in the history."; }, paths);
}
export async function escalateAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const e = await tickets.escalateTicket(db, actor, id, {
      kind: str(fd, "kind"), severity: str(fd, "severity") || "P2", reason: optional(fd, "reason"), requestedTeamId: optional(fd, "requestedTeamId"), assignedToId: optional(fd, "assignedToId"),
      reproductionSteps: optional(fd, "reproductionSteps"), expectedResult: optional(fd, "expectedResult"), actualResult: optional(fd, "actualResult"), environment: optional(fd, "environment"),
      evidence: optional(fd, "evidence"), customerImpact: optional(fd, "customerImpact"), workaround: optional(fd, "workaround"), businessConsequence: optional(fd, "businessConsequence"),
    });
    return e.status === "pending_approval" ? "Escalation raised — awaiting Support Lead approval." : "Escalation raised. They've been notified and it's in their Escalations inbox.";
  }, paths);
}
export async function decideEscalationAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.decideEscalation(db, actor, escId, str(fd, "decision") === "approve", optional(fd, "comment")); return "Decision recorded."; }, paths);
}
export async function acceptEscalationAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.acceptEscalation(db, actor, escId, optional(fd, "note")); return "Accepted. The person who raised it can see you're on it."; }, paths);
}
export async function reassignEscalationAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.reassignEscalation(db, actor, escId, str(fd, "assignedToId"), optional(fd, "note")); return "Reassigned and the new owner notified."; }, paths);
}
export async function escalationUpdateAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.addEscalationUpdate(db, actor, escId, { body: str(fd, "body"), engineeringStatus: optional(fd, "engineeringStatus"), rootCause: optional(fd, "rootCause"), fixVersion: optional(fd, "fixVersion") }); return "Update posted."; }, paths);
}
export async function resolveEscalationAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.resolveEscalation(db, actor, escId, str(fd, "resolution")); return "Marked resolved. The person who raised it has been asked to confirm."; }, paths);
}
export async function confirmEscalationAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.confirmEscalation(db, actor, escId, optional(fd, "note")); return "Confirmed resolved. The escalation is closed."; }, paths);
}
export async function reopenEscalationAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.reopenEscalation(db, actor, escId, str(fd, "reason")); return "Reopened and sent back to the assignee."; }, paths);
}
export async function cancelEscalationAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.cancelEscalation(db, actor, escId, str(fd, "reason")); return "Escalation withdrawn."; }, paths);
}
export async function engineeringUpdateAction(escId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.addEngineeringUpdate(db, actor, escId, { body: str(fd, "body"), engineeringStatus: optional(fd, "engineeringStatus"), rootCause: optional(fd, "rootCause"), fixVersion: optional(fd, "fixVersion") }); return "Engineering update added (internal)."; }, paths);
}
export async function linkArticleAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.linkArticle(db, actor, id, str(fd, "articleId")); return "Article linked."; }, paths);
}
export async function linkRecordsAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await tickets.linkTicket(db, actor, id, { onboardingProjectId: optional(fd, "onboardingProjectId"), dealId: optional(fd, "dealId") }); return "Links saved."; }, paths);
}
export async function uploadAttachmentAction(id: string, _: A, fd: FormData) {
  const { uploadTicketAttachment } = await import("@/server/services/files");
  return act(async (actor, db) => { await uploadTicketAttachment(db, actor, id, fd.get("file") as File, str(fd, "visibility") === "public" ? "public" : "internal"); return "Attachment uploaded."; }, paths);
}

// ------------------------------------------------------------- Customer portal (no staff session)

async function portal(token: string, fn: () => Promise<string>): Promise<ActionResult> {
  if (!rateLimit(`portal:${await clientIp()}:${token.slice(0, 8)}`, 20, 10 * 60000)) return { ok: false, message: "Too many requests. Please wait a few minutes.", at: Date.now() };
  try { return { ok: true, message: await fn(), at: Date.now() }; }
  catch (e) { if (e instanceof AppError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors, at: Date.now() }; throw e; }
}
export async function portalReplyAction(token: string, _: A, fd: FormData) {
  const db = await getDb();
  return portal(token, async () => { await tickets.portalReply(db, token, str(fd, "body")); return "Message sent to the support team."; });
}
export async function portalConfirmAction(token: string, _: A, fd: FormData) {
  const db = await getDb();
  return portal(token, async () => {
    const choice = str(fd, "choice");
    if (choice === "confirm") { await tickets.portalConfirmResolved(db, token); return "Thank you — the ticket is now closed."; }
    if (choice === "reopen") { if (!str(fd, "reason")) throw invalid("Tell us what is still happening.", { reason: "Required." }); await tickets.portalReopen(db, token, str(fd, "reason")); return "We've reopened your ticket."; }
    throw invalid("Choose an option.");
  });
}
export async function portalCsatAction(token: string, _: A, fd: FormData) {
  const db = await getDb();
  return portal(token, async () => { await tickets.portalCsat(db, token, Number(str(fd, "score")), optional(fd, "comment")); return "Thanks for your feedback."; });
}
