import Link from "next/link";
import { ctx, qs , requirePerm } from "@/server/page";
import { listProjects } from "@/server/services/onboarding";
import { listHandovers } from "@/server/services/handover";
import { usersInRoles } from "@/server/services/admin";
import { ONBOARDING_STAGES, stageLabel } from "@/lib/rules/onboarding";
import { fmtDate, todayIn } from "@/lib/format";
import { Badge, Card, EmptyState, FilterBar, FInput, FSelect, PageHeader, Progress, RiskBadge, Table, Tabs, Td } from "@/components/ui";

export const metadata = { title: "Onboarding" };
type SP = { view?: string; owner?: string; stage?: string; risk?: string; state?: string; q?: string };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "onboarding.view", "handover.view");
  const f = await searchParams;
  const rows = await listProjects(db, actor, f);
  // Won deals whose handover Sales hasn't submitted yet: the onboarding project is created on submission.
  const incoming = (await listHandovers(db, actor)).filter((h) => !h.onboardingProjectId && ["Draft", "Pending Sales Submission"].includes(h.status));
  const owners = await usersInRoles(db, ["onboarding_manager"]);
  const today = todayIn(tz);
  const view = f.view === "list" ? "list" : "board";
  const days = (d: string | null) => (d ? Math.round((Date.parse(d) - Date.parse(today)) / 86400000) : null);
  const card = (p: (typeof rows)[number]) => {
    const dd = days(p.targetGoLive);
    return (
      <div className="space-y-1.5">
        <Link href={`/onboarding/${p.id}`} className="block text-sm font-medium leading-snug hover:underline">{p.companyName}</Link>
        <div className="flex flex-wrap gap-1">{p.state === "draft" ? <Badge tone="amber">Handover Incomplete</Badge> : <RiskBadge level={p.riskLevel} />}{p.state === "on_hold" && <Badge tone="amber">On hold</Badge>}</div>
        <Progress value={p.progress} label="Task progress" />
        <p className="text-xs text-slate-500">{p.ownerName ?? "No owner"} · {dd === null ? "No go-live date" : dd < 0 ? <span className="font-medium text-red-700">go-live {-dd}d overdue</span> : `go-live in ${dd}d`}</p>
        {(p.overdue > 0 || p.openBlockers > 0) && <p className="text-xs text-red-700">{p.overdue > 0 && `${p.overdue} overdue`}{p.overdue > 0 && p.openBlockers > 0 && " · "}{p.openBlockers > 0 && `${p.openBlockers} blocker(s)`}</p>}
      </div>
    );
  };
  const stagesInUse = ONBOARDING_STAGES.filter((s) => rows.some((r) => r.stage === s.key) || ["kickoff_pending", "configuration", "training_in_progress", "go_live_review"].includes(s.key));
  return (
    <>
      <PageHeader title="Onboarding & implementation" subtitle="Flow: deal won → Sales completes and submits the handover → a draft project appears here → Onboarding accepts it and the project starts. Risk is rule-based and every reason is shown on the project." />
      <Tabs current={view} tabs={[{ key: "board", label: "Board", href: `/onboarding${qs({ ...f, view: undefined })}` }, { key: "list", label: "List", href: `/onboarding${qs({ ...f, view: "list" })}` }]} />
      {incoming.length > 0 && (
        <Card title={`Coming from Sales (${incoming.length})`} className="mb-4" pad={false}>
          <p className="px-4 pt-3 text-sm text-slate-600">These deals are won, but Sales hasn&apos;t submitted the handover yet. Each becomes an onboarding project here once it&apos;s submitted; Onboarding then reviews and accepts it.</p>
          <Table head={["Customer", "Deal", "Value", "Handover", "Waiting", "Sales owner", ""]}>
            {incoming.map((h) => (
              <tr key={h.id} className="hover:bg-slate-50">
                <Td><Link href={`/companies/${h.companyId}`} className="font-medium hover:underline">{h.companyName}</Link></Td>
                <Td><Link href={`/deals/${h.dealId}`} className="hover:underline">{h.dealName}</Link></Td>
                <Td className="whitespace-nowrap">{h.amount != null ? `${h.currency} ${Number(h.amount).toLocaleString("en-NG")}` : "—"}</Td>
                <Td><Badge tone="amber">{h.status}</Badge><Progress value={h.completeness} label="Checklist completeness" /></Td>
                <Td className="whitespace-nowrap text-xs">{Math.max(0, Math.round((Date.now() - h.createdAt.getTime()) / 86400000))} day(s)</Td>
                <Td>{h.ownerName}</Td>
                <Td><Link href={`/handovers/${h.id}`} className="whitespace-nowrap rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50">Open handover</Link></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <FilterBar action="/onboarding">
        <input type="hidden" name="view" value={view} />
        <FInput name="q" label="Customer" value={f.q} />
        <FSelect name="owner" label="Owner" value={f.owner} options={[{ value: "me", label: "Me" }, ...owners.map((u) => ({ value: u.id, label: u.name }))]} />
        <FSelect name="risk" label="Risk" value={f.risk} options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
        <FSelect name="state" label="State" value={f.state} all="Not completed" options={[{ value: "draft", label: "Draft (handover pending)" }, { value: "active", label: "Active" }, { value: "on_hold", label: "On hold" }, { value: "completed", label: "Completed" }]} />
      </FilterBar>
      {rows.length === 0 ? <EmptyState title="No onboarding projects match" /> : view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="flex gap-3" style={{ minWidth: `${(stagesInUse.length + 1) * 236}px` }}>
            {[{ key: "__draft", label: "Awaiting handover acceptance" }, ...stagesInUse].map((s) => {
              const col = rows.filter((r) => (s.key === "__draft" ? r.state === "draft" : r.state !== "draft" && r.stage === s.key));
              return (
                <section key={s.key} aria-label={s.label} className="w-56 shrink-0 rounded-xl border border-slate-200 bg-slate-100/80">
                  <header className="border-b border-slate-200 px-3 py-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{s.label}</h3><p className="text-xs text-slate-500">{col.length}</p></header>
                  <ul className="flex min-h-20 flex-col gap-2 p-2">{col.map((p) => <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">{card(p)}</li>)}</ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Card pad={false}>
          <Table head={["Customer", "Stage", "Risk", "Progress", "Owner", "Target go-live", "Issues"]}>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link href={`/onboarding/${p.id}`} className="font-medium hover:underline">{p.companyName}</Link><div className="text-xs text-slate-500">{p.name}</div></Td>
                <Td>{p.state === "draft" ? <Badge tone="amber">Handover Incomplete</Badge> : stageLabel(p.stage)}</Td><Td><RiskBadge level={p.riskLevel} /></Td>
                <Td className="min-w-[8rem]"><Progress value={p.progress} /></Td><Td>{p.ownerName ?? "—"}</Td><Td>{fmtDate(p.targetGoLive, tz)}</Td>
                <Td className="text-xs">{p.riskReasons.join("; ") || "—"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
