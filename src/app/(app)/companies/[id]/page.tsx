import { and, eq, isNull } from "drizzle-orm";
import { ctx, load } from "@/server/page";
import { can } from "@/server/actor";
import { companyRecord } from "@/server/services/companies-workspace";
import { workspaceContacts } from "@/server/services/contacts-workspace";
import { users } from "@/db/schema";
import { todayIn } from "@/lib/format";
import { CompanyRecord, type CompanyData } from "@/components/companies/record";
import { customerJourney } from "@/server/services/journey";
import { canManageType, listDocuments } from "@/server/services/documents";
import { JourneyTracker } from "@/components/related";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db } = await ctx();
  try { const { getCompany } = await import("@/server/services/accounts"); return { title: (await getCompany(db, actor, id)).name }; } catch { return { title: "Company" }; }
}

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const { actor, db, tz } = await ctx();
  const r = await load(() => companyRecord(db, actor, id));
  const [us, allContacts] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), isNull(users.deletedAt))).orderBy(users.name),
    can(actor, "accounts.edit") ? workspaceContacts(db, actor) : Promise.resolve([]),
  ]);
  const journey = await customerJourney(db, id);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const c = r.company;
  const data: CompanyData = {
    c: { ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(), deletedAt: null },
    owner: r.owner?.name ?? null, csm: r.csm?.name ?? null, createdBy: r.createdBy, lastActivityAt: iso(r.lastActivityAt),
    contacts: r.contactsDetail,
    deals: r.deals.map((d) => ({ id: d.id, name: d.name, amount: d.amount, currency: d.currency, stage: d.stage, isWon: d.isWon, isLost: d.isLost, close: d.expectedCloseDate, ownerName: d.ownerName })),
    tickets: r.tickets.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.createdAt.toISOString(), canOpen: t.canOpen })),
    projects: r.projects.map((p) => ({ id: p.id, name: p.name, stage: p.stage, riskLevel: p.riskLevel })),
    sessions: r.sessions.map((s) => ({ id: s.id, title: s.title, startsAt: iso(s.startsAt), status: s.status, attended: s.attended, participants: s.participants })),
    files: r.files.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: f.sizeBytes, createdAt: f.createdAt.toISOString(), by: f.by, restricted: f.restricted })),
    activities: r.activitiesFull.map((a) => ({ ...a, occurredAt: a.occurredAt.toISOString(), scheduledFor: iso(a.scheduledFor), pinnedAt: iso(a.pinnedAt) })),
    tasks: r.tasks.map((t) => ({ id: t.id, title: t.title, dueAt: iso(t.dueAt), status: t.status, priority: t.priority, ownerName: t.ownerName })),
    events: r.timeline.filter((e) => ["deal", "ticket", "training", "handover"].includes(e.kind)).map((e, i) => ({ id: `e${i}`, kind: e.kind, title: e.title, detail: e.detail ?? null, at: e.at.toISOString(), by: e.by ?? null, link: e.link ?? null })),
    history: r.history.map((h) => ({ ...h, at: h.at.toISOString() })),
    health: r.health ? { score: r.health.score, status: r.health.status, components: r.health.components } : null,
    renewals: r.renewals.map((x) => ({ id: x.id, date: x.renewalDate, amount: x.amount, currency: x.currency, status: x.status })),
    summary: { ...r.summary, generatedAt: r.summary.generatedAt.toISOString() },
    documents: await listDocuments(db, actor, { companyId: id }),
    docPerms: { sla: canManageType(actor, "sla"), quote: canManageType(actor, "quote"), invoice: canManageType(actor, "invoice") },
  };
  return (
    <CompanyRecord data={data} users={us} initialTab={tab} journey={journey.length ? <JourneyTracker steps={journey} /> : null}
      contactOptions={allContacts.filter((x) => x.companyId !== id).map((x) => ({ id: x.id, name: `${x.firstName} ${x.lastName}`, hint: x.companyName ?? "No company", updatedAt: x.updatedAt.toISOString() }))}
      ctx={{
        me: { id: actor.id, name: actor.name }, today: todayIn(tz), tz,
        perms: {
          edit: can(actor, "accounts.edit"), delete: can(actor, "data.delete"), export: can(actor, "data.export"), log: can(actor, "activities.log"),
          assign: can(actor, "leads.assign", "deals.reassign", "accounts.view_all", "tasks.view_all"), deals: can(actor, "deals.view_all", "deals.view_own"), dealsEdit: can(actor, "deals.edit"),
          tickets: can(actor, "tickets.create"),
        },
      }} />
  );
}
