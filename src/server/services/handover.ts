import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db";
import {
  handoverRecords, handoverReviews, deals, companies, contacts, dealContacts, dealProducts, products, users, onboardingProjects,
} from "@/db/schema";
import {
  HANDOVER_FIELDS, SALES_EDITABLE_STATUSES, ACCEPTED_STATUSES, handoverCompleteness, missingHandoverFields, fieldLabel,
  type HandoverStatus,
} from "@/lib/rules/handover";
import { fmtMoney } from "@/lib/format";
import { type Actor, assertCan, can } from "../actor";
import { audit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { notifyRoles, notifyUsers } from "../notify";
import { handoverScope } from "./scope";
import { emit } from "./workflows";
import { createDraftProject, activateProject } from "./onboarding";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

type Deal = typeof deals.$inferSelect;

async function prefill(db: Executor, deal: Deal) {
  const [company] = await db.select().from(companies).where(eq(companies.id, deal.companyId));
  const cs = await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle, email: contacts.email, phone: contacts.phone, role: dealContacts.role })
    .from(dealContacts).innerJoin(contacts, eq(contacts.id, dealContacts.contactId)).where(eq(dealContacts.dealId, deal.id));
  const primary = cs.find((c) => c.id === deal.primaryContactId);
  const lines = await db.select({ name: products.name, quantity: dealProducts.quantity, unitPrice: dealProducts.unitPrice })
    .from(dealProducts).innerJoin(products, eq(products.id, dealProducts.productId)).where(eq(dealProducts.dealId, deal.id));
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, deal.ownerId));
  const person = (c: (typeof cs)[number]) => `${c.firstName} ${c.lastName}${c.jobTitle ? `, ${c.jobTitle}` : ""} — ${[c.email, c.phone].filter(Boolean).join(" / ")}`;
  const checklist: Record<string, string> = {
    customerName: company?.name ?? "",
    primaryContact: primary ? person(primary) : "",
    secondaryContacts: cs.filter((c) => c.id !== deal.primaryContactId).map((c) => `${person(c)} (${c.role ?? "contact"})`).join("\n"),
    productsSold: lines.map((l) => `${l.quantity} × ${l.name} @ ${fmtMoney(l.unitPrice, deal.currency)}`).join("\n"),
    agreementReference: deal.contractReference ?? "",
    pricing: deal.amount ? `${fmtMoney(deal.amount, deal.currency)}${deal.billingFrequency ? `, billed ${deal.billingFrequency.toLowerCase()}` : ""}` : "",
    startDate: deal.startDate ?? "",
    discount: deal.discountPct ? `${deal.discountPct}% (${deal.discountStatus})` : "None",
    salesExecutive: owner?.name ?? "",
  };
  return Object.fromEntries(Object.entries(checklist).filter(([, v]) => v));
}

/**
 * Called inside the Closed Won transaction. Idempotent: the unique deal_id constraint guarantees exactly
 * one handover per deal however many times this runs.
 */
export async function ensureHandoverForDeal(db: Executor, actor: Actor, deal: Deal) {
  const checklist = await prefill(db, deal);
  const rows = await db.insert(handoverRecords).values({
    dealId: deal.id, companyId: deal.companyId, status: "Pending Sales Submission", checklist,
    completeness: handoverCompleteness(checklist),
  }).onConflictDoNothing({ target: handoverRecords.dealId }).returning();
  if (!rows.length) return { created: false, handover: null };
  const h = rows[0];
  await db.insert(handoverReviews).values({ handoverId: h.id, action: "created", actorId: actor.id, comment: "Deal moved to Closed Won" });
  await audit(db, actor, "handover.created", "handover", h.id, { status: { from: null, to: h.status } });
  const [owner] = await db.select({ managerId: users.managerId }).from(users).where(eq(users.id, deal.ownerId));
  const n = { kind: "handover", link: `/handovers/${h.id}`, dedupeKey: `handover-created:${h.id}` };
  await notifyUsers(db, [deal.ownerId], { ...n, title: `Complete the handover for ${deal.name}`, body: "The deal is won. Onboarding cannot start until the handover is submitted and accepted." });
  await notifyUsers(db, [owner?.managerId], { ...n, title: `Deal won — handover pending: ${deal.name}` });
  await notifyRoles(db, ["onboarding_manager"], { ...n, title: `New handover incoming: ${deal.name}`, body: "Awaiting Sales submission." });
  return { created: true, handover: h };
}

export type HandoverFilters = { status?: string; owner?: string; deal?: string };

export async function listHandovers(db: DB, actor: Actor, f: HandoverFilters = {}) {
  const conds: (SQL | undefined)[] = [handoverScope(actor)];
  if (f.status) conds.push(eq(handoverRecords.status, f.status));
  if (f.deal) conds.push(eq(handoverRecords.dealId, f.deal));
  if (f.owner === "me") conds.push(eq(deals.ownerId, actor.id));
  return db.select({
    id: handoverRecords.id, status: handoverRecords.status, completeness: handoverRecords.completeness,
    submittedAt: handoverRecords.submittedAt, acceptedAt: handoverRecords.acceptedAt, createdAt: handoverRecords.createdAt,
    updatedAt: handoverRecords.updatedAt, returnCount: handoverRecords.returnCount, correctionRequested: handoverRecords.correctionRequested,
    dealId: deals.id, dealName: deals.name, amount: deals.amount, currency: deals.currency, companyId: companies.id, companyName: companies.name,
    ownerId: deals.ownerId, ownerName: users.name, onboardingProjectId: handoverRecords.onboardingProjectId,
  }).from(handoverRecords).innerJoin(deals, eq(deals.id, handoverRecords.dealId)).innerJoin(companies, eq(companies.id, handoverRecords.companyId))
    .innerJoin(users, eq(users.id, deals.ownerId)).where(and(...conds)).orderBy(desc(handoverRecords.updatedAt));
}

export async function getHandover(db: Executor, actor: Actor, id: string) {
  const [h] = await db.select().from(handoverRecords).where(and(eq(handoverRecords.id, id), handoverScope(actor)));
  if (!h) throw notFound("Handover");
  const [deal] = await db.select().from(deals).where(eq(deals.id, h.dealId));
  return { h, deal };
}

export async function getHandoverDetail(db: DB, actor: Actor, id: string) {
  const { h, deal } = await getHandover(db, actor, id);
  const [company] = await db.select().from(companies).where(eq(companies.id, h.companyId));
  const reviews = await db.select({ id: handoverReviews.id, action: handoverReviews.action, comment: handoverReviews.comment, missingFields: handoverReviews.missingFields, createdAt: handoverReviews.createdAt, actor: users.name })
    .from(handoverReviews).leftJoin(users, eq(users.id, handoverReviews.actorId)).where(eq(handoverReviews.handoverId, id)).orderBy(desc(handoverReviews.createdAt));
  const project = h.onboardingProjectId
    ? (await db.select().from(onboardingProjects).where(eq(onboardingProjects.id, h.onboardingProjectId)))[0] ?? null : null;
  const isDealOwner = deal.ownerId === actor.id;
  return {
    h, deal, company, reviews, project, missing: missingHandoverFields(h.checklist),
    canEdit: can(actor, "handover.submit") && (isDealOwner || can(actor, "deals.view_all")) && (SALES_EDITABLE_STATUSES as string[]).includes(h.status),
    canReview: can(actor, "handover.review") && h.status === "Submitted for Review",
    canOverride: can(actor, "handover.override"),
    canOverrideAccept: can(actor, "handover.review") && can(actor, "handover.override") && ["Pending Sales Submission", "Changes Requested"].includes(h.status),
    canRequestCorrection: can(actor, "handover.submit") && isDealOwner && (ACCEPTED_STATUSES as string[]).includes(h.status),
    canApplyCorrection: can(actor, "handover.review") && h.correctionRequested,
  };
}

function assertSalesEditor(actor: Actor, h: typeof handoverRecords.$inferSelect, deal: Deal) {
  assertCan(actor, "handover.submit");
  if (deal.ownerId !== actor.id && !can(actor, "deals.view_all")) throw forbidden("Only the deal owner or a sales manager can edit this handover.");
  if (!(SALES_EDITABLE_STATUSES as string[]).includes(h.status))
    throw forbidden(`This handover is “${h.status}” and is read-only for Sales. Request a documented correction instead.`);
}

export async function saveHandoverChecklist(db: DB, actor: Actor, id: string, input: Record<string, unknown>, expected?: Version) {
  const { h, deal } = await getHandover(db, actor, id);
  assertSalesEditor(actor, h, deal);
  await assertFresh(db, actor, "handover", id, h.updatedAt, expected, "handover");
  const checklist: Record<string, string> = { ...h.checklist };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of HANDOVER_FIELDS) {
    if (!(f.key in input)) continue;
    const v = String(input[f.key] ?? "").trim().slice(0, 5000);
    if ((checklist[f.key] ?? "") !== v) changes[f.key] = { from: checklist[f.key] ?? null, to: v || null };
    checklist[f.key] = v;
  }
  if (checklist.targetGoLive && !/^\d{4}-\d{2}-\d{2}$/.test(checklist.targetGoLive))
    throw invalid("Target go-live must be a date.", { targetGoLive: "Use YYYY-MM-DD." });
  const status: HandoverStatus = h.status === "Draft" ? "Pending Sales Submission" : (h.status as HandoverStatus);
  assertUpdated(await db.update(handoverRecords).set({ checklist, completeness: handoverCompleteness(checklist), status, updatedAt: new Date() })
    .where(and(eq(handoverRecords.id, id), sameVersion(handoverRecords.updatedAt, h.updatedAt))).returning({ id: handoverRecords.id }), "handover");
  if (Object.keys(changes).length) await audit(db, actor, "handover.checklist_saved", "handover", id, changes);
  return { completeness: handoverCompleteness(checklist), missing: missingHandoverFields(checklist) };
}

export async function submitHandover(db: DB, actor: Actor, id: string) {
  const { h, deal } = await getHandover(db, actor, id);
  assertSalesEditor(actor, h, deal);
  const missing = missingHandoverFields(h.checklist);
  if (missing.length) {
    throw invalid(`${missing.length} required item(s) are missing. Complete them before submitting.`,
      Object.fromEntries(missing.map((k) => [k, "Required before submission."])));
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    const projectId = await createDraftProject(tx, h, deal);
    await tx.update(handoverRecords).set({ status: "Submitted for Review", submittedBy: actor.id, submittedAt: now, onboardingProjectId: projectId, updatedAt: now })
      .where(eq(handoverRecords.id, id));
    await tx.insert(handoverReviews).values({ handoverId: id, action: "submitted", actorId: actor.id });
    await audit(tx, actor, "handover.submitted", "handover", id, { status: { from: h.status, to: "Submitted for Review" } });
    await notifyRoles(tx, ["onboarding_manager"], {
      kind: "handover", title: `Handover ready for review: ${deal.name}`, link: `/handovers/${id}`, dedupeKey: `handover-submitted:${id}:${now.getTime()}`,
    });
  });
  await emit(db, "handover.submitted", { entityId: id, dedupe: `${id}:${now.getTime()}`, ownerId: deal.ownerId, name: deal.name, link: `/handovers/${id}` });
}

const requireComment = (c: string | null | undefined, what: string) => {
  if (!c || c.trim().length < 5) throw invalid(`A comment is required to ${what}.`, { comment: "Explain your decision (at least 5 characters)." });
  return c.trim();
};

export async function requestHandoverChanges(db: DB, actor: Actor, id: string, commentIn: string | null) {
  assertCan(actor, "handover.review");
  const { h, deal } = await getHandover(db, actor, id);
  if (h.status !== "Submitted for Review") throw conflict(`Only submitted handovers can be returned (current status: ${h.status}).`);
  const comment = requireComment(commentIn, "request changes");
  const missing = missingHandoverFields(h.checklist);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(handoverRecords).set({
      status: "Changes Requested", reviewedBy: actor.id, reviewedAt: now, reviewComment: comment, returnCount: h.returnCount + 1, updatedAt: now,
    }).where(eq(handoverRecords.id, id));
    await tx.insert(handoverReviews).values({ handoverId: id, action: "changes_requested", comment, missingFields: missing, actorId: actor.id });
    await audit(tx, actor, "handover.changes_requested", "handover", id, { status: { from: h.status, to: "Changes Requested" } }, comment);
  });
  await emit(db, "handover.returned", {
    entityId: id, dedupe: `${id}:${now.getTime()}`, ownerId: deal.ownerId, submitterId: h.submittedBy, name: deal.name, comment,
    missing: missing.map(fieldLabel).join("; ") || "none flagged", link: `/handovers/${id}`,
  });
}

export async function acceptHandover(
  db: DB, actor: Actor, id: string,
  input: { comment: string | null; onboardingOwnerId: string | null; overrideReason?: string | null; templateId?: string | null },
) {
  assertCan(actor, "handover.review");
  const { h, deal } = await getHandover(db, actor, id);
  if (!["Submitted for Review", "Pending Sales Submission", "Changes Requested"].includes(h.status))
    throw conflict(`This handover cannot be accepted (current status: ${h.status}).`);
  const comment = requireComment(input.comment, "accept");
  if (!input.onboardingOwnerId) throw invalid("Assign an onboarding owner.", { onboardingOwnerId: "Required." });
  const missing = missingHandoverFields(h.checklist);
  const notSubmitted = h.status !== "Submitted for Review";
  let override: string | null = null;
  if (missing.length || notSubmitted) {
    if (!input.overrideReason) {
      throw invalid(notSubmitted
        ? "Sales has not submitted this handover. Only an authorised manager can accept it early, with a documented override reason."
        : `This handover is incomplete (${missing.length} missing). Request changes, or an authorised manager may override with a reason.`,
        { overrideReason: "Required to accept an incomplete or unsubmitted handover." });
    }
    if (!can(actor, "handover.override")) throw forbidden("Only an authorised manager can override an incomplete handover.");
    if (input.overrideReason.trim().length < 10) throw invalid("Explain the override.", { overrideReason: "At least 10 characters." });
    override = input.overrideReason.trim();
  }
  const now = new Date();
  const projectId = await db.transaction(async (tx) => {
    const pid = h.onboardingProjectId ?? (await createDraftProject(tx, h, deal));
    await activateProject(tx, actor, pid, { ownerId: input.onboardingOwnerId!, templateId: input.templateId ?? null, handover: h, deal });
    await tx.update(handoverRecords).set({
      status: "Accepted by Onboarding", acceptedBy: actor.id, acceptedAt: now, reviewedBy: actor.id, reviewedAt: now, reviewComment: comment,
      overrideReason: override, overrideBy: override ? actor.id : null, onboardingProjectId: pid, updatedAt: now,
    }).where(eq(handoverRecords.id, id));
    await tx.insert(handoverReviews).values({
      handoverId: id, action: override ? "override_accepted" : "accepted", comment: override ? `${comment}\n\nOverride reason: ${override}` : comment,
      missingFields: missing.length ? missing : null, actorId: actor.id,
    });
    await audit(tx, actor, override ? "handover.override_accepted" : "handover.accepted", "handover", id,
      { status: { from: h.status, to: "Accepted by Onboarding" }, ...(override ? { missingFields: { from: null, to: missing } } : {}) }, override);
    return pid;
  });
  await emit(db, "handover.accepted", {
    entityId: id, ownerId: deal.ownerId, onboardingOwnerId: input.onboardingOwnerId, name: deal.name, projectId, link: `/onboarding/${projectId}`,
  });
  return projectId;
}

export async function requestHandoverCorrection(db: DB, actor: Actor, id: string, input: { field: string; newValue: string; reason: string }) {
  const { h, deal } = await getHandover(db, actor, id);
  assertCan(actor, "handover.submit");
  if (deal.ownerId !== actor.id) throw forbidden("Only the deal owner can request a correction.");
  if (!(ACCEPTED_STATUSES as string[]).includes(h.status)) throw conflict("Corrections are only for accepted handovers. Edit the checklist directly instead.");
  if (!HANDOVER_FIELDS.some((f) => f.key === input.field)) throw invalid("Choose a checklist item.", { field: "Required." });
  if (!input.newValue?.trim()) throw invalid("Provide the corrected value.", { newValue: "Required." });
  const reason = requireComment(input.reason, "request a correction");
  await db.insert(handoverReviews).values({
    handoverId: id, action: "correction_requested", actorId: actor.id,
    comment: JSON.stringify({ field: input.field, newValue: input.newValue.trim(), reason }),
  });
  await db.update(handoverRecords).set({ correctionRequested: true, updatedAt: new Date() }).where(eq(handoverRecords.id, id));
  await audit(db, actor, "handover.correction_requested", "handover", id, null, `${fieldLabel(input.field)}: ${reason}`);
  const [p] = h.onboardingProjectId ? await db.select({ ownerId: onboardingProjects.ownerId }).from(onboardingProjects).where(eq(onboardingProjects.id, h.onboardingProjectId)) : [];
  await notifyUsers(db, [p?.ownerId, h.acceptedBy], { kind: "handover", title: `Correction requested on accepted handover: ${deal.name}`, body: `${fieldLabel(input.field)} — ${reason}`, link: `/handovers/${id}` });
}

export async function applyHandoverCorrection(db: DB, actor: Actor, id: string, reviewId: string, approve: boolean) {
  assertCan(actor, "handover.review");
  const { h, deal } = await getHandover(db, actor, id);
  const [req] = await db.select().from(handoverReviews).where(and(eq(handoverReviews.id, reviewId), eq(handoverReviews.handoverId, id), eq(handoverReviews.action, "correction_requested")));
  if (!req) throw notFound("Correction request");
  const { field, newValue, reason } = JSON.parse(req.comment ?? "{}") as { field: string; newValue: string; reason: string };
  await db.transaction(async (tx) => {
    if (approve) {
      const checklist = { ...h.checklist, [field]: newValue };
      await tx.update(handoverRecords).set({ checklist, completeness: handoverCompleteness(checklist), updatedAt: new Date() }).where(eq(handoverRecords.id, id));
      await audit(tx, actor, "handover.correction_applied", "handover", id, { [field]: { from: h.checklist[field] ?? null, to: newValue } }, reason);
    } else {
      await audit(tx, actor, "handover.correction_declined", "handover", id, null, reason);
    }
    await tx.insert(handoverReviews).values({ handoverId: id, action: approve ? "correction_applied" : "correction_declined", actorId: actor.id, comment: `${fieldLabel(field)}: ${newValue}` });
    const pending = await tx.select({ n: sql<number>`count(*)::int` }).from(handoverReviews)
      .where(and(eq(handoverReviews.handoverId, id), inArray(handoverReviews.action, ["correction_requested"])));
    const resolved = await tx.select({ n: sql<number>`count(*)::int` }).from(handoverReviews)
      .where(and(eq(handoverReviews.handoverId, id), inArray(handoverReviews.action, ["correction_applied", "correction_declined"])));
    await tx.update(handoverRecords).set({ correctionRequested: pending[0].n > resolved[0].n }).where(eq(handoverRecords.id, id));
  });
  const [p] = h.onboardingProjectId ? await db.select({ ownerId: onboardingProjects.ownerId }).from(onboardingProjects).where(eq(onboardingProjects.id, h.onboardingProjectId)) : [];
  await notifyUsers(db, [deal.ownerId, p?.ownerId], { kind: "handover", title: `Handover correction ${approve ? "applied" : "declined"}: ${deal.name}`, body: fieldLabel(field), link: `/handovers/${id}` });
}

/** Keeps the handover status in step with onboarding progress. */
export async function syncHandoverFromProject(db: Executor, projectId: string, state: string, stage: string) {
  const status = state === "completed" ? "Complete" : ["handover_review", "kickoff_pending"].includes(stage) ? "Accepted by Onboarding" : "In Onboarding";
  await db.update(handoverRecords).set({ status, updatedAt: new Date() })
    .where(and(eq(handoverRecords.onboardingProjectId, projectId), inArray(handoverRecords.status, ["Accepted by Onboarding", "In Onboarding", "Complete"])));
}
