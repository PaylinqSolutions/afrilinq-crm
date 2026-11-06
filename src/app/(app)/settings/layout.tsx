import Link from "next/link";
import { requireActor } from "@/server/session";
import { can } from "@/server/actor";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const a = await requireActor();
  const items = [
    can(a, "admin.settings") && ["/settings", "General"], can(a, "admin.users") && ["/settings/users", "Users & teams"], can(a, "admin.roles") && ["/settings/roles", "Roles & permissions"],
    can(a, "admin.pipelines") && ["/settings/pipelines", "Pipelines"], can(a, "admin.sla") && ["/settings/sla", "SLA policies"], can(a, "admin.workflows") && ["/settings/workflows", "Workflow rules"],
    can(a, "admin.integrations") && ["/settings/integrations", "Integrations"], can(a, "admin.settings") && ["/settings/templates", "Onboarding templates"],
    can(a, "admin.settings") && ["/settings/fields", "Custom fields"], can(a, "audit.view") && ["/settings/audit", "Audit log"],
  ].filter(Boolean) as [string, string][];
  return (
    <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0"><ul className="flex gap-1 lg:flex-col">{items.map(([h, l]) => <li key={h}><Link className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-slate-700 hover:bg-white hover:shadow-sm" href={h}>{l}</Link></li>)}</ul></nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
