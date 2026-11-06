import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import {
  leads, deals, pipelineStages, dealProducts, products, users, companies, handoverRecords, onboardingProjects, onboardingTasks,
  onboardingBlockers, trainingParticipants, trainingSessions, tickets, ticketEscalations, customerHealthSnapshots, renewals,
  expansionOpportunities, tasks, activities,
} from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { addDays, todayIn, ticketRef, fmtMoney, DEFAULT_TZ } from "@/lib/format";
import { zonedToUtc } from "@/lib/rules/sla";
import { type Actor, assertCan, can } from "../actor";
import { forbidden } from "../errors";
import { getSettings } from "../settings";
import { dealScope } from "./scope";

export type ReportFilters = { from: string; to: string; owner?: string; product?: string; segment?: string; team?: string; tz?: string };

export function defaultRange(tz: string): ReportFilters {
  const to = todayIn(tz);
  return { from: addDays(to, -89), to, tz };
}

const startOfDay = (key: string, tz: string) => { const [y, m, d] = key.split("-").map(Number); return zonedToUtc(y, m, d, 0, 0, tz); };
const bounds = (f: ReportFilters) => [startOfDay(f.from, f.tz ?? DEFAULT_TZ), startOfDay(addDays(f.to, 1), f.tz ?? DEFAULT_TZ)] as const;
const inRange = (col: SQL | Parameters<typeof gte>[0], f: ReportFilters) => { const [a, b] = bounds(f); return and(gte(col as never, a), lt(col as never, b)); };
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** Precise definitions shown next to every metric. */
export const DEFINITIONS: Record<string, string> = {
  leads_new: "Leads created in the period (excludes soft-deleted).",
  pipeline_open: "Sum of deal value for deals in non-terminal stages, as of now.",
  weighted: "Σ(deal value × stage probability, or the deal's probability override) for open deals.",
  deals_won: "Deals that entered Closed Won with closed date in the period.",
  deals_lost: "Deals that entered Closed Lost with closed date in the period.",
  win_rate: "Won ÷ (won + lost) for deals closed in the period.",
  cycle: "Average days from deal creation to Closed Won, for deals won in the period.",
  handover_accept: "Average hours from handover submission to acceptance, for handovers accepted in the period.",
  handover_return: "Handovers returned at least once ÷ handovers submitted in the period.",
  handovers_pending: "Handovers not yet accepted (Pending Sales Submission, Submitted, Changes Requested).",
  onboarding_active: "Onboarding projects in active or on-hold state.",
  onboarding_at_risk: "Active projects whose rule-based risk level is High.",
  milestones_overdue: "Open milestone tasks past due date on active projects.",
  training_rate: "Participants marked complete ÷ participants in sessions held in the period (cancelled excluded).",
  tickets_open: "Tickets in any open status, as of now.",
  tickets_p1p2: "Open tickets with priority P1 or P2.",
  sla_first: "Tickets created in the period whose first human response met the target ÷ those with a first response (or already breached).",
  sla_resolution: "Tickets resolved in the period within the resolution target ÷ tickets resolved in the period.",
  reopen_rate: "Tickets resolved in the period that have been reopened at least once ÷ tickets resolved in the period.",
  csat: "Average CSAT score (1–5) for tickets created in the period with a response.",
  frt: "Average wall-clock minutes from ticket creation to first human response (tickets created in the period).",
  ttr: "Average wall-clock hours from creation to resolution (tickets resolved in the period).",
  breaches: "Tickets created in the period that breached first-response or resolution targets.",
  eng_escalations: "Engineering escalations raised in the period.",
  accounts_at_risk: "Customers whose latest health snapshot is At Risk.",
  renewals_90: "Upcoming/in-progress renewals due in the next 90 days and their value.",
  expansion: "Open expansion opportunities (identified or qualified) and estimated value.",
  target: "Monthly target from Settings vs Closed Won value with closed date in the current month.",
};

function dealFilterConds(actor: Actor, f: ReportFilters): (SQL | undefined)[] {
  const c: (SQL | undefined)[] = [isNull(deals.deletedAt), dealScope(actor)];
  if (f.owner) c.push(eq(deals.ownerId, f.owner));
  if (f.segment) c.push(eq(companies.segment, f.segment));
  if (f.product) c.push(sql`exists (select 1 from deal_products dp where dp.deal_id = ${deals.id} and dp.product_id = ${f.product})`);
  return c;
}

export async function salesMetrics(db: DB, actor: Actor, f: ReportFilters) {
  if (!can(actor, "reports.sales", "reports.executive")) throw forbidden();
  const base = dealFilterConds(actor, f);
  const [open] = await db.select({
    n: count(), value: sql<number>`coalesce(sum(${deals.amount}),0)::float`,
    weighted: sql<number>`coalesce(sum(${deals.amount} * coalesce(${deals.probabilityOverride}, ${pipelineStages.probability}) / 100.0),0)::float`,
  }).from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...base, eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false)));
  const closed = await db.select({
    won: sql<number>`count(*) filter (where ${pipelineStages.isWon})::int`, lost: sql<number>`count(*) filter (where ${pipelineStages.isLost})::int`,
    wonValue: sql<number>`coalesce(sum(${deals.amount}) filter (where ${pipelineStages.isWon}),0)::float`,
    cycle: sql<number | null>`avg(extract(epoch from (${deals.closedAt} - ${deals.createdAt})) / 86400) filter (where ${pipelineStages.isWon})`,
  }).from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...base, inRange(deals.closedAt, f)));
  const c = closed[0];
  const byStage = await db.select({ stage: pipelineStages.name, position: pipelineStages.position, n: count(), value: sql<number>`coalesce(sum(${deals.amount}),0)::float` })
    .from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...base, eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false))).groupBy(pipelineStages.name, pipelineStages.position).orderBy(asc(pipelineStages.position));
  const forecast = await db.select({
    month: sql<string>`to_char(${deals.expectedCloseDate}::date, 'YYYY-MM')`,
    weighted: sql<number>`coalesce(sum(${deals.amount} * coalesce(${deals.probabilityOverride}, ${pipelineStages.probability}) / 100.0),0)::float`,
    commit: sql<number>`coalesce(sum(${deals.amount}) filter (where ${deals.forecastCategory} = 'commit'),0)::float`,
  }).from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...base, eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false), isNotNull(deals.expectedCloseDate)))
    .groupBy(sql`1`).orderBy(sql`1`).limit(6);
  const lossReasons = await db.select({ reason: deals.lossReason, n: count() }).from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...base, eq(pipelineStages.isLost, true), inRange(deals.closedAt, f))).groupBy(deals.lossReason).orderBy(desc(count()));
  // Column-aware range (gte/lt) so Dates are encoded via the column; raw Dates in sql`` crash postgres-js.
  const closedIn = inRange(deals.closedAt, f)!;
  const reps = await db.select({
    ownerId: users.id, name: users.name, won: sql<number>`count(*) filter (where ${pipelineStages.isWon} and ${closedIn})::int`,
    lost: sql<number>`count(*) filter (where ${pipelineStages.isLost} and ${closedIn})::int`,
    wonValue: sql<number>`coalesce(sum(${deals.amount}) filter (where ${pipelineStages.isWon} and ${closedIn}),0)::float`,
    openValue: sql<number>`coalesce(sum(${deals.amount}) filter (where not ${pipelineStages.isWon} and not ${pipelineStages.isLost}),0)::float`,
  }).from(deals).innerJoin(users, eq(users.id, deals.ownerId)).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...base)).groupBy(users.id, users.name).orderBy(desc(sql`4`));
  const leadConds = [isNull(leads.deletedAt), inRange(leads.createdAt, f), f.owner ? eq(leads.ownerId, f.owner) : undefined, f.segment ? eq(leads.segment, f.segment) : undefined,
    can(actor, "leads.view_all") ? undefined : eq(leads.ownerId, actor.id)];
  const sources = await db.select({ source: leads.source, n: count(), converted: sql<number>`count(*) filter (where ${leads.status} = 'Converted')::int` })
    .from(leads).where(and(...leadConds)).groupBy(leads.source).orderBy(desc(count()));
  const [leadTotals] = await db.select({ n: count() }).from(leads).where(and(...leadConds));
  const now = new Date();
  const taskConds = [inRange(tasks.dueAt, f), lt(tasks.dueAt, now), can(actor, "tasks.view_all") ? (f.owner ? eq(tasks.ownerId, f.owner) : undefined) : eq(tasks.ownerId, actor.id)];
  const [taskStats] = await db.select({ due: count(), done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int` }).from(tasks).where(and(...taskConds));
  const s = await getSettings(db);
  const monthStart = `${todayIn(s.timezone).slice(0, 7)}-01`;
  const [month] = await db.select({ v: sql<number>`coalesce(sum(${deals.amount}),0)::float` }).from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...dealFilterConds(actor, { ...f, owner: f.owner }), eq(pipelineStages.isWon, true), inRange(deals.closedAt, { from: monthStart, to: todayIn(s.timezone), tz: s.timezone })));
  return {
    open: { n: open.n, value: open.value, weighted: Math.round(open.weighted) },
    won: c.won, lost: c.lost, wonValue: c.wonValue, winRate: pct(c.won, c.won + c.lost), cycleDays: c.cycle === null ? null : Math.round(Number(c.cycle)),
    byStage, forecast, lossReasons, reps, sources, newLeads: leadTotals.n, activity: { due: taskStats.due, done: taskStats.done, rate: pct(taskStats.done, taskStats.due) },
    target: { monthly: s.monthlySalesTarget, actual: month.v, pct: pct(month.v, s.monthlySalesTarget) }, currency: s.currency,
  };
}

export async function onboardingMetrics(db: DB, actor: Actor, f: ReportFilters) {
  if (!can(actor, "reports.onboarding", "reports.executive")) throw forbidden();
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const queue = await db.select({ status: handoverRecords.status, n: count() }).from(handoverRecords).groupBy(handoverRecords.status);
  const [acc] = await db.select({
    hours: sql<number | null>`avg(extract(epoch from (${handoverRecords.acceptedAt} - ${handoverRecords.submittedAt})) / 3600)`, n: count(),
  }).from(handoverRecords).where(and(isNotNull(handoverRecords.acceptedAt), inRange(handoverRecords.acceptedAt, f)));
  const [ret] = await db.select({ submitted: count(), returned: sql<number>`count(*) filter (where ${handoverRecords.returnCount} > 0)::int` })
    .from(handoverRecords).where(and(isNotNull(handoverRecords.submittedAt), inRange(handoverRecords.submittedAt, f)));
  const incomplete = await db.select({ id: handoverRecords.id, completeness: handoverRecords.completeness, status: handoverRecords.status, deal: deals.name, owner: users.name, updatedAt: handoverRecords.updatedAt, createdAt: handoverRecords.createdAt })
    .from(handoverRecords).innerJoin(deals, eq(deals.id, handoverRecords.dealId)).innerJoin(users, eq(users.id, deals.ownerId))
    .where(inArray(handoverRecords.status, ["Pending Sales Submission", "Changes Requested", "Draft"])).orderBy(asc(handoverRecords.createdAt));
  const projects = await db.select({
    id: onboardingProjects.id, name: onboardingProjects.name, stage: onboardingProjects.stage, riskLevel: onboardingProjects.riskLevel, riskReasons: onboardingProjects.riskReasons,
    targetGoLive: onboardingProjects.targetGoLive, owner: users.name, companyId: onboardingProjects.companyId, state: onboardingProjects.state,
  }).from(onboardingProjects).leftJoin(users, eq(users.id, onboardingProjects.ownerId)).where(inArray(onboardingProjects.state, ["active", "on_hold"])).orderBy(asc(onboardingProjects.targetGoLive));
  const byStage = Object.entries(projects.reduce<Record<string, number>>((a, p) => ({ ...a, [p.stage]: (a[p.stage] ?? 0) + 1 }), {})).map(([stage, n]) => ({ stage, n }));
  const [ms] = await db.select({ n: count() }).from(onboardingTasks).innerJoin(onboardingProjects, eq(onboardingProjects.id, onboardingTasks.projectId))
    .where(and(eq(onboardingTasks.isMilestone, true), ne(onboardingTasks.status, "done"), lt(onboardingTasks.dueDate, today), inArray(onboardingProjects.state, ["active", "on_hold"])));
  const [bl] = await db.select({ n: count() }).from(onboardingBlockers).innerJoin(onboardingProjects, eq(onboardingProjects.id, onboardingBlockers.projectId))
    .where(and(eq(onboardingBlockers.status, "open"), inArray(onboardingProjects.state, ["active", "on_hold"])));
  const [tr] = await db.select({ n: count(), done: sql<number>`count(*) filter (where ${trainingParticipants.completed})::int` }).from(trainingParticipants)
    .innerJoin(trainingSessions, eq(trainingSessions.id, trainingParticipants.sessionId))
    .where(and(inRange(trainingSessions.startsAt, f), ne(trainingParticipants.attendance, "cancelled"), lt(trainingSessions.startsAt, new Date())));
  return {
    queue, acceptHours: acc.hours === null ? null : Math.round(Number(acc.hours) * 10) / 10, accepted: acc.n,
    returnRate: pct(ret.returned, ret.submitted), submitted: ret.submitted, incomplete,
    projects: projects.map((p) => ({ ...p, daysToGoLive: p.targetGoLive ? Math.round((Date.parse(p.targetGoLive) - Date.parse(today)) / 86400000) : null })),
    byStage, active: projects.length, atRisk: projects.filter((p) => p.riskLevel === "high").length, overdueMilestones: ms.n, openBlockers: bl.n,
    trainingRate: pct(tr.done, tr.n), trainingParticipants: tr.n,
    trainingGaps: projects.filter((p) => p.riskReasons.some((r) => r.includes("training"))).length,
  };
}

export async function supportMetrics(db: DB, actor: Actor, f: ReportFilters) {
  if (!can(actor, "reports.support", "reports.executive")) throw forbidden();
  const tconds = (extra: SQL | undefined) => and(isNull(tickets.deletedAt), f.product ? eq(tickets.productId, f.product) : undefined, f.owner ? eq(tickets.ownerId, f.owner) : undefined, f.team ? eq(tickets.teamId, f.team) : undefined, extra);
  const open = inArray(tickets.status, OPEN_STATUSES);
  const byPriority = await db.select({ priority: tickets.priority, n: count() }).from(tickets).where(tconds(open)).groupBy(tickets.priority).orderBy(asc(tickets.priority));
  const age = await db.select({
    bucket: sql<string>`case when now() - ${tickets.createdAt} < interval '1 day' then '<1d' when now() - ${tickets.createdAt} < interval '3 days' then '1–3d' when now() - ${tickets.createdAt} < interval '7 days' then '3–7d' else '>7d' end`,
    n: count(),
  }).from(tickets).where(tconds(open)).groupBy(sql`1`);
  const byOwner = await db.select({ owner: sql<string>`coalesce(${users.name}, 'Unassigned')`, n: count() }).from(tickets).leftJoin(users, eq(users.id, tickets.ownerId)).where(tconds(open)).groupBy(sql`1`).orderBy(desc(count()));
  const byProduct = await db.select({ product: sql<string>`coalesce(${products.name}, 'Unspecified')`, n: count() }).from(tickets).leftJoin(products, eq(products.id, tickets.productId)).where(tconds(inRange(tickets.createdAt, f))).groupBy(sql`1`).orderBy(desc(count()));
  const byCustomer = await db.select({ customer: sql<string>`coalesce(${companies.name}, 'Unknown')`, n: count() }).from(tickets).leftJoin(companies, eq(companies.id, tickets.companyId)).where(tconds(inRange(tickets.createdAt, f))).groupBy(sql`1`).orderBy(desc(count())).limit(8);
  const [created] = await db.select({
    n: count(), frtMins: sql<number | null>`avg(extract(epoch from (${tickets.firstRespondedAt} - ${tickets.createdAt})) / 60)`,
    frMet: sql<number>`count(*) filter (where ${tickets.firstRespondedAt} is not null and not ${tickets.firstResponseBreached})::int`,
    frMeasured: sql<number>`count(*) filter (where ${tickets.firstRespondedAt} is not null or ${tickets.firstResponseBreached})::int`,
    breaches: sql<number>`count(*) filter (where ${tickets.firstResponseBreached} or ${tickets.resolutionBreached})::int`,
    csat: sql<number | null>`avg(${tickets.csatScore})`, csatN: sql<number>`count(${tickets.csatScore})::int`,
  }).from(tickets).where(tconds(inRange(tickets.createdAt, f)));
  const [resolved] = await db.select({
    n: count(), met: sql<number>`count(*) filter (where not ${tickets.resolutionBreached})::int`,
    reopened: sql<number>`count(*) filter (where ${tickets.reopenCount} > 0)::int`,
    ttrHours: sql<number | null>`avg(extract(epoch from (${tickets.resolvedAt} - ${tickets.createdAt})) / 3600)`,
  }).from(tickets).where(tconds(and(isNotNull(tickets.resolvedAt), inRange(tickets.resolvedAt, f))));
  const codes = await db.select({ code: tickets.resolutionCode, n: count() }).from(tickets).where(tconds(and(isNotNull(tickets.resolvedAt), inRange(tickets.resolvedAt, f)))).groupBy(tickets.resolutionCode).orderBy(desc(count()));
  const [oldest] = await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, createdAt: tickets.createdAt }).from(tickets).where(tconds(open)).orderBy(asc(tickets.createdAt)).limit(1);
  const [eng] = await db.select({ n: count() }).from(ticketEscalations).where(and(eq(ticketEscalations.kind, "engineering"), inRange(ticketEscalations.createdAt, f)));
  const openTotal = byPriority.reduce((s, x) => s + x.n, 0);
  return {
    openTotal, byPriority, p1p2: byPriority.filter((x) => x.priority === "P1" || x.priority === "P2").reduce((s, x) => s + x.n, 0),
    age, byOwner, byProduct, byCustomer, created: created.n,
    frtMins: created.frtMins === null ? null : Math.round(Number(created.frtMins)), slaFirst: pct(created.frMet, created.frMeasured),
    breaches: created.breaches, csat: created.csat === null ? null : Math.round(Number(created.csat) * 10) / 10, csatN: created.csatN,
    resolved: resolved.n, slaResolution: pct(resolved.met, resolved.n), reopenRate: pct(resolved.reopened, resolved.n),
    ttrHours: resolved.ttrHours === null ? null : Math.round(Number(resolved.ttrHours) * 10) / 10, codes, oldest: oldest ?? null, engEscalations: eng.n,
  };
}

export async function successMetrics(db: DB, actor: Actor) {
  if (!can(actor, "reports.executive", "success.view")) throw forbidden();
  const latest = await db.select({ companyId: customerHealthSnapshots.companyId, status: customerHealthSnapshots.status, at: customerHealthSnapshots.computedAt })
    .from(customerHealthSnapshots).orderBy(desc(customerHealthSnapshots.computedAt));
  const seen = new Set<string>();
  const current = latest.filter((x) => (seen.has(x.companyId) ? false : (seen.add(x.companyId), true)));
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  const [ren] = await db.select({ n: count(), v: sql<number>`coalesce(sum(${renewals.amount}),0)::float` }).from(renewals)
    .where(and(inArray(renewals.status, ["upcoming", "in_progress"]), lt(renewals.renewalDate, addDays(today, 90))));
  const [exp] = await db.select({ n: count(), v: sql<number>`coalesce(sum(${expansionOpportunities.estimatedValue}),0)::float` }).from(expansionOpportunities)
    .where(inArray(expansionOpportunities.status, ["identified", "qualified"]));
  return { atRisk: current.filter((c) => c.status === "at_risk").length, watch: current.filter((c) => c.status === "watch").length, healthy: current.filter((c) => c.status === "healthy").length, renewals: ren, expansion: exp };
}

export async function executiveDashboard(db: DB, actor: Actor, f: ReportFilters) {
  assertCan(actor, "reports.executive");
  const [sales, onboarding, support, success] = await Promise.all([salesMetrics(db, actor, f), onboardingMetrics(db, actor, f), supportMetrics(db, actor, f), successMetrics(db, actor)]);
  return { sales, onboarding, support, success };
}

// ----------------------------------------------------------------- Drill-down

export const DRILLS: Record<string, { label: string; perm: Parameters<typeof can>[1][] }> = {
  leads_new: { label: "New leads", perm: ["reports.sales", "reports.executive"] },
  pipeline_open: { label: "Open pipeline", perm: ["reports.sales", "reports.executive"] },
  deals_won: { label: "Deals won", perm: ["reports.sales", "reports.executive"] },
  deals_lost: { label: "Deals lost", perm: ["reports.sales", "reports.executive"] },
  stale_deals: { label: "Stale deals", perm: ["reports.sales", "reports.executive"] },
  handovers_pending: { label: "Handovers awaiting acceptance", perm: ["reports.onboarding", "reports.executive"] },
  onboarding_at_risk: { label: "High-risk onboarding projects", perm: ["reports.onboarding", "reports.executive"] },
  milestones_overdue: { label: "Overdue milestones", perm: ["reports.onboarding", "reports.executive"] },
  tickets_open: { label: "Open tickets", perm: ["reports.support", "reports.executive"] },
  tickets_breached: { label: "Tickets with SLA breaches", perm: ["reports.support", "reports.executive"] },
  tickets_reopened: { label: "Reopened tickets (resolved in period)", perm: ["reports.support", "reports.executive"] },
  accounts_at_risk: { label: "At-risk accounts", perm: ["reports.executive", "success.view"] },
  renewals_90: { label: "Renewals due in 90 days", perm: ["reports.executive", "success.view"] },
};

export type DrillRow = { id: string; href: string; cells: string[] };

export async function drill(db: DB, actor: Actor, key: string, f: ReportFilters): Promise<{ label: string; headers: string[]; rows: DrillRow[]; definition?: string }> {
  const d = DRILLS[key];
  if (!d || !can(actor, ...d.perm)) throw forbidden();
  const s = await getSettings(db);
  const money = (n: number | null, c = s.currency) => fmtMoney(n, c);
  const dealQ = (extra: SQL | undefined) => db.select({ id: deals.id, name: deals.name, company: companies.name, amount: deals.amount, currency: deals.currency, stage: pipelineStages.name, owner: users.name, closedAt: deals.closedAt, close: deals.expectedCloseDate, lossReason: deals.lossReason, last: deals.lastActivityAt })
    .from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId)).innerJoin(users, eq(users.id, deals.ownerId))
    .where(and(...dealFilterConds(actor, f), extra)).orderBy(desc(deals.amount)).limit(500);
  switch (key) {
    case "leads_new": {
      const rows = await db.select({ id: leads.id, name: leads.name, org: leads.organization, source: leads.source, status: leads.status, createdAt: leads.createdAt }).from(leads)
        .where(and(isNull(leads.deletedAt), inRange(leads.createdAt, f), can(actor, "leads.view_all") ? undefined : eq(leads.ownerId, actor.id))).orderBy(desc(leads.createdAt));
      return { label: d.label, definition: DEFINITIONS.leads_new, headers: ["Lead", "Organisation", "Source", "Status", "Created"], rows: rows.map((r) => ({ id: r.id, href: `/leads/${r.id}`, cells: [r.name, r.org ?? "Individual", r.source, r.status, r.createdAt.toISOString().slice(0, 10)] })) };
    }
    case "pipeline_open":
    case "deals_won":
    case "deals_lost":
    case "stale_deals": {
      const extra = key === "pipeline_open" ? and(eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false))
        : key === "deals_won" ? and(eq(pipelineStages.isWon, true), inRange(deals.closedAt, f))
        : key === "deals_lost" ? and(eq(pipelineStages.isLost, true), inRange(deals.closedAt, f))
        : and(eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false), sql`coalesce(${deals.lastActivityAt}, ${deals.updatedAt}) < now() - (${pipelineStages.staleAfterDays} || ' days')::interval`);
      const rows = await dealQ(extra);
      return { label: d.label, definition: DEFINITIONS[key === "stale_deals" ? "pipeline_open" : key], headers: ["Deal", "Company", "Value", "Stage", "Owner", key === "deals_lost" ? "Loss reason" : "Close"], rows: rows.map((r) => ({ id: r.id, href: `/deals/${r.id}`, cells: [r.name, r.company, money(r.amount, r.currency), r.stage, r.owner, key === "deals_lost" ? r.lossReason ?? "—" : (r.closedAt?.toISOString().slice(0, 10) ?? r.close ?? "—")] })) };
    }
    case "handovers_pending": {
      const rows = await db.select({ id: handoverRecords.id, status: handoverRecords.status, completeness: handoverRecords.completeness, deal: deals.name, owner: users.name, createdAt: handoverRecords.createdAt })
        .from(handoverRecords).innerJoin(deals, eq(deals.id, handoverRecords.dealId)).innerJoin(users, eq(users.id, deals.ownerId))
        .where(inArray(handoverRecords.status, ["Draft", "Pending Sales Submission", "Submitted for Review", "Changes Requested"])).orderBy(asc(handoverRecords.createdAt));
      return { label: d.label, definition: DEFINITIONS.handovers_pending, headers: ["Deal", "Status", "Complete", "Sales owner", "Since"], rows: rows.map((r) => ({ id: r.id, href: `/handovers/${r.id}`, cells: [r.deal, r.status, `${r.completeness}%`, r.owner, r.createdAt.toISOString().slice(0, 10)] })) };
    }
    case "onboarding_at_risk": {
      const rows = await db.select({ id: onboardingProjects.id, name: onboardingProjects.name, reasons: onboardingProjects.riskReasons, target: onboardingProjects.targetGoLive, owner: users.name })
        .from(onboardingProjects).leftJoin(users, eq(users.id, onboardingProjects.ownerId)).where(and(eq(onboardingProjects.riskLevel, "high"), inArray(onboardingProjects.state, ["active", "on_hold"])));
      return { label: d.label, definition: DEFINITIONS.onboarding_at_risk, headers: ["Project", "Owner", "Target go-live", "Reasons"], rows: rows.map((r) => ({ id: r.id, href: `/onboarding/${r.id}`, cells: [r.name, r.owner ?? "—", r.target ?? "—", r.reasons.join("; ")] })) };
    }
    case "milestones_overdue": {
      const today = todayIn(s.timezone);
      const rows = await db.select({ id: onboardingTasks.id, title: onboardingTasks.title, due: onboardingTasks.dueDate, project: onboardingProjects.name, pid: onboardingProjects.id })
        .from(onboardingTasks).innerJoin(onboardingProjects, eq(onboardingProjects.id, onboardingTasks.projectId))
        .where(and(eq(onboardingTasks.isMilestone, true), ne(onboardingTasks.status, "done"), lt(onboardingTasks.dueDate, today), inArray(onboardingProjects.state, ["active", "on_hold"])));
      return { label: d.label, definition: DEFINITIONS.milestones_overdue, headers: ["Milestone", "Project", "Due"], rows: rows.map((r) => ({ id: r.id, href: `/onboarding/${r.pid}`, cells: [r.title, r.project, r.due ?? "—"] })) };
    }
    case "tickets_open":
    case "tickets_breached":
    case "tickets_reopened": {
      const extra = key === "tickets_open" ? inArray(tickets.status, OPEN_STATUSES)
        : key === "tickets_breached" ? and(inRange(tickets.createdAt, f), or(eq(tickets.firstResponseBreached, true), eq(tickets.resolutionBreached, true)))
        : and(isNotNull(tickets.resolvedAt), inRange(tickets.resolvedAt, f), sql`${tickets.reopenCount} > 0`);
      const rows = await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, priority: tickets.priority, status: tickets.status, company: companies.name, createdAt: tickets.createdAt })
        .from(tickets).leftJoin(companies, eq(companies.id, tickets.companyId)).where(and(isNull(tickets.deletedAt), extra)).orderBy(asc(tickets.priority), asc(tickets.createdAt)).limit(500);
      return { label: d.label, definition: DEFINITIONS[key === "tickets_breached" ? "breaches" : key === "tickets_reopened" ? "reopen_rate" : "tickets_open"], headers: ["Ticket", "Subject", "Priority", "Status", "Customer", "Created"], rows: rows.map((r) => ({ id: r.id, href: `/tickets/${r.id}`, cells: [ticketRef(r.number), r.subject, r.priority, r.status, r.company ?? "—", r.createdAt.toISOString().slice(0, 10)] })) };
    }
    case "accounts_at_risk": {
      const snaps = await db.select({ companyId: customerHealthSnapshots.companyId, status: customerHealthSnapshots.status, score: customerHealthSnapshots.score, name: companies.name })
        .from(customerHealthSnapshots).innerJoin(companies, eq(companies.id, customerHealthSnapshots.companyId)).orderBy(desc(customerHealthSnapshots.computedAt));
      const seen = new Set<string>();
      const rows = snaps.filter((x) => (seen.has(x.companyId) ? false : (seen.add(x.companyId), true))).filter((x) => x.status === "at_risk");
      return { label: d.label, definition: DEFINITIONS.accounts_at_risk, headers: ["Customer", "Score"], rows: rows.map((r) => ({ id: r.companyId, href: `/companies/${r.companyId}`, cells: [r.name, String(r.score)] })) };
    }
    case "renewals_90": {
      const today = todayIn(s.timezone);
      const rows = await db.select({ id: renewals.id, companyId: renewals.companyId, name: companies.name, date: renewals.renewalDate, amount: renewals.amount, currency: renewals.currency, status: renewals.status })
        .from(renewals).innerJoin(companies, eq(companies.id, renewals.companyId)).where(and(inArray(renewals.status, ["upcoming", "in_progress"]), lt(renewals.renewalDate, addDays(today, 90)))).orderBy(asc(renewals.renewalDate));
      return { label: d.label, definition: DEFINITIONS.renewals_90, headers: ["Customer", "Renewal date", "Value", "Status"], rows: rows.map((r) => ({ id: r.id, href: `/companies/${r.companyId}`, cells: [r.name, r.date, money(r.amount, r.currency), r.status] })) };
    }
  }
  throw forbidden();
}

// ----------------------------------------------------------------- Daily workspace

export async function myWorkspace(db: DB, actor: Actor) {
  const s = await getSettings(db);
  const now = new Date();
  const today = todayIn(s.timezone, now);
  const [y, m, d] = today.split("-").map(Number);
  const dayStart = zonedToUtc(y, m, d, 0, 0, s.timezone);
  const dayEnd = zonedToUtc(y, m, d, 23, 59, s.timezone);
  const myTasks = await db.select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority, relatedType: tasks.relatedType, relatedId: tasks.relatedId, companyName: companies.name })
    .from(tasks).leftJoin(companies, eq(companies.id, tasks.companyId)).where(and(eq(tasks.ownerId, actor.id), eq(tasks.status, "open"), lt(tasks.dueAt, new Date(dayEnd.getTime() + 7 * 86400000)))).orderBy(asc(tasks.dueAt));
  const appointments = await db.select({ id: activities.id, type: activities.type, subject: activities.subject, scheduledFor: activities.scheduledFor, companyName: companies.name, dealId: activities.dealId, companyId: activities.companyId })
    .from(activities).leftJoin(companies, eq(companies.id, activities.companyId))
    .where(and(eq(activities.createdBy, actor.id), gte(activities.scheduledFor, dayStart), lt(activities.scheduledFor, dayEnd))).orderBy(asc(activities.scheduledFor));
  const sessions = can(actor, "training.view_assigned", "training.view_all")
    ? await db.select({ id: trainingSessions.id, title: trainingSessions.title, startsAt: trainingSessions.startsAt, companyName: companies.name }).from(trainingSessions).innerJoin(companies, eq(companies.id, trainingSessions.companyId))
        .where(and(eq(trainingSessions.facilitatorId, actor.id), gte(trainingSessions.startsAt, dayStart), lt(trainingSessions.startsAt, dayEnd)))
    : [];
  const attention = can(actor, "deals.view_own", "deals.view_all")
    ? (await db.select({ id: deals.id, name: deals.name, company: companies.name, amount: deals.amount, currency: deals.currency, stage: pipelineStages.name, nextStep: deals.nextStep, nextStepDue: deals.nextStepDue, last: deals.lastActivityAt, stale: pipelineStages.staleAfterDays, discountStatus: deals.discountStatus })
        .from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(companies, eq(companies.id, deals.companyId))
        .where(and(eq(deals.ownerId, actor.id), eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false), isNull(deals.deletedAt))))
        .map((x) => {
          const reasons: string[] = [];
          if (!x.nextStep || !x.nextStepDue) reasons.push("No next step");
          else if (x.nextStepDue < today) reasons.push(`Next step overdue (${x.nextStepDue})`);
          const days = x.last ? Math.floor((now.getTime() - x.last.getTime()) / 86400000) : 999;
          if (days >= x.stale) reasons.push(`No activity for ${days} days`);
          if (x.discountStatus === "pending") reasons.push("Discount awaiting approval");
          return { ...x, reasons };
        }).filter((x) => x.reasons.length)
    : [];
  const myHandovers = can(actor, "handover.submit")
    ? await db.select({ id: handoverRecords.id, status: handoverRecords.status, completeness: handoverRecords.completeness, deal: deals.name }).from(handoverRecords).innerJoin(deals, eq(deals.id, handoverRecords.dealId))
        .where(and(eq(deals.ownerId, actor.id), inArray(handoverRecords.status, ["Pending Sales Submission", "Changes Requested", "Draft"])))
    : [];
  const myTickets = can(actor, "tickets.view_assigned", "tickets.view_all")
    ? await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, priority: tickets.priority, status: tickets.status, resolutionDueAt: tickets.resolutionDueAt })
        .from(tickets).where(and(eq(tickets.ownerId, actor.id), inArray(tickets.status, OPEN_STATUSES))).orderBy(asc(tickets.priority), asc(tickets.resolutionDueAt)).limit(10)
    : [];
  return {
    overdue: myTasks.filter((t) => t.dueAt && t.dueAt < now), dueToday: myTasks.filter((t) => t.dueAt && t.dueAt >= now && t.dueAt <= dayEnd),
    upcoming: myTasks.filter((t) => t.dueAt && t.dueAt > dayEnd), appointments, sessions, attention, myHandovers, myTickets, today,
  };
}

export async function globalSearch(db: DB, actor: Actor, q: string) {
  if (!q || q.trim().length < 2) return [];
  const like = `%${q.trim()}%`;
  const out: { type: string; id: string; title: string; sub: string; href: string }[] = [];
  const { companyScope, leadScope, ticketScope } = await import("./scope");
  if (can(actor, "accounts.view_all", "accounts.view_own")) {
    const cs = await db.select({ id: companies.id, name: companies.name, city: companies.city }).from(companies).where(and(isNull(companies.deletedAt), companyScope(db, actor), sql`${companies.name} ilike ${like}`)).limit(6);
    out.push(...cs.map((c) => ({ type: "Company", id: c.id, title: c.name, sub: c.city ?? "", href: `/companies/${c.id}` })));
    const { contacts } = await import("@/db/schema");
    const ps = await db.select({ id: contacts.id, f: contacts.firstName, l: contacts.lastName, e: contacts.email }).from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(and(isNull(contacts.deletedAt), companyScope(db, actor), or(sql`(${contacts.firstName} || ' ' || ${contacts.lastName}) ilike ${like}`, sql`${contacts.email} ilike ${like}`))).limit(6);
    out.push(...ps.map((c) => ({ type: "Contact", id: c.id, title: `${c.f} ${c.l}`, sub: c.e ?? "", href: `/contacts/${c.id}` })));
  }
  if (can(actor, "leads.view_all", "leads.view_own")) {
    const ls = await db.select({ id: leads.id, name: leads.name, org: leads.organization }).from(leads).where(and(isNull(leads.deletedAt), leadScope(actor), or(sql`${leads.name} ilike ${like}`, sql`${leads.organization} ilike ${like}`))).limit(5);
    out.push(...ls.map((l) => ({ type: "Lead", id: l.id, title: l.name, sub: l.org ?? "Individual", href: `/leads/${l.id}` })));
  }
  if (can(actor, "deals.view_all", "deals.view_own")) {
    const ds = await db.select({ id: deals.id, name: deals.name }).from(deals).where(and(isNull(deals.deletedAt), dealScope(actor), sql`${deals.name} ilike ${like}`)).limit(5);
    out.push(...ds.map((d) => ({ type: "Deal", id: d.id, title: d.name, sub: "", href: `/deals/${d.id}` })));
  }
  const ts = await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject }).from(tickets)
    .where(and(isNull(tickets.deletedAt), ticketScope(db, actor), or(sql`${tickets.subject} ilike ${like}`, sql`('AFL-' || ${tickets.number}) ilike ${like}`))).limit(5);
  out.push(...ts.map((t) => ({ type: "Ticket", id: t.id, title: `${ticketRef(t.number)} ${t.subject}`, sub: "", href: `/tickets/${t.id}` })));
  return out;
}
