import { and, eq, inArray, isNull, lt, max, ne, notInArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  tickets, slaPolicies, slaEvents, tasks, leads, deals, pipelineStages, users, onboardingProjects, onboardingTasks, renewals,
  companies, customerHealthSnapshots,
} from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { ticketRef, todayIn, addDays } from "@/lib/format";
import { SYSTEM_ACTOR } from "../actor";
import { audit } from "../audit";
import { notifyUsers, usersWithRole } from "../notify";
import { getSettings } from "../settings";
import { clocksFor } from "./tickets";
import { emit } from "./workflows";
import { recomputeRisk } from "./onboarding";
import { computeCompanyHealth } from "./health";

async function event(db: DB, ticketId: string, kind: string, metric: string, details: string, dedupeKey: string) {
  const rows = await db.insert(slaEvents).values({ ticketId, kind, metric, details, dedupeKey }).onConflictDoNothing().returning({ id: slaEvents.id });
  return rows.length > 0;
}

/**
 * Evaluates every open ticket's SLA clocks and records warnings, escalations and breaches exactly once per
 * clock cycle (dedupe keys). Safe to run as often as you like.
 */
export async function runSlaSweep(db: DB, now = new Date()) {
  const out = { checked: 0, warnings: 0, escalations: 0, breaches: 0, updateOverdue: 0, followUps: 0 };
  const open = await db.select().from(tickets).where(and(inArray(tickets.status, OPEN_STATUSES), isNull(tickets.deletedAt)));
  const policies = await db.select().from(slaPolicies);
  const leads = await usersWithRole(db, ["support_lead"]);
  for (const t of open) {
    out.checked++;
    const policy = policies.find((p) => p.id === t.slaPolicyId) ?? policies.find((p) => p.isDefault);
    if (!policy) continue;
    const c = clocksFor(t, policy, now);
    if (!c) continue;
    const ref = ticketRef(t.number);
    for (const clock of [c.firstResponse, c.resolution]) {
      if (clock.completedAt) continue;
      const cycle = clock.metric === "resolution" ? t.reopenCount : 0;
      const key = `${t.id}:${clock.metric}:${cycle}`;
      const label = clock.metric === "first_response" ? "first response" : "resolution";
      const s = clock.state;
      const atLeast = (x: string) => ["warning", "escalate", "breached"].indexOf(s) >= ["warning", "escalate", "breached"].indexOf(x);
      if (s === "paused" || s === "ok") continue;
      if (atLeast("warning") && await event(db, t.id, "warning", clock.metric, `${clock.elapsedPct}% of ${label} target elapsed`, `${key}:warning`)) {
        out.warnings++;
        await notifyUsers(db, [t.ownerId], { kind: "sla", title: `SLA nearing breach (${label}): ${ref}`, body: t.subject, link: `/tickets/${t.id}`, dedupeKey: `${key}:warning` });
        await emit(db, "ticket.sla_warning", { entityId: t.id, dedupe: `${key}:warning`, ownerId: t.ownerId, metric: clock.metric, priority: t.priority, number: ref, link: `/tickets/${t.id}` });
      }
      if (atLeast("escalate") && await event(db, t.id, "escalated", clock.metric, `${clock.elapsedPct}% elapsed — escalated to Support Lead`, `${key}:escalate`)) {
        out.escalations++;
        await db.update(tickets).set({ escalationLevel: sql`greatest(${tickets.escalationLevel}, 1)` }).where(eq(tickets.id, t.id));
        await notifyUsers(db, leads, { kind: "sla", title: `SLA escalation (${label}): ${ref} ${t.priority}`, body: t.subject, link: `/tickets/${t.id}`, dedupeKey: `${key}:escalate` });
      }
      if (s === "breached" && await event(db, t.id, "breached", clock.metric, `${label} target missed`, `${key}:breach`)) {
        out.breaches++;
        await db.update(tickets).set({
          escalationLevel: sql`greatest(${tickets.escalationLevel}, 2)`,
          ...(clock.metric === "first_response" ? { firstResponseBreached: true } : { resolutionBreached: true }),
        }).where(eq(tickets.id, t.id));
        await notifyUsers(db, [t.ownerId, ...leads], { kind: "sla", title: `SLA BREACHED (${label}): ${ref} ${t.priority}`, body: t.subject, link: `/tickets/${t.id}`, dedupeKey: `${key}:breach` });
        const owner = t.ownerId ?? leads[0];
        if (owner) await db.insert(tasks).values({
          title: `SLA breached on ${ref}: post an update and next action`, ownerId: owner, dueAt: new Date(now.getTime() + 3600000), priority: "urgent",
          relatedType: "ticket", relatedId: t.id, companyId: t.companyId, dedupeKey: `${key}:breach-task`,
        }).onConflictDoNothing();
        await audit(db, SYSTEM_ACTOR, "ticket.sla_breached", "ticket", t.id, null, label);
        await emit(db, "ticket.sla_breached", { entityId: t.id, dedupe: `${key}:breach`, ownerId: t.ownerId, metric: clock.metric, priority: t.priority, number: ref, link: `/tickets/${t.id}` });
      }
    }
    if (t.nextUpdateDueAt && !t.slaPausedAt && t.nextUpdateDueAt < now && await event(db, t.id, "update_overdue", "update", "Customer update interval exceeded", `${t.id}:update:${t.nextUpdateDueAt.toISOString()}`)) {
      out.updateOverdue++;
      await notifyUsers(db, [t.ownerId, ...(t.priority === "P1" ? leads : [])], { kind: "sla", title: `Customer update overdue: ${ref}`, link: `/tickets/${t.id}`, dedupeKey: `${t.id}:update:${t.nextUpdateDueAt.toISOString()}` });
    }
    if (t.status === "waiting_on_customer" && t.waitingFollowUpAt && t.waitingFollowUpAt < now) {
      const n = await notifyUsers(db, [t.ownerId], { kind: "ticket", title: `Customer follow-up due: ${ref}`, body: t.waitingReason ?? undefined, link: `/tickets/${t.id}`, dedupeKey: `followup:${t.id}:${t.waitingFollowUpAt.toISOString()}` });
      out.followUps += n;
    }
  }
  return out;
}

export async function runAutomationSweep(db: DB, now = new Date()) {
  const s = await getSettings(db);
  const out = { idleLeads: 0, staleDeals: 0, overdueTasks: 0, projects: 0, milestones: 0, renewals: 0, health: 0 };
  const day = 86400000;

  const idle = await db.select({ l: leads, managerId: users.managerId }).from(leads).leftJoin(users, eq(users.id, leads.ownerId))
    .where(and(notInArray(leads.status, ["Converted", "Disqualified"]), isNull(leads.deletedAt), sql`coalesce(${leads.lastActivityAt}, ${leads.createdAt}) < ${new Date(now.getTime() - s.idleLeadDays * day).toISOString()}::timestamptz`));
  for (const { l, managerId } of idle) {
    const days = Math.floor((now.getTime() - (l.lastActivityAt ?? l.createdAt).getTime()) / day);
    await emit(db, "lead.idle", { entityId: l.id, dedupe: `${l.id}:${days >= s.idleLeadEscalateDays ? "escalate" : "remind"}`, relatedType: "lead", ownerId: l.ownerId, managerId, name: l.name, organization: l.organization ?? l.contactName, daysIdle: days, escalateDays: s.idleLeadEscalateDays, link: `/leads/${l.id}` });
    out.idleLeads++;
  }

  const open = await db.select({ d: deals, stale: pipelineStages.staleAfterDays, managerId: users.managerId }).from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).innerJoin(users, eq(users.id, deals.ownerId))
    .where(and(eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false), isNull(deals.deletedAt)));
  for (const { d, stale, managerId } of open) {
    const last = d.lastActivityAt ?? d.updatedAt;
    const days = Math.floor((now.getTime() - last.getTime()) / day);
    if (days >= (stale || s.staleDealDays)) {
      await emit(db, "deal.stale", { entityId: d.id, dedupe: `${d.id}:${last.toISOString().slice(0, 10)}`, relatedType: "deal", ownerId: d.ownerId, managerId, name: d.name, daysInactive: days, link: `/deals/${d.id}` });
      out.staleDeals++;
    }
  }

  const overdue = await db.select().from(tasks).where(and(eq(tasks.status, "open"), lt(tasks.dueAt, now)));
  for (const t of overdue) {
    await emit(db, "task.overdue", { entityId: t.id, ownerId: t.ownerId, title: t.title, link: "/tasks?due=overdue" });
    out.overdueTasks++;
  }

  const today = todayIn(s.timezone, now);
  const active = await db.select().from(onboardingProjects).where(inArray(onboardingProjects.state, ["active", "on_hold"]));
  for (const p of active) {
    await recomputeRisk(db, p.id);
    out.projects++;
    const late = await db.select().from(onboardingTasks).where(and(eq(onboardingTasks.projectId, p.id), eq(onboardingTasks.isMilestone, true), ne(onboardingTasks.status, "done"), lt(onboardingTasks.dueDate, today)));
    for (const m of late) {
      const daysLate = Math.round((Date.parse(today) - Date.parse(m.dueDate!)) / day);
      await emit(db, "onboarding.milestone_overdue", { entityId: m.id, relatedType: "onboarding", relatedId: p.id, ownerId: p.ownerId, name: p.name, milestone: m.title, daysLate, critical: daysLate > 7, link: `/onboarding/${p.id}` });
      out.milestones++;
    }
  }

  const due = await db.select({ r: renewals, csmId: companies.csmId, ownerId: companies.ownerId, name: companies.name }).from(renewals).innerJoin(companies, eq(companies.id, renewals.companyId))
    .where(and(eq(renewals.status, "upcoming"), lt(renewals.renewalDate, addDays(today, s.renewalNoticeDays))));
  for (const { r, csmId, ownerId, name } of due) {
    await emit(db, "renewal.approaching", { entityId: r.id, relatedType: "company", relatedId: r.companyId, companyId: r.companyId, ownerId: r.ownerId ?? csmId ?? ownerId, name, renewalDate: r.renewalDate, link: `/companies/${r.companyId}` });
    out.renewals++;
  }

  const customers = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.lifecycle, "customer"), isNull(companies.deletedAt)));
  const lastSnap = new Map((await db.select({ companyId: customerHealthSnapshots.companyId, at: max(customerHealthSnapshots.computedAt) })
    .from(customerHealthSnapshots).groupBy(customerHealthSnapshots.companyId)).map((r) => [r.companyId, r.at]));
  for (const c of customers) {
    const last = lastSnap.get(c.id);
    if (last && now.getTime() - new Date(last).getTime() < 20 * 3600000) continue;
    await computeCompanyHealth(db, c.id, now);
    out.health++;
  }
  return out;
}

export async function runAllSweeps(db: DB, now = new Date()) {
  const sla = await runSlaSweep(db, now);
  const automation = await runAutomationSweep(db, now);
  return { sla, automation, at: now.toISOString() };
}
