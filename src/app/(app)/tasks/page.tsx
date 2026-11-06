import { and, desc, eq, isNull } from "drizzle-orm";
import { ctx } from "@/server/page";
import { can } from "@/server/actor";
import { taskQueues, workspaceTasks } from "@/server/services/tasks-workspace";
import { workspaceContacts } from "@/server/services/contacts-workspace";
import { workspaceCompanies } from "@/server/services/companies-workspace";
import { dealScope } from "@/server/services/scope";
import { companies, deals, savedViews, users } from "@/db/schema";
import { todayIn } from "@/lib/format";
import { TasksWorkspace, type WTask } from "@/components/tasks/workspace";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string; task?: string; q?: string }> }) {
  const { actor, db, tz } = await ctx();
  const sp = await searchParams;
  const canAccounts = can(actor, "accounts.view_all", "accounts.view_own");
  const [rows, us, queues, views, cs, cos, ds] = await Promise.all([
    workspaceTasks(db, actor),
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true), isNull(users.deletedAt))).orderBy(users.name),
    taskQueues(db),
    db.select({ id: savedViews.id, name: savedViews.name, query: savedViews.query }).from(savedViews).where(and(eq(savedViews.userId, actor.id), eq(savedViews.entity, "tasks-table"))),
    canAccounts ? workspaceContacts(db, actor) : Promise.resolve([]),
    canAccounts ? workspaceCompanies(db, actor) : Promise.resolve([]),
    can(actor, "deals.view_all", "deals.view_own") ? db.select({ id: deals.id, name: deals.name, company: companies.name }).from(deals).innerJoin(companies, eq(companies.id, deals.companyId)).where(and(isNull(deals.deletedAt), dealScope(actor))).orderBy(desc(deals.updatedAt)).limit(300) : Promise.resolve([]),
  ]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const tasks: WTask[] = rows.map((r) => ({ ...r, dueAt: iso(r.dueAt), remindAt: iso(r.remindAt), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), completedAt: iso(r.completedAt), lastContactedAt: iso(r.lastContactedAt) }));
  const links = [
    ...cs.map((c) => ({ value: `contact:${c.id}`, label: `${c.firstName} ${c.lastName}`, hint: `Contact${c.companyName ? ` · ${c.companyName}` : ""}` })),
    ...cos.map((c) => ({ value: `company:${c.id}`, label: c.name, hint: "Company" })),
    ...ds.map((d) => ({ value: `deal:${d.id}`, label: d.name, hint: `Deal · ${d.company}` })),
  ];
  return (
    <TasksWorkspace tasks={tasks} users={us} queues={queues} links={links} views={views} initial={sp}
      ctx={{ me: { id: actor.id, name: actor.name }, today: todayIn(tz), tz, perms: { viewAll: can(actor, "tasks.view_all"), assign: can(actor, "tasks.view_all", "leads.assign", "tickets.reassign"), export: can(actor, "data.export"), log: can(actor, "activities.log") } }} />
  );
}
