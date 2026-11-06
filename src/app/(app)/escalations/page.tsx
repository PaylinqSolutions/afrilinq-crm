import Link from "next/link";
import { ctx } from "@/server/page";
import { can } from "@/server/actor";
import { listEscalations, type EscalationView } from "@/server/services/tickets";
import { ESCALATION_STATUSES, escalationKindLabel } from "@/lib/rules/escalations";
import { fmtDateTime, ticketRef } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Table, Tabs, Td } from "@/components/ui";

export const metadata = { title: "Escalations" };

const VIEWS: { key: EscalationView; label: string; lead?: boolean; empty: string }[] = [
  { key: "mine", label: "Assigned to me", empty: "Nothing is escalated to you right now." },
  { key: "team", label: "My team", empty: "Nothing is waiting on your team." },
  { key: "raised", label: "Raised by me", empty: "You have no open escalations." },
  { key: "confirm", label: "Awaiting my confirmation", empty: "No resolved escalations are waiting for you to confirm." },
  { key: "approval", label: "Needs approval", lead: true, empty: "No escalations are waiting for approval." },
  { key: "all", label: "All open", lead: true, empty: "No open escalations." },
  { key: "closed", label: "History", empty: "No closed escalations yet." },
];

export default async function EscalationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { actor, db, tz } = await ctx();
  const lead = can(actor, "tickets.approve_escalation", "tickets.view_all");
  const views = VIEWS.filter((v) => !v.lead || lead);
  const { view: raw } = await searchParams;
  const view = (views.find((v) => v.key === raw) ?? views[0]).key;
  const counts = Object.fromEntries(await Promise.all(views.filter((v) => v.key !== "closed").map(async (v) => [v.key, (await listEscalations(db, actor, v.key)).length])));
  const rows = await listEscalations(db, actor, view);
  const now = Date.now();
  return (
    <>
      <PageHeader title="Escalations" subtitle="Support brings in engineering, a colleague, Sales, Onboarding or management. Flow: raised → (approval for engineering/management) → accepted → resolved → confirmed by whoever raised it." />
      <Tabs current={view} tabs={views.map((v) => ({ key: v.key, label: v.label, href: `/escalations?view=${v.key}`, count: counts[v.key] }))} />
      <Card pad={false}>
        <Table head={["Ticket", "Customer", "Escalated to", "Severity", "Status", view === "closed" ? "Closed" : "Due / age", "Raised by"]} empty={<EmptyState title={views.find((v) => v.key === view)!.empty} />}>
          {rows.map((e) => {
            const st = ESCALATION_STATUSES[e.status];
            const overdue = !!e.dueAt && !e.acceptedAt && ["open", "pending_approval"].includes(e.status) && e.dueAt.getTime() < now;
            return (
              <tr key={e.id} className={overdue ? "bg-red-50/50" : "hover:bg-slate-50"}>
                <Td><Link href={`/tickets/${e.ticketId}#escalations`} className="font-medium text-brand-700 hover:underline">{ticketRef(e.number)} {e.subject}</Link>
                  <p className="max-w-md truncate text-xs text-slate-500" title={e.reason ?? ""}>{e.reason}</p>{e.resolution && <p className="max-w-md truncate text-xs text-emerald-700">Resolution: {e.resolution}</p>}</Td>
                <Td>{e.companyName ?? "—"}</Td>
                <Td><span className="font-medium">{escalationKindLabel(e.kind)}</span><p className="text-xs text-slate-500">{e.assignee ?? e.team ?? "—"}</p></Td>
                <Td>{e.severity}</Td>
                <Td><Badge tone={st?.tone === "violet" ? "violet" : st?.tone ?? "gray"}>{st?.label ?? e.status}</Badge></Td>
                <Td className={overdue ? "font-medium text-red-700" : "text-xs"}>{view === "closed" ? fmtDateTime(e.resolvedAt, tz) : overdue ? `Overdue — due ${fmtDateTime(e.dueAt, tz)}` : e.acceptedAt ? `Accepted ${fmtDateTime(e.acceptedAt, tz)}` : e.dueAt && ["open", "pending_approval"].includes(e.status) ? `Accept by ${fmtDateTime(e.dueAt, tz)}` : `Raised ${Math.max(0, Math.floor((now - e.createdAt.getTime()) / 86400000))} day(s) ago`}</Td>
                <Td className="text-xs">{e.raisedBy ?? "—"}<p className="text-slate-500">{fmtDateTime(e.createdAt, tz)}</p></Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
