import { and, count, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import type { DB } from "@/db";
import { workflowRules, workflowRuns, tasks, users, leads, type RuleCondition, type RuleAction } from "@/db/schema";
import { notifyRoles, notifyUsers, usersWithRole } from "../notify";

/**
 * Configurable rule engine. Core business invariants (handover creation, onboarding project creation,
 * SLA calculation) are enforced in services and cannot be disabled; rules add configurable
 * side-effects such as notifications, follow-up tasks and assignment.
 *
 * Each (rule, idempotency key) runs at most once successfully. Failures are recorded with the error and
 * can be retried from Settings → Workflow rules (up to MAX_ATTEMPTS).
 */

export const TRIGGERS: Record<string, string> = {
  "lead.created": "Lead created",
  "lead.idle": "Lead idle beyond threshold",
  "activity.logged": "Activity logged",
  "deal.stale": "Deal inactive beyond threshold",
  "deal.closed_won": "Deal moved to Closed Won",
  "deal.discount_requested": "Discount approval requested",
  "handover.submitted": "Handover submitted",
  "handover.returned": "Handover returned to Sales",
  "handover.accepted": "Handover accepted",
  "onboarding.milestone_overdue": "Onboarding milestone overdue",
  "onboarding.training_gap": "Required training incomplete before go-live",
  "onboarding.high_risk": "Onboarding project became high risk",
  "ticket.created": "Ticket created",
  "ticket.sla_warning": "SLA at risk",
  "ticket.sla_breached": "SLA breached",
  "ticket.resolved": "Ticket resolved",
  "ticket.closed": "Ticket closed",
  "task.overdue": "Task overdue",
  "account.at_risk": "Customer health at risk",
  "renewal.approaching": "Renewal approaching",
};

export const ACTION_TYPES: Record<string, string> = {
  notify: "Notify people (owner, manager, assignee…)",
  notify_roles: "Notify everyone with a role",
  create_task: "Create a follow-up task",
  assign_lead: "Assign lead by territory/source map, else round-robin",
};

const MAX_ATTEMPTS = 3;

export type Payload = Record<string, unknown> & { entityId: string; dedupe?: string };

function getPath(o: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);
}

export function matches(conds: RuleCondition[], p: Record<string, unknown>) {
  return conds.every((c) => {
    const v = getPath(p, c.field);
    switch (c.op) {
      case "eq": return v === c.value;
      case "neq": return v !== c.value;
      case "in": return Array.isArray(c.value) && c.value.includes(v);
      case "gte": return typeof v === "number" && v >= Number(c.value);
      case "lte": return typeof v === "number" && v <= Number(c.value);
      case "exists": return v !== null && v !== undefined && v !== "";
      default: return false;
    }
  });
}

export const render = (tpl: unknown, p: Record<string, unknown>) =>
  String(tpl ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(getPath(p, k) ?? ""));

async function resolvePeople(db: DB, who: unknown, p: Record<string, unknown>) {
  const ids: string[] = [];
  for (const w of (Array.isArray(who) ? who : [who]) as string[]) {
    const v = p[`${w}Id`] ?? p[w];
    if (typeof v === "string") ids.push(v);
    if (w === "manager" && typeof p.ownerId === "string" && !p.managerId) {
      const [u] = await db.select({ m: users.managerId }).from(users).where(eq(users.id, p.ownerId));
      if (u?.m) ids.push(u.m);
    }
  }
  return ids;
}

async function runAction(db: DB, a: RuleAction, p: Payload, log: string[]) {
  const prm = a.params ?? {};
  const link = prm.link ? render(prm.link, p) : (p.link as string | undefined);
  switch (a.type) {
    case "notify": {
      const ids = await resolvePeople(db, prm.to, p);
      const n = await notifyUsers(db, ids, {
        kind: String(prm.kind ?? "workflow"), title: render(prm.title, p), body: render(prm.body, p), link,
        dedupeKey: `${render(prm.title, p)}:${p.dedupe ?? p.entityId}`,
      });
      log.push(`Notified ${n} user(s)`);
      return;
    }
    case "notify_roles": {
      const n = await notifyRoles(db, (prm.roles as string[]) ?? [], {
        kind: String(prm.kind ?? "workflow"), title: render(prm.title, p), body: render(prm.body, p), link,
        dedupeKey: `${render(prm.title, p)}:${p.dedupe ?? p.entityId}`,
      });
      log.push(`Notified ${n} user(s) in roles ${(prm.roles as string[]).join(", ")}`);
      return;
    }
    case "create_task": {
      const [ownerId] = await resolvePeople(db, prm.assignTo ?? "owner", p);
      if (!ownerId) { log.push("No assignee resolved; task skipped"); return; }
      const days = Number(prm.dueInDays ?? 1);
      const title = render(prm.title, p);
      const rows = await db.insert(tasks).values({
        title, description: render(prm.description ?? "", p) || null, ownerId,
        dueAt: new Date(Date.now() + days * 86400000), priority: String(prm.priority ?? "normal"),
        relatedType: (p.relatedType as string) ?? null, relatedId: (p.relatedId as string) ?? p.entityId,
        companyId: (p.companyId as string) ?? null, dedupeKey: `wf:${title}:${p.dedupe ?? p.entityId}`,
      }).onConflictDoNothing().returning({ id: tasks.id });
      log.push(rows.length ? `Created task “${title}”` : "Task already exists");
      return;
    }
    case "assign_lead": {
      if (p.ownerId) { log.push("Lead already has an owner"); return; }
      const map = (prm.map ?? {}) as Record<string, string>;
      const key = [p.region, p.source].find((k) => typeof k === "string" && map[k as string]);
      let ownerId: string | undefined;
      if (key) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, map[key as string]));
        ownerId = u?.id;
      }
      if (!ownerId) {
        const reps = await usersWithRole(db, ["sales_executive"]);
        if (reps.length) {
          const rows = await db.select({ ownerId: leads.ownerId, n: count() }).from(leads)
            .where(and(notInArray(leads.status, ["Converted", "Disqualified"]), isNotNull(leads.ownerId))).groupBy(leads.ownerId);
          const load = new Map(rows.map((r) => [r.ownerId, r.n]));
          ownerId = [...reps].sort((x, y) => (load.get(x) ?? 0) - (load.get(y) ?? 0))[0];
        }
      }
      if (!ownerId) { log.push("No sales executive available"); return; }
      await db.update(leads).set({ ownerId, updatedAt: new Date() }).where(and(eq(leads.id, p.entityId), isNull(leads.ownerId)));
      p.ownerId = ownerId;
      log.push(key ? `Assigned by territory/source map (${key})` : "Assigned round-robin by open lead load");
      return;
    }
    default:
      throw new Error(`Unknown action type “${a.type}”`);
  }
}

async function execute(db: DB, rule: typeof workflowRules.$inferSelect, runId: string, payload: Payload, attempts: number) {
  const log: string[] = [];
  try {
    for (const a of rule.actions) await runAction(db, a, payload, log);
    await db.update(workflowRuns).set({ status: "success", error: null, log, attempts, finishedAt: new Date() }).where(eq(workflowRuns.id, runId));
  } catch (e) {
    await db.update(workflowRuns).set({ status: "failed", error: (e as Error).message.slice(0, 500), log, attempts, finishedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
  }
}

/** Fires all enabled rules for a trigger. Never throws: failures are recorded on the run. */
export async function emit(db: DB, trigger: string, payload: Payload) {
  try {
    const rules = await db.select().from(workflowRules).where(and(eq(workflowRules.trigger, trigger), eq(workflowRules.enabled, true)));
    for (const rule of rules) {
      const key = `${rule.key}:${payload.dedupe ?? payload.entityId}`;
      if (!matches(rule.conditions, payload)) continue;
      const [run] = await db.insert(workflowRuns).values({ ruleId: rule.id, idempotencyKey: key, trigger, payload, status: "running" })
        .onConflictDoNothing().returning({ id: workflowRuns.id });
      if (!run) continue; // already ran for this key
      await execute(db, rule, run.id, { ...payload }, 1);
    }
  } catch (e) {
    console.error(`[workflow] ${trigger} failed to dispatch:`, (e as Error).message);
  }
}

export async function retryRun(db: DB, runId: string) {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  if (!run || run.status !== "failed") return { ok: false, message: "Only failed runs can be retried." };
  if (run.attempts >= MAX_ATTEMPTS) return { ok: false, message: `Retry limit (${MAX_ATTEMPTS}) reached.` };
  const [rule] = await db.select().from(workflowRules).where(eq(workflowRules.id, run.ruleId));
  if (!rule) return { ok: false, message: "Rule no longer exists." };
  await execute(db, rule, run.id, run.payload as Payload, run.attempts + 1);
  const [after] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  return { ok: after.status === "success", message: after.status === "success" ? "Run succeeded." : `Run failed again: ${after.error}` };
}
