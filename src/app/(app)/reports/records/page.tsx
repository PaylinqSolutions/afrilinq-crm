import Link from "next/link";
import { ctx, load, qs } from "@/server/page";
import { defaultRange, drill, DRILLS } from "@/server/services/reports";
import { can } from "@/server/actor";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "Report records" };

export default async function Records({ searchParams }: { searchParams: Promise<{ m?: string; from?: string; to?: string; owner?: string; product?: string; segment?: string }> }) {
  const { actor, db, tz } = await ctx();
  const sp = await searchParams;
  const def = defaultRange(tz);
  const f = { from: sp.from || def.from, to: sp.to || def.to, owner: sp.owner, product: sp.product, segment: sp.segment, tz };
  const r = await load(() => drill(db, actor, sp.m ?? "", f));
  return (
    <>
      <PageHeader title={r.label} crumbs={[{ href: `/reports${qs({ from: sp.from, to: sp.to })}`, label: "Reports" }]} subtitle={<>{r.rows.length} record(s) · {f.from} → {f.to}. {r.definition}</>} />
      <Card pad={false}>
        <Table head={r.headers} empty={<EmptyState title="No records" />}>
          {r.rows.map((row) => <tr key={row.id} className="hover:bg-slate-50">{row.cells.map((c, i) => <Td key={i}>{i === 0 ? <Link className="font-medium hover:underline" href={row.href}>{c}</Link> : c}</Td>)}</tr>)}
        </Table>
      </Card>
      <p className="mt-2 text-xs text-slate-500">Other drill-downs: {Object.entries(DRILLS).filter(([, v]) => can(actor, ...v.perm)).map(([k, v]) => <Link key={k} className="mr-2 underline" href={`/reports/records${qs({ ...sp, m: k })}`}>{v.label}</Link>)}</p>
    </>
  );
}
