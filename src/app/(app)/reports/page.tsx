import Link from "next/link";
import { ctx, qs , requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { defaultRange, DEFINITIONS, executiveDashboard, onboardingMetrics, salesMetrics, supportMetrics, successMetrics, type ReportFilters } from "@/server/services/reports";
import { simpleUsers, listTeams } from "@/server/services/admin";
import { products } from "@/db/schema";
import { SEGMENTS } from "@/lib/rules/sales";
import { stageLabel } from "@/lib/rules/onboarding";
import { fmtMoney, ticketRef } from "@/lib/format";
import { formatMinutes } from "@/lib/rules/sla";
import { Card, EmptyState, FilterBar, FInput, FSelect, Notice, PageHeader, Progress, RiskBadge, Stat, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { BarList, ColumnChart } from "@/components/charts";

export const metadata = { title: "Reports" };
type SP = { tab?: string; from?: string; to?: string; owner?: string; product?: string; segment?: string; team?: string };
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor, db, tz, settings } = await ctx();
  requirePerm(actor, "reports.executive", "reports.sales", "reports.onboarding", "reports.support");
  const sp = await searchParams;
  const tabs = [
    can(actor, "reports.executive") && { key: "executive", label: "Executive" }, can(actor, "reports.sales", "reports.executive") && { key: "sales", label: "Sales" },
    can(actor, "reports.onboarding", "reports.executive") && { key: "onboarding", label: "Onboarding" }, can(actor, "reports.support", "reports.executive") && { key: "support", label: "Support" },
  ].filter(Boolean) as { key: string; label: string }[];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : tabs[0].key;
  const def = defaultRange(tz);
  const f: ReportFilters = { from: sp.from || def.from, to: sp.to || def.to, owner: sp.owner, product: sp.product, segment: sp.segment, team: sp.team, tz };
  const keep = { from: sp.from, to: sp.to, owner: sp.owner, product: sp.product, segment: sp.segment, team: sp.team };
  const drill = (m: string) => `/reports/records${qs({ m, ...keep })}`;
  const users = await simpleUsers(db);
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  const cur = settings.currency;
  const S = tab === "sales" || tab === "executive" ? await salesMetrics(db, actor, f) : null;
  const O = tab === "onboarding" || tab === "executive" ? await onboardingMetrics(db, actor, f) : null;
  const T = tab === "support" || tab === "executive" ? await supportMetrics(db, actor, f) : null;
  const X = tab === "executive" ? await successMetrics(db, actor) : null;
  void executiveDashboard;
  const D = ({ k }: { k: string }) => <span title={DEFINITIONS[k]} className="cursor-help border-b border-dotted border-slate-400">ⓘ</span>;
  return (
    <>
      <PageHeader title="Reports & dashboards" subtitle={`${f.from} → ${f.to} (${tz}). All figures are computed live from CRM records — demo data is fictional. Hover ⓘ for definitions; click a tile to see the underlying records.`} />
      <Tabs current={tab} tabs={tabs.map((t) => ({ ...t, href: `/reports${qs({ ...keep, tab: t.key })}` }))} />
      <FilterBar action="/reports">
        <input type="hidden" name="tab" value={tab} />
        <FInput name="from" label="From" type="date" value={f.from} /><FInput name="to" label="To" type="date" value={f.to} />
        <FSelect name="owner" label="User" value={sp.owner} options={users.map((u) => ({ value: u.id, label: u.name }))} />
        <FSelect name="product" label="Product" value={sp.product} options={ps.map((p) => ({ value: p.id, label: p.name }))} />
        {tab !== "support" && <FSelect name="segment" label="Segment" value={sp.segment} options={SEGMENTS.map((s) => ({ value: s, label: s }))} />}
        {tab === "support" && <FSelect name="team" label="Team" value={sp.team} options={(await listTeams(db)).filter((t) => t.kind === "support").map((t) => ({ value: t.id, label: t.name }))} />}
      </FilterBar>

      {S && (tab === "sales" || tab === "executive") && (
        <section className="mb-6 space-y-4">
          {tab === "executive" && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sales</h2>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open pipeline" value={fmtMoney(S.open.value, cur, true)} sub={<>{S.open.n} deals · weighted {fmtMoney(S.open.weighted, cur, true)} <D k="weighted" /></>} href={drill("pipeline_open")} />
            <Stat label="Won in period" value={fmtMoney(S.wonValue, cur, true)} sub={<>{S.won} won · {S.lost} lost <D k="deals_won" /></>} href={drill("deals_won")} />
            <Stat label="Win rate" value={pct(S.winRate)} sub={<>Avg cycle {S.cycleDays ?? "—"} days <D k="cycle" /></>} href={drill("deals_lost")} />
            <Stat label="Target this month" value={pct(S.target.pct)} sub={<>{fmtMoney(S.target.actual, cur, true)} of {fmtMoney(S.target.monthly, cur, true)} <D k="target" /></>} />
            <Stat label="New leads" value={S.newLeads} href={drill("leads_new")} sub={<D k="leads_new" />} />
            <Stat label="Activity completion" value={pct(S.activity.rate)} sub={`${S.activity.done}/${S.activity.due} due tasks done`} />
            <Stat label="Stale deals" value="View" href={drill("stale_deals")} sub="No activity beyond stage threshold" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Open pipeline by stage"><ColumnChart label="Open value" currency={cur} data={S.byStage.map((s) => ({ name: s.stage.split(" /")[0], value: s.value }))} /></Card>
            <Card title="Close-date forecast (weighted)"><ColumnChart label="Weighted value" currency={cur} data={S.forecast.map((s) => ({ name: s.month, value: Math.round(s.weighted) }))} /></Card>
            <Card title="Lead sources & conversion"><Table head={["Source", "Leads", "Converted", "Rate"]}>{S.sources.map((s) => <tr key={s.source}><Td>{s.source}</Td><Td>{s.n}</Td><Td>{s.converted}</Td><Td>{pct(s.n ? Math.round((s.converted / s.n) * 100) : null)}</Td></tr>)}</Table></Card>
            <Card title="Win / loss reasons"><BarList data={S.lossReasons.map((r) => ({ name: r.reason ?? "Unspecified", value: r.n }))} /></Card>
            <Card title="Rep performance" className="lg:col-span-2"><Table head={["Rep", "Won", "Lost", "Win rate", "Won value", "Open pipeline"]}>{S.reps.map((r) => <tr key={r.ownerId}><Td>{r.name}</Td><Td>{r.won}</Td><Td>{r.lost}</Td><Td>{pct(r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null)}</Td><Td>{fmtMoney(r.wonValue, cur)}</Td><Td>{fmtMoney(r.openValue, cur)}</Td></tr>)}</Table></Card>
          </div>
        </section>
      )}

      {O && (tab === "onboarding" || tab === "executive") && (
        <section className="mb-6 space-y-4">
          {tab === "executive" && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Handover & onboarding</h2>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Handovers awaiting acceptance" value={O.queue.filter((q) => !["Accepted by Onboarding", "In Onboarding", "Complete"].includes(q.status)).reduce((s, q) => s + q.n, 0)} href={drill("handovers_pending")} sub={<D k="handovers_pending" />} />
            <Stat label="Avg acceptance time" value={O.acceptHours === null ? "—" : `${O.acceptHours} h`} sub={<>{O.accepted} accepted · return rate {pct(O.returnRate)} <D k="handover_return" /></>} />
            <Stat label="Active projects" value={O.active} sub={`${O.overdueMilestones} overdue milestones · ${O.openBlockers} blockers`} href={drill("milestones_overdue")} />
            <Stat label="At-risk go-lives" value={O.atRisk} tone={O.atRisk ? "red" : undefined} href={drill("onboarding_at_risk")} sub={<>Training completion {pct(O.trainingRate)} <D k="training_rate" /></>} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Projects by stage"><BarList data={O.byStage.map((s) => ({ name: stageLabel(s.stage), value: s.n }))} /></Card>
            <Card title="Incomplete handovers">{O.incomplete.length === 0 ? <EmptyState title="None" /> : <ul className="space-y-2">{O.incomplete.map((h) => <li key={h.id}><Link className="text-sm font-medium hover:underline" href={`/handovers/${h.id}`}>{h.deal}</Link><div className="flex items-center gap-2 text-xs text-slate-500"><StatusBadge status={h.status} />{h.owner} · {Math.floor((Date.now() - h.createdAt.getTime()) / 86400000)}d old</div><Progress value={h.completeness} /></li>)}</ul>}</Card>
            <Card title="Days to go-live" className="lg:col-span-2"><Table head={["Project", "Stage", "Owner", "Days to go-live", "Risk", "Training / risk factors"]}>{O.projects.map((p) => <tr key={p.id}><Td><Link className="hover:underline" href={`/onboarding/${p.id}`}>{p.name}</Link></Td><Td>{stageLabel(p.stage)}</Td><Td>{p.owner}</Td><Td className={p.daysToGoLive !== null && p.daysToGoLive < 0 ? "font-medium text-red-700" : ""}>{p.daysToGoLive ?? "—"}</Td><Td><RiskBadge level={p.riskLevel} /></Td><Td className="text-xs">{p.riskReasons.join("; ") || "—"}</Td></tr>)}</Table></Card>
          </div>
        </section>
      )}

      {T && (tab === "support" || tab === "executive") && (
        <section className="mb-6 space-y-4">
          {tab === "executive" && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Support</h2>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open tickets" value={T.openTotal} sub={`${T.p1p2} P1/P2`} href={drill("tickets_open")} tone={T.p1p2 ? "amber" : undefined} />
            <Stat label="First response SLA" value={pct(T.slaFirst)} sub={<>Avg {T.frtMins === null ? "—" : formatMinutes(T.frtMins)} <D k="sla_first" /></>} />
            <Stat label="Resolution SLA" value={pct(T.slaResolution)} sub={<>Avg {T.ttrHours === null ? "—" : formatMinutes(T.ttrHours * 60)} · {T.resolved} resolved <D k="sla_resolution" /></>} />
            <Stat label="SLA breaches" value={T.breaches} tone={T.breaches ? "red" : undefined} href={drill("tickets_breached")} sub={<D k="breaches" />} />
            <Stat label="Reopen rate" value={pct(T.reopenRate)} href={drill("tickets_reopened")} sub={<D k="reopen_rate" />} />
            <Stat label="CSAT" value={T.csat === null ? "—" : `${T.csat}/5`} sub={`${T.csatN} response(s)`} />
            <Stat label="Engineering escalations" value={T.engEscalations} sub={<D k="eng_escalations" />} />
            <Stat label="Oldest open ticket" value={T.oldest ? ticketRef(T.oldest.number) : "—"} sub={T.oldest ? `${Math.floor((Date.now() - T.oldest.createdAt.getTime()) / 86400000)} days old` : undefined} href={T.oldest ? `/tickets/${T.oldest.id}` : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Open by priority"><BarList data={T.byPriority.map((p) => ({ name: p.priority, value: p.n, href: `/tickets?queue=all_open&priority=${p.priority}` }))} /></Card>
            <Card title="Open by age"><BarList data={["<1d", "1–3d", "3–7d", ">7d"].map((b) => ({ name: b, value: T.age.find((a) => a.bucket === b)?.n ?? 0 }))} /></Card>
            <Card title="Open by owner"><BarList data={T.byOwner.map((o) => ({ name: o.owner, value: o.n }))} /></Card>
            <Card title="Created by product"><BarList data={T.byProduct.map((o) => ({ name: o.product, value: o.n }))} /></Card>
            <Card title="Created by customer"><BarList data={T.byCustomer.map((o) => ({ name: o.customer, value: o.n }))} /></Card>
            <Card title="Resolution categories"><BarList data={T.codes.map((o) => ({ name: o.code ?? "—", value: o.n }))} /></Card>
          </div>
        </section>
      )}

      {X && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Customer success</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="At-risk accounts" value={X.atRisk} tone={X.atRisk ? "red" : undefined} href={drill("accounts_at_risk")} sub={`${X.watch} on watch · ${X.healthy} healthy`} />
            <Stat label="Renewals due (90d)" value={fmtMoney(X.renewals.v, cur, true)} sub={`${X.renewals.n} renewal(s)`} href={drill("renewals_90")} />
            <Stat label="Expansion pipeline" value={fmtMoney(X.expansion.v, cur, true)} sub={`${X.expansion.n} opportunity(ies)`} />
          </div>
        </section>
      )}
      <Notice tone="blue">Metric definitions are listed on each tile (ⓘ). Report values never include records outside the selected filters.</Notice>
    </>
  );
}
