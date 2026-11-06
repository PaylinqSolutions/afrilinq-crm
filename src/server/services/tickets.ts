import crypto from "node:crypto";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db";
import {
  tickets, ticketMessages, ticketInternalNotes, ticketAttachments, ticketStatusHistory, ticketEscalations, escalationUpdates,
  slaEvents, slaPolicies, companies, contacts, products, users, teams, userRoles, roles, onboardingProjects, knowledgeArticles,
  articleTicketLinks, tasks, deals,
} from "@/db/schema";
import { ticketSchema } from "@/lib/schemas";
import {
  classifyPriority, allowedTicketTransitions, isOpenStatus, validateResolution, ticketStatusLabel, WAITING_STATUSES, NOT_YET_KNOWN,
  OPEN_STATUSES, type Priority,
} from "@/lib/rules/tickets";
import { addTargetMinutes, elapsedTargetMinutes, evaluateClock, computeDueDates } from "@/lib/rules/sla";
import { ticketRef } from "@/lib/format";
import { ACTIVE_ESCALATION_STATUSES, ESCALATION_RESPONSE_HOURS, escalationKindLabel, escalationTarget } from "@/lib/rules/escalations";
import { type Actor, actorRef, assertCan, can, SYSTEM_ACTOR } from "../actor";
import { audit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { parse } from "../validate";
import { notifyRoles, notifyUsers } from "../notify";
import { getSettings } from "../settings";
import { ticketScope } from "./scope";
import { emit } from "./workflows";
import { recordSystemMessage } from "./integrations";
import { paging } from "./sales";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

type Ticket = typeof tickets.$inferSelect;
type Policy = typeof slaPolicies.$inferSelect;

// ---------------------------------------------------------------------------- SLA helpers

export async function policyForCompany(db: Executor, companyId: string | null): Promise<Policy> {
  const all = await db.select().from(slaPolicies).where(eq(slaPolicies.active, true));
  let tier: string | null = null;
  if (companyId) tier = (await db.select({ tier: companies.tier }).from(companies).where(eq(companies.id, companyId)))[0]?.tier ?? null;
  const p = all.find((x) => tier && x.customerTier === tier) ?? all.find((x) => x.isDefault) ?? all[0];
  if (!p) throw new Error("No active SLA policy configured");
  return p;
}

export async function policyOf(db: Executor, t: Pick<Ticket, "slaPolicyId" | "companyId">) {
  if (t.slaPolicyId) {
    const [p] = await db.select().from(slaPolicies).where(eq(slaPolicies.id, t.slaPolicyId));
    if (p) return p;
  }
  return policyForCompany(db, t.companyId);
}

export function clocksFor(t: Ticket, policy: Policy, now = new Date()) {
  const target = policy.targets[t.priority];
  if (!target) return null;
  const cal = policy.calendar;
  const paused = t.slaPausedAt ?? null;
  return {
    target,
    firstResponse: evaluateClock("first_response", t.createdAt, t.firstResponseDueAt, t.firstRespondedAt, now, target, cal, paused),
    resolution: evaluateClock("resolution", t.createdAt, t.resolutionDueAt, t.resolvedAt, now, target, cal, paused),
  };
}

async function slaEvent(db: Executor, ticketId: string, kind: string, metric: string, details: string | null, actor: Actor | null, dedupeKey?: string) {
  const rows = await db.insert(slaEvents).values({ ticketId, kind, metric, details, actorId: actor ? actorRef(actor) : null, dedupeKey: dedupeKey ?? null })
    .onConflictDoNothing().returning({ id: slaEvents.id });
  return rows.length > 0;
}

async function history(db: Executor, t: Ticket, to: string, actor: Actor | null, reason: string | null, snapshot?: Record<string, unknown>, label?: string) {
  await db.insert(ticketStatusHistory).values({
    ticketId: t.id, fromStatus: t.status, toStatus: to, reason, snapshot: snapshot ?? null,
    changedBy: actor ? actorRef(actor) : null, changedByLabel: label ?? actor?.name ?? "Customer",
  });
}

/**
 * Applies the explicit pause policy when the status changes. Returns the ticket patch.
 * Pausing records who and why; resuming extends the due dates by the paused working time.
 * Waiting statuses that the policy does not pause are recorded as "clock continues" — never silently.
 */
async function clockTransition(db: Executor, t: Ticket, to: string, actor: Actor | null, reason: string | null, now: Date) {
  const policy = await policyOf(db, t);
  const pauses = new Set(policy.pauseStatuses);
  const target = policy.targets[t.priority];
  const patch: Partial<Ticket> = {};
  const wasPaused = !!t.slaPausedAt;
  const willPause = pauses.has(to);
  if (!wasPaused && willPause) {
    patch.slaPausedAt = now; patch.slaPausedBy = actor ? actorRef(actor) : null;
    await slaEvent(db, t.id, "paused", "clock", `${ticketStatusLabel(to)}: ${reason ?? "no reason"}`, actor);
  } else if (wasPaused && !willPause) {
    const mins = elapsedTargetMinutes(t.slaPausedAt!, now, target, policy.calendar);
    patch.slaPausedAt = null; patch.slaPausedBy = null; patch.slaPausedTotalMins = t.slaPausedTotalMins + mins;
    if (!t.firstRespondedAt && t.firstResponseDueAt) patch.firstResponseDueAt = addTargetMinutes(t.firstResponseDueAt, mins, target, policy.calendar);
    if (!t.resolvedAt && t.resolutionDueAt) patch.resolutionDueAt = addTargetMinutes(t.resolutionDueAt, mins, target, policy.calendar);
    await slaEvent(db, t.id, "resumed", "clock", `Paused for ${mins} ${target.businessHours ? "business " : ""}minute(s); due dates extended`, actor);
  }
  if ((WAITING_STATUSES as string[]).includes(to) && !willPause) {
    await slaEvent(db, t.id, "continues", "clock", `${ticketStatusLabel(to)} does not pause the SLA under policy “${policy.name}”`, actor);
  }
  return patch;
}

// ---------------------------------------------------------------------------- Create

function significantWords(s: string) {
  const stop = new Set(["the", "a", "an", "and", "or", "is", "are", "to", "of", "in", "on", "for", "not", "with", "our", "we", "it", "can't", "cannot", "unable", "when"]);
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
}

export async function findDuplicates(db: Executor, input: { companyId: string | null; productId: string | null; subject: string; requesterEmail?: string | null }, windowDays: number, excludeId?: string) {
  if (!input.companyId && !input.requesterEmail) return [];
  const since = new Date(Date.now() - windowDays * 86400000);
  const rows = await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status }).from(tickets).where(and(
    input.companyId ? eq(tickets.companyId, input.companyId) : eq(tickets.requesterEmail, input.requesterEmail!),
    input.productId ? eq(tickets.productId, input.productId) : undefined,
    gte(tickets.createdAt, since), isNull(tickets.deletedAt), excludeId ? ne(tickets.id, excludeId) : undefined,
    notInArray(tickets.status, ["closed"]),
  ));
  const w = significantWords(input.subject);
  return rows.filter((r) => {
    const o = significantWords(r.subject);
    const inter = [...w].filter((x) => o.has(x)).length;
    const union = new Set([...w, ...o]).size || 1;
    return inter / union >= 0.34;
  });
}

async function routeTicket(db: Executor, category: string, companyId: string | null) {
  const s = await getSettings(db);
  let teamName = s.ticketRouting.categoryTeam[category] ?? s.ticketRouting.defaultTeam;
  if (companyId) {
    const [c] = await db.select({ tier: companies.tier }).from(companies).where(eq(companies.id, companyId));
    if (c && s.ticketRouting.tierTeam[c.tier]) teamName = s.ticketRouting.tierTeam[c.tier];
  }
  const [team] = await db.select().from(teams).where(eq(teams.name, teamName));
  if (!team || !s.ticketRouting.autoAssign) return { teamId: team?.id ?? null, ownerId: null, rule: team ? `category → ${teamName}` : "no matching team" };
  const agents = await db.selectDistinct({ id: users.id }).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.teamId, team.id), eq(users.active, true), eq(roles.key, "support_agent")));
  if (!agents.length) return { teamId: team.id, ownerId: null, rule: `category → ${teamName} (no agents available)` };
  const loads = await db.select({ ownerId: tickets.ownerId, n: count() }).from(tickets)
    .where(and(inArray(tickets.ownerId, agents.map((a) => a.id)), inArray(tickets.status, OPEN_STATUSES))).groupBy(tickets.ownerId);
  const load = new Map(loads.map((l) => [l.ownerId, l.n]));
  const ownerId = agents.map((a) => a.id).sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
  return { teamId: team.id, ownerId, rule: `category → ${teamName}, least-loaded agent` };
}

export async function createTicket(db: DB, actor: Actor, input: unknown, opts: { now?: Date } = {}) {
  assertCan(actor, "tickets.create");
  const v = parse(ticketSchema, input);
  const now = opts.now ?? new Date();
  const s = await getSettings(db);
  // Tickets always belong to an existing customer record: a company, a contact, or both.
  let companyId = v.companyId;
  let contactId = v.contactId;
  if (companyId) {
    const [co] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, companyId), isNull(companies.deletedAt)));
    if (!co) throw invalid("That company doesn't exist or was deleted. Pick an existing company.", { companyId: "Not found." });
    // A requester email that belongs to one of the company's contacts links that contact.
    if (!contactId && v.requesterEmail) {
      const [m] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.companyId, companyId), sql`lower(${contacts.email}) = ${v.requesterEmail}`, isNull(contacts.deletedAt)));
      contactId = m?.id ?? null;
    }
  }
  if (contactId) {
    const [c] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)));
    if (!c) throw invalid("That contact doesn't exist or was deleted. Pick an existing contact.", { contactId: "Not found." });
    if (companyId && c.companyId !== companyId) throw invalid("That contact belongs to a different company.", { contactId: "Mismatch." });
    companyId ??= c.companyId;
  }
  if (!v.ignoreDuplicates) {
    const dupes = await findDuplicates(db, { companyId, productId: v.productId, subject: v.subject, requesterEmail: v.requesterEmail }, s.duplicateWindowDays);
    if (dupes.length) {
      throw invalid(`Possible duplicate of ${dupes.map((d) => `${ticketRef(d.number)} “${d.subject}”`).join(", ")}. Review it, or tick “Not a duplicate” to create anyway.`,
        { ignoreDuplicates: "Confirm this is not a duplicate." });
    }
  }
  const priority = classifyPriority({ impact: v.impact, urgency: v.urgency, workaroundAvailable: v.workaroundAvailable, incidentType: v.incidentType });
  const route = await routeTicket(db, v.category, companyId);
  const ownerId = v.ownerId && (can(actor, "tickets.reassign") || v.ownerId === actor.id) ? v.ownerId : route.ownerId;
  const teamId = v.teamId ?? route.teamId;
  const policy = await policyForCompany(db, companyId);
  const target = policy.targets[priority];
  const due = computeDueDates(now, target, policy.calendar);
  const contact = contactId ? (await db.select().from(contacts).where(eq(contacts.id, contactId)))[0] : null;
  const requesterEmail = v.requesterEmail ?? contact?.email ?? null;

  const t = await db.transaction(async (tx) => {
    const [t] = await tx.insert(tickets).values({
      subject: v.subject, description: v.description, companyId, contactId, requesterEmail, channel: v.channel,
      productId: v.productId, category: v.category, subcategory: v.subcategory, impact: v.impact, urgency: v.urgency, priority,
      status: ownerId ? "assigned" : "new", ownerId, teamId, slaPolicyId: policy.id, ...due,
      nextUpdateDueAt: priority === "P1" || priority === "P2" ? addTargetMinutes(now, target.updateMins, target, policy.calendar) : null,
      isIncident: !!v.incidentType, incidentType: v.incidentType, affectedUsers: v.affectedUsers, affectedCustomers: v.affectedCustomers,
      businessImpact: v.businessImpact, workaroundAvailable: v.workaroundAvailable, workaround: v.workaround,
      onboardingProjectId: v.onboardingProjectId, dealId: v.dealId, portalToken: crypto.randomBytes(18).toString("base64url"),
      createdBy: actorRef(actor), createdAt: now, updatedAt: now,
    }).returning();
    await tx.insert(ticketStatusHistory).values({ ticketId: t.id, fromStatus: null, toStatus: t.status, reason: `Created via ${v.channel}; routing: ${route.rule}`, changedBy: actorRef(actor), changedByLabel: actor.name, createdAt: now });
    await slaEvent(tx, t.id, "started", "clock", `Policy “${policy.name}”, ${priority}: first response by ${due.firstResponseDueAt.toISOString()}, resolution by ${due.resolutionDueAt.toISOString()}${target.businessHours ? " (business hours)" : " (24×7)"}`, actor);
    const ack = `Thank you — we have received your request ${ticketRef(t.number)} (“${t.subject}”). It has been logged as ${priority}. A member of the support team will respond shortly.`;
    const delivery = requesterEmail ? await recordSystemMessage(tx as unknown as DB, { channel: "email", to: requesterEmail, subject: `[${ticketRef(t.number)}] ${t.subject}`, body: ack, relatedType: "ticket", relatedId: t.id }) : "recorded";
    await tx.insert(ticketMessages).values({ ticketId: t.id, authorName: "Afrilinq Support (automated)", body: ack, isAutomated: true, deliveryStatus: delivery, createdAt: now });
    if (policy.automatedAckCountsAsResponse) await tx.update(tickets).set({ firstRespondedAt: now }).where(eq(tickets.id, t.id));
    await audit(tx, actor, "ticket.created", "ticket", t.id, { priority: { from: null, to: priority }, status: { from: null, to: t.status } });
    return t;
  });

  if (t.isIncident) await openIncident(db, actor, t);
  if (ownerId) await notifyUsers(db, [ownerId], { kind: "ticket", title: `${priority} ticket assigned: ${ticketRef(t.number)} ${t.subject}`, link: `/tickets/${t.id}` });
  await emit(db, "ticket.created", {
    entityId: t.id, relatedType: "ticket", priority, ownerId, teamId, companyId, subject: t.subject, number: ticketRef(t.number), link: `/tickets/${t.id}`,
  });
  return t;
}

/** Incident workflow for P1 security / data / outage events: immediate authorised notification and a tracked incident. */
async function openIncident(db: DB, actor: Actor, t: Ticket) {
  const [existing] = await db.select({ id: ticketEscalations.id }).from(ticketEscalations).where(and(eq(ticketEscalations.ticketId, t.id), eq(ticketEscalations.kind, "incident")));
  if (existing) return;
  await db.insert(ticketEscalations).values({
    ticketId: t.id, kind: "incident", severity: "P1", status: "approved", reason: `Incident type: ${t.incidentType}`, customerImpact: t.businessImpact, createdBy: actorRef(actor),
  });
  await db.update(tickets).set({ escalationLevel: 3 }).where(eq(tickets.id, t.id));
  await notifyRoles(db, ["support_lead", "executive", "super_admin"], {
    kind: "incident", title: `INCIDENT (${t.incidentType}) — ${ticketRef(t.number)} ${t.subject}`, body: t.businessImpact ?? undefined,
    link: `/tickets/${t.id}`, dedupeKey: `incident:${t.id}`,
  });
  await audit(db, actor, "ticket.incident_opened", "ticket", t.id, null, t.incidentType);
}

// ---------------------------------------------------------------------------- Read

export type TicketFilters = {
  queue?: string; priority?: string; status?: string; owner?: string; team?: string; product?: string; company?: string;
  sla?: string; q?: string; page?: string; sort?: string; segment?: string;
};

export const QUEUES: { key: string; label: string }[] = [
  { key: "all_open", label: "All open" }, { key: "unassigned", label: "Unassigned" }, { key: "mine", label: "My tickets" },
  { key: "team", label: "Team queue" }, { key: "p1p2", label: "P1 / P2" }, { key: "sla_risk", label: "SLA at risk" },
  { key: "overdue", label: "Overdue / breached" }, { key: "waiting_customer", label: "Waiting on customer" },
  { key: "waiting_engineering", label: "Waiting on engineering" }, { key: "reopened", label: "Reopened" },
  { key: "recent_resolved", label: "Recently resolved" },
];

export async function listTickets(db: DB, actor: Actor, f: TicketFilters) {
  const conds: (SQL | undefined)[] = [isNull(tickets.deletedAt), ticketScope(db, actor)];
  const q = f.queue ?? "all_open";
  const open = inArray(tickets.status, OPEN_STATUSES);
  if (q === "recent_resolved") conds.push(and(inArray(tickets.status, ["resolved", "closed"]), gte(tickets.resolvedAt, new Date(Date.now() - 7 * 86400000))));
  else if (q !== "any") conds.push(f.status ? undefined : open);
  if (q === "unassigned") conds.push(isNull(tickets.ownerId));
  if (q === "mine") conds.push(eq(tickets.ownerId, actor.id));
  if (q === "team") conds.push(actor.teamId ? eq(tickets.teamId, actor.teamId) : sql`false`);
  if (q === "p1p2") conds.push(inArray(tickets.priority, ["P1", "P2"]));
  if (q === "waiting_customer") conds.push(eq(tickets.status, "waiting_on_customer"));
  if (q === "waiting_engineering") conds.push(eq(tickets.status, "waiting_on_engineering"));
  if (q === "reopened") conds.push(or(eq(tickets.status, "reopened"), sql`${tickets.reopenCount} > 0`));
  if (f.priority) conds.push(eq(tickets.priority, f.priority));
  if (f.status) conds.push(eq(tickets.status, f.status));
  if (f.owner) conds.push(f.owner === "me" ? eq(tickets.ownerId, actor.id) : eq(tickets.ownerId, f.owner));
  if (f.team) conds.push(eq(tickets.teamId, f.team));
  if (f.product) conds.push(eq(tickets.productId, f.product));
  if (f.company) conds.push(eq(tickets.companyId, f.company));
  if (f.segment) conds.push(eq(companies.segment, f.segment));
  if (f.q) conds.push(or(ilike(tickets.subject, `%${f.q}%`), sql`('AFL-' || ${tickets.number}) ilike ${`%${f.q}%`}`, ilike(companies.name, `%${f.q}%`)));
  const order = { priority: asc(tickets.priority), created: desc(tickets.createdAt), oldest: asc(tickets.createdAt), due: asc(tickets.resolutionDueAt), updated: desc(tickets.updatedAt) }[f.sort ?? "priority"] ?? asc(tickets.priority);
  const rows = await db.select({
    t: tickets, companyName: companies.name, ownerName: users.name, productName: products.name, teamName: teams.name, tier: companies.tier,
  }).from(tickets).leftJoin(companies, eq(companies.id, tickets.companyId)).leftJoin(users, eq(users.id, tickets.ownerId))
    .leftJoin(products, eq(products.id, tickets.productId)).leftJoin(teams, eq(teams.id, tickets.teamId))
    .where(and(...conds)).orderBy(order, asc(tickets.resolutionDueAt)).limit(1000);
  const policies = await db.select().from(slaPolicies);
  const now = new Date();
  let out = rows.map((r) => {
    const policy = policies.find((p) => p.id === r.t.slaPolicyId) ?? policies.find((p) => p.isDefault)!;
    const clocks = clocksFor(r.t, policy, now);
    const worst = clocks ? [clocks.firstResponse, clocks.resolution].filter((c) => !c.completedAt || c.state === "breached")
      .sort((a, b) => rank(b.state) - rank(a.state))[0] ?? clocks.resolution : null;
    return { ...r, clocks, sla: worst };
  });
  if (q === "sla_risk" || f.sla === "risk") out = out.filter((r) => r.sla && ["warning", "escalate"].includes(r.sla.state));
  if (q === "overdue" || f.sla === "breached") out = out.filter((r) => r.sla?.state === "breached" || r.t.firstResponseBreached || r.t.resolutionBreached);
  const { limit, offset } = paging(f.page);
  return { rows: out.slice(offset, offset + limit), total: out.length, all: out };
}

const rank = (s: string) => ({ breached: 5, escalate: 4, warning: 3, paused: 2, ok: 1, met: 0 })[s] ?? 0;

export async function getTicket(db: Executor, actor: Actor, id: string) {
  const [t] = await db.select().from(tickets).where(and(eq(tickets.id, id), isNull(tickets.deletedAt), ticketScope(db, actor)));
  if (!t) throw notFound("Ticket");
  return t;
}

export async function getTicketDetail(db: DB, actor: Actor, id: string) {
  const t = await getTicket(db, actor, id);
  const policy = await policyOf(db, t);
  const canNotes = can(actor, "tickets.notes");
  const [company] = t.companyId ? await db.select().from(companies).where(eq(companies.id, t.companyId)) : [];
  const [contact] = t.contactId ? await db.select().from(contacts).where(eq(contacts.id, t.contactId)) : [];
  const [product] = t.productId ? await db.select().from(products).where(eq(products.id, t.productId)) : [];
  const [owner] = t.ownerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, t.ownerId)) : [];
  const [team] = t.teamId ? await db.select().from(teams).where(eq(teams.id, t.teamId)) : [];
  const messages = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, id)).orderBy(asc(ticketMessages.createdAt));
  const notes = canNotes
    ? await db.select({ id: ticketInternalNotes.id, body: ticketInternalNotes.body, createdAt: ticketInternalNotes.createdAt, author: users.name })
        .from(ticketInternalNotes).innerJoin(users, eq(users.id, ticketInternalNotes.authorUserId)).where(eq(ticketInternalNotes.ticketId, id)).orderBy(asc(ticketInternalNotes.createdAt))
    : null;
  const attachments = (await db.select().from(ticketAttachments).where(eq(ticketAttachments.ticketId, id)))
    .filter((a) => a.visibility === "public" || canNotes);
  const statusHistory = await db.select().from(ticketStatusHistory).where(eq(ticketStatusHistory.ticketId, id)).orderBy(desc(ticketStatusHistory.createdAt));
  const events = await db.select().from(slaEvents).where(eq(slaEvents.ticketId, id)).orderBy(desc(slaEvents.createdAt));
  const escRows = await db.select().from(ticketEscalations).where(eq(ticketEscalations.ticketId, id)).orderBy(desc(ticketEscalations.createdAt));
  const nameIds = [...new Set(escRows.flatMap((e) => [e.assignedToId, e.createdBy, e.resolvedBy, e.acceptedBy, e.confirmedBy]).filter(Boolean))] as string[];
  const names = new Map((nameIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, nameIds)) : []).map((u) => [u.id, u.name]));
  const teamNames = new Map((await db.select({ id: teams.id, name: teams.name }).from(teams)).map((x) => [x.id, x.name]));
  const escalations = escRows.map((e) => ({
    ...e, can: escalationPermissions(actor, e, t), assigneeName: e.assignedToId ? names.get(e.assignedToId) ?? null : null, teamName: e.assignedTeamId ? teamNames.get(e.assignedTeamId) ?? null : e.requestedTeamId ? teamNames.get(e.requestedTeamId) ?? null : null,
    raisedByName: e.createdBy ? names.get(e.createdBy) ?? null : null, resolvedByName: e.resolvedBy ? names.get(e.resolvedBy) ?? null : null, confirmedByName: e.confirmedBy ? names.get(e.confirmedBy) ?? null : null,
  }));
  // Escalation threads are internal: visible to support staff with notes access and to everyone taking part in that escalation.
  const visibleEsc = escalations.filter((e) => canNotes || e.can.update || e.can.confirm || e.can.reopen).map((e) => e.id);
  const escUpdates = visibleEsc.length
    ? await db.select({ id: escalationUpdates.id, escalationId: escalationUpdates.escalationId, body: escalationUpdates.body, createdAt: escalationUpdates.createdAt, author: users.name })
        .from(escalationUpdates).innerJoin(users, eq(users.id, escalationUpdates.authorId)).where(inArray(escalationUpdates.escalationId, visibleEsc)).orderBy(asc(escalationUpdates.createdAt))
    : [];
  const related = t.companyId
    ? await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status, priority: tickets.priority, createdAt: tickets.createdAt })
        .from(tickets).where(and(eq(tickets.companyId, t.companyId), ne(tickets.id, id), isNull(tickets.deletedAt), ticketScope(db, actor))).orderBy(desc(tickets.createdAt)).limit(8)
    : [];
  const onboarding = t.companyId
    ? await db.select({ id: onboardingProjects.id, name: onboardingProjects.name, stage: onboardingProjects.stage, state: onboardingProjects.state, riskLevel: onboardingProjects.riskLevel, targetGoLive: onboardingProjects.targetGoLive })
        .from(onboardingProjects).where(eq(onboardingProjects.companyId, t.companyId)).orderBy(desc(onboardingProjects.createdAt)).limit(3)
    : [];
  const linkedArticles = await db.select({ id: knowledgeArticles.id, title: knowledgeArticles.title, audience: knowledgeArticles.audience })
    .from(articleTicketLinks).innerJoin(knowledgeArticles, eq(knowledgeArticles.id, articleTicketLinks.articleId)).where(eq(articleTicketLinks.ticketId, id));
  const suggested = await suggestArticles(db, actor, t);
  const dupes = await findDuplicates(db, { companyId: t.companyId, productId: t.productId, subject: t.subject, requesterEmail: t.requesterEmail }, 30, t.id);
  const isEngineerOnly = can(actor, "tickets.view_escalated") && !can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned");
  return {
    t, policy, clocks: clocksFor(t, policy), company, contact, product, owner, team, messages, notes, attachments, statusHistory, events,
    escalations, escUpdates, related, onboarding, linkedArticles, suggested, duplicates: dupes,
    perms: {
      edit: can(actor, "tickets.edit") && !isEngineerOnly, reply: can(actor, "tickets.reply"), notes: canNotes,
      reassign: can(actor, "tickets.reassign"), override: can(actor, "tickets.priority_override"), escalate: can(actor, "tickets.escalate"),
      approve: can(actor, "tickets.approve_escalation"), engineering: can(actor, "engineering.update"),
    },
    transitions: allowedTicketTransitions(t.status),
  };
}

async function suggestArticles(db: DB, actor: Actor, t: Ticket) {
  const words = [...significantWords(`${t.subject} ${t.category}`)].slice(0, 6);
  if (!words.length) return [];
  const audience = can(actor, "kb.view_internal") ? undefined : eq(knowledgeArticles.audience, "customer");
  const rows = await db.select({ id: knowledgeArticles.id, title: knowledgeArticles.title, summary: knowledgeArticles.summary, audience: knowledgeArticles.audience, tags: knowledgeArticles.tags, productId: knowledgeArticles.productId, category: knowledgeArticles.category })
    .from(knowledgeArticles).where(and(eq(knowledgeArticles.status, "published"), audience, or(...words.map((w) => or(ilike(knowledgeArticles.title, `%${w}%`), ilike(knowledgeArticles.summary, `%${w}%`), sql`${knowledgeArticles.tags}::text ilike ${`%${w}%`}`)))));
  return rows.map((r) => ({ ...r, score: (r.productId === t.productId ? 2 : 0) + words.filter((w) => `${r.title} ${r.summary} ${r.tags.join(" ")}`.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score).slice(0, 4);
}

// ---------------------------------------------------------------------------- Update

function assertEditable(actor: Actor, t: Ticket) {
  assertCan(actor, "tickets.edit");
  if (can(actor, "tickets.view_escalated") && !can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned"))
    throw forbidden("Engineering can add updates to escalations but cannot change ticket outcomes.");
  void t;
}

async function recalcDue(db: Executor, t: Ticket, priority: Priority) {
  const policy = await policyOf(db, t);
  const target = policy.targets[priority];
  const due = computeDueDates(t.createdAt, target, policy.calendar);
  const extend = (d: Date) => addTargetMinutes(d, t.slaPausedTotalMins, target, policy.calendar);
  return {
    firstResponseDueAt: t.firstRespondedAt ? t.firstResponseDueAt : extend(due.firstResponseDueAt),
    resolutionDueAt: t.resolvedAt ? t.resolutionDueAt : extend(due.resolutionDueAt),
  };
}

export async function updateTriage(db: DB, actor: Actor, id: string, input: {
  category: string; subcategory: string | null; impact: string; urgency: string; productId: string | null; workaroundAvailable: boolean;
  workaround: string | null; affectedUsers: number | null; businessImpact: string | null; incidentType: string | null;
}, expected?: Version) {
  const t = await getTicket(db, actor, id);
  assertEditable(actor, t);
  await assertFresh(db, actor, "ticket", id, t.updatedAt, expected, "ticket");
  if (!isOpenStatus(t.status)) throw conflict("Reopen the ticket before changing triage.");
  if (!input.category || !input.impact || !input.urgency) throw invalid("Category, impact and urgency are required.");
  const calculated = classifyPriority(input);
  const priority = t.priorityOverridden && !input.incidentType ? (t.priority as Priority) : calculated;
  const patch: Partial<Ticket> = {
    ...input, priority, isIncident: !!input.incidentType || t.isIncident, incidentType: input.incidentType ?? t.incidentType, updatedAt: new Date(),
    ...(priority !== t.priority ? await recalcDue(db, t, priority) : {}),
    ...(t.status === "new" ? { status: "triaged" } : {}),
  };
  assertUpdated(await db.update(tickets).set(patch).where(and(eq(tickets.id, id), sameVersion(tickets.updatedAt, t.updatedAt))).returning({ id: tickets.id }), "ticket");
  if (t.status === "new") await history(db, t, "triaged", actor, "Triage completed");
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of ["category", "impact", "urgency", "priority", "productId"] as const) if (t[k] !== patch[k]) changes[k] = { from: t[k], to: patch[k] };
  await audit(db, actor, "ticket.triaged", "ticket", id, changes);
  if (priority !== t.priority) await slaEvent(db, id, "recalculated", "clock", `Priority ${t.priority} → ${priority}; due dates recalculated`, actor);
  if (patch.isIncident && !t.isIncident) await openIncident(db, actor, { ...t, ...patch } as Ticket);
}

export async function overridePriority(db: DB, actor: Actor, id: string, priority: Priority, reason: string, expected?: Version) {
  assertCan(actor, "tickets.priority_override");
  const t = await getTicket(db, actor, id);
  await assertFresh(db, actor, "ticket", id, t.updatedAt, expected, "ticket");
  if (!["P1", "P2", "P3", "P4"].includes(priority)) throw invalid("Unknown priority.");
  if (!reason?.trim() || reason.trim().length < 10) throw invalid("Explain the override.", { reason: "At least 10 characters." });
  if (t.isIncident && priority !== "P1") throw conflict("Incidents stay P1 until the incident is closed.");
  assertUpdated(await db.update(tickets).set({ priority, priorityOverridden: true, ...(await recalcDue(db, t, priority)), updatedAt: new Date() }).where(and(eq(tickets.id, id), sameVersion(tickets.updatedAt, t.updatedAt))).returning({ id: tickets.id }), "ticket");
  await audit(db, actor, "ticket.priority_overridden", "ticket", id, { priority: { from: t.priority, to: priority } }, reason);
  await slaEvent(db, id, "recalculated", "clock", `Priority manually overridden ${t.priority} → ${priority}: ${reason}`, actor);
}

export async function assignTicket(db: DB, actor: Actor, id: string, ownerId: string | null, teamId: string | null, expected?: Version) {
  const t = await getTicket(db, actor, id);
  assertEditable(actor, t);
  await assertFresh(db, actor, "ticket", id, t.updatedAt, expected, "ticket");
  const selfAssign = ownerId === actor.id && (!t.ownerId || t.ownerId === actor.id) && (!teamId || teamId === t.teamId);
  if (!can(actor, "tickets.reassign") && !selfAssign) throw forbidden("Only a support lead can reassign tickets. You can take unassigned tickets yourself.");
  const status = ownerId && ["new", "triaged"].includes(t.status) ? "assigned" : t.status;
  assertUpdated(await db.update(tickets).set({ ownerId, teamId: teamId ?? t.teamId, status, updatedAt: new Date() }).where(and(eq(tickets.id, id), sameVersion(tickets.updatedAt, t.updatedAt))).returning({ id: tickets.id }), "ticket");
  if (status !== t.status) await history(db, t, status, actor, "Assigned");
  await audit(db, actor, "ticket.assigned", "ticket", id, { ownerId: { from: t.ownerId, to: ownerId }, teamId: { from: t.teamId, to: teamId ?? t.teamId } });
  if (ownerId && ownerId !== actor.id) await notifyUsers(db, [ownerId], { kind: "ticket", title: `Ticket assigned to you: ${ticketRef(t.number)} ${t.subject}`, link: `/tickets/${id}` });
}

export async function changeTicketStatus(db: DB, actor: Actor, id: string, to: string, input: { reason?: string | null; waitingReason?: string | null; followUpAt?: Date | null; expected?: Version } = {}) {
  const t = await getTicket(db, actor, id);
  assertEditable(actor, t);
  await assertFresh(db, actor, "ticket", id, t.updatedAt, input.expected, "ticket");
  if (to === "resolved") throw conflict("Use “Resolve” to record the resolution.");
  if (to === "reopened") throw conflict("Use “Reopen” so the previous resolution is preserved.");
  if (to === "closed") return closeTicket(db, actor, id, input.reason ?? null);
  if (!allowedTicketTransitions(t.status).includes(to as never)) throw conflict(`Cannot move from ${ticketStatusLabel(t.status)} to ${ticketStatusLabel(to)}.`);
  const waiting = (WAITING_STATUSES as string[]).includes(to);
  if (waiting && !input.waitingReason?.trim()) throw invalid("Record what you are waiting for.", { waitingReason: "Required for waiting statuses." });
  if (to === "waiting_on_customer" && !input.followUpAt) throw invalid("Set the next follow-up date.", { followUpAt: "Required when waiting on the customer." });
  const now = new Date();
  const clock = await clockTransition(db, t, to, actor, input.waitingReason ?? input.reason ?? null, now);
  await db.update(tickets).set({
    status: to, waitingReason: waiting ? input.waitingReason : null, waitingFollowUpAt: to === "waiting_on_customer" ? input.followUpAt : null, ...clock, updatedAt: now,
  }).where(and(eq(tickets.id, id), sameVersion(tickets.updatedAt, t.updatedAt))).returning({ id: tickets.id }).then((r) => assertUpdated(r, "ticket"));
  await history(db, t, to, actor, input.waitingReason ?? input.reason ?? null);
  await audit(db, actor, "ticket.status_changed", "ticket", id, { status: { from: t.status, to } }, input.waitingReason ?? input.reason ?? null);
  if (to === "waiting_on_customer" && input.followUpAt && t.ownerId) {
    await db.insert(tasks).values({ title: `Follow up with customer on ${ticketRef(t.number)}`, description: input.waitingReason, ownerId: t.ownerId, dueAt: input.followUpAt, relatedType: "ticket", relatedId: id, companyId: t.companyId, priority: "normal", dedupeKey: `ticket-followup:${id}:${input.followUpAt.toISOString()}` }).onConflictDoNothing();
  }
}

export async function replyToTicket(db: DB, actor: Actor, id: string, body: string) {
  assertCan(actor, "tickets.reply");
  const t = await getTicket(db, actor, id);
  if (!body?.trim()) throw invalid("Write a reply.", { body: "Required." });
  const policy = await policyOf(db, t);
  const target = policy.targets[t.priority];
  const now = new Date();
  const delivery = t.requesterEmail
    ? await recordSystemMessage(db, { channel: "email", to: t.requesterEmail, subject: `Re: [${ticketRef(t.number)}] ${t.subject}`, body, relatedType: "ticket", relatedId: id })
    : "recorded";
  await db.insert(ticketMessages).values({ ticketId: id, authorUserId: actor.id, authorName: actor.name, body: body.trim(), deliveryStatus: delivery });
  const patch: Partial<Ticket> = { lastPublicUpdateAt: now, updatedAt: now };
  if (t.priority === "P1" || t.priority === "P2") patch.nextUpdateDueAt = addTargetMinutes(now, target.updateMins, target, policy.calendar);
  if (!t.firstRespondedAt) {
    patch.firstRespondedAt = now;
    const met = !t.firstResponseDueAt || now <= t.firstResponseDueAt;
    if (!met) patch.firstResponseBreached = true;
    await slaEvent(db, id, met ? "met" : "breached", "first_response", `First human response by ${actor.name}`, actor, `${id}:first_response:${met ? "met" : "late"}`);
  }
  if (t.status === "new" || t.status === "triaged" || t.status === "assigned") {
    patch.status = "in_progress";
    if (!t.ownerId) patch.ownerId = actor.id;
    await history(db, t, "in_progress", actor, "Agent replied");
  }
  await db.update(tickets).set(patch).where(eq(tickets.id, id));
  return { delivery };
}

export async function addInternalNote(db: DB, actor: Actor, id: string, body: string) {
  assertCan(actor, "tickets.notes");
  await getTicket(db, actor, id);
  if (!body?.trim()) throw invalid("Write a note.", { body: "Required." });
  await db.insert(ticketInternalNotes).values({ ticketId: id, authorUserId: actor.id, body: body.trim() });
  await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, id));
}

export async function resolveTicket(db: DB, actor: Actor, id: string, input: {
  resolutionSummary: string | null; resolutionCode: string | null; rootCause: string | null; rootCauseFollowUpOwnerId: string | null;
  workaround?: string | null; incidentEvidence?: string | null; expected?: Version;
}) {
  const t = await getTicket(db, actor, id);
  assertEditable(actor, t);
  await assertFresh(db, actor, "ticket", id, t.updatedAt, input.expected, "ticket");
  if (!isOpenStatus(t.status)) throw conflict("Only open tickets can be resolved.");
  const errs = validateResolution({ ...input, priority: t.priority, isIncident: t.isIncident });
  if (t.isIncident) {
    if (!can(actor, "tickets.approve_escalation")) errs.incidentEvidence = "Incidents must be confirmed fixed by a Support Lead or authorised confirmer.";
    else if (!input.incidentEvidence?.trim() || input.incidentEvidence.trim().length < 10) errs.incidentEvidence = "Record the evidence that the incident is contained/fixed.";
  }
  if (Object.keys(errs).length) throw invalid("This ticket can't be resolved yet.", errs);
  const now = new Date();
  const clock = await clockTransition(db, t, "resolved", actor, "Resolved", now);
  const met = !t.resolutionDueAt || now <= t.resolutionDueAt;
  await db.update(tickets).set({
    status: "resolved", resolvedAt: now, resolvedBy: actor.id, resolutionSummary: input.resolutionSummary, resolutionCode: input.resolutionCode,
    rootCause: input.rootCause, rootCauseFollowUpOwnerId: input.rootCause === NOT_YET_KNOWN ? input.rootCauseFollowUpOwnerId : null,
    workaround: input.workaround ?? t.workaround, incidentConfirmedBy: t.isIncident ? actor.id : null, resolutionBreached: t.resolutionBreached || !met,
    waitingReason: null, waitingFollowUpAt: null, ...clock, updatedAt: now,
  }).where(and(eq(tickets.id, id), sameVersion(tickets.updatedAt, t.updatedAt))).returning({ id: tickets.id }).then((r) => assertUpdated(r, "ticket"));
  await history(db, t, "resolved", actor, input.resolutionCode, { resolutionSummary: input.resolutionSummary, rootCause: input.rootCause, incidentEvidence: input.incidentEvidence ?? null });
  await slaEvent(db, id, met ? "met" : "breached", "resolution", `Resolved by ${actor.name}`, actor, `${id}:resolution:${t.reopenCount}:${met ? "met" : "late"}`);
  await db.insert(ticketMessages).values({ ticketId: id, authorUserId: actor.id, authorName: actor.name, body: `We believe this is resolved:\n\n${input.resolutionSummary}\n\nIf the issue persists, reply or use your ticket link to reopen it.` });
  await audit(db, actor, "ticket.resolved", "ticket", id, { status: { from: t.status, to: "resolved" } }, input.resolutionCode);
  if (input.rootCause === NOT_YET_KNOWN && input.rootCauseFollowUpOwnerId) {
    await db.insert(tasks).values({ title: `Root cause follow-up: ${ticketRef(t.number)}`, ownerId: input.rootCauseFollowUpOwnerId, dueAt: new Date(now.getTime() + 5 * 86400000), priority: "high", relatedType: "ticket", relatedId: id, companyId: t.companyId, dedupeKey: `rootcause:${id}:${t.reopenCount}` }).onConflictDoNothing();
  }
  if (t.isIncident) await db.update(ticketEscalations).set({ status: "resolved", updatedAt: now }).where(and(eq(ticketEscalations.ticketId, id), eq(ticketEscalations.kind, "incident")));
  await emit(db, "ticket.resolved", { entityId: id, dedupe: `${id}:${t.reopenCount}`, relatedType: "ticket", ownerId: t.ownerId ?? actor.id, companyId: t.companyId, number: ticketRef(t.number), subject: t.subject, priority: t.priority, link: `/tickets/${id}` });
}

export async function closeTicket(db: DB, actor: Actor, id: string, reason: string | null, viaPortal = false) {
  const t = viaPortal ? (await db.select().from(tickets).where(eq(tickets.id, id)))[0] : await getTicket(db, actor, id);
  if (!viaPortal) assertEditable(actor, t);
  if (t.status !== "resolved" && !(t.status === "waiting_on_customer" && reason))
    throw conflict("Close a ticket from Resolved, or from Waiting on Customer with a reason (e.g. no response).");
  if (t.status === "waiting_on_customer" && !t.resolutionSummary) throw conflict("Resolve the ticket first, recording the outcome, then close it.");
  const now = new Date();
  await db.update(tickets).set({ status: "closed", closedAt: now, slaPausedAt: null, updatedAt: now }).where(eq(tickets.id, id));
  await history(db, t, "closed", viaPortal ? null : actor, reason ?? (viaPortal ? "Customer confirmed resolution" : "Closed"), undefined, viaPortal ? "Customer" : undefined);
  await audit(db, actor, "ticket.closed", "ticket", id, { status: { from: t.status, to: "closed" } }, reason);
  const s = await getSettings(db);
  if (s.csatOnClose && t.requesterEmail && !t.csatScore) {
    await recordSystemMessage(db, { channel: "email", to: t.requesterEmail, subject: `How did we do on ${ticketRef(t.number)}?`, body: "Please rate your support experience using your ticket link.", relatedType: "ticket", relatedId: id });
  }
  if ((t.priority === "P1" || t.priority === "P2" || t.isIncident) && t.ownerId) {
    await db.insert(tasks).values({ title: `Post-incident review: ${ticketRef(t.number)}`, ownerId: t.ownerId, dueAt: new Date(now.getTime() + 3 * 86400000), priority: "high", relatedType: "ticket", relatedId: id, companyId: t.companyId, dedupeKey: `pir:${id}:${t.reopenCount}` }).onConflictDoNothing();
  }
  await emit(db, "ticket.closed", { entityId: id, dedupe: `${id}:${t.reopenCount}`, ownerId: t.ownerId, priority: t.priority, link: `/tickets/${id}` });
}

/** Reopens while preserving the previous resolution in status history. */
export async function reopenTicket(db: DB, actor: Actor | null, id: string, reason: string) {
  const t = actor ? await getTicket(db, actor, id) : (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
  if (actor) assertEditable(actor, t);
  if (!["resolved", "closed"].includes(t.status)) throw conflict("Only resolved or closed tickets can be reopened.");
  if (!reason?.trim()) throw invalid("Say why the ticket is being reopened.", { reason: "Required." });
  const policy = await policyOf(db, t);
  const target = policy.targets[t.priority];
  const now = new Date();
  const snapshot = {
    previousResolution: { resolutionSummary: t.resolutionSummary, resolutionCode: t.resolutionCode, rootCause: t.rootCause, resolvedAt: t.resolvedAt, resolvedBy: t.resolvedBy, closedAt: t.closedAt },
  };
  await db.update(tickets).set({
    status: "reopened", reopenCount: t.reopenCount + 1, resolvedAt: null, resolvedBy: null, closedAt: null, resolutionSummary: null, resolutionCode: null,
    resolutionDueAt: addTargetMinutes(now, target.resolutionMins, target, policy.calendar), incidentConfirmedBy: null, updatedAt: now,
  }).where(eq(tickets.id, id));
  await history(db, t, "reopened", actor, reason, snapshot, actor ? undefined : "Customer");
  await slaEvent(db, id, "recalculated", "resolution", `Reopened: new resolution target from reopen time`, actor);
  await audit(db, actor ?? SYSTEM_ACTOR, "ticket.reopened", "ticket", id, { status: { from: t.status, to: "reopened" } }, reason);
  if (t.isIncident) await db.update(ticketEscalations).set({ status: "approved" }).where(and(eq(ticketEscalations.ticketId, id), eq(ticketEscalations.kind, "incident")));
  await notifyUsers(db, [t.ownerId], { kind: "ticket", title: `Ticket reopened: ${ticketRef(t.number)}`, body: reason, link: `/tickets/${id}` });
}

// ---------------------------------------------------------------------------- Escalation

export type EscalationInput = {
  kind: string; severity: string; reason: string | null; requestedTeamId: string | null; assignedToId?: string | null; reproductionSteps: string | null; expectedResult: string | null;
  actualResult: string | null; environment: string | null; evidence: string | null; customerImpact: string | null; workaround: string | null;
  businessConsequence: string | null;
};
type Esc = typeof ticketEscalations.$inferSelect;

async function escalationNote(db: Executor, escId: string, actor: Actor, body: string) {
  await db.insert(escalationUpdates).values({ escalationId: escId, authorId: actor.id, body });
}
/** People who should hear about an escalation: the assignee, or the whole assigned team. */
async function escalationRecipients(db: Executor, esc: Esc) {
  if (esc.assignedToId) return [esc.assignedToId];
  if (esc.assignedTeamId) return (await db.select({ id: users.id }).from(users).where(and(eq(users.teamId, esc.assignedTeamId), eq(users.active, true)))).map((u) => u.id);
  return [];
}
/** Who may act on an escalation as the receiving side. */
function isReceiver(actor: Actor, esc: Esc) {
  return can(actor, "tickets.approve_escalation") || esc.assignedToId === actor.id || (!!esc.assignedTeamId && esc.assignedTeamId === actor.teamId)
    || (esc.kind === "management" && can(actor, "reports.executive"));
}
/** Who may act as the raising side (confirm, reopen, withdraw). */
function isRequester(actor: Actor, esc: Esc, t: Ticket) {
  return can(actor, "tickets.approve_escalation") || esc.createdBy === actor.id || t.ownerId === actor.id;
}
async function loadEscalation(db: DB, actor: Actor, escId: string) {
  const [esc] = await db.select().from(ticketEscalations).where(eq(ticketEscalations.id, escId));
  if (!esc) throw notFound("Escalation");
  const t = await getTicket(db, actor, esc.ticketId);
  return { esc, t };
}

/** Raise an escalation to engineering, a support colleague, the Support Lead, Sales, Onboarding or management. */
export async function escalateTicket(db: DB, actor: Actor, id: string, v: EscalationInput) {
  assertCan(actor, "tickets.escalate");
  const t = await getTicket(db, actor, id);
  if (!isOpenStatus(t.status)) throw conflict("Only open tickets can be escalated.");
  const target = escalationTarget(v.kind);
  if (!target) throw invalid("Choose who to escalate to.", { kind: "Required." });
  if (!v.reason?.trim()) throw invalid("Explain why you are escalating.", { reason: "Required." });
  if (!["P1", "P2", "P3", "P4"].includes(v.severity)) throw invalid("Choose a severity.", { severity: "Required." });
  let assignedToId = v.assignedToId ?? null;
  if (v.kind === "engineering") {
    const req = { reproductionSteps: "Reproduction steps", expectedResult: "Expected result", actualResult: "Actual result", environment: "Environment", customerImpact: "Customer impact", businessConsequence: "Business consequence" };
    const errs: Record<string, string> = Object.fromEntries(Object.entries(req).filter(([k]) => !v[k as keyof EscalationInput]?.toString().trim()).map(([k, l]) => [k, `${l} is required for an engineering escalation.`]));
    if (!v.requestedTeamId) errs.requestedTeamId = "Choose the engineering team.";
    if (Object.keys(errs).length) throw invalid("Engineering escalations need full technical context.", errs);
    assignedToId = null;
  }
  // Sensible defaults: Sales → the account owner; Onboarding → the customer's onboarding owner.
  if (!assignedToId && v.kind === "sales" && t.companyId) assignedToId = (await db.select({ o: companies.ownerId }).from(companies).where(eq(companies.id, t.companyId)))[0]?.o ?? null;
  if (!assignedToId && v.kind === "onboarding" && t.companyId) {
    const [p] = await db.select({ o: onboardingProjects.ownerId }).from(onboardingProjects).where(and(eq(onboardingProjects.companyId, t.companyId), ne(onboardingProjects.state, "completed"))).orderBy(desc(onboardingProjects.createdAt)).limit(1);
    assignedToId = p?.o ?? null;
  }
  if (target.target === "person" && v.kind !== "support_lead" && !assignedToId) throw invalid("Choose who to escalate to.", { assignedToId: "Pick a person." });
  if (assignedToId) {
    const [u] = await db.select({ id: users.id, active: users.active }).from(users).where(eq(users.id, assignedToId));
    if (!u?.active) throw invalid("That person isn't an active user.", { assignedToId: "Pick an active user." });
    if (assignedToId === actor.id) throw invalid("You can't escalate to yourself.", { assignedToId: "Pick someone else." });
  }
  const needsApproval = target.needsApproval && !can(actor, "tickets.approve_escalation");
  const now = new Date();
  const [esc] = await db.insert(ticketEscalations).values({
    ticketId: id, kind: v.kind, severity: v.severity, reason: v.reason, requestedTeamId: v.requestedTeamId, reproductionSteps: v.reproductionSteps, expectedResult: v.expectedResult,
    actualResult: v.actualResult, environment: v.environment, evidence: v.evidence, customerImpact: v.customerImpact, workaround: v.workaround, businessConsequence: v.businessConsequence,
    status: needsApproval ? "pending_approval" : "open", assignedTeamId: needsApproval ? null : v.requestedTeamId, assignedToId,
    approvedBy: needsApproval ? null : actor.id, createdBy: actor.id, dueAt: new Date(now.getTime() + (ESCALATION_RESPONSE_HOURS[v.severity] ?? 24) * 3600000),
  }).returning();
  const level = v.kind === "management" ? 3 : 2;
  await db.update(tickets).set({ escalationLevel: Math.max(t.escalationLevel, level), updatedAt: now }).where(eq(tickets.id, id));
  await audit(db, actor, "ticket.escalated", "ticket", id, { escalation: { from: null, to: v.kind } }, v.reason);
  if (needsApproval) await notifyRoles(db, ["support_lead"], { kind: "escalation", title: `Escalation needs approval: ${ticketRef(t.number)}`, body: v.reason ?? undefined, link: `/tickets/${id}#escalations` });
  else await onEscalationApproved(db, actor, t, esc);
  return esc;
}

async function onEscalationApproved(db: DB, actor: Actor, t: Ticket, esc: Esc) {
  const link = `/tickets/${t.id}#escalations`;
  const title = `${escalationKindLabel(esc.kind)} escalation for you: ${ticketRef(t.number)} ${t.subject}`;
  if (esc.kind === "management") await notifyRoles(db, ["executive"], { kind: "escalation", title, body: esc.reason ?? undefined, link });
  else if (esc.kind === "support_lead" && !esc.assignedToId) await notifyRoles(db, ["support_lead"], { kind: "escalation", title, body: esc.reason ?? undefined, link });
  else await notifyUsers(db, await escalationRecipients(db, esc), { kind: "escalation", title, body: esc.reason ?? undefined, link, dedupeKey: `esc-new:${esc.id}` });
  if (esc.kind === "engineering" && isOpenStatus(t.status) && t.status !== "waiting_on_engineering") {
    const fresh = (await db.select().from(tickets).where(eq(tickets.id, t.id)))[0];
    const clock = await clockTransition(db, fresh, "waiting_on_engineering", actor, "Engineering escalation approved", new Date());
    await db.update(tickets).set({ status: "waiting_on_engineering", waitingReason: `Engineering escalation: ${esc.reason}`, ...clock }).where(eq(tickets.id, t.id));
    await history(db, fresh, "waiting_on_engineering", actor, "Engineering escalation approved");
  }
}

export async function decideEscalation(db: DB, actor: Actor, escId: string, approve: boolean, comment: string | null) {
  assertCan(actor, "tickets.approve_escalation");
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (esc.status !== "pending_approval") throw conflict("This escalation has already been decided.");
  if (!approve && !comment?.trim()) throw invalid("Say why you're declining.", { comment: "Required." });
  const [updated] = await db.update(ticketEscalations).set({
    status: approve ? "open" : "rejected", approvedBy: actor.id, assignedTeamId: approve ? esc.requestedTeamId : null, updatedAt: new Date(),
  }).where(eq(ticketEscalations.id, escId)).returning();
  await escalationNote(db, escId, actor, approve ? `Approved${comment ? `: ${comment}` : ""}` : `Declined: ${comment}`);
  await audit(db, actor, approve ? "ticket.escalation_approved" : "ticket.escalation_rejected", "ticket", t.id, null, comment);
  if (approve) await onEscalationApproved(db, actor, t, updated);
  else await notifyUsers(db, [esc.createdBy], { kind: "escalation", title: `Escalation declined on ${ticketRef(t.number)}`, body: comment ?? undefined, link: `/tickets/${t.id}#escalations` });
}

/** The receiver takes ownership: the requester sees someone is on it. */
export async function acceptEscalation(db: DB, actor: Actor, escId: string, note: string | null) {
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (!isReceiver(actor, esc)) throw forbidden("Only the person or team it's escalated to can accept it.");
  if (!["open", "approved"].includes(esc.status)) throw conflict("This escalation isn't waiting to be accepted.");
  const now = new Date();
  await db.update(ticketEscalations).set({ status: "in_progress", acceptedAt: now, acceptedBy: actor.id, assignedToId: esc.assignedToId ?? actor.id, updatedAt: now }).where(eq(ticketEscalations.id, escId));
  await escalationNote(db, escId, actor, `Accepted${note?.trim() ? `: ${note.trim()}` : ""}`);
  await audit(db, actor, "ticket.escalation_accepted", "ticket", t.id, null, note);
  await notifyUsers(db, [esc.createdBy, t.ownerId].filter((x) => x !== actor.id), { kind: "escalation", title: `${actor.name} accepted the escalation on ${ticketRef(t.number)}`, link: `/tickets/${t.id}#escalations` });
}

/** Pass the escalation to someone else (receiver or Support Lead). */
export async function reassignEscalation(db: DB, actor: Actor, escId: string, assignedToId: string, note: string | null) {
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (!isReceiver(actor, esc)) throw forbidden("Only the current assignee or the Support Lead can reassign this escalation.");
  if (!ACTIVE_ESCALATION_STATUSES.includes(esc.status) || esc.status === "resolved") throw conflict("Only open escalations can be reassigned.");
  const [u] = await db.select({ id: users.id, name: users.name, active: users.active }).from(users).where(eq(users.id, assignedToId));
  if (!u?.active) throw invalid("Pick an active user.", { assignedToId: "Pick an active user." });
  await db.update(ticketEscalations).set({ assignedToId, status: esc.status === "pending_approval" ? esc.status : "open", acceptedAt: null, acceptedBy: null, updatedAt: new Date() }).where(eq(ticketEscalations.id, escId));
  await escalationNote(db, escId, actor, `Reassigned to ${u.name}${note?.trim() ? `: ${note.trim()}` : ""}`);
  await audit(db, actor, "ticket.escalation_reassigned", "ticket", t.id, { assignedToId: { from: esc.assignedToId, to: assignedToId } }, note);
  await notifyUsers(db, [assignedToId], { kind: "escalation", title: `${actor.name} passed you an escalation: ${ticketRef(t.number)} ${t.subject}`, body: note ?? undefined, link: `/tickets/${t.id}#escalations`, dedupeKey: `esc-reassign:${escId}:${assignedToId}:${Date.now()}` });
}

/** Internal progress note from either side. Engineering can also record status, root cause and fix version. */
export async function addEscalationUpdate(db: DB, actor: Actor, escId: string, input: { body: string; engineeringStatus?: string | null; rootCause?: string | null; fixVersion?: string | null }) {
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (!isReceiver(actor, esc) && !isRequester(actor, esc, t) && !can(actor, "engineering.update")) throw forbidden("You're not part of this escalation.");
  if (!input.body?.trim()) throw invalid("Write an update.", { body: "Required." });
  await escalationNote(db, escId, actor, input.body.trim());
  const engineering = esc.kind === "engineering" && can(actor, "engineering.update");
  await db.update(ticketEscalations).set({
    ...(engineering ? { engineeringStatus: input.engineeringStatus ?? esc.engineeringStatus, rootCause: input.rootCause ?? esc.rootCause, fixVersion: input.fixVersion ?? esc.fixVersion } : {}),
    status: ["open", "approved"].includes(esc.status) && isReceiver(actor, esc) ? "in_progress" : esc.status, updatedAt: new Date(),
  }).where(eq(ticketEscalations.id, escId));
  await audit(db, actor, engineering ? "ticket.engineering_update" : "ticket.escalation_update", "ticket", t.id, engineering ? { engineeringStatus: { from: esc.engineeringStatus, to: input.engineeringStatus ?? esc.engineeringStatus } } : null);
  const others = isReceiver(actor, esc) ? [esc.createdBy, t.ownerId] : await escalationRecipients(db, esc);
  await notifyUsers(db, others.filter((x) => x && x !== actor.id), { kind: "escalation", title: `Update on the ${escalationKindLabel(esc.kind).toLowerCase()} escalation for ${ticketRef(t.number)}`, body: input.body.slice(0, 200), link: `/tickets/${t.id}#escalations`, dedupeKey: `esc-upd:${escId}:${Date.now()}` });
  if (engineering && (input.engineeringStatus === "fix_released" || input.engineeringStatus === "wont_fix") && ["open", "approved", "in_progress"].includes(esc.status))
    await resolveEscalation(db, actor, escId, input.engineeringStatus === "fix_released" ? `Fix released${input.fixVersion ? ` in ${input.fixVersion}` : ""}. ${input.body}` : `Won't fix. ${input.body}`);
}
/** Kept for existing callers. */
export const addEngineeringUpdate = addEscalationUpdate;

/** The receiver says it's done. The requester is asked to confirm. */
export async function resolveEscalation(db: DB, actor: Actor, escId: string, resolution: string) {
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (!isReceiver(actor, esc)) throw forbidden("Only the person or team it's escalated to can resolve it.");
  if (!["open", "approved", "in_progress"].includes(esc.status)) throw conflict("This escalation isn't open.");
  if (!resolution?.trim()) throw invalid("Describe how it was resolved.", { resolution: "Required." });
  const now = new Date();
  await db.update(ticketEscalations).set({ status: "resolved", resolvedAt: now, resolvedBy: actor.id, resolution: resolution.trim(), acceptedAt: esc.acceptedAt ?? now, acceptedBy: esc.acceptedBy ?? actor.id, updatedAt: now }).where(eq(ticketEscalations.id, escId));
  await escalationNote(db, escId, actor, `Resolved: ${resolution.trim()}`);
  await audit(db, actor, "ticket.escalation_resolved", "ticket", t.id, null, resolution);
  // The ticket was waiting on engineering; support now owns the next step with the customer.
  if (esc.kind === "engineering" && t.status === "waiting_on_engineering") {
    const clock = await clockTransition(db, t, "in_progress", actor, "Engineering escalation resolved", now);
    await db.update(tickets).set({ status: "in_progress", waitingReason: null, ...clock, updatedAt: now }).where(eq(tickets.id, t.id));
    await history(db, t, "in_progress", actor, "Engineering escalation resolved");
  }
  await notifyUsers(db, [esc.createdBy, t.ownerId].filter((x) => x !== actor.id), { kind: "escalation", title: `Escalation resolved on ${ticketRef(t.number)} — please confirm`, body: resolution.slice(0, 200), link: `/tickets/${t.id}#escalations`, dedupeKey: `esc-res:${escId}:${esc.reopenCount}` });
}

/** The requester confirms the resolution: the escalation is closed. */
export async function confirmEscalation(db: DB, actor: Actor, escId: string, note: string | null) {
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (!isRequester(actor, esc, t)) throw forbidden("Only the person who raised it, the ticket owner or the Support Lead can confirm.");
  if (esc.status !== "resolved") throw conflict("Only resolved escalations can be confirmed.");
  const now = new Date();
  await db.update(ticketEscalations).set({ status: "closed", confirmedAt: now, confirmedBy: actor.id, updatedAt: now }).where(eq(ticketEscalations.id, escId));
  await escalationNote(db, escId, actor, `Confirmed resolved${note?.trim() ? `: ${note.trim()}` : ""}`);
  await audit(db, actor, "ticket.escalation_closed", "ticket", t.id, null, note);
  await lowerEscalationLevel(db, t.id);
  await notifyUsers(db, [esc.resolvedBy, esc.assignedToId].filter((x) => x && x !== actor.id), { kind: "escalation", title: `Escalation on ${ticketRef(t.number)} confirmed resolved`, link: `/tickets/${t.id}#escalations`, dedupeKey: `esc-ok:${escId}` });
}

/** The requester isn't satisfied: back to the receiver. */
export async function reopenEscalation(db: DB, actor: Actor, escId: string, reason: string) {
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (!isRequester(actor, esc, t)) throw forbidden("Only the person who raised it, the ticket owner or the Support Lead can reopen it.");
  if (!["resolved", "closed"].includes(esc.status)) throw conflict("Only resolved escalations can be reopened.");
  if (!reason?.trim()) throw invalid("Say what's still not right.", { reason: "Required." });
  await db.update(ticketEscalations).set({ status: "in_progress", resolvedAt: null, resolvedBy: null, confirmedAt: null, confirmedBy: null, reopenCount: esc.reopenCount + 1, updatedAt: new Date() }).where(eq(ticketEscalations.id, escId));
  await escalationNote(db, escId, actor, `Reopened: ${reason.trim()}`);
  await audit(db, actor, "ticket.escalation_reopened", "ticket", t.id, null, reason);
  await notifyUsers(db, [...await escalationRecipients(db, esc), esc.resolvedBy].filter((x) => x && x !== actor.id), { kind: "escalation", title: `Escalation reopened on ${ticketRef(t.number)}`, body: reason, link: `/tickets/${t.id}#escalations`, dedupeKey: `esc-reopen:${escId}:${esc.reopenCount + 1}` });
}

/** The requester no longer needs help (e.g. sorted it themselves). */
export async function cancelEscalation(db: DB, actor: Actor, escId: string, reason: string) {
  const { esc, t } = await loadEscalation(db, actor, escId);
  if (!isRequester(actor, esc, t)) throw forbidden("Only the person who raised it, the ticket owner or the Support Lead can withdraw it.");
  if (!["pending_approval", "open", "in_progress"].includes(esc.status)) throw conflict("This escalation can't be withdrawn now.");
  if (!reason?.trim()) throw invalid("Say why you're withdrawing it.", { reason: "Required." });
  await db.update(ticketEscalations).set({ status: "cancelled", updatedAt: new Date() }).where(eq(ticketEscalations.id, escId));
  await escalationNote(db, escId, actor, `Withdrawn: ${reason.trim()}`);
  await audit(db, actor, "ticket.escalation_cancelled", "ticket", t.id, null, reason);
  await lowerEscalationLevel(db, t.id);
  await notifyUsers(db, (await escalationRecipients(db, esc)).filter((x) => x !== actor.id), { kind: "escalation", title: `Escalation withdrawn on ${ticketRef(t.number)}`, body: reason, link: `/tickets/${t.id}#escalations`, dedupeKey: `esc-cancel:${escId}` });
}

/** When nothing is escalated any more, the ticket's escalation flag clears. */
async function lowerEscalationLevel(db: DB, ticketId: string) {
  const open = await db.select({ kind: ticketEscalations.kind }).from(ticketEscalations).where(and(eq(ticketEscalations.ticketId, ticketId), inArray(ticketEscalations.status, ACTIVE_ESCALATION_STATUSES)));
  const level = open.some((e) => e.kind === "management" || e.kind === "incident") ? 3 : open.length ? 2 : 0;
  await db.update(tickets).set({ escalationLevel: level }).where(eq(tickets.id, ticketId));
}

/** What the viewer can do on each escalation of a ticket. */
export function escalationPermissions(actor: Actor, esc: Esc, t: Ticket) {
  const recv = isReceiver(actor, esc), req = isRequester(actor, esc, t), active = ["open", "approved", "in_progress"].includes(esc.status);
  return {
    approve: esc.status === "pending_approval" && can(actor, "tickets.approve_escalation"),
    accept: recv && ["open", "approved"].includes(esc.status), resolve: recv && active, reassign: recv && (active || esc.status === "pending_approval"),
    update: (recv || req || can(actor, "engineering.update")) && esc.status !== "closed", engineering: esc.kind === "engineering" && can(actor, "engineering.update") && active,
    confirm: req && esc.status === "resolved", reopen: req && ["resolved", "closed"].includes(esc.status), cancel: req && ["pending_approval", "open", "in_progress"].includes(esc.status),
  };
}

export type EscalationView = "mine" | "team" | "raised" | "confirm" | "approval" | "all" | "closed";
/** The escalations inbox: what's assigned to me or my team, what I raised, and what I need to confirm. */
export async function listEscalations(db: DB, actor: Actor, view: EscalationView) {
  const lead = can(actor, "tickets.approve_escalation", "tickets.view_all");
  const active = inArray(ticketEscalations.status, ACTIVE_ESCALATION_STATUSES);
  const conds: SQL[] = [];
  if (view === "mine") conds.push(and(eq(ticketEscalations.assignedToId, actor.id), inArray(ticketEscalations.status, ["open", "approved", "in_progress"]))!);
  if (view === "team") conds.push(and(actor.teamId ? eq(ticketEscalations.assignedTeamId, actor.teamId) : sql`false`, inArray(ticketEscalations.status, ["open", "approved", "in_progress"]))!);
  if (view === "raised") conds.push(and(eq(ticketEscalations.createdBy, actor.id), active)!);
  if (view === "confirm") conds.push(and(eq(ticketEscalations.status, "resolved"), lead ? sql`true` : or(eq(ticketEscalations.createdBy, actor.id), eq(tickets.ownerId, actor.id)))!);
  if (view === "approval") conds.push(lead ? eq(ticketEscalations.status, "pending_approval") : sql`false`);
  if (view === "all") conds.push(lead ? active : sql`false`);
  if (view === "closed") conds.push(and(inArray(ticketEscalations.status, ["closed", "rejected", "cancelled"]), lead ? sql`true` : or(eq(ticketEscalations.createdBy, actor.id), eq(ticketEscalations.assignedToId, actor.id)))!);
  const assignee = sql<string | null>`(select name from users u where u.id = ${ticketEscalations.assignedToId})`;
  const team = sql<string | null>`(select name from teams tm where tm.id = ${ticketEscalations.assignedTeamId})`;
  const raisedBy = sql<string | null>`(select name from users u where u.id = ${ticketEscalations.createdBy})`;
  return db.select({
    id: ticketEscalations.id, kind: ticketEscalations.kind, severity: ticketEscalations.severity, status: ticketEscalations.status, reason: ticketEscalations.reason,
    createdAt: ticketEscalations.createdAt, dueAt: ticketEscalations.dueAt, acceptedAt: ticketEscalations.acceptedAt, resolvedAt: ticketEscalations.resolvedAt, resolution: ticketEscalations.resolution,
    assignee, team, raisedBy, ticketId: tickets.id, number: tickets.number, subject: tickets.subject, companyName: companies.name, priority: tickets.priority,
  }).from(ticketEscalations).innerJoin(tickets, eq(tickets.id, ticketEscalations.ticketId)).leftJoin(companies, eq(companies.id, tickets.companyId))
    .where(and(...conds, isNull(tickets.deletedAt), ne(ticketEscalations.kind, "incident"))).orderBy(asc(ticketEscalations.dueAt)).limit(300);
}

/** Badge count for the navigation: escalations waiting on me (to accept, work on, confirm or approve). */
export async function myEscalationCount(db: DB, actor: Actor) {
  const [r] = await db.select({ n: count() }).from(ticketEscalations).innerJoin(tickets, eq(tickets.id, ticketEscalations.ticketId)).where(and(isNull(tickets.deletedAt), or(
    and(eq(ticketEscalations.assignedToId, actor.id), inArray(ticketEscalations.status, ["open", "in_progress"])),
    actor.teamId ? and(eq(ticketEscalations.assignedTeamId, actor.teamId), isNull(ticketEscalations.assignedToId), eq(ticketEscalations.status, "open")) : sql`false`,
    and(eq(ticketEscalations.status, "resolved"), eq(ticketEscalations.createdBy, actor.id)),
    can(actor, "tickets.approve_escalation") ? eq(ticketEscalations.status, "pending_approval") : sql`false`,
  )));
  return r?.n ?? 0;
}

export async function linkArticle(db: DB, actor: Actor, ticketId: string, articleId: string) {
  assertCan(actor, "tickets.edit");
  await getTicket(db, actor, ticketId);
  await db.insert(articleTicketLinks).values({ articleId, ticketId, linkedBy: actor.id }).onConflictDoNothing();
}

export async function linkTicket(db: DB, actor: Actor, ticketId: string, input: { onboardingProjectId: string | null; dealId: string | null }) {
  const t = await getTicket(db, actor, ticketId);
  assertEditable(actor, t);
  if (input.dealId) { const [d] = await db.select({ c: deals.companyId }).from(deals).where(eq(deals.id, input.dealId)); if (!d || d.c !== t.companyId) throw invalid("Deal must belong to the same customer."); }
  await db.update(tickets).set({ ...input, updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await audit(db, actor, "ticket.linked", "ticket", ticketId, { onboardingProjectId: { from: t.onboardingProjectId, to: input.onboardingProjectId }, dealId: { from: t.dealId, to: input.dealId } });
}

// ---------------------------------------------------------------------------- Customer-facing portal

/**
 * Customer-visible projection. Reads ONLY customer-safe columns and the public ticket_messages table.
 * Internal notes, escalations, engineering updates and SLA internals are never queried here.
 */
export async function getPortalTicket(db: DB, token: string) {
  if (!token || token.length < 20) return null;
  const [t] = await db.select({
    id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status, priority: tickets.priority,
    createdAt: tickets.createdAt, resolvedAt: tickets.resolvedAt, closedAt: tickets.closedAt, resolutionSummary: tickets.resolutionSummary,
    csatScore: tickets.csatScore, companyName: companies.name,
  }).from(tickets).leftJoin(companies, eq(companies.id, tickets.companyId)).where(and(eq(tickets.portalToken, token), isNull(tickets.deletedAt)));
  if (!t) return null;
  const messages = await db.select({ id: ticketMessages.id, authorName: ticketMessages.authorName, body: ticketMessages.body, createdAt: ticketMessages.createdAt, isAutomated: ticketMessages.isAutomated, fromCustomer: sql<boolean>`${ticketMessages.authorContactId} is not null or ${ticketMessages.authorUserId} is null and ${ticketMessages.isAutomated} = false` })
    .from(ticketMessages).where(eq(ticketMessages.ticketId, t.id)).orderBy(asc(ticketMessages.createdAt));
  const attachments = await db.select({ id: ticketAttachments.id, filename: ticketAttachments.filename }).from(ticketAttachments)
    .where(and(eq(ticketAttachments.ticketId, t.id), eq(ticketAttachments.visibility, "public")));
  return { ticket: { ...t, statusLabel: ticketStatusLabel(t.status) }, messages, attachments };
}

async function portalTicket(db: DB, token: string) {
  const [t] = await db.select().from(tickets).where(and(eq(tickets.portalToken, token), isNull(tickets.deletedAt)));
  if (!t) throw notFound("Ticket");
  return t;
}

export async function portalReply(db: DB, token: string, body: string) {
  const t = await portalTicket(db, token);
  if (!body?.trim() || body.length > 10000) throw invalid("Write a message.", { body: "Required (max 10,000 characters)." });
  const [contact] = t.contactId ? await db.select().from(contacts).where(eq(contacts.id, t.contactId)) : [];
  await db.insert(ticketMessages).values({ ticketId: t.id, authorContactId: contact?.id ?? null, authorName: contact ? `${contact.firstName} ${contact.lastName}` : t.requesterEmail ?? "Customer", body: body.trim() });
  if (t.status === "waiting_on_customer") {
    const clock = await clockTransition(db, t, "in_progress", null, "Customer replied", new Date());
    await db.update(tickets).set({ status: "in_progress", waitingReason: null, waitingFollowUpAt: null, ...clock, updatedAt: new Date() }).where(eq(tickets.id, t.id));
    await history(db, t, "in_progress", null, "Customer replied", undefined, "Customer");
  } else await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, t.id));
  await notifyUsers(db, [t.ownerId], { kind: "ticket", title: `Customer replied on ${ticketRef(t.number)}`, link: `/tickets/${t.id}` });
}

export async function portalConfirmResolved(db: DB, token: string) {
  const t = await portalTicket(db, token);
  if (t.status !== "resolved") throw conflict("This ticket is not awaiting confirmation.");
  await closeTicket(db, SYSTEM_ACTOR, t.id, "Customer confirmed resolution", true);
}

export async function portalReopen(db: DB, token: string, reason: string) {
  const t = await portalTicket(db, token);
  await reopenTicket(db, null, t.id, `Customer reports the issue persists: ${reason}`);
}

export async function portalCsat(db: DB, token: string, score: number, comment: string | null) {
  const t = await portalTicket(db, token);
  if (!["resolved", "closed"].includes(t.status)) throw conflict("You can rate support once the ticket is resolved.");
  if (!(score >= 1 && score <= 5)) throw invalid("Choose a rating from 1 to 5.", { score: "Required." });
  await db.update(tickets).set({ csatScore: score, csatComment: comment?.slice(0, 2000) ?? null }).where(eq(tickets.id, t.id));
}

/** Minimal pickers (id + name only) so ticket creators can link customers without full account access. */
export async function customerPicker(db: DB, actor: Actor) {
  assertCan(actor, "tickets.create");
  return db.select({ id: companies.id, name: companies.name }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.name));
}
/** Every live contact, with their company, for picking the person a ticket is about. */
export async function allContactsPicker(db: DB, actor: Actor) {
  assertCan(actor, "tickets.create");
  const rows = await db.select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, email: contacts.email, companyId: contacts.companyId, companyName: companies.name })
    .from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId)).where(isNull(contacts.deletedAt)).orderBy(asc(contacts.lastName));
  return rows.map((r) => ({ id: r.id, name: `${r.first} ${r.last}`, email: r.email, companyId: r.companyId, companyName: r.companyName }));
}

export async function contactPicker(db: DB, actor: Actor, companyId: string) {
  assertCan(actor, "tickets.create");
  return db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName }).from(contacts)
    .where(and(eq(contacts.companyId, companyId), isNull(contacts.deletedAt))).orderBy(asc(contacts.lastName));
}
