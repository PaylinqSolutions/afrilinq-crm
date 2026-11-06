import { relatedFor } from "@/server/services/journey";
import { RelatedPanel } from "@/components/related";
import Link from "next/link";
import { ctx, load } from "@/server/page";
import { getProgram } from "@/server/services/training";
import { products } from "@/db/schema";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { ProgramFields } from "@/components/program-form";
import { addAssessmentAction, addMaterialAction, saveProgramAction } from "@/app/actions/training";

export default async function ProgramDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const related = await relatedFor(db, actor, "program", id);
  const d = await load(() => getProgram(db, actor, id));
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  return (
    <>
      <PageHeader title={d.p.name} crumbs={[{ href: "/training?view=programs", label: "Programs" }]} subtitle={`${d.product?.name ?? "All products"} · ${d.p.audienceRole.replace(/_/g, " ")} · ${d.p.durationMinutes} min`}
        actions={d.p.requiredForGoLive ? <Badge tone="red">Required for go-live</Badge> : <Badge>Optional</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Learning objectives">{d.p.objectives.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{d.p.objectives.map((o) => <li key={o}>{o}</li>)}</ul> : <EmptyState title="No objectives yet" />}{d.p.description && <p className="mt-3 text-sm text-slate-600">{d.p.description}</p>}</Card>
          <Card title="Sessions">{d.sessions.length ? <ul className="divide-y divide-slate-100">{d.sessions.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><Link className="font-medium hover:underline" href={`/training/sessions/${s.id}`}>{s.title}</Link><span className="text-xs text-slate-500">{s.companyName} · {fmtDateTime(s.startsAt, tz)} · {s.facilitator}</span><StatusBadge status={s.status} /></li>)}</ul> : <EmptyState title="No sessions you can see" />}</Card>
          {d.canEdit && <Disclosure label="Edit program"><Card><ActionForm action={saveProgramAction.bind(null, id)}><ProgramFields p={d.p} products={ps} /></ActionForm></Card></Disclosure>}
        </div>
        <div className="space-y-4">
          <RelatedPanel groups={related.groups} />
          <Card title="Materials">
            {d.materials.length ? <ul className="space-y-1 text-sm">{d.materials.map((m) => <li key={m.id}><a className="text-brand-700 hover:underline" href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a> <Badge>{m.kind}</Badge> {m.visibility === "internal" ? <Badge tone="amber">Internal</Badge> : <Badge tone="green">Customer</Badge>}</li>)}</ul> : <EmptyState title="No materials" />}
            {d.canEdit && <div className="mt-3"><Disclosure label="Add material"><ActionForm action={addMaterialAction.bind(null, id)} resetOnSuccess className="space-y-2">
              <Input name="title" label="Title" required /><Input name="url" label="Link (document/video store)" type="url" required />
              <Grid><Select name="kind" label="Type" options={["guide", "video", "recording", "slides", "link"].map((k) => ({ value: k, label: k }))} /><Select name="visibility" label="Visibility" options={[{ value: "customer", label: "Customer" }, { value: "internal", label: "Internal only" }]} /></Grid>
              <Submit size="sm">Add</Submit></ActionForm></Disclosure></div>}
          </Card>
          <Card title="Assessments">
            {d.assessments.length ? <ul className="space-y-1 text-sm">{d.assessments.map((a) => <li key={a.id}>{a.title} <span className="text-xs text-slate-500">· pass {a.passMark}% · {a.questions.length} question(s)</span></li>)}</ul> : <EmptyState title="No assessments" />}
            {d.canEdit && <div className="mt-3"><Disclosure label="Add assessment"><ActionForm action={addAssessmentAction.bind(null, id)} resetOnSuccess className="space-y-2">
              <Input name="title" label="Title" required /><Input name="passMark" label="Pass mark (%)" type="number" defaultValue={70} />
              <Textarea name="questions" label="Questions" rows={4} required hint="One per line: Question | option A | option B | option C | correct option number" />
              <Submit size="sm">Add</Submit></ActionForm></Disclosure></div>}
          </Card>
        </div>
      </div>
    </>
  );
}
