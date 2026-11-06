import { appUrl } from "@/lib/app-url";
import crypto from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import {
  users, roles, userRoles, rolePermissions, permissions, teams, invitations, pipelineStages, slaPolicies, auditLogs, customFields,
  workflowRules, workflowRuns, onboardingTemplates, onboardingTemplateTasks, products, type SlaTarget, type BusinessCalendar,
  type RuleAction, type RuleCondition,
} from "@/db/schema";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { DEAL_REQUIRABLE_FIELDS } from "@/lib/rules/sales";
import { TICKET_STATUSES } from "@/lib/rules/tickets";
import { type Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { conflict, invalid, notFound } from "../errors";
import { sha256 } from "../auth-core";
import { getSettings, saveSettings, type AppSettings } from "../settings";
import { ACTION_TYPES, TRIGGERS, retryRun } from "./workflows";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export async function listUsersWithRoles(db: DB) {
  const us = await db.select({ u: users, team: teams.name }).from(users).leftJoin(teams, eq(teams.id, users.teamId)).where(isNull(users.deletedAt)).orderBy(asc(users.name));
  const ur = await db.select({ userId: userRoles.userId, roleId: roles.id, key: roles.key, name: roles.name }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId));
  return us.map(({ u, team }) => ({
    id: u.id, name: u.name, email: u.email, title: u.title, active: u.active, teamId: u.teamId, team, managerId: u.managerId,
    lastLoginAt: u.lastLoginAt, roles: ur.filter((r) => r.userId === u.id),
  }));
}

export async function simpleUsers(db: DB) {
  return db.select({ id: users.id, name: users.name, teamId: users.teamId }).from(users).where(and(eq(users.active, true), isNull(users.deletedAt))).orderBy(asc(users.name));
}

export async function usersInRoles(db: DB, keys: string[]) {
  return db.selectDistinct({ id: users.id, name: users.name }).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(inArray(roles.key, keys), eq(users.active, true))).orderBy(asc(users.name));
}

export async function inviteUser(db: DB, actor: Actor, v: { email: string; name: string; roleId: string; teamId: string | null }) {
  assertCan(actor, "admin.users");
  const email = v.email?.trim().toLowerCase();
  const e: Record<string, string> = {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email.";
  if (!v.name?.trim()) e.name = "Name is required.";
  if (!v.roleId) e.roleId = "Choose a role.";
  if (Object.keys(e).length) throw invalid("Please correct the invitation.", e);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing?.active && existing.passwordHash) throw conflict("A user with this email already exists.");
  const token = crypto.randomBytes(24).toString("base64url");
  await db.insert(invitations).values({ email, name: v.name.trim(), roleId: v.roleId, teamId: v.teamId, tokenHash: sha256(token), invitedBy: actor.id, expiresAt: new Date(Date.now() + 7 * 86400000) });
  const [role] = await db.select().from(roles).where(eq(roles.id, v.roleId));
  await audit(db, actor, "user.invited", "user", email, { role: { from: null, to: role?.name } });
  return { token, url: `${appUrl()}/invite/${token}` };
}

export async function listInvitations(db: DB) {
  return db.select({ i: invitations, role: roles.name }).from(invitations).innerJoin(roles, eq(roles.id, invitations.roleId))
    .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).orderBy(desc(invitations.createdAt));
}

export async function revokeInvitation(db: DB, actor: Actor, id: string) {
  assertCan(actor, "admin.users");
  await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id));
  await audit(db, actor, "user.invitation_revoked", "invitation", id);
}

export async function setUserRoles(db: DB, actor: Actor, userId: string, roleIds: string[]) {
  assertCan(actor, "admin.users");
  const before = await db.select({ name: roles.name, key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
  const after = roleIds.length ? await db.select({ id: roles.id, name: roles.name, key: roles.key }).from(roles).where(inArray(roles.id, roleIds)) : [];
  if (userId === actor.id && before.some((r) => r.key === "super_admin") && !after.some((r) => r.key === "super_admin"))
    throw conflict("You cannot remove your own Super Admin role.");
  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    if (after.length) await tx.insert(userRoles).values(after.map((r) => ({ userId, roleId: r.id })));
    await audit(tx, actor, "user.roles_changed", "user", userId, { roles: { from: before.map((r) => r.name), to: after.map((r) => r.name) } });
  });
}

export async function updateUser(db: DB, actor: Actor, userId: string, v: { teamId: string | null; managerId: string | null; title: string | null; active: boolean }) {
  assertCan(actor, "admin.users");
  if (userId === actor.id && !v.active) throw conflict("You cannot deactivate yourself.");
  const [before] = await db.select().from(users).where(eq(users.id, userId));
  if (!before) throw notFound("User");
  await db.update(users).set({ ...v, updatedAt: new Date() }).where(eq(users.id, userId));
  await audit(db, actor, v.active ? "user.updated" : "user.deactivated", "user", userId, {
    ...(before.teamId !== v.teamId ? { teamId: { from: before.teamId, to: v.teamId } } : {}),
    ...(before.active !== v.active ? { active: { from: before.active, to: v.active } } : {}),
  });
}

export async function rolesWithPermissions(db: DB) {
  const rs = await db.select().from(roles).orderBy(asc(roles.name));
  const rp = await db.select().from(rolePermissions);
  return rs.map((r) => ({ ...r, permissions: rp.filter((x) => x.roleId === r.id).map((x) => x.permissionKey) }));
}

export async function setRolePermissions(db: DB, actor: Actor, roleId: string, keys: string[]) {
  assertCan(actor, "admin.roles");
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!role) throw notFound("Role");
  const valid = keys.filter((k) => (ALL_PERMISSIONS as string[]).includes(k));
  if (role.key === "super_admin" && !["admin.roles", "admin.users"].every((k) => valid.includes(k)))
    throw conflict("Super Admin must keep user and role administration to prevent lock-out.");
  const before = (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((x) => x.permissionKey);
  await db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (valid.length) await tx.insert(rolePermissions).values(valid.map((k) => ({ roleId, permissionKey: k })));
    await audit(tx, actor, "role.permissions_changed", "role", roleId, {
      added: { from: null, to: valid.filter((k) => !before.includes(k)) }, removed: { from: before.filter((k) => !valid.includes(k)), to: null },
    });
  });
}

export async function listPermissions(db: DB) {
  return db.select().from(permissions).orderBy(asc(permissions.category), asc(permissions.key));
}

export async function listTeams(db: DB) {
  return db.select().from(teams).orderBy(asc(teams.name));
}

export async function createTeam(db: DB, actor: Actor, name: string, kind: string) {
  assertCan(actor, "admin.users");
  if (!name?.trim()) throw invalid("Team name is required.", { name: "Required." });
  await db.insert(teams).values({ name: name.trim(), kind });
  await audit(db, actor, "team.created", "team", name);
}

// --------------------------------------------------------------- Pipelines

export async function updateStage(db: DB, actor: Actor, stageId: string, v: {
  name: string; probability: number; requiredFields: string[]; entryCriteria: string | null; exitCriteria: string | null; staleAfterDays: number;
}) {
  assertCan(actor, "admin.pipelines");
  const [s] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, stageId));
  if (!s) throw notFound("Stage");
  if (!v.name?.trim()) throw invalid("Stage name is required.", { name: "Required." });
  if (!(v.probability >= 0 && v.probability <= 100)) throw invalid("Probability is 0–100.", { probability: "0–100" });
  if (s.isWon && v.probability !== 100) throw invalid("Closed Won must be 100%.", { probability: "Must be 100." });
  if (s.isLost && v.probability !== 0) throw invalid("Closed Lost must be 0%.", { probability: "Must be 0." });
  const required = v.requiredFields.filter((f) => f in DEAL_REQUIRABLE_FIELDS);
  await db.update(pipelineStages).set({ ...v, requiredFields: required }).where(eq(pipelineStages.id, stageId));
  await audit(db, actor, "pipeline.stage_updated", "pipeline_stage", stageId, {
    probability: { from: s.probability, to: v.probability }, requiredFields: { from: s.requiredFields, to: required },
  });
}

// --------------------------------------------------------------- SLA

export async function listSlaPolicies(db: DB) {
  return db.select().from(slaPolicies).orderBy(desc(slaPolicies.isDefault), asc(slaPolicies.name));
}

export async function updateSlaPolicy(db: DB, actor: Actor, id: string, v: {
  name: string; description: string | null; calendar: BusinessCalendar; targets: Record<string, SlaTarget>; pauseStatuses: string[];
  automatedAckCountsAsResponse: boolean; active: boolean;
}, expected?: Version) {
  assertCan(actor, "admin.sla");
  const [p] = await db.select().from(slaPolicies).where(eq(slaPolicies.id, id));
  if (p) await assertFresh(db, actor, "sla_policy", id, p.updatedAt, expected, "SLA policy");
  if (!p) throw notFound("SLA policy");
  const e: Record<string, string> = {};
  try { new Intl.DateTimeFormat("en", { timeZone: v.calendar.timezone }); } catch { e.timezone = "Unknown IANA time zone."; }
  if (!/^\d{2}:\d{2}$/.test(v.calendar.start) || !/^\d{2}:\d{2}$/.test(v.calendar.end) || v.calendar.start >= v.calendar.end) e.hours = "Business hours must be HH:MM with start before end.";
  if (!v.calendar.workdays.length) e.workdays = "Choose at least one working day.";
  for (const h of v.calendar.holidays) if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) e.holidays = `Holiday “${h}” must be YYYY-MM-DD.`;
  for (const [pri, t] of Object.entries(v.targets)) {
    if (!(t.firstResponseMins > 0 && t.resolutionMins > 0 && t.updateMins > 0)) e[`${pri}`] = `${pri}: targets must be positive minutes.`;
    if (t.firstResponseMins > t.resolutionMins) e[`${pri}`] = `${pri}: first response cannot exceed resolution target.`;
    if (!(t.warnAtPct > 0 && t.warnAtPct < t.escalateAtPct && t.escalateAtPct < 100)) e[`${pri}`] = `${pri}: warn % < escalate % < 100.`;
  }
  const validStatuses = TICKET_STATUSES.map((s) => s.key) as string[];
  if (v.pauseStatuses.some((s) => !validStatuses.includes(s))) e.pauseStatuses = "Unknown status.";
  if (Object.keys(e).length) throw invalid("Please correct the SLA policy.", e);
  assertUpdated(await db.update(slaPolicies).set({ ...v, updatedAt: new Date() })
    .where(and(eq(slaPolicies.id, id), sameVersion(slaPolicies.updatedAt, p.updatedAt))).returning({ id: slaPolicies.id }), "SLA policy");
  await audit(db, actor, "sla.policy_updated", "sla_policy", id, {
    targets: { from: p.targets, to: v.targets }, pauseStatuses: { from: p.pauseStatuses, to: v.pauseStatuses }, calendar: { from: p.calendar, to: v.calendar },
  });
}

// --------------------------------------------------------------- Settings, custom fields, templates

export async function updateAppSettings(db: DB, actor: Actor, patch: Partial<AppSettings>) {
  assertCan(actor, "admin.settings");
  const before = await getSettings(db);
  if (patch.timezone) { try { new Intl.DateTimeFormat("en", { timeZone: patch.timezone }); } catch { throw invalid("Unknown time zone.", { timezone: "Use an IANA name such as Africa/Lagos." }); } }
  if (patch.currency && !/^[A-Z]{3}$/.test(patch.currency)) throw invalid("Currency must be a 3-letter ISO code.", { currency: "e.g. NGN" });
  const next = { ...before, ...patch };
  await saveSettings(db, next);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(patch) as (keyof AppSettings)[]) if (JSON.stringify(before[k]) !== JSON.stringify(next[k])) changes[k] = { from: before[k], to: next[k] };
  await audit(db, actor, "settings.updated", "settings", "app", changes);
}

export async function addCustomField(db: DB, actor: Actor, v: { entityType: string; label: string; fieldType: string; options: string[]; required: boolean }) {
  assertCan(actor, "admin.settings");
  if (v.entityType !== "company") throw invalid("Custom fields are currently supported on companies.");
  if (!v.label?.trim()) throw invalid("Label is required.", { label: "Required." });
  if (!["text", "number", "date", "select"].includes(v.fieldType)) throw invalid("Unknown field type.");
  if (v.fieldType === "select" && !v.options.length) throw invalid("Select fields need options.", { options: "Comma-separated options." });
  const key = v.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  await db.insert(customFields).values({ ...v, key, label: v.label.trim(), options: v.fieldType === "select" ? v.options : null });
  await audit(db, actor, "custom_field.created", "custom_field", key);
}

export async function deleteCustomField(db: DB, actor: Actor, id: string) {
  assertCan(actor, "admin.settings");
  await db.delete(customFields).where(eq(customFields.id, id));
  await audit(db, actor, "custom_field.deleted", "custom_field", id);
}

export async function listTemplates(db: DB) {
  const ts = await db.select({ t: onboardingTemplates, product: products.name }).from(onboardingTemplates).leftJoin(products, eq(products.id, onboardingTemplates.productId)).orderBy(asc(onboardingTemplates.name));
  const tasks = await db.select().from(onboardingTemplateTasks).orderBy(asc(onboardingTemplateTasks.position));
  return ts.map((x) => ({ ...x, tasks: tasks.filter((t) => t.templateId === x.t.id) }));
}

export async function saveTemplate(db: DB, actor: Actor, id: string | null, v: {
  name: string; productId: string | null; segment: string | null; durationDays: number; description: string | null;
  tasks: { title: string; stageKey: string; offsetDays: number; isMilestone: boolean; customerResponsibility: boolean; dependsOnPosition: number | null }[];
}) {
  assertCan(actor, "admin.settings");
  if (!v.name?.trim()) throw invalid("Template name is required.", { name: "Required." });
  if (!v.tasks.length) throw invalid("Add at least one task.", { tasks: "Required." });
  await db.transaction(async (tx) => {
    let tid = id;
    if (tid) await tx.update(onboardingTemplates).set({ name: v.name, productId: v.productId, segment: v.segment, durationDays: v.durationDays, description: v.description }).where(eq(onboardingTemplates.id, tid));
    else tid = (await tx.insert(onboardingTemplates).values({ name: v.name, productId: v.productId, segment: v.segment, durationDays: v.durationDays, description: v.description }).returning())[0].id;
    await tx.delete(onboardingTemplateTasks).where(eq(onboardingTemplateTasks.templateId, tid));
    await tx.insert(onboardingTemplateTasks).values(v.tasks.map((t, i) => ({ ...t, templateId: tid!, position: i + 1 })));
    await audit(tx, actor, id ? "template.updated" : "template.created", "onboarding_template", tid);
  });
}

// --------------------------------------------------------------- Workflows

export async function listRules(db: DB) {
  const rules = await db.select().from(workflowRules).orderBy(asc(workflowRules.trigger));
  const runs = await db.select().from(workflowRuns).orderBy(desc(workflowRuns.startedAt)).limit(100);
  return { rules, runs, triggers: TRIGGERS, actionTypes: ACTION_TYPES };
}

export async function updateRule(db: DB, actor: Actor, id: string, v: { enabled: boolean; name: string; conditionsJson: string; actionsJson: string }) {
  assertCan(actor, "admin.workflows");
  const [r] = await db.select().from(workflowRules).where(eq(workflowRules.id, id));
  if (!r) throw notFound("Rule");
  let conditions: RuleCondition[]; let actions: RuleAction[];
  try { conditions = JSON.parse(v.conditionsJson || "[]"); } catch { throw invalid("Conditions must be valid JSON.", { conditionsJson: "Invalid JSON." }); }
  try { actions = JSON.parse(v.actionsJson || "[]"); } catch { throw invalid("Actions must be valid JSON.", { actionsJson: "Invalid JSON." }); }
  if (!Array.isArray(conditions) || conditions.some((c) => !c.field || !["eq", "neq", "in", "gte", "lte", "exists"].includes(c.op)))
    throw invalid("Each condition needs a field and an op (eq, neq, in, gte, lte, exists).", { conditionsJson: "Invalid condition." });
  if (!Array.isArray(actions) || actions.some((a) => !(a.type in ACTION_TYPES)))
    throw invalid(`Action types must be one of: ${Object.keys(ACTION_TYPES).join(", ")}.`, { actionsJson: "Unknown action type." });
  await db.update(workflowRules).set({ enabled: v.enabled, name: v.name, conditions, actions, updatedAt: new Date() }).where(eq(workflowRules.id, id));
  await audit(db, actor, "workflow.rule_updated", "workflow_rule", id, { enabled: { from: r.enabled, to: v.enabled } });
}

export async function retryWorkflowRun(db: DB, actor: Actor, runId: string) {
  assertCan(actor, "admin.workflows");
  const res = await retryRun(db, runId);
  await audit(db, actor, "workflow.run_retried", "workflow_run", runId, null, res.message);
  return res;
}

// --------------------------------------------------------------- Audit

export async function listAudit(db: DB, actor: Actor, f: { q?: string; entity?: string; actor?: string; page?: string }) {
  assertCan(actor, "audit.view");
  const conds: (SQL | undefined)[] = [];
  if (f.entity) conds.push(eq(auditLogs.entityType, f.entity));
  if (f.actor) conds.push(eq(auditLogs.actorId, f.actor));
  if (f.q) conds.push(or(ilike(auditLogs.action, `%${f.q}%`), ilike(auditLogs.entityId, `%${f.q}%`), ilike(auditLogs.reason, `%${f.q}%`)));
  const page = Math.max(1, Number(f.page) || 1);
  return db.select().from(auditLogs).where(and(...conds)).orderBy(desc(auditLogs.createdAt)).limit(50).offset((page - 1) * 50);
}
