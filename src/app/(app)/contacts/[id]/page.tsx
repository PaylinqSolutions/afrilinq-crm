import { and, desc, eq, isNull } from "drizzle-orm";
import { ctx, load } from "@/server/page";
import { can } from "@/server/actor";
import { contactRecord, referralSources } from "@/server/services/contacts-workspace";
import { listCompanies } from "@/server/services/accounts";
import { dealScope } from "@/server/services/scope";
import { companies, deals, users } from "@/db/schema";
import { todayIn } from "@/lib/format";
import { ContactRecord, type RecordData } from "@/components/contacts/record";
import { customerJourney } from "@/server/services/journey";
import { canManageType, listDocuments } from "@/server/services/documents";
import { JourneyTracker } from "@/components/related";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db } = await ctx();
  try { const r = await contactRecord(db, actor, id); return { title: `${r.c.firstName} ${r.c.lastName}` }; } catch { return { title: "Contact" }; }
}

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const { actor, db, tz } = await ctx();
  const r = await load(() => contactRecord(db, actor, id));
  const [us, { rows: cos }, sources, ds] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), isNull(users.deletedAt))).orderBy(users.name),
    listCompanies(db, actor, {}, true), referralSources(db),
    can(actor, "deals.edit") ? db.select({ id: deals.id, name: deals.name, company: companies.name }).from(deals).innerJoin(companies, eq(companies.id, deals.companyId))
      .where(and(isNull(deals.deletedAt), dealScope(actor))).orderBy(desc(deals.updatedAt)).limit(300) : Promise.resolve([]),
  ]);
  const journey = r.c.companyId ? await customerJourney(db, r.c.companyId) : [];
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const data: RecordData = {
    c: { ...r.c, createdAt: r.c.createdAt.toISOString(), updatedAt: r.c.updatedAt.toISOString(), deletedAt: null },
    company: r.company, owner: r.owner, colleagues: r.colleagues,
    attachments: r.attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })), dealEvents: r.dealEvents.map((e) => ({ ...e, at: e.at.toISOString() })), lastActivityAt: iso(r.lastActivityAt),
    activities: r.activities.map((a) => ({ ...a, occurredAt: a.occurredAt.toISOString(), scheduledFor: iso(a.scheduledFor), pinnedAt: iso(a.pinnedAt) })),
    tasks: r.tasks.map((t) => ({ ...t, dueAt: iso(t.dueAt), remindAt: iso(t.remindAt), createdAt: t.createdAt.toISOString(), completedAt: iso(t.completedAt) })),
    deals: r.deals, tickets: r.tickets?.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) ?? null,
    training: r.training.map((t) => ({ ...t, startsAt: iso(t.startsAt) })), projects: r.projects,
    history: r.history.map((h) => ({ ...h, at: h.at.toISOString() })),
    summary: { ...r.summary, generatedAt: r.summary.generatedAt.toISOString() },
    documents: r.c.companyId ? (await listDocuments(db, actor, { companyId: r.c.companyId })).filter((x) => x.contactId === r.c.id) : [],
    docPerms: { sla: canManageType(actor, "sla"), quote: canManageType(actor, "quote"), invoice: canManageType(actor, "invoice") },
  };
  return (
    <ContactRecord data={data} users={us} journey={journey.length ? <JourneyTracker steps={journey} title={`${r.company?.name}'s customer journey`} /> : null} companies={cos.map((c) => ({ id: c.id, name: c.name }))} sources={sources} dealOptions={ds} initialTab={tab}
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
