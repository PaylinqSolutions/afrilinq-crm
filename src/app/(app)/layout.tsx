import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { Bell, HelpCircle, Plus, Search, LogOut } from "lucide-react";
import { getDb } from "@/db";
import { notifications, handoverRecords } from "@/db/schema";
import { requireActor } from "@/server/session";
import { can } from "@/server/actor";
import { Shell, type NavItem } from "@/components/shell";
import { logoutAction } from "@/app/actions/auth";
import { myEscalationCount } from "@/server/services/tickets";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const db = await getDb();
  const [{ n: unread }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)));
  const handoverQueue = can(actor, "handover.review")
    ? (await db.select({ n: count() }).from(handoverRecords).where(eq(handoverRecords.status, "Submitted for Review")))[0].n : 0;
  const escalationsWaiting = await myEscalationCount(db, actor);
  const items: (NavItem | false)[] = [
    { href: "/", label: "Dashboard", icon: "dashboard" },
    can(actor, "leads.view_all", "leads.view_own") && { href: "/leads", label: "Leads", icon: "leads" },
    can(actor, "accounts.view_all", "accounts.view_own") && { href: "/contacts", label: "Contacts", icon: "contacts" },
    can(actor, "accounts.view_all", "accounts.view_own") && { href: "/companies", label: "Companies", icon: "companies" },
    can(actor, "deals.view_all", "deals.view_own") && { href: "/deals", label: "Deals", icon: "deals" },
    { href: "/products", label: "Products", icon: "products" },
    can(actor, "accounts.view_all", "accounts.view_own", "billing.manage", "finance.view") && { href: "/billing", label: "Billing & Agreements", icon: "billing" },
    can(actor, "handover.view") && { href: "/handovers", label: "Handover Queue", icon: "handover", badge: handoverQueue },
    can(actor, "onboarding.view", "handover.view") && { href: "/onboarding", label: "Onboarding", icon: "onboarding" },
    can(actor, "training.view_all", "training.view_assigned") && { href: "/training", label: "Training", icon: "training" },
    can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned", "tickets.view_escalated", "tickets.create") && { href: "/tickets", label: "Tickets", icon: "tickets" },
    { href: "/escalations", label: "Escalations", icon: "escalations", badge: escalationsWaiting },
    can(actor, "success.view") && { href: "/success", label: "Customer Success", icon: "success" },
    { href: "/kb", label: "Knowledge Base", icon: "kb" },
    { href: "/tasks", label: "Tasks", icon: "tasks" },
    can(actor, "reports.executive", "reports.sales", "reports.onboarding", "reports.support") && { href: "/reports", label: "Reports", icon: "reports" },
    can(actor, "admin.users", "admin.roles", "admin.settings", "admin.pipelines", "admin.sla", "admin.workflows", "admin.integrations", "audit.view") && { href: "/settings", label: "Settings", icon: "settings" },
  ];
  const quick = [
    can(actor, "leads.edit") && ["/leads/new", "Lead"], can(actor, "accounts.edit") && ["/contacts/new", "Contact"], can(actor, "accounts.edit") && ["/companies/new", "Company"],
    can(actor, "deals.edit") && ["/deals/new", "Deal"], can(actor, "tickets.create") && ["/tickets/new", "Ticket"], ["/tasks?new=1", "Task"],
    can(actor, "training.manage") && ["/training/sessions/new", "Training session"], can(actor, "kb.edit") && ["/kb/new", "Article"],
  ].filter(Boolean) as [string, string][];
  const topbar = (
    <>
      <form action="/search" method="get" role="search" className="relative flex-1 sm:max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
        <label htmlFor="global-search" className="sr-only">Search</label>
        <input id="global-search" name="q" placeholder="Search companies, contacts, deals, tickets…" className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-8 pr-3 text-sm focus:bg-white" />
      </form>
      <div className="ml-auto flex items-center gap-1">
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-2 text-sm font-medium text-white hover:bg-brand-700" aria-label="Quick create"><Plus className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">New</span></summary>
          <ul className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {quick.map(([href, label]) => <li key={href}><Link href={href} className="block px-3 py-1.5 text-sm hover:bg-slate-50">{label}</Link></li>)}
          </ul>
        </details>
        <Link href="/notifications" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <Link href="/kb?sop=1" className="hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 sm:block" aria-label="Help and playbooks"><HelpCircle className="h-5 w-5" aria-hidden /></Link>
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100" aria-label="Your profile">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{actor.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</span>
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
            <p className="font-medium text-slate-900">{actor.name}</p>
            <p className="truncate text-xs text-slate-500">{actor.email}</p>
            <p className="mt-1 text-xs text-slate-500">{actor.roleKeys.map((r) => r.replace(/_/g, " ")).join(", ")}</p>
            <form action={logoutAction} className="mt-3"><button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-slate-50"><LogOut className="h-4 w-4" aria-hidden />Sign out</button></form>
          </div>
        </details>
      </div>
    </>
  );
  return <Shell items={items.filter(Boolean) as NavItem[]} topbar={topbar}>{children}</Shell>;
}
