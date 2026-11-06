import Link from "next/link";
import { ctx, qs , requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { listLeads } from "@/server/services/sales";
import { simpleUsers } from "@/server/services/admin";
import { LEAD_SOURCES, LEAD_STATUSES, SEGMENTS } from "@/lib/rules/sales";
import { fmtDateTime } from "@/lib/format";
import { Card, EmptyState, FilterBar, FInput, FSelect, LinkButton, PageHeader, Pagination, StatusBadge, Table, Td } from "@/components/ui";
import { SavedViews } from "@/components/saved-views";

export const metadata = { title: "Leads" };
type SP = { q?: string; status?: string; owner?: string; source?: string; segment?: string; page?: string; sort?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "leads.view_all", "leads.view_own");
  const f = await searchParams;
  const { rows, total } = await listLeads(db, actor, f);
  const users = await simpleUsers(db);
  const now = new Date();
  const base = `/leads${qs({ ...f, page: undefined })}`;
  return (
    <>
      <PageHeader title="Leads" subtitle="Open leads by next action. Converted and disqualified leads are hidden unless filtered."
        actions={<>{can(actor, "data.export") && <LinkButton variant="secondary" href={`/api/export/leads${qs({ ...f, page: undefined })}`}>Export CSV</LinkButton>}{can(actor, "leads.edit") && <LinkButton href="/leads/new">New lead</LinkButton>}</>} />
      <SavedViews entity="leads" current={qs({ ...f, page: undefined })} />
      <FilterBar action="/leads">
        <FInput name="q" label="Search" value={f.q} placeholder="Name or organisation" />
        <FSelect name="status" label="Status" value={f.status} all="Open" options={LEAD_STATUSES.map((s) => ({ value: s, label: s }))} />
        <FSelect name="owner" label="Owner" value={f.owner} options={[{ value: "me", label: "Me" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        <FSelect name="source" label="Source" value={f.source} options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} />
        <FSelect name="segment" label="Segment" value={f.segment} options={SEGMENTS.map((s) => ({ value: s, label: s }))} />
        <FSelect name="sort" label="Sort" value={f.sort} all={null} options={[{ value: "due", label: "Next action due" }, { value: "created", label: "Newest" }, { value: "name", label: "Name" }, { value: "status", label: "Status" }]} />
      </FilterBar>
      <Card pad={false}>
        <Table head={["Lead", "Organisation", "Status", "Source", "Product", "Owner", "Next action", ""]} empty={<EmptyState title="No leads match these filters" action={can(actor, "leads.edit") ? <LinkButton href="/leads/new">Create a lead</LinkButton> : undefined} />}>
          {rows.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <Td><Link href={`/leads/${l.id}`} className="font-medium text-slate-900 hover:underline">{l.name}</Link><div className="text-xs text-slate-500">{l.contactName}</div></Td>
              <Td>{l.organization ?? <span className="text-slate-500">Individual</span>}</Td><Td><StatusBadge status={l.status} /></Td><Td>{l.source}</Td><Td className="text-xs">{l.product ?? "—"}</Td><Td>{l.ownerName ?? <span className="text-amber-700">Unassigned</span>}</Td>
              <Td><div className="max-w-[16rem] truncate">{l.nextAction}</div><div className={`text-xs ${l.nextActionDue && l.nextActionDue < now ? "font-medium text-red-700" : "text-slate-500"}`}>{l.nextActionDue ? `${l.nextActionDue < now ? "Overdue · " : ""}${fmtDateTime(l.nextActionDue, tz)}` : "No date"}</div></Td>
              <Td>{!["Converted", "Disqualified"].includes(l.status) && can(actor, "leads.edit") && can(actor, "accounts.edit") && <Link href={`/leads/${l.id}#convert`} className="whitespace-nowrap rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50">Convert</Link>}</Td>
            </tr>
          ))}
        </Table>
        <Pagination total={total} page={Number(f.page) || 1} base={base} />
      </Card>
    </>
  );
}
