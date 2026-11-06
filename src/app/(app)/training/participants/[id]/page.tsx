import Link from "next/link";
import { ctx, load } from "@/server/page";
import { participantRecord } from "@/server/services/training";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, PageHeader, StatusBadge, Table, Td } from "@/components/ui";

export default async function ParticipantRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const d = await load(() => participantRecord(db, actor, id));
  return (
    <>
      <PageHeader title={`${d.contact.firstName} ${d.contact.lastName}`} subtitle={`${d.contact.jobTitle ?? ""} · ${d.contact.companyName ?? ""}`} crumbs={[{ href: "/training", label: "Training" }]} />
      <p className="mb-4 flex flex-wrap gap-3 text-sm">
        <Link href={`/contacts/${d.contact.id}`} className="font-semibold text-brand-700 hover:underline">Open contact record</Link>
        {d.contact.companyId && <Link href={`/companies/${d.contact.companyId}`} className="font-semibold text-brand-700 hover:underline">Open {d.contact.companyName}</Link>}
        {d.contact.companyId && <Link href={`/companies/${d.contact.companyId}/360?tab=training`} className="font-semibold text-brand-700 hover:underline">All company training</Link>}
      </p>
      <Card title="Training record" pad={false}>
        <Table head={["Session", "Program", "When", "Attendance", "Completed", "Competency", "Feedback"]}>
          {d.rows.map((r) => <tr key={r.p.id}><Td><Link className="hover:underline" href={`/training/sessions/${r.sessionId}`}>{r.session}</Link></Td><Td className="text-xs">{r.program}{r.required && <Badge tone="red">Required</Badge>}</Td><Td>{fmtDateTime(r.startsAt, tz)}</Td><Td><StatusBadge status={r.p.attendance} /></Td><Td>{r.p.completed ? "Yes" : "No"}{r.p.needsRetraining && <Badge tone="amber">Retrain</Badge>}</Td><Td>{r.p.competency.replace("_", " ")}</Td><Td>{r.p.feedbackScore ?? "—"}</Td></tr>)}
        </Table>
      </Card>
      {d.results.length > 0 && <Card title="Assessments" className="mt-4"><ul className="text-sm">{d.results.map((r) => <li key={r.r.id}>{r.title}: {r.r.score}% (pass mark {r.passMark}%) — {r.r.passed ? "passed" : "not passed"}</li>)}</ul></Card>}
    </>
  );
}
