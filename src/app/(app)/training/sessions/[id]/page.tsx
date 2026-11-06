import { customerJourney, relatedFor } from "@/server/services/journey";
import { JourneyTracker, RelatedPanel } from "@/components/related";
import Link from "next/link";
import { ctx, load } from "@/server/page";
import { getSessionDetail } from "@/server/services/training";
import { fmtDateTime, toLocalInput } from "@/lib/format";
import { Badge, Card, EmptyState, KV, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, Checkbox, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { addParticipantsAction, assessmentResultAction, attendanceAction, completeSessionAction, remindersAction, updateSessionAction } from "@/app/actions/training";

export default async function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const related = await relatedFor(db, actor, "session", id);
  const journey = related.companyId ? await customerJourney(db, related.companyId) : [];
  const d = await load(() => getSessionDetail(db, actor, id));
  const { s } = d;
  const editable = d.canManage && s.status !== "completed" && s.status !== "cancelled";
  return (
    <>
      <PageHeader title={s.title} crumbs={[{ href: "/training", label: "Training" }]}
        subtitle={<>{d.canOpenCompany ? <Link className="hover:underline" href={`/companies/${d.company.id}/360?tab=training`}>{d.company.name}</Link> : d.company.name} · <Link className="hover:underline" href={`/training/programs/${d.program.id}`}>{d.program.name}</Link> · {fmtDateTime(s.startsAt, tz)} · {s.durationMinutes} min · {d.facilitator.name}</>}
        actions={<><StatusBadge status={s.status} />{s.isRefresher && <Badge tone="violet">Refresher</Badge>}</>} />
      {journey.length > 0 && <div className="mb-4"><JourneyTracker steps={journey} /></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Participants & attendance (${d.participants.length})`}>
            {d.participants.length === 0 ? <EmptyState title="No participants yet" /> : (
              <ul className="divide-y divide-slate-100">
                {d.participants.map(({ p, firstName, lastName, jobTitle, email }) => (
                  <li key={p.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2"><Link href={`/training/participants/${p.contactId}`} className="font-medium hover:underline">{firstName} {lastName}</Link><span className="text-xs text-slate-500">{jobTitle} · {email}</span><StatusBadge status={p.attendance} />{p.completed && <Badge tone="green">Completed</Badge>}{p.needsRetraining && <Badge tone="amber">Retraining needed</Badge>}<Badge>{p.competency.replace("_", " ")}</Badge></div>
                    {d.results.filter((r) => r.participantId === p.id).map((r) => <p key={r.id} className="text-xs text-slate-600">Assessment: {r.score}% · {r.passed ? "passed" : "not passed"}</p>)}
                    {d.canManage && s.status !== "cancelled" && (
                      <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]">
                        <ActionForm action={attendanceAction.bind(null, p.id)} className="flex flex-wrap items-end gap-2">
                          <Select name="attendance" label="Attendance" defaultValue={p.attendance} options={["pending", "attended", "absent", "rescheduled", "cancelled"].map((a) => ({ value: a, label: a }))} />
                          <Select name="competency" label="Competency" defaultValue={p.competency} options={["not_assessed", "developing", "competent", "proficient"].map((a) => ({ value: a, label: a.replace("_", " ") }))} />
                          <Input name="feedbackScore" label="Feedback 1–5" type="number" min={1} max={5} defaultValue={p.feedbackScore ?? ""} className="w-28" />
                          <div className="flex flex-col gap-1 pb-1"><Checkbox name="completed" label="Completed" defaultChecked={p.completed} /><Checkbox name="needsRetraining" label="Needs retraining" defaultChecked={p.needsRetraining} /></div>
                          <Submit size="sm" variant="secondary">Save</Submit>
                        </ActionForm>
                        {d.assessments.length > 0 && (
                          <ActionForm action={assessmentResultAction.bind(null, p.id)} className="flex items-end gap-2">
                            <Select name="assessmentId" label="Assessment" options={d.assessments.map((a) => ({ value: a.id, label: a.title }))} />
                            <Input name="score" label="Score %" type="number" min={0} max={100} className="w-24" required />
                            <Submit size="sm" variant="secondary">Record</Submit>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && d.companyContacts.length > 0 && (
              <div className="mt-3"><Disclosure label="Add participants">
                <ActionForm action={addParticipantsAction.bind(null, id)} className="space-y-2">
                  <div className="grid gap-1 sm:grid-cols-2">{d.companyContacts.map((c) => <Checkbox key={c.id} name="contactIds" value={c.id} label={`${c.firstName} ${c.lastName}`} hint={c.jobTitle ?? undefined} />)}</div>
                  <Input name="requiredRole" label="Required role (for completion tracking)" defaultValue={d.program.audienceRole} />
                  <Submit size="sm">Add</Submit>
                </ActionForm>
              </Disclosure></div>
            )}
          </Card>
          {editable && (
            <Card title="Mark session delivered">
              <ActionForm action={completeSessionAction.bind(null, id)} className="space-y-2">
                <Textarea name="topicsCovered" label="Topics covered" required rows={2} />
                <p className="text-xs text-slate-500">Attendance must be recorded for every participant first.</p>
                <Submit size="sm">Mark delivered</Submit>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <RelatedPanel groups={related.groups} />
          <Card title="Session">
            <KV items={[["Channel", s.channel], ["Meeting link", s.meetingLink ? <a key="m" className="break-all text-brand-700 underline" href={s.meetingLink} target="_blank" rel="noopener noreferrer">{s.meetingLink}</a> : null], ["Location", s.location], ["Agenda", s.agenda], ["Topics covered", s.topicsCovered], ["Onboarding project", d.project ? <Link key="p" className="hover:underline" href={`/onboarding/${d.project.id}`}>{d.project.name}</Link> : null]]} />
            {editable && <div className="mt-3"><Disclosure label="Reschedule / edit">
              <ActionForm action={updateSessionAction.bind(null, id)} className="space-y-2">
                <Input name="startsAt" label="Date & time" type="datetime-local" defaultValue={toLocalInput(s.startsAt, tz)} />
                <Input name="meetingLink" label="Meeting link" defaultValue={s.meetingLink ?? ""} /><Input name="location" label="Location" defaultValue={s.location ?? ""} />
                <Textarea name="agenda" label="Agenda" defaultValue={s.agenda ?? ""} rows={2} />
                <Select name="status" label="Status" defaultValue={s.status === "rescheduled" ? "rescheduled" : "scheduled"} options={[{ value: "scheduled", label: "Scheduled" }, { value: "rescheduled", label: "Rescheduled" }, { value: "cancelled", label: "Cancelled" }]} />
                <Textarea name="notes" label="Notes" defaultValue={s.notes ?? ""} rows={2} />
                <Submit size="sm">Save</Submit>
              </ActionForm>
            </Disclosure></div>}
          </Card>
          {editable && (
            <Card title="Reminders">
              <ActionForm action={remindersAction.bind(null, id)} className="space-y-2">
                <p className="text-xs text-slate-600">An in-app reminder goes to the facilitator. Participant emails need a configured email provider.</p>
                <Checkbox name="confirmSimulated" label="Email not configured: record simulated reminders (demo mode)" />
                <Submit size="sm" variant="secondary">Send reminders</Submit>
              </ActionForm>
            </Card>
          )}
          <Card title="Materials">{d.materials.length ? <ul className="space-y-1 text-sm">{d.materials.map((m) => <li key={m.id}><a className="text-brand-700 hover:underline" href={m.url} target="_blank" rel="noopener noreferrer">{m.title}</a> {m.visibility === "internal" && <Badge tone="amber">Internal</Badge>}</li>)}</ul> : <EmptyState title="No materials" />}</Card>
        </div>
      </div>
    </>
  );
}
