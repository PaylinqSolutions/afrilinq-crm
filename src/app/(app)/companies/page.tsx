import { and, eq, isNull } from "drizzle-orm";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { workspaceCompanies } from "@/server/services/companies-workspace";
import { savedViews, users } from "@/db/schema";
import { todayIn } from "@/lib/format";
import { CompaniesWorkspace, type WCompany } from "@/components/companies/workspace";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; preview?: string }> }) {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "accounts.view_all", "accounts.view_own");
  const sp = await searchParams;
  const [rows, us, views] = await Promise.all([
    workspaceCompanies(db, actor),
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), isNull(users.deletedAt))).orderBy(users.name),
    db.select({ id: savedViews.id, name: savedViews.name, query: savedViews.query }).from(savedViews).where(and(eq(savedViews.userId, actor.id), eq(savedViews.entity, "companies-table"))),
  ]);
  const companies: WCompany[] = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), lastActivityAt: r.lastActivityAt ? r.lastActivityAt.toISOString() : null }));
  return (
    <CompaniesWorkspace companies={companies} users={us} views={views} initial={sp}
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
