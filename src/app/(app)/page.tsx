import Link from "next/link";
import { ctx } from "@/server/page";
import { can } from "@/server/actor";
import { myWorkspace, salesMetrics, supportMetrics, onboardingMetrics, defaultRange } from "@/server/services/reports";
import { Card, EmptyState, PageHeader, PriorityBadge, Stat, StatusBadge, Badge, LinkButton } from "@/components/ui";
import { TaskList } from "@/components/records";
import { fmtDateTime, fmtMoney, ticketRef } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const { actor, db, tz, settings } = await ctx();
  const w = await myWorkspace(db, actor);
  const f = defaultRange(tz);
  const showSales = can(actor, "reports.sales", "reports.executive");
  const showSupport = can(actor, "reports.support", "reports.executive");
  const showOnb = can(actor, "reports.onboarding", "reports.executive");
  const [sm, sup, onb] = await Promise.all([
    showSales ? salesMetrics(db, actor, f) : null, showSupport ? supportMetrics(db, actor, f) : null, showOnb ? onboardingMetrics(db, actor, f) : null,
  ]);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return (
    <>
      <PageHeader title={`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${actor.name.split(" ")[0]}`} subtitle={`Your workspace for ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date())} (${tz})`} />
      {(sm || sup || onb) && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {sm && <Stat label="Open pipeline" value={fmtMoney(sm.open.value, settings.currency, true)} sub={`Weighted ${fmtMoney(sm.open.weighted, settings.currency, true)}`} href="/reports/records?m=pipeline_open" />}
          {sm && <Stat label="Won (90 days)" value={fmtMoney(sm.wonValue, settings.currency, true)} sub={`${sm.won} deals · win rate ${sm.winRate ?? "—"}%`} href="/reports/records?m=deals_won" />}
          {onb && <Stat label="Onboarding at risk" value={onb.atRisk} sub={`${onb.active} active · ${onb.overdueMilestones} overdue milestones`} tone={onb.atRisk ? "red" : undefined} href="/reports/records?m=onboarding_at_risk" />}
          {sup && <Stat label="Open P1/P2 tickets" value={sup.p1p2} sub={`${sup.openTotal} open · SLA first response ${sup.slaFirst ?? "—"}%`} tone={sup.p1p2 ? "amber" : undefined} href="/tickets?queue=p1p2" />}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Overdue (${w.overdue.length}) & due today (${w.dueToday.length})`} actions={<LinkButton href="/tasks" variant="ghost" size="sm">All tasks</LinkButton>}>
            {w.overdue.length + w.dueToday.length === 0 ? <EmptyState title="You're all caught up">No overdue or due-today tasks.</EmptyState> : <TaskList tasks={[...w.overdue, ...w.dueToday].map((t) => ({ ...t, status: "open" }))} tz={tz} compact />}
          </Card>
          {can(actor, "deals.view_own", "deals.view_all") && (
            <Card title={`Deals needing attention (${w.attention.length})`} actions={<LinkButton href="/deals" variant="ghost" size="sm">Pipeline</LinkButton>}>
              {w.attention.length === 0 ? <EmptyState title="No deals need attention" /> : (
                <ul className="divide-y divide-slate-100">
                  {w.attention.map((d) => (
                    <li key={d.id} className="py-2">
                      <Link href={`/deals/${d.id}`} className="text-sm font-medium text-slate-900 hover:underline">{d.name}</Link>
                      <p className="text-xs text-slate-500">{d.company} · {d.stage} · {fmtMoney(d.amount, d.currency)}</p>
                      <div className="mt-1 flex flex-wrap gap-1">{d.reasons.map((r) => <Badge key={r} tone="amber">{r}</Badge>)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {w.myTickets.length > 0 && (
            <Card title="My open tickets" actions={<LinkButton href="/tickets?queue=mine" variant="ghost" size="sm">My queue</LinkButton>}>
              <ul className="divide-y divide-slate-100">
                {w.myTickets.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-2 py-2"><PriorityBadge p={t.priority} /><Link href={`/tickets/${t.id}`} className="text-sm font-medium hover:underline">{ticketRef(t.number)} {t.subject}</Link><StatusBadge status={t.status} /></li>)}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Today's appointments">
            {w.appointments.length + w.sessions.length === 0 ? <EmptyState title="Nothing scheduled today" /> : (
              <ul className="space-y-2">
                {w.appointments.map((a) => <li key={a.id} className="text-sm"><span className="font-medium tabular-nums">{fmtDateTime(a.scheduledFor, tz).split(", ").pop()}</span> · {a.dealId ? <Link className="hover:underline" href={`/deals/${a.dealId}`}>{a.subject}</Link> : a.subject}<p className="text-xs text-slate-500">{a.companyName}</p></li>)}
                {w.sessions.map((s) => <li key={s.id} className="text-sm"><span className="font-medium tabular-nums">{fmtDateTime(s.startsAt, tz).split(", ").pop()}</span> · <Link className="hover:underline" href={`/training/sessions/${s.id}`}>{s.title}</Link><p className="text-xs text-slate-500">Training · {s.companyName}</p></li>)}
              </ul>
            )}
          </Card>
          {w.myHandovers.length > 0 && (
            <Card title="Handovers waiting on you">
              <ul className="space-y-2">{w.myHandovers.map((h) => <li key={h.id}><Link href={`/handovers/${h.id}`} className="text-sm font-medium hover:underline">{h.deal}</Link><div className="mt-0.5 flex gap-2"><StatusBadge status={h.status} /><span className="text-xs text-slate-500">{h.completeness}% complete</span></div></li>)}</ul>
            </Card>
          )}
          <Card title="Follow-ups this week">
            {w.upcoming.length === 0 ? <EmptyState title="No upcoming follow-ups" /> : <TaskList tasks={w.upcoming.slice(0, 8).map((t) => ({ ...t, status: "open" }))} tz={tz} compact />}
          </Card>
        </div>
      </div>
    </>
  );
}
