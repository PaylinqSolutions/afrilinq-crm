import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { activities, auditLogs, companies, contacts, deals, pipelineStages, tickets, users } from "@/db/schema";
import { CONTACT_LEAD_STATUSES, leadStatusLabel, normalisePhone } from "@/lib/rules/contacts";
import { SEGMENTS, TIERS } from "@/lib/rules/sales";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { type Actor, assertCan, can } from "../actor";
import { audit, diff } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { companyScope } from "./scope";
import { customer360, getCompany } from "./accounts";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export const COMPANY_LIFECYCLES = [{ key: "prospect", label: "Prospect" }, { key: "customer", label: "Customer" }, { key: "churned", label: "Churned" }] as const;
export const lifecycleName = (k: string) => COMPANY_LIFECYCLES.find((l) => l.key === k)?.label ?? k;

/** Everything the Companies table needs, scoped to the viewer, with counts for contacts, open deals and open tickets. */
export async function workspaceCompanies(db: DB, actor: Actor) {
  // Subqueries reference the outer row explicitly; drizzle prints bare column names in single-table selects.
  const co = sql.raw(`"companies"."id"`);
  const owner = sql<string | null>`(select name from users u where u.id = "companies"."owner_id")`;
  const rows = await db.select({
    id: companies.id, name: companies.name, industry: companies.industry, segment: companies.segment, tier: companies.tier, lifecycle: companies.lifecycle,
    region: companies.region, city: companies.city, website: companies.website, phone: companies.phone, ownerId: companies.ownerId, ownerName: owner,
    csmId: companies.csmId, leadStatus: companies.leadStatus, employees: companies.employees, annualRevenue: companies.annualRevenue,
    createdAt: companies.createdAt, updatedAt: companies.updatedAt,
    lastActivityAt: sql<string | null>`(select max(occurred_at) from activities a where a.company_id = ${co} and a.scheduled_for is null)`,
    contactCount: sql<number>`(select count(*) from contacts c where c.company_id = ${co} and c.deleted_at is null)::int`,
    openDeals: sql<number>`(select count(*) from deals d join pipeline_stages s on s.id = d.stage_id where d.company_id = ${co} and d.deleted_at is null and not s.is_won and not s.is_lost)::int`,
    openTickets: sql<number>`(select count(*) from tickets t where t.company_id = ${co} and t.deleted_at is null and t.status in (${sql.join(OPEN_STATUSES.map((x) => sql`${x}`), sql`, `)}))::int`,
  }).from(companies).where(and(isNull(companies.deletedAt), companyScope(db, actor))).orderBy(desc(companies.createdAt)).limit(5000);
  return rows.map((r) => ({ ...r, lastActivityAt: r.lastActivityAt ? new Date(r.lastActivityAt) : null }));
}

const url = z.string().trim().max(300).nullable().refine((v) => !v || /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v), "Enter a valid web address.");
const patchSchema = z.object({
  name: z.string().trim().min(2, "Company name is required.").max(160), industry: z.string().trim().max(80).nullable(),
  segment: z.enum(SEGMENTS as [string, ...string[]]), tier: z.enum(TIERS as [string, ...string[]]),
  lifecycle: z.enum(["prospect", "customer", "churned"]), region: z.string().trim().max(60).nullable(), city: z.string().trim().max(60).nullable(),
  address: z.string().trim().max(300).nullable(), postalCode: z.string().trim().max(20).nullable(), website: url, linkedinUrl: url,
  phone: z.string().trim().max(40).nullable(), ownerId: z.string().uuid().nullable(), csmId: z.string().uuid().nullable(),
  leadStatus: z.string().nullable().refine((v) => !v || CONTACT_LEAD_STATUSES.some((s) => s.key === v), "Unknown lead status."),
  employees: z.number().int().min(0, "Can't be negative.").max(10_000_000).nullable(), annualRevenue: z.number().min(0, "Can't be negative.").nullable(),
  timeZone: z.string().trim().max(60).nullable(), notes: z.string().trim().max(5000).nullable(),
}).partial();
export type CompanyPatch = Record<string, string | number | null>;

/** Inline edit of one or more company properties, with conflict detection and an audit entry. */
export async function patchCompany(db: DB, actor: Actor, id: string, patch: CompanyPatch, expected: Version) {
  assertCan(actor, "accounts.edit");
  const before = await getCompany(db, actor, id);
  await assertFresh(db, actor, "company", id, before.updatedAt, expected, "company");
  const clean = Object.fromEntries(Object.entries(patch).map(([k, v]) => {
    if (typeof v === "string" && v.trim() === "") return [k, null];
    if ((k === "employees" || k === "annualRevenue") && typeof v === "string") { const n = Number(v.replace(/[, ₦$]/g, "")); return [k, Number.isFinite(n) ? n : v]; }
    return [k, v];
  }));
  const r = patchSchema.safeParse(clean);
  if (!r.success) throw invalid(r.error.issues[0].message, Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
  const v = r.data;
  if (v.phone) { const n = normalisePhone(v.phone); if (!n.valid) throw invalid("That doesn't look like a phone number.", { phone: "Use 10–15 digits." }); v.phone = n.value; }
  if (v.name && v.name.toLowerCase() !== before.name.toLowerCase()) {
    const [dupe] = await db.select({ id: companies.id }).from(companies).where(and(sql`lower(${companies.name}) = ${v.name.toLowerCase()}`, isNull(companies.deletedAt)));
    if (dupe) throw invalid("Another company already has this name.", { name: "Duplicate name." });
  }
  if (v.ownerId !== undefined && v.ownerId !== before.ownerId && v.ownerId !== actor.id && !can(actor, "leads.assign", "deals.reassign", "accounts.view_all")) throw forbidden("You can only assign companies to yourself.");
  const rows = await db.update(companies).set({ ...v, updatedAt: new Date() }).where(and(eq(companies.id, id), sameVersion(companies.updatedAt, before.updatedAt))).returning();
  assertUpdated(rows, "company");
  await audit(db, actor, "company.updated", "company", id, diff(before as Record<string, unknown>, v as Record<string, unknown>));
  return rows[0];
}

export async function bulkUpdateCompanies(db: DB, actor: Actor, ids: string[], patch: { ownerId?: string | null; leadStatus?: string | null; lifecycle?: string }) {
  assertCan(actor, "accounts.edit");
  if (!ids.length) throw invalid("Select at least one company.");
  if (patch.ownerId && patch.ownerId !== actor.id && !can(actor, "leads.assign", "deals.reassign", "accounts.view_all")) throw forbidden("You can only assign companies to yourself.");
  const r = patchSchema.pick({ ownerId: true, leadStatus: true, lifecycle: true }).safeParse(patch);
  if (!r.success) throw invalid(r.error.issues[0].message);
  const visible = await db.select({ id: companies.id }).from(companies).where(and(inArray(companies.id, ids), isNull(companies.deletedAt), companyScope(db, actor)));
  if (!visible.length) throw notFound("Companies");
  await db.update(companies).set({ ...r.data, updatedAt: new Date() }).where(inArray(companies.id, visible.map((v) => v.id)));
  for (const v of visible) await audit(db, actor, "company.updated", "company", v.id, Object.fromEntries(Object.entries(r.data).map(([k, x]) => [k, { from: null, to: x }])), "Bulk edit");
  return visible.length;
}

export async function deleteCompanies(db: DB, actor: Actor, ids: string[], reason: string) {
  assertCan(actor, "data.delete");
  if (!reason.trim()) throw invalid("Give a reason for deleting.", { reason: "Required." });
  const visible = await db.select({ id: companies.id }).from(companies).where(and(inArray(companies.id, ids), isNull(companies.deletedAt), companyScope(db, actor)));
  await db.update(companies).set({ deletedAt: new Date() }).where(inArray(companies.id, visible.map((v) => v.id)));
  for (const v of visible) await audit(db, actor, "company.deleted", "company", v.id, null, reason);
  return visible.length;
}

export async function restoreCompanies(db: DB, actor: Actor, ids: string[]) {
  assertCan(actor, "data.delete");
  await db.update(companies).set({ deletedAt: null }).where(inArray(companies.id, ids));
  for (const id of ids) await audit(db, actor, "company.restored", "company", id);
  return ids.length;
}

export async function exportCompaniesCsv(db: DB, actor: Actor, ids: string[]) {
  assertCan(actor, "data.export");
  if (!ids.length) throw invalid("Nothing to export.");
  const rows = (await workspaceCompanies(db, actor)).filter((r) => ids.includes(r.id));
  const esc = (v: unknown) => { let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [["Company", "Owner", "Lifecycle", "Lead status", "Segment", "Tier", "Industry", "City", "Region", "Phone", "Website", "Contacts", "Open deals", "Open tickets", "Created", "Last activity"],
    ...rows.map((r) => [r.name, r.ownerName, lifecycleName(r.lifecycle), leadStatusLabel(r.leadStatus), r.segment, r.tier, r.industry, r.city, r.region, r.phone, r.website, r.contactCount, r.openDeals, r.openTickets, r.createdAt, r.lastActivityAt])]
    .map((r) => r.map(esc).join(",")).join("\n");
  await audit(db, actor, "data.exported", "export", "companies", { rows: { from: null, to: rows.length } }, "Companies table selection");
  return { csv, count: rows.length };
}

/** Companies that look like the same organisation: same name once punctuation and words like "Ltd" are stripped, or the same web domain. */
export async function duplicateCompanies(db: DB, actor: Actor) {
  const rows = await workspaceCompanies(db, actor);
  const norm = (n: string) => n.toLowerCase().replace(/\b(ltd|limited|plc|inc|llc|nig|nigeria|the)\b/g, "").replace(/[^a-z0-9]/g, "");
  const dom = (w: string | null) => w?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) for (const key of [`name:${norm(r.name)}`, dom(r.website) ? `domain:${dom(r.website)}` : null]) {
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].filter(([, g]) => g.length > 1).map(([key, g]) => ({ key, ids: g.map((x) => ({ id: x.id, name: x.name, company: x.city })) }));
}

/** The company record: Customer 360 data plus contacts with lead details, property history and a rule-based summary. */
export async function companyRecord(db: DB, actor: Actor, id: string, now = new Date()) {
  const v = await customer360(db, actor, id);
  const cs = await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone, jobTitle: contacts.jobTitle, contactRoles: contacts.contactRoles, leadStatus: contacts.leadStatus, ownerName: users.name })
    .from(contacts).leftJoin(users, eq(users.id, contacts.ownerId)).where(and(eq(contacts.companyId, id), isNull(contacts.deletedAt)));
  const history = await db.select({ at: auditLogs.createdAt, action: auditLogs.action, changes: auditLogs.changes, by: users.name, reason: auditLogs.reason })
    .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(and(eq(auditLogs.entityType, "company"), eq(auditLogs.entityId, id))).orderBy(desc(auditLogs.createdAt)).limit(100);
  const [creator] = await db.select({ by: users.name }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(and(eq(auditLogs.entityType, "company"), eq(auditLogs.entityId, id), eq(auditLogs.action, "company.created"))).limit(1);
  const acts = await db.select({
    id: activities.id, type: activities.type, subject: activities.subject, body: activities.body, outcome: activities.outcome, occurredAt: activities.occurredAt,
    scheduledFor: activities.scheduledFor, durationMinutes: activities.durationMinutes, simulated: activities.simulated, pinnedAt: activities.pinnedAt, by: users.name, byId: activities.createdBy,
    contactId: activities.contactId, dealId: activities.dealId,
  }).from(activities).leftJoin(users, eq(users.id, activities.createdBy)).where(eq(activities.companyId, id)).orderBy(desc(activities.occurredAt)).limit(300);
  const done = acts.filter((a) => !a.scheduledFor || a.scheduledFor <= now);
  const DAY = 86400000;
  const recent30 = done.filter((a) => now.getTime() - a.occurredAt.getTime() < 30 * DAY).length;
  const last = done[0];
  const daysSince = last ? Math.floor((now.getTime() - last.occurredAt.getTime()) / DAY) : null;
  const openDeals = v.deals.filter((d) => !d.isWon && !d.isLost);
  const openTickets = v.tickets.filter((t) => (OPEN_STATUSES as string[]).includes(t.status));
  const c = v.company;
  const lines = [
    `${c.name} is a ${lifecycleName(c.lifecycle).toLowerCase()}${c.industry ? ` in ${c.industry}` : ""}${c.city ? `, based in ${c.city}` : ""} (${c.segment}, ${c.tier} tier).`,
    `${cs.length} contact${cs.length === 1 ? "" : "s"} on file${cs.some((x) => x.contactRoles.includes("decision_maker")) ? ", including a decision-maker" : cs.length ? ", but no decision-maker identified yet" : ""}.`,
    last ? `Last activity was a ${last.type} ${daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`}; ${recent30} in the last 30 days.` : "No activity has been logged yet.",
    openDeals.length ? `${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"} worth ${openDeals.reduce((a, d) => a + (d.amount ?? 0), 0).toLocaleString("en-NG")} ${openDeals[0].currency}.` : v.deals.some((d) => d.isWon) ? "Has closed-won business with Afrilinq." : "No deals yet.",
    ...(openTickets.length ? [`${openTickets.length} support ticket${openTickets.length === 1 ? " is" : "s are"} open.`] : []),
    ...(v.health ? [`Customer health: ${v.health.status.replace(/_/g, " ")} (${v.health.score}/100).`] : []),
  ];
  const missing = [!c.ownerId && "owner", !c.phone && "phone", !c.website && "website", !c.industry && "industry", !cs.length && "contacts"].filter(Boolean) as string[];
  const next = !c.ownerId ? "Assign an owner so someone follows up." : !cs.length ? "Add the people you deal with at this company." : !cs.some((x) => x.contactRoles.includes("decision_maker")) ? "Identify the decision-maker." :
    v.tasks.some((t) => t.dueAt && t.dueAt < now) ? "Clear overdue tasks on this account." : daysSince === null ? "Make first contact." : daysSince > 30 ? "Re-engage: no activity in over 30 days." :
    openTickets.some((t) => t.priority === "P1" || t.priority === "P2") ? "Check in on the open high-priority ticket." : "Keep momentum: schedule the next step.";
  const engagement = Math.min(100, recent30 * 10 + (openDeals.length ? 20 : 0) + (daysSince !== null && daysSince < 14 ? 20 : 0) + Math.min(20, cs.length * 5));
  return {
    ...v, contactsDetail: cs, history, createdBy: creator?.by ?? null, activitiesFull: acts, lastActivityAt: last?.occurredAt ?? null,
    summary: { lines, next, missing, engagement, recent30, daysSince, openTickets: openTickets.length, generatedAt: now },
  };
}

export { isNotNull, pipelineStages, deals, tickets };
