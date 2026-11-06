import Link from "next/link";
import { ctx, qs } from "@/server/page";
import { can } from "@/server/actor";
import { listTickets, QUEUES } from "@/server/services/tickets";
import { simpleUsers, listTeams } from "@/server/services/admin";
import { products } from "@/db/schema";
import { TICKET_STATUSES, ticketStatusLabel } from "@/lib/rules/tickets";
import { SEGMENTS } from "@/lib/rules/sales";
import { fmtRelative, ticketRef } from "@/lib/format";
import { slaLabel } from "@/lib/sla-label";
import { Badge, Card, EmptyState, FilterBar, FInput, FSelect, LinkButton, PageHeader, Pagination, PriorityBadge, SlaBadge, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { SavedViews } from "@/components/saved-views";
import { runSweepAction } from "@/app/actions/admin";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "Tickets" };
type SP = { queue?: string; view?: string; priority?: string; status?: string; owner?: string; team?: string; product?: string; company?: string; sla?: string; q?: string; page?: string; sort?: string; segment?: string };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor, db } = await ctx();
  const f = await searchParams;
  const queue = f.queue ?? "all_open";
  const view = f.view === "board" ? "board" : "table";
  const { rows, total, all } = await listTickets(db, actor, { ...f, queue });
  const users = await simpleUsers(db);
  const teams = await listTeams(db);
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  const keep = { ...f, page: undefined };
  return (
    <>
      <PageHeader title="Support desk" subtitle="SLA timers use the customer's policy, business hours and Africa/Lagos time unless configured otherwise."
        actions={<>{can(actor, "tickets.approve_escalation") && <ActionForm action={runSweepAction}><Submit variant="secondary">Run SLA check now</Submit></ActionForm>}{can(actor, "data.export") && <LinkButton variant="secondary" href={`/api/export/tickets${qs(keep)}`}>Export CSV</LinkButton>}{can(actor, "tickets.create") && <LinkButton href="/tickets/new">New ticket</LinkButton>}</>} />
      <nav aria-label="Queues" className="-mx-4 mb-3 overflow-x-auto px-4"><ul className="flex gap-1.5">
        {QUEUES.map((q) => <li key={q.key}><Link href={`/tickets${qs({ queue: q.key, view: f.view })}`} aria-current={q.key === queue ? "page" : undefined}
          className={`inline-block whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${q.key === queue ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-500"}`}>{q.label}</Link></li>)}
      </ul></nav>
      <Tabs current={view} tabs={[{ key: "table", label: "Table", href: `/tickets${qs({ ...keep, view: undefined })}` }, { key: "board", label: "Board", href: `/tickets${qs({ ...keep, view: "board" })}` }]} />
      <SavedViews entity="tickets" current={qs(keep)} />
      <FilterBar action="/tickets">
        <input type="hidden" name="queue" value={queue} /><input type="hidden" name="view" value={view === "board" ? "board" : ""} />
        <FInput name="q" label="Search" value={f.q} placeholder="AFL-12, subject, customer" />
        <FSelect name="priority" label="Priority" value={f.priority} options={["P1", "P2", "P3", "P4"].map((p) => ({ value: p, label: p }))} />
        <FSelect name="status" label="Status" value={f.status} options={TICKET_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
        <FSelect name="sla" label="SLA" value={f.sla} options={[{ value: "risk", label: "At risk" }, { value: "breached", label: "Breached" }]} />
        <FSelect name="owner" label="Owner" value={f.owner} options={[{ value: "me", label: "Me" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <FSelect name="team" label="Team queue" value={f.team} options={teams.filter((t) => t.kind === "support" || t.kind === "engineering").map((t) => ({ value: t.id, label: t.name }))} />
        <FSelect name="product" label="Product" value={f.product} options={ps.map((p) => ({ value: p.id, label: p.name }))} />
        <FSelect name="segment" label="Segment" value={f.segment} options={SEGMENTS.map((s) => ({ value: s, label: s }))} />
        <FSelect name="sort" label="Sort" value={f.sort} all={null} options={[{ value: "priority", label: "Priority" }, { value: "due", label: "Resolution due" }, { value: "oldest", label: "Oldest" }, { value: "created", label: "Newest" }, { value: "updated", label: "Recently updated" }]} />
      </FilterBar>
      {view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="flex gap-3" style={{ minWidth: `${TICKET_STATUSES.length * 236}px` }}>
            {TICKET_STATUSES.map((s) => {
              const col = all.filter((r) => r.t.status === s.key);
              return (
                <section key={s.key} aria-label={s.label} className="w-56 shrink-0 rounded-xl border border-slate-200 bg-slate-100/80">
                  <header className="border-b border-slate-200 px-3 py-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{s.label}</h3><p className="text-xs text-slate-500">{col.length}</p></header>
                  <ul className="flex min-h-20 flex-col gap-2 p-2">
                    {col.map((r) => (
                      <li key={r.t.id} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
                        <div className="flex items-center justify-between gap-1"><PriorityBadge p={r.t.priority} /><span className="text-xs text-slate-500">{ticketRef(r.t.number)}</span></div>
                        <Link href={`/tickets/${r.t.id}`} className="mt-1 block text-sm font-medium leading-snug hover:underline">{r.t.subject}</Link>
                        <p className="truncate text-xs text-slate-500">{r.companyName ?? r.t.requesterEmail} · {r.ownerName ?? "Unassigned"}</p>
                        {r.sla && <div className="mt-1"><SlaBadge state={r.sla.state} label={slaLabel(r.sla)} /></div>}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Card pad={false}>
          <Table head={["Ticket", "Customer", "Priority", "Status", "SLA", "Owner / queue", "Age"]} empty={<EmptyState title="No tickets in this queue" />}>
            {rows.map((r) => (
              <tr key={r.t.id} className="hover:bg-slate-50">
                <Td><Link href={`/tickets/${r.t.id}`} className="font-medium hover:underline">{ticketRef(r.t.number)} · {r.t.subject}</Link><div className="text-xs text-slate-500">{r.productName} · {r.t.category}{r.t.isIncident && <Badge tone="red">Incident</Badge>}{r.t.reopenCount > 0 && <Badge tone="red">Reopened ×{r.t.reopenCount}</Badge>}</div></Td>
                <Td>{r.companyName ?? r.t.requesterEmail}<div className="text-xs text-slate-500">{r.tier}</div></Td>
                <Td><PriorityBadge p={r.t.priority} /></Td>
                <Td><StatusBadge status={r.t.status} />{r.t.waitingReason && <div className="max-w-[12rem] truncate text-xs text-slate-500" title={r.t.waitingReason}>{r.t.waitingReason}</div>}</Td>
                <Td>{r.sla ? <SlaBadge state={r.sla.state} label={slaLabel(r.sla)} /> : "—"}</Td>
                <Td>{r.ownerName ?? <span className="text-amber-700">Unassigned</span>}<div className="text-xs text-slate-500">{r.teamName}</div></Td>
                <Td className="whitespace-nowrap text-xs">{fmtRelative(r.t.createdAt)}</Td>
              </tr>
            ))}
          </Table>
          <Pagination total={total} page={Number(f.page) || 1} base={`/tickets${qs(keep)}`} />
        </Card>
      )}
      <p className="mt-2 text-xs text-slate-500">Statuses: {TICKET_STATUSES.map((s) => ticketStatusLabel(s.key)).join(" → ")}.</p>
    </>
  );
}
