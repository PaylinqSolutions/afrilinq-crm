import { ctx, qs, requirePerm } from "@/server/page";
import { listAudit } from "@/server/services/admin";
import { fmtDateTime } from "@/lib/format";
import { Card, EmptyState, FilterBar, FInput, FSelect, PageHeader, Table, Td } from "@/components/ui";
import Link from "next/link";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string; page?: string }> }) {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "audit.view");
  const f = await searchParams;
  const rows = await listAudit(db, actor, f);
  const page = Number(f.page) || 1;
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who changed what, when — including role changes, financial/contract fields, deal stage/amount, ticket priority/status, handover decisions, onboarding completion and data exports." />
      <FilterBar action="/settings/audit">
        <FInput name="q" label="Search" value={f.q} placeholder="Action, record ID or reason" />
        <FSelect name="entity" label="Entity" value={f.entity} options={["deal", "lead", "company", "contact", "handover", "onboarding", "ticket", "user", "role", "settings", "sla_policy", "export", "training_session", "article"].map((e) => ({ value: e, label: e }))} />
      </FilterBar>
      <Card pad={false}>
        <Table head={["When", "Who", "Action", "Record", "Changes", "Reason"]} empty={<EmptyState title="No events" />}>
          {rows.map((a) => (
            <tr key={a.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(a.createdAt, tz)}</Td><Td>{a.actorLabel}</Td><Td><code className="text-xs">{a.action}</code></Td><Td className="text-xs">{a.entityType}<div className="max-w-[10rem] truncate text-slate-500">{a.entityId}</div></Td>
              <Td className="max-w-md text-xs">{a.changes ? Object.entries(a.changes).map(([k, c]) => <div key={k} className="break-words"><span className="font-medium">{k}</span>: {JSON.stringify(c.from)?.slice(0, 80)} → {JSON.stringify(c.to)?.slice(0, 80)}</div>) : "—"}</Td><Td className="text-xs">{a.reason}</Td></tr>
          ))}
        </Table>
        <div className="flex justify-between px-3 py-2 text-xs">{page > 1 ? <Link href={`/settings/audit${qs({ ...f, page: String(page - 1) })}`}>← Newer</Link> : <span />}{rows.length === 50 && <Link href={`/settings/audit${qs({ ...f, page: String(page + 1) })}`}>Older →</Link>}</div>
      </Card>
    </>
  );
}
