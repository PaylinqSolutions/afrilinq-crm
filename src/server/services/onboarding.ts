import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db";
import {
  onboardingProjects, onboardingTasks, onboardingBlockers, onboardingTemplates, onboardingTemplateTasks, handoverRecords,
  deals, dealProducts, companies, users, trainingPrograms, trainingSessions, trainingParticipants, type GoLiveItem,
} from "@/db/schema";
import { DEFAULT_GO_LIVE_CHECKLIST, ONBOARDING_STAGES, assessOnboardingRisk, stageLabel } from "@/lib/rules/onboarding";
import { addDays, todayIn } from "@/lib/format";
import { type Actor, assertCan, can, SYSTEM_ACTOR } from "../actor";
import { audit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { notifyUsers, usersWithRole } from "../notify";
import { getSettings } from "../settings";
import { onboardingScope } from "./scope";
import { emit } from "./workflows";
import { syncHandoverFromProject } from "./handover";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

type Handover = typeof handoverRecords.$inferSelect;
type Deal = typeof deals.$inferSelect;

/** Creates the draft project for a submitted handover. Exactly one per handover (unique handover_id). */
export async function createDraftProject(db: Executor, h: Handover, deal: Deal): Promise<string> {
  const [existing] = await db.select({ id: onboardingProjects.id }).from(onboardingProjects).where(eq(onboardingProjects.handoverId, h.id));
  if (existing) return existing.id;
  const [line] = await db.select({ productId: dealProducts.productId }).from(dealProducts).where(eq(dealProducts.dealId, deal.id)).limit(1);
  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, deal.companyId));
  const rows = await db.insert(onboardingProjects).values({
    name: `${company?.name ?? deal.name} onboarding`, companyId: deal.companyId, dealId: deal.id, handoverId: h.id,
    productId: line?.productId ?? null, stage: "handover_review", state: "draft",
  }).onConflictDoNothing({ target: onboardingProjects.handoverId }).returning({ id: onboardingProjects.id });
  if (rows.length) return rows[0].id;
  const [again] = await db.select({ id: onboardingProjects.id }).from(onboardingProjects).where(eq(onboardingProjects.handoverId, h.id));
  return again.id;
}

export async function pickTemplate(db: Executor, productId: string | null, segment: string | null) {
  const all = await db.select().from(onboardingTemplates).where(eq(onboardingTemplates.active, true));
  const score = (t: (typeof all)[number]) =>
    (t.productId && t.productId === productId ? 2 : t.productId ? -10 : 0) + (t.segment && t.segment === segment ? 1 : t.segment ? -10 : 0);
  return all.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Applies the template on acceptance: owner, dated tasks/milestones, go-live checklist. Runs once. */
export async function activateProject(
  db: Executor, actor: Actor, projectId: string,
  o: { ownerId: string; templateId: string | null; handover: Handover; deal: Deal },
) {
  const [p] = await db.select().from(onboardingProjects).where(eq(onboardingProjects.id, projectId));
  if (p.state !== "draft") throw conflict("This onboarding project has already been activated.");
  const [company] = await db.select().from(companies).where(eq(companies.id, p.companyId));
  const template = o.templateId
    ? (await db.select().from(onboardingTemplates).where(eq(onboardingTemplates.id, o.templateId)))[0]
    : await pickTemplate(db, p.productId, company?.segment ?? null);
  if (!template) throw invalid("No onboarding template is configured. Add one in Settings → Onboarding templates.");
  const { timezone } = await getSettings(db);
  const today = todayIn(timezone);
  const start = o.deal.startDate && o.deal.startDate > today ? o.deal.startDate : today;
  const rawTarget = o.handover.checklist.targetGoLive;
  const target = rawTarget && /^\d{4}-\d{2}-\d{2}$/.test(rawTarget) ? rawTarget : addDays(start, template.durationDays);
  const tt = await db.select().from(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.templateId, template.id)).orderBy(asc(onboardingTemplateTasks.position));
  const byPos = new Map<number, string>();
  for (const t of tt) {
    const [row] = await db.insert(onboardingTasks).values({
      projectId, position: t.position, title: t.title, stageKey: t.stageKey, ownerId: t.customerResponsibility ? null : o.ownerId,
      dueDate: addDays(start, t.offsetDays), isMilestone: t.isMilestone, customerResponsibility: t.customerResponsibility,
      dependsOnTaskId: t.dependsOnPosition !== null ? byPos.get(t.dependsOnPosition) ?? null : null,
    }).returning({ id: onboardingTasks.id });
    byPos.set(t.position, row.id);
  }
  const checklist: GoLiveItem[] = (template.goLiveChecklist ?? DEFAULT_GO_LIVE_CHECKLIST).map((label) => ({ label, done: false }));
  await db.update(onboardingProjects).set({
    ownerId: o.ownerId, templateId: template.id, state: "active", stage: "kickoff_pending", kickoffDate: addDays(start, 2),
    targetGoLive: target, goLiveChecklist: checklist, updatedAt: new Date(),
  }).where(eq(onboardingProjects.id, projectId));
  if (company && !company.csmId) await db.update(companies).set({ csmId: o.ownerId }).where(eq(companies.id, company.id));
  await audit(db, actor, "onboarding.activated", "onboarding", projectId, { template: { from: null, to: template.name }, ownerId: { from: null, to: o.ownerId } });
  await notifyUsers(db, [o.ownerId], { kind: "onboarding", title: `You own a new onboarding project: ${p.name}`, link: `/onboarding/${projectId}` });
}

export type OnboardingFilters = { owner?: string; stage?: string; risk?: string; state?: string; q?: string };

export async function listProjects(db: DB, actor: Actor, f: OnboardingFilters = {}) {
  const conds: (SQL | undefined)[] = [onboardingScope(actor)];
  if (f.owner) conds.push(f.owner === "me" ? eq(onboardingProjects.ownerId, actor.id) : eq(onboardingProjects.ownerId, f.owner));
  if (f.stage) conds.push(eq(onboardingProjects.stage, f.stage));
  if (f.risk) conds.push(eq(onboardingProjects.riskLevel, f.risk));
  if (f.state) conds.push(eq(onboardingProjects.state, f.state));
  else conds.push(ne(onboardingProjects.state, "completed"));
  if (f.q) conds.push(sql`${companies.name} ilike ${`%${f.q}%`}`);
  const rows = await db.select({
    id: onboardingProjects.id, name: onboardingProjects.name, stage: onboardingProjects.stage, state: onboardingProjects.state,
    riskLevel: onboardingProjects.riskLevel, riskReasons: onboardingProjects.riskReasons, targetGoLive: onboardingProjects.targetGoLive,
    actualGoLive: onboardingProjects.actualGoLive, companyId: companies.id, companyName: companies.name, ownerName: users.name, ownerId: onboardingProjects.ownerId,
    progress: sql<number>`coalesce((select round(100.0 * count(*) filter (where status = 'done') / nullif(count(*),0)) from onboarding_tasks where project_id = ${onboardingProjects.id}), 0)::int`,
    overdue: sql<number>`(select count(*) from onboarding_tasks where project_id = ${onboardingProjects.id} and status <> 'done' and due_date < current_date)::int`,
    openBlockers: sql<number>`(select count(*) from onboarding_blockers where project_id = ${onboardingProjects.id} and status = 'open')::int`,
  }).from(onboardingProjects).innerJoin(companies, eq(companies.id, onboardingProjects.companyId))
    .leftJoin(users, eq(users.id, onboardingProjects.ownerId)).where(and(...conds)).orderBy(asc(onboardingProjects.targetGoLive));
  return rows;
}

export async function getProject(db: Executor, actor: Actor, id: string) {
  const [p] = await db.select().from(onboardingProjects).where(and(eq(onboardingProjects.id, id), onboardingScope(actor)));
  if (!p) throw notFound("Onboarding project");
  return p;
}

export async function trainingStatusForProject(db: Executor, projectId: string, productId: string | null, companyId: string) {
  const required = await db.select().from(trainingPrograms).where(and(
    eq(trainingPrograms.requiredForGoLive, true), eq(trainingPrograms.active, true),
    productId ? or(eq(trainingPrograms.productId, productId), isNull(trainingPrograms.productId)) : isNull(trainingPrograms.productId),
  ));
  const parts = required.length ? await db.select({
    programId: trainingSessions.programId, completed: trainingParticipants.completed, attendance: trainingParticipants.attendance,
  }).from(trainingParticipants).innerJoin(trainingSessions, eq(trainingSessions.id, trainingParticipants.sessionId))
    .where(and(eq(trainingSessions.companyId, companyId), inArray(trainingSessions.programId, required.map((r) => r.id)))) : [];
  const perProgram = required.map((prog) => {
    const ps = parts.filter((x) => x.programId === prog.id);
    const done = ps.filter((x) => x.completed).length;
    return { programId: prog.id, name: prog.name, audienceRole: prog.audienceRole, participants: ps.length, completed: done, gap: ps.length === 0 ? 1 : ps.length - done };
  });
  void projectId;
  return { perProgram, gaps: perProgram.reduce((s, x) => s + x.gap, 0) };
}

export async function recomputeRisk(db: DB, projectId: string) {
  const [p] = await db.select().from(onboardingProjects).where(eq(onboardingProjects.id, projectId));
  if (!p || p.state === "draft") return null;
  const s = await getSettings(db);
  const ts = await db.select({ status: onboardingTasks.status, dueDate: onboardingTasks.dueDate, isMilestone: onboardingTasks.isMilestone }).from(onboardingTasks).where(eq(onboardingTasks.projectId, projectId));
  const bs = await db.select({ status: onboardingBlockers.status, severity: onboardingBlockers.severity }).from(onboardingBlockers).where(eq(onboardingBlockers.projectId, projectId));
  const training = await trainingStatusForProject(db, projectId, p.productId, p.companyId);
  const today = todayIn(s.timezone);
  const r = assessOnboardingRisk({ today, targetGoLive: p.targetGoLive, state: p.state, tasks: ts, blockers: bs, trainingGaps: p.state === "completed" ? 0 : training.gaps, trainingWindowDays: s.goLiveTrainingWindowDays });
  const level = p.state === "completed" ? "low" : r.level;
  await db.update(onboardingProjects).set({ riskLevel: level, riskReasons: r.reasons }).where(eq(onboardingProjects.id, projectId));
  if (level === "high" && p.riskLevel !== "high") {
    await audit(db, SYSTEM_ACTOR, "onboarding.risk_high", "onboarding", projectId, { riskLevel: { from: p.riskLevel, to: "high" } }, r.reasons.join("; "));
    const managers = await usersWithRole(db, ["onboarding_manager"]);
    await notifyUsers(db, [p.ownerId, ...managers], { kind: "risk", title: `High-risk onboarding: ${p.name}`, body: r.reasons.join("; "), link: `/onboarding/${projectId}`, dedupeKey: `risk-high:${projectId}:${today}` });
    await emit(db, "onboarding.high_risk", { entityId: projectId, dedupe: `${projectId}:${today}`, ownerId: p.ownerId, name: p.name, reasons: r.reasons.join("; "), link: `/onboarding/${projectId}` });
  }
  if (training.gaps > 0 && p.targetGoLive && p.state !== "completed" && p.targetGoLive <= addDays(today, s.goLiveTrainingWindowDays)) {
    await emit(db, "onboarding.training_gap", { entityId: projectId, dedupe: `${projectId}:${p.targetGoLive}`, ownerId: p.ownerId, name: p.name, gaps: training.gaps, link: `/onboarding/${projectId}` });
  }
  return { ...r, level };
}

export async function getProjectDetail(db: DB, actor: Actor, id: string) {
  const p = await getProject(db, actor, id);
  const tasksRows = await db.select({
    id: onboardingTasks.id, position: onboardingTasks.position, title: onboardingTasks.title, stageKey: onboardingTasks.stageKey, ownerId: onboardingTasks.ownerId,
    ownerName: users.name, dueDate: onboardingTasks.dueDate, status: onboardingTasks.status, isMilestone: onboardingTasks.isMilestone,
    customerResponsibility: onboardingTasks.customerResponsibility, dependsOnTaskId: onboardingTasks.dependsOnTaskId, notes: onboardingTasks.notes,
    evidenceUrl: onboardingTasks.evidenceUrl, completedAt: onboardingTasks.completedAt,
  }).from(onboardingTasks).leftJoin(users, eq(users.id, onboardingTasks.ownerId)).where(eq(onboardingTasks.projectId, id)).orderBy(asc(onboardingTasks.position));
  const blockers = await db.select({
    id: onboardingBlockers.id, description: onboardingBlockers.description, severity: onboardingBlockers.severity, status: onboardingBlockers.status,
    customerSide: onboardingBlockers.customerSide, resolution: onboardingBlockers.resolution, raisedAt: onboardingBlockers.raisedAt, resolvedAt: onboardingBlockers.resolvedAt, ownerName: users.name,
  }).from(onboardingBlockers).leftJoin(users, eq(users.id, onboardingBlockers.ownerId)).where(eq(onboardingBlockers.projectId, id)).orderBy(desc(onboardingBlockers.raisedAt));
  const [company] = await db.select().from(companies).where(eq(companies.id, p.companyId));
  const [owner] = p.ownerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.ownerId)) : [];
  const [template] = p.templateId ? await db.select().from(onboardingTemplates).where(eq(onboardingTemplates.id, p.templateId)) : [];
  const training = await trainingStatusForProject(db, id, p.productId, p.companyId);
  const sessions = await db.select({ id: trainingSessions.id, title: trainingSessions.title, startsAt: trainingSessions.startsAt, status: trainingSessions.status })
    .from(trainingSessions).where(eq(trainingSessions.companyId, p.companyId)).orderBy(asc(trainingSessions.startsAt));
  const [handover] = p.handoverId ? await db.select({ id: handoverRecords.id, status: handoverRecords.status, checklist: handoverRecords.checklist }).from(handoverRecords).where(eq(handoverRecords.id, p.handoverId)) : [];
  const isOwner = p.ownerId === actor.id;
  return {
    p, tasks: tasksRows, blockers, company, owner, template, training, sessions, handover,
    canManage: can(actor, "onboarding.manage") && p.state !== "draft",
    canComplete: can(actor, "onboarding.complete") && (isOwner || actor.roleKeys.includes("onboarding_manager") || actor.roleKeys.includes("super_admin")),
  };
}

function assertManage(actor: Actor, p: typeof onboardingProjects.$inferSelect) {
  assertCan(actor, "onboarding.manage");
  if (p.state === "draft") throw conflict("This project starts once the handover is accepted.");
  if (p.state === "completed") throw conflict("Completed projects are read-only.");
}

export async function updateOnboardingTask(db: DB, actor: Actor, taskId: string, input: { status?: string; ownerId?: string | null; dueDate?: string | null; notes?: string | null; evidenceUrl?: string | null }) {
  const [t] = await db.select().from(onboardingTasks).where(eq(onboardingTasks.id, taskId));
  if (!t) throw notFound("Task");
  const p = await getProject(db, actor, t.projectId);
  assertManage(actor, p);
  if (input.status && !["todo", "in_progress", "blocked", "done"].includes(input.status)) throw invalid("Unknown status.");
  if (input.status && ["in_progress", "done"].includes(input.status) && t.dependsOnTaskId) {
    const [dep] = await db.select().from(onboardingTasks).where(eq(onboardingTasks.id, t.dependsOnTaskId));
    if (dep && dep.status !== "done") throw conflict(`Blocked by dependency “${dep.title}”. Complete it first.`);
  }
  if (input.evidenceUrl && !/^https?:\/\//.test(input.evidenceUrl)) throw invalid("Evidence must be an http(s) link.", { evidenceUrl: "Use a full URL." });
  const next = {
    ...input, completedAt: input.status === "done" ? t.completedAt ?? new Date() : input.status ? null : t.completedAt,
  };
  await db.update(onboardingTasks).set(next).where(eq(onboardingTasks.id, taskId));
  if (input.status && input.status !== t.status) await audit(db, actor, "onboarding.task_status", "onboarding", p.id, { [t.title]: { from: t.status, to: input.status } });
  await recomputeRisk(db, p.id);
}

export async function addOnboardingTask(db: DB, actor: Actor, projectId: string, input: { title: string; stageKey: string; dueDate: string | null; ownerId: string | null; isMilestone: boolean; customerResponsibility: boolean }) {
  const p = await getProject(db, actor, projectId);
  assertManage(actor, p);
  if (!input.title?.trim()) throw invalid("Task title is required.", { title: "Required." });
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(position), 0)::int` }).from(onboardingTasks).where(eq(onboardingTasks.projectId, projectId));
  await db.insert(onboardingTasks).values({ projectId, position: max + 1, ...input, title: input.title.trim() });
  await recomputeRisk(db, projectId);
}

export async function addBlocker(db: DB, actor: Actor, projectId: string, input: { description: string; severity: string; ownerId: string | null; customerSide: boolean }) {
  const p = await getProject(db, actor, projectId);
  assertManage(actor, p);
  if (!input.description?.trim()) throw invalid("Describe the blocker.", { description: "Required." });
  await db.insert(onboardingBlockers).values({ projectId, ...input, description: input.description.trim() });
  await audit(db, actor, "onboarding.blocker_raised", "onboarding", projectId, null, `${input.severity}: ${input.description}`);
  await recomputeRisk(db, projectId);
}

export async function resolveBlocker(db: DB, actor: Actor, blockerId: string, resolution: string) {
  const [b] = await db.select().from(onboardingBlockers).where(eq(onboardingBlockers.id, blockerId));
  if (!b) throw notFound("Blocker");
  const p = await getProject(db, actor, b.projectId);
  assertManage(actor, p);
  if (!resolution?.trim()) throw invalid("Describe how it was resolved.", { resolution: "Required." });
  await db.update(onboardingBlockers).set({ status: "resolved", resolution, resolvedAt: new Date() }).where(eq(onboardingBlockers.id, blockerId));
  await audit(db, actor, "onboarding.blocker_resolved", "onboarding", p.id, null, resolution);
  await recomputeRisk(db, p.id);
}

export async function setProjectStage(db: DB, actor: Actor, projectId: string, stage: string, reason: string | null, expected?: Version) {
  const p = await getProject(db, actor, projectId);
  assertManage(actor, p);
  await assertFresh(db, actor, "onboarding", projectId, p.updatedAt, expected, "project");
  if (!ONBOARDING_STAGES.some((s) => s.key === stage)) throw invalid("Unknown stage.");
  if (stage === "completed") throw conflict("Use “Confirm onboarding completion” to complete a project.");
  if (stage === "on_hold" && !reason?.trim()) throw invalid("Give a reason for putting the project on hold.", { reason: "Required." });
  const state = stage === "on_hold" ? "on_hold" : "active";
  assertUpdated(await db.update(onboardingProjects).set({ stage, state, onHoldReason: stage === "on_hold" ? reason : null, updatedAt: new Date() })
    .where(and(eq(onboardingProjects.id, projectId), sameVersion(onboardingProjects.updatedAt, p.updatedAt))).returning({ id: onboardingProjects.id }), "project");
  await audit(db, actor, "onboarding.stage_changed", "onboarding", projectId, { stage: { from: stageLabel(p.stage), to: stageLabel(stage) } }, reason);
  await syncHandoverFromProject(db, projectId, state, stage);
  await recomputeRisk(db, projectId);
}

export async function updateProjectDates(db: DB, actor: Actor, projectId: string, input: { targetGoLive: string | null; kickoffDate: string | null; internalNotes: string | null }, expected?: Version) {
  const p = await getProject(db, actor, projectId);
  assertManage(actor, p);
  await assertFresh(db, actor, "onboarding", projectId, p.updatedAt, expected, "project");
  assertUpdated(await db.update(onboardingProjects).set({ ...input, updatedAt: new Date() })
    .where(and(eq(onboardingProjects.id, projectId), sameVersion(onboardingProjects.updatedAt, p.updatedAt))).returning({ id: onboardingProjects.id }), "project");
  await audit(db, actor, "onboarding.updated", "onboarding", projectId, {
    ...(p.targetGoLive !== input.targetGoLive ? { targetGoLive: { from: p.targetGoLive, to: input.targetGoLive } } : {}),
  });
  await recomputeRisk(db, projectId);
}

export async function updateGoLiveChecklist(db: DB, actor: Actor, projectId: string, items: GoLiveItem[], expected?: Version) {
  const p = await getProject(db, actor, projectId);
  assertManage(actor, p);
  await assertFresh(db, actor, "onboarding", projectId, p.updatedAt, expected, "project");
  const merged = p.goLiveChecklist.map((it, i) => ({ ...it, done: !!items[i]?.done, na: !!items[i]?.na, note: items[i]?.note?.slice(0, 500) || undefined }));
  assertUpdated(await db.update(onboardingProjects).set({ goLiveChecklist: merged, updatedAt: new Date() })
    .where(and(eq(onboardingProjects.id, projectId), sameVersion(onboardingProjects.updatedAt, p.updatedAt))).returning({ id: onboardingProjects.id }), "project");
  await audit(db, actor, "onboarding.go_live_checklist", "onboarding", projectId, {
    checklist: { from: p.goLiveChecklist.filter((x) => x.done).length, to: merged.filter((x) => x.done).length },
  });
}

/**
 * Completion requires an explicit confirmation by an authorised onboarding owner with go-live/closure notes.
 * Ticking every task is not enough. Any outstanding item needs a documented exception, which is audit-logged.
 */
export async function completeProject(db: DB, actor: Actor, projectId: string, input: { notes: string; actualGoLive: string | null; exceptionReason: string | null }) {
  const d = await getProjectDetail(db, actor, projectId);
  if (!d.canComplete) throw forbidden("Only the onboarding owner or an onboarding manager can confirm completion.");
  if (d.p.state === "completed") throw conflict("Already completed.");
  if (d.p.state === "draft") throw conflict("This project has not started.");
  if (!input.notes?.trim() || input.notes.trim().length < 10) throw invalid("Record go-live / closure notes.", { notes: "At least 10 characters." });
  if (!input.actualGoLive) throw invalid("Record the actual go-live date.", { actualGoLive: "Required." });
  const outstanding: string[] = [];
  const unchecked = d.p.goLiveChecklist.filter((x) => !x.done && !x.na);
  if (unchecked.length) outstanding.push(`${unchecked.length} go-live checklist item(s) not confirmed`);
  const openTasks = d.tasks.filter((t) => t.status !== "done");
  if (openTasks.length) outstanding.push(`${openTasks.length} open task(s)`);
  const openBlockers = d.blockers.filter((b) => b.status === "open");
  if (openBlockers.length) outstanding.push(`${openBlockers.length} open blocker(s)`);
  if (d.training.gaps) outstanding.push(`${d.training.gaps} required training completion(s) outstanding`);
  if (outstanding.length && !input.exceptionReason?.trim())
    throw invalid(`Outstanding: ${outstanding.join("; ")}. Resolve them or record an exception reason.`, { exceptionReason: "Required while items are outstanding." });
  await db.update(onboardingProjects).set({
    state: "completed", stage: "completed", completedAt: new Date(), completedBy: actor.id, completionNotes: input.notes.trim(),
    actualGoLive: input.actualGoLive, completionException: outstanding.length ? `${outstanding.join("; ")} — ${input.exceptionReason!.trim()}` : null,
    riskLevel: "low", updatedAt: new Date(),
  }).where(eq(onboardingProjects.id, projectId));
  await audit(db, actor, outstanding.length ? "onboarding.completed_with_exception" : "onboarding.completed", "onboarding", projectId,
    { state: { from: d.p.state, to: "completed" } }, outstanding.length ? `${outstanding.join("; ")} — ${input.exceptionReason}` : input.notes);
  await syncHandoverFromProject(db, projectId, "completed", "completed");
}
