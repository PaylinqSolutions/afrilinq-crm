import { and, eq, isNull } from "drizzle-orm";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { referralSources, workspaceContacts } from "@/server/services/contacts-workspace";
import { listCompanies } from "@/server/services/accounts";
import { savedViews, users } from "@/db/schema";
import { todayIn } from "@/lib/format";
import { ContactsWorkspace } from "@/components/contacts/workspace";
import type { WContact } from "@/components/contacts/kit";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; preview?: string; status?: string; owner?: string }> }) {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "accounts.view_all", "accounts.view_own");
  const sp = await searchParams;
  const [rows, us, { rows: cos }, sources, views] = await Promise.all([
    workspaceContacts(db, actor),
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), isNull(users.deletedAt))).orderBy(users.name),
    listCompanies(db, actor, {}, true),
    referralSources(db),
    db.select({ id: savedViews.id, name: savedViews.name, query: savedViews.query }).from(savedViews).where(and(eq(savedViews.userId, actor.id), eq(savedViews.entity, "contacts-table"))),
  ]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const contacts: WContact[] = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), lastActivityAt: iso(r.lastActivityAt) }));
  return (
    <ContactsWorkspace contacts={contacts} users={us} companies={cos.map((c) => ({ id: c.id, name: c.name }))} sources={sources} views={views} initial={sp}
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
