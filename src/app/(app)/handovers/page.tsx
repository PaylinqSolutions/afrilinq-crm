import Link from "next/link";
import { ctx, requirePerm } from "@/server/page";
import { listHandovers } from "@/server/services/handover";
import { HANDOVER_STATUSES } from "@/lib/rules/handover";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge, Card, EmptyState, FilterBar, FSelect, PageHeader, Progress, Stat, StatusBadge, Table, Td } from "@/components/ui";

export const metadata = { title: "Handover queue" };

export default async function HandoversPage({ searchParams }: { searchParams: Promise<{ status?: string; owner?: string; deal?: string }> }) {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "handover.view");
  const f = await searchParams;
  const rows = await listHandovers(db, actor, f);
  const all = f.status || f.owner || f.deal ? await listHandovers(db, actor, {}) : rows;
  const count = (s: string) => all.filter((r) => r.status === s).length;
  const now = Date.now();
  return (
    <>
      <PageHeader title="Handover queue" subtitle="Closed-won deals move from Sales to Onboarding here. Onboarding cannot start until a handover is accepted." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Awaiting Sales" value={count("Pending Sales Submission")} href="/handovers?status=Pending+Sales+Submission" tone={count("Pending Sales Submission") ? "amber" : undefined} />
        <Stat label="Ready for review" value={count("Submitted for Review")} href="/handovers?status=Submitted+for+Review" />
        <Stat label="Changes requested" value={count("Changes Requested")} href="/handovers?status=Changes+Requested" />
        <Stat label="In onboarding" value={count("Accepted by Onboarding") + count("In Onboarding")} />
      </div>
      <FilterBar action="/handovers">
        <FSelect name="status" label="Status" value={f.status} options={HANDOVER_STATUSES.map((s) => ({ value: s, label: s }))} />
        <FSelect name="owner" label="Sales owner" value={f.owner} options={[{ value: "me", label: "My deals" }]} />
      </FilterBar>
      <Card pad={false}>
        <Table head={["Deal", "Customer", "Status", "Completeness", "Sales owner", "Age", "Returns"]} empty={<EmptyState title="No handovers match" />}>
          {rows.map((h) => {
            const age = Math.floor((now - h.createdAt.getTime()) / 86400000);
            const waiting = !["Accepted by Onboarding", "In Onboarding", "Complete"].includes(h.status);
            return (
              <tr key={h.id} className="hover:bg-slate-50">
                <Td><Link href={`/handovers/${h.id}`} className="font-medium hover:underline">{h.dealName}</Link><div className="text-xs text-slate-500">{fmtMoney(h.amount, h.currency)}</div></Td>
                <Td><Link href={`/companies/${h.companyId}`} className="hover:underline">{h.companyName}</Link></Td>
                <Td><StatusBadge status={h.status} />{h.correctionRequested && <Badge tone="violet">Correction requested</Badge>}</Td>
                <Td className="min-w-[8rem]"><Progress value={h.completeness} label="Completeness" /></Td>
                <Td>{h.ownerName}</Td>
                <Td className={waiting && age > 5 ? "font-medium text-red-700" : ""}>{age}d{waiting && age > 5 ? " · overdue" : ""}<div className="text-xs font-normal text-slate-500">since {fmtDate(h.createdAt, tz)}</div></Td>
                <Td className="tabular-nums">{h.returnCount}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
