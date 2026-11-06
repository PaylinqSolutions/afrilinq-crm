import Link from "next/link";
import { ctx, qs , requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { listPrograms, listSessions } from "@/server/services/training";
import { addDays, fmtDateTime, todayIn } from "@/lib/format";
import { zonedParts } from "@/lib/rules/sla";
import { Badge, Card, EmptyState, FilterBar, FSelect, LinkButton, PageHeader, StatusBadge, Table, Tabs, Td } from "@/components/ui";

export const metadata = { title: "Training" };

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ view?: string; status?: string; mine?: string; week?: string }> }) {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "training.view_all", "training.view_assigned");
  const f = await searchParams;
  const view = f.view === "list" ? "list" : f.view === "programs" ? "programs" : "calendar";
  const today = todayIn(tz);
  const dow = zonedParts(new Date(), tz).weekday;
  const weekStart = f.week ?? addDays(today, -((dow + 6) % 7));
  const sessions = await listSessions(db, actor, view === "calendar" ? { from: weekStart, to: addDays(weekStart, 6), mine: f.mine } : { status: f.status, mine: f.mine });
  const programs = view === "programs" ? await listPrograms(db, actor) : [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayKey = (d: Date) => { const p = zonedParts(d, tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
  return (
    <>
      <PageHeader title="Customer training" subtitle={can(actor, "training.view_all") ? "All programs and sessions." : "Sessions you facilitate and the customers assigned to you."}
        actions={<>{can(actor, "training.programs") && <LinkButton variant="secondary" href="/training/programs/new">New program</LinkButton>}{can(actor, "training.manage") && <LinkButton href="/training/sessions/new">Schedule session</LinkButton>}</>} />
      <Tabs current={view} tabs={[{ key: "calendar", label: "Calendar", href: "/training" }, { key: "list", label: "All sessions", href: "/training?view=list" }, { key: "programs", label: "Programs", href: "/training?view=programs" }]} />
      {view === "calendar" && (
        <Card title={`Week of ${weekStart}`} actions={<div className="flex gap-2 text-sm"><Link className="underline" href={`/training${qs({ week: addDays(weekStart, -7), mine: f.mine })}`}>← Previous</Link><Link className="underline" href="/training">This week</Link><Link className="underline" href={`/training${qs({ week: addDays(weekStart, 7), mine: f.mine })}`}>Next →</Link></div>}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
            {days.map((d) => {
              const items = sessions.filter((s) => dayKey(s.s.startsAt) === d);
              return (
                <div key={d} className={`min-h-28 rounded-lg border p-2 ${d === today ? "border-brand-500 bg-brand-50/50" : "border-slate-200"}`}>
                  <p className="text-xs font-semibold text-slate-600">{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}</p>
                  <ul className="mt-1 space-y-1">{items.map((s) => <li key={s.s.id}><Link href={`/training/sessions/${s.s.id}`} className="block rounded bg-white p-1.5 text-xs shadow-sm ring-1 ring-slate-200 hover:ring-brand-500"><span className="font-medium">{fmtDateTime(s.s.startsAt, tz).split(", ").pop()}</span> {s.s.title}<span className="block text-slate-500">{s.facilitator}</span></Link></li>)}</ul>
                </div>
              );
            })}
          </div>
          {sessions.length === 0 && <p className="mt-3 text-sm text-slate-500">No sessions this week.</p>}
        </Card>
      )}
      {view === "list" && (
        <>
          <FilterBar action="/training"><input type="hidden" name="view" value="list" />
            <FSelect name="status" label="Status" value={f.status} options={["scheduled", "rescheduled", "completed", "cancelled"].map((s) => ({ value: s, label: s }))} />
            <FSelect name="mine" label="Facilitator" value={f.mine} all="Anyone" options={[{ value: "1", label: "Me" }]} />
          </FilterBar>
          <Card pad={false}>
            <Table head={["Session", "Customer", "Program", "When", "Facilitator", "Status"]} empty={<EmptyState title="No sessions" />}>
              {sessions.map((s) => <tr key={s.s.id}><Td><Link className="font-medium hover:underline" href={`/training/sessions/${s.s.id}`}>{s.s.title}</Link>{s.s.isRefresher && <Badge tone="violet">Refresher</Badge>}</Td><Td>{s.companyName}</Td><Td className="text-xs">{s.program}</Td><Td>{fmtDateTime(s.s.startsAt, tz)}</Td><Td>{s.facilitator}</Td><Td><StatusBadge status={s.s.status} /></Td></tr>)}
            </Table>
          </Card>
        </>
      )}
      {view === "programs" && (
        <Card pad={false}>
          <Table head={["Program", "Product", "Audience role", "Required for go-live", "Duration"]} empty={<EmptyState title="No programs" />}>
            {programs.map(({ p, productName }) => <tr key={p.id}><Td><Link className="font-medium hover:underline" href={`/training/programs/${p.id}`}>{p.name}</Link></Td><Td className="text-xs">{productName ?? "All products"}</Td><Td>{p.audienceRole.replace(/_/g, " ")}</Td><Td>{p.requiredForGoLive ? <Badge tone="red">Required</Badge> : <Badge>Optional</Badge>}</Td><Td>{p.durationMinutes} min</Td></tr>)}
          </Table>
        </Card>
      )}
    </>
  );
}
