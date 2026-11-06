import { and, avg, count, desc, eq, gte, inArray, isNull, lt, max, ne, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  companies, customerHealthSnapshots, onboardingProjects, onboardingTasks, tickets, tasks, activities, trainingParticipants,
  trainingSessions, trainingPrograms, renewals, expansionOpportunities, users,
} from "@/db/schema";
import { computeHealth } from "@/lib/rules/health";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { type Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { invalid, notFound } from "../errors";
import { getSettings } from "../settings";
import { emit } from "./workflows";

export async function computeCompanyHealth(db: DB, companyId: string, now = new Date()) {
  const s = await getSettings(db);
  const [proj] = await db.select().from(onboardingProjects).where(and(eq(onboardingProjects.companyId, companyId), ne(onboardingProjects.state, "completed"), ne(onboardingProjects.state, "draft")))
    .orderBy(desc(onboardingProjects.createdAt)).limit(1);
  let onboardingProgress: number | null = null;
  if (proj) {
    const [r] = await db.select({ total: count(), done: sql<number>`count(*) filter (where ${onboardingTasks.status} = 'done')::int` }).from(onboardingTasks).where(eq(onboardingTasks.projectId, proj.id));
    onboardingProgress = r.total ? Math.round((r.done / r.total) * 100) : 0;
  }
  const open = inArray(tickets.status, OPEN_STATUSES);
  const [tk] = await db.select({
    p12: sql<number>`count(*) filter (where ${tickets.priority} in ('P1','P2'))::int`, other: sql<number>`count(*) filter (where ${tickets.priority} not in ('P1','P2'))::int`,
  }).from(tickets).where(and(eq(tickets.companyId, companyId), open, isNull(tickets.deletedAt)));
  const [br] = await db.select({ n: count() }).from(tickets).where(and(eq(tickets.companyId, companyId), gte(tickets.createdAt, new Date(now.getTime() - 90 * 86400000)), or(eq(tickets.firstResponseBreached, true), eq(tickets.resolutionBreached, true))));
  const [od] = await db.select({ n: count() }).from(tasks).where(and(eq(tasks.companyId, companyId), eq(tasks.status, "open"), lt(tasks.dueAt, now)));
  const [om] = proj ? await db.select({ n: count() }).from(onboardingTasks).where(and(eq(onboardingTasks.projectId, proj.id), ne(onboardingTasks.status, "done"), lt(onboardingTasks.dueDate, now.toISOString().slice(0, 10)))) : [{ n: 0 }];
  const [tr] = await db.select({ req: count(), done: sql<number>`count(*) filter (where ${trainingParticipants.completed})::int` }).from(trainingParticipants)
    .innerJoin(trainingSessions, eq(trainingSessions.id, trainingParticipants.sessionId)).innerJoin(trainingPrograms, eq(trainingPrograms.id, trainingSessions.programId))
    .where(and(eq(trainingSessions.companyId, companyId), eq(trainingPrograms.requiredForGoLive, true), ne(trainingParticipants.attendance, "cancelled")));
  const [lc] = await db.select({ at: max(activities.occurredAt) }).from(activities).where(and(eq(activities.companyId, companyId), inArray(activities.type, ["call", "email", "meeting", "demo", "whatsapp"]), lt(activities.occurredAt, now)));
  const [cs] = await db.select({ a: avg(tickets.csatScore) }).from(tickets).where(and(eq(tickets.companyId, companyId), gte(tickets.createdAt, new Date(now.getTime() - 180 * 86400000))));
  const h = computeHealth({
    onboardingProgress, onboardingRisk: proj?.riskLevel ?? null, openP1P2: tk.p12, openOther: tk.other, slaBreaches90d: br.n,
    overdueActions: od.n + om.n, trainingRequired: tr.req, trainingCompleted: tr.done,
    daysSinceLastContact: lc.at ? Math.floor((now.getTime() - new Date(lc.at).getTime()) / 86400000) : null,
    avgCsat: cs.a !== null ? Number(cs.a) : null,
  }, s.health);
  const [prev] = await db.select().from(customerHealthSnapshots).where(eq(customerHealthSnapshots.companyId, companyId)).orderBy(desc(customerHealthSnapshots.computedAt)).limit(1);
  const [snap] = await db.insert(customerHealthSnapshots).values({ companyId, score: h.score, status: h.status, components: h.components, computedAt: now }).returning();
  if (h.status === "at_risk") {
    const [c] = await db.select().from(companies).where(eq(companies.id, companyId));
    const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / (7 * 86400000))}`;
    await emit(db, "account.at_risk", {
      entityId: companyId, dedupe: `${companyId}:${week}`, relatedType: "company", companyId, ownerId: c.csmId ?? c.ownerId, name: c.name,
      score: h.score, factors: h.components.filter((x) => x.score < 60).map((x) => `${x.label}: ${x.detail}`).join("; "), link: `/companies/${companyId}/360`,
      wasAtRisk: prev?.status === "at_risk",
    });
  }
  return snap;
}

export async function reviewHealth(db: DB, actor: Actor, snapshotId: string, notes: string) {
  assertCan(actor, "success.manage");
  if (!notes?.trim()) throw invalid("Record your review notes and planned actions.", { notes: "Required." });
  const [s] = await db.select().from(customerHealthSnapshots).where(eq(customerHealthSnapshots.id, snapshotId));
  if (!s) throw notFound("Health snapshot");
  await db.update(customerHealthSnapshots).set({ reviewedBy: actor.id, reviewedAt: new Date(), reviewNotes: notes.trim() }).where(eq(customerHealthSnapshots.id, snapshotId));
  await audit(db, actor, "health.reviewed", "company", s.companyId, null, notes);
}

export async function successOverview(db: DB) {
  const customers = await db.select({ id: companies.id, name: companies.name, segment: companies.segment, tier: companies.tier, csm: users.name, billingStatus: companies.billingStatus })
    .from(companies).leftJoin(users, eq(users.id, companies.csmId)).where(and(eq(companies.lifecycle, "customer"), isNull(companies.deletedAt)));
  const ids = customers.map((c) => c.id);
  if (!ids.length) return [];
  const snaps = await db.select().from(customerHealthSnapshots).where(inArray(customerHealthSnapshots.companyId, ids)).orderBy(desc(customerHealthSnapshots.computedAt));
  const rs = await db.select().from(renewals).where(and(inArray(renewals.companyId, ids), inArray(renewals.status, ["upcoming", "in_progress"])));
  const xs = await db.select().from(expansionOpportunities).where(and(inArray(expansionOpportunities.companyId, ids), inArray(expansionOpportunities.status, ["identified", "qualified"])));
  const proj = await db.select({ companyId: onboardingProjects.companyId, stage: onboardingProjects.stage, state: onboardingProjects.state, riskLevel: onboardingProjects.riskLevel, actualGoLive: onboardingProjects.actualGoLive })
    .from(onboardingProjects).where(inArray(onboardingProjects.companyId, ids));
  const lastContact = await db.select({ companyId: activities.companyId, at: max(activities.occurredAt) }).from(activities)
    .where(and(inArray(activities.companyId, ids), lt(activities.occurredAt, new Date()))).groupBy(activities.companyId);
  const nextTouch = await db.select({ companyId: tasks.companyId, at: sql<Date>`min(${tasks.dueAt})` }).from(tasks)
    .where(and(inArray(tasks.companyId, ids), eq(tasks.status, "open"))).groupBy(tasks.companyId);
  const openT = await db.select({ companyId: tickets.companyId, p12: sql<number>`count(*) filter (where ${tickets.priority} in ('P1','P2'))::int`, n: count() })
    .from(tickets).where(and(inArray(tickets.companyId, ids), inArray(tickets.status, OPEN_STATUSES))).groupBy(tickets.companyId);
  return customers.map((c) => {
    const snap = snaps.find((s) => s.companyId === c.id) ?? null;
    return {
      ...c, health: snap, renewal: rs.filter((r) => r.companyId === c.id).sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))[0] ?? null,
      expansions: xs.filter((x) => x.companyId === c.id), onboarding: proj.filter((p) => p.companyId === c.id).sort((a, b) => (a.state === "completed" ? 1 : -1) - (b.state === "completed" ? 1 : -1))[0] ?? null,
      lastContact: lastContact.find((l) => l.companyId === c.id)?.at ?? null, nextTouch: nextTouch.find((n) => n.companyId === c.id)?.at ?? null,
      openTickets: openT.find((o) => o.companyId === c.id) ?? { p12: 0, n: 0 },
    };
  });
}

export async function upsertRenewal(db: DB, actor: Actor, input: { id?: string | null; companyId: string; renewalDate: string; amount: number | null; status: string; ownerId: string | null; notes: string | null }) {
  assertCan(actor, "success.manage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.renewalDate)) throw invalid("Renewal date is required.", { renewalDate: "Use YYYY-MM-DD." });
  if (!["upcoming", "in_progress", "renewed", "churned"].includes(input.status)) throw invalid("Unknown status.");
  const { id, ...v } = input;
  if (id) {
    const [before] = await db.select().from(renewals).where(eq(renewals.id, id));
    await db.update(renewals).set(v).where(eq(renewals.id, id));
    await audit(db, actor, "renewal.updated", "company", input.companyId, { status: { from: before?.status, to: v.status }, amount: { from: before?.amount, to: v.amount } });
  } else {
    await db.insert(renewals).values(v);
    await audit(db, actor, "renewal.created", "company", input.companyId);
  }
  if (input.status === "churned") await db.update(companies).set({ lifecycle: "churned" }).where(eq(companies.id, input.companyId));
}

export async function addExpansion(db: DB, actor: Actor, input: { companyId: string; productId: string | null; kind: string; description: string; estimatedValue: number | null; ownerId: string | null }) {
  assertCan(actor, "success.manage");
  if (!input.description?.trim()) throw invalid("Describe the opportunity.", { description: "Required." });
  await db.insert(expansionOpportunities).values({ ...input, ownerId: input.ownerId ?? actor.id });
  await audit(db, actor, "expansion.created", "company", input.companyId);
}

export async function setExpansionStatus(db: DB, actor: Actor, id: string, status: string) {
  assertCan(actor, "success.manage");
  if (!["identified", "qualified", "converted", "dropped"].includes(status)) throw invalid("Unknown status.");
  await db.update(expansionOpportunities).set({ status }).where(eq(expansionOpportunities.id, id));
}
