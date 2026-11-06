import { customerJourney, relatedFor } from "@/server/services/journey";
import { JourneyTracker, RelatedPanel } from "@/components/related";
import Link from "next/link";
import { Lock, Users } from "lucide-react";
import { ctx, load } from "@/server/page";
import { getProjectDetail } from "@/server/services/onboarding";
import { usersInRoles } from "@/server/services/admin";
import { ONBOARDING_STAGES, stageLabel } from "@/lib/rules/onboarding";
import { fmtDate, fmtDateTime, todayIn } from "@/lib/format";
import { Badge, Card, EmptyState, KV, Notice, PageHeader, Progress, RiskBadge, StatusBadge, VersionField } from "@/components/ui";
import { ActionForm, Checkbox, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import {
  addBlockerAction, addOnbTaskAction, completeProjectAction, goLiveChecklistAction, resolveBlockerAction, setStageAction, updateDatesAction, updateOnbTaskAction,
} from "@/app/actions/handover";

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const related = await relatedFor(db, actor, "onboarding", id);
  const journey = related.companyId ? await customerJourney(db, related.companyId) : [];
  const d = await load(() => getProjectDetail(db, actor, id));
  const { p } = d;
  const today = todayIn(tz);
  const team = await usersInRoles(db, ["onboarding_manager", "trainer"]);
  const done = d.tasks.filter((t) => t.status === "done").length;
  const progress = d.tasks.length ? Math.round((done / d.tasks.length) * 100) : 0;
  const byStage = ONBOARDING_STAGES.map((s) => ({ ...s, tasks: d.tasks.filter((t) => t.stageKey === s.key) })).filter((s) => s.tasks.length);
  const titleOf = (tid: string | null) => d.tasks.find((t) => t.id === tid)?.title;
  return (
    <>
      <PageHeader title={d.company.name} crumbs={[{ href: "/onboarding", label: "Onboarding" }]}
        subtitle={<>{p.name} · Owner {d.owner?.name ?? "unassigned"} · Template {d.template?.name ?? "—"}{d.handover && <> · <Link className="hover:underline" href={`/handovers/${d.handover.id}`}>Handover ({d.handover.status})</Link></>}</>}
        actions={<>{p.state === "draft" ? <Badge tone="amber">Handover Incomplete</Badge> : <><Badge tone="brand">{stageLabel(p.stage)}</Badge><RiskBadge level={p.riskLevel} /></>}{p.state === "completed" && <Badge tone="green">Completed</Badge>}</>} />
      {p.state === "draft" && <Notice tone="amber" title="Waiting for handover acceptance">This draft project activates when onboarding accepts the handover. Tasks and dates are created from the template at that point.</Notice>}
      {p.riskReasons.length > 0 && p.state !== "completed" && <Notice tone={p.riskLevel === "high" ? "red" : "amber"} title={`Why this project is ${p.riskLevel} risk`}><ul className="list-disc pl-4">{p.riskReasons.map((r) => <li key={r}>{r}</li>)}</ul></Notice>}
      {p.state === "completed" && <Notice tone="green" title={`Completed ${fmtDateTime(p.completedAt, tz)}`}>{p.completionNotes}{p.completionException && <p className="mt-1"><strong>Exception:</strong> {p.completionException}</p>}</Notice>}
      {p.onHoldReason && p.state === "on_hold" && <Notice tone="amber" title="On hold">{p.onHoldReason}</Notice>}

      {journey.length > 0 && <div className="mb-4"><JourneyTracker steps={journey} /></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Milestones & tasks" actions={<div className="w-40"><Progress value={progress} label="Task progress" /></div>}>
            {d.tasks.length === 0 ? <EmptyState title="No tasks yet" /> : (
              <div className="space-y-4">
          <RelatedPanel groups={related.groups} />
                {byStage.map((s) => (
                  <section key={s.key}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">{s.label}</h3>
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {s.tasks.map((t) => {
                        const overdue = t.status !== "done" && t.dueDate && t.dueDate < today;
                        return (
                          <li key={t.id} className="p-2.5">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900">{t.isMilestone && <span className="mr-1 text-accent-500" aria-label="Milestone">◆</span>}{t.title}</p>
                                <p className="text-xs text-slate-500">
                                  {t.customerResponsibility ? <span className="inline-flex items-center gap-0.5 text-violet-700"><Users className="h-3 w-3" aria-hidden />Customer responsibility</span> : t.ownerName ?? "Unassigned"}
                                  {" · "}<span className={overdue ? "font-medium text-red-700" : ""}>{overdue ? "Overdue · " : "Due "}{fmtDate(t.dueDate, tz)}</span>
                                  {t.dependsOnTaskId && <> · <Lock className="inline h-3 w-3" aria-hidden /> after “{titleOf(t.dependsOnTaskId)}”</>}
                                </p>
                                {t.notes && <p className="mt-0.5 text-xs text-slate-600">{t.notes}</p>}
                                {t.evidenceUrl && <a className="text-xs text-brand-700 underline" href={t.evidenceUrl} target="_blank" rel="noopener noreferrer">Evidence</a>}
                              </div>
                              {d.canManage ? (
                                <ActionForm action={updateOnbTaskAction.bind(null, t.id)} className="flex flex-wrap items-center gap-1">
                                  <label className="sr-only" htmlFor={`st-${t.id}`}>Status</label>
                                  <select id={`st-${t.id}`} name="status" defaultValue={t.status} className="rounded border border-slate-300 px-1.5 py-1 text-xs">
                                    <option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
                                  </select>
                                  <label className="sr-only" htmlFor={`due-${t.id}`}>Due date</label>
                                  <input id={`due-${t.id}`} name="dueDate" type="date" defaultValue={t.dueDate ?? ""} className="rounded border border-slate-300 px-1.5 py-1 text-xs" />
                                  <Submit size="sm" variant="secondary">Save</Submit>
                                </ActionForm>
                              ) : <StatusBadge status={t.status} />}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {d.canManage && (
              <div className="mt-4"><Disclosure label="Add task / milestone">
                <ActionForm action={addOnbTaskAction.bind(null, id)} resetOnSuccess className="space-y-2">
                  <Grid>
                    <Input name="title" label="Title" required className="sm:col-span-2" />
                    <Select name="stageKey" label="Stage" options={ONBOARDING_STAGES.filter((s) => s.key !== "on_hold").map((s) => ({ value: s.key, label: s.label }))} />
                    <Input name="dueDate" label="Due" type="date" />
                    <Select name="ownerId" label="Owner" placeholder="—" options={team.map((u) => ({ value: u.id, label: u.name }))} />
                    <div className="flex flex-col gap-1 pt-6"><Checkbox name="isMilestone" label="Milestone" /><Checkbox name="customerResponsibility" label="Customer responsibility" /></div>
                  </Grid>
                  <Submit size="sm">Add</Submit>
                </ActionForm>
              </Disclosure></div>
            )}
          </Card>

          <Card title={`Go-live readiness (${p.goLiveChecklist.filter((x) => x.done || x.na).length}/${p.goLiveChecklist.length})`}>
            {p.goLiveChecklist.length === 0 ? <EmptyState title="Checklist is created when the project starts" /> : d.canManage ? (
              <ActionForm action={goLiveChecklistAction.bind(null, id, p.goLiveChecklist.length)} className="space-y-2"><VersionField at={p.updatedAt} />
                {p.goLiveChecklist.map((it, i) => (
                  <div key={i} className="grid grid-cols-1 items-start gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[1fr_auto_12rem]">
                    <Checkbox name={`done_${i}`} label={it.label} defaultChecked={it.done} />
                    <Checkbox name={`na_${i}`} label="N/A" defaultChecked={it.na} />
                    <label className="sr-only" htmlFor={`note_${i}`}>Note</label>
                    <input id={`note_${i}`} name={`note_${i}`} defaultValue={it.note ?? ""} placeholder="Evidence / note" className="rounded border border-slate-300 px-2 py-1 text-xs" />
                  </div>
                ))}
                <Submit size="sm">Save checklist</Submit>
              </ActionForm>
            ) : (
              <ul className="space-y-1 text-sm">{p.goLiveChecklist.map((it, i) => <li key={i}>{it.done ? "✓" : it.na ? "N/A" : "○"} {it.label}{it.note && <span className="text-xs text-slate-500"> — {it.note}</span>}</li>)}</ul>
            )}
          </Card>

          <Card title={`Blockers (${d.blockers.filter((b) => b.status === "open").length} open)`}>
            {d.blockers.length === 0 ? <EmptyState title="No blockers logged" /> : (
              <ul className="space-y-2">
                {d.blockers.map((b) => (
                  <li key={b.id} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone={b.severity === "critical" || b.severity === "high" ? "red" : b.severity === "medium" ? "amber" : "gray"}>{b.severity}</Badge><StatusBadge status={b.status} />{b.customerSide && <Badge tone="violet">Customer side</Badge>}</div>
                    <p className="mt-1 text-sm">{b.description}</p>
                    <p className="text-xs text-slate-500">Raised {fmtDateTime(b.raisedAt, tz)} · {b.ownerName ?? "No owner"}{b.resolution && ` · Resolved: ${b.resolution}`}</p>
                    {b.status === "open" && d.canManage && (
                      <ActionForm action={resolveBlockerAction.bind(null, b.id)} className="mt-2 flex flex-wrap items-end gap-2"><Input name="resolution" label="Resolution" className="min-w-[14rem] flex-1" /><Submit size="sm" variant="secondary">Resolve</Submit></ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {d.canManage && <div className="mt-3"><Disclosure label="Log blocker">
              <ActionForm action={addBlockerAction.bind(null, id)} resetOnSuccess className="space-y-2">
                <Textarea name="description" label="Description" required rows={2} />
                <Grid><Select name="severity" label="Severity" defaultValue="medium" options={["low", "medium", "high", "critical"].map((s) => ({ value: s, label: s }))} /><Select name="ownerId" label="Owner" placeholder="—" options={team.map((u) => ({ value: u.id, label: u.name }))} /></Grid>
                <Checkbox name="customerSide" label="Customer-side dependency" />
                <Submit size="sm">Log blocker</Submit>
              </ActionForm>
            </Disclosure></div>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Project">
            <KV items={[["Kickoff", fmtDate(p.kickoffDate, tz)], ["Target go-live", fmtDate(p.targetGoLive, tz)], ["Actual go-live", fmtDate(p.actualGoLive, tz)], ["Customer tier", d.company.tier], ["Segment", d.company.segment]]} />
            {d.canManage && (
              <div className="mt-3 space-y-3">
                <ActionForm action={setStageAction.bind(null, id)} className="space-y-2"><VersionField at={p.updatedAt} />
                  <Select name="stage" label="Stage" defaultValue={p.stage} options={ONBOARDING_STAGES.filter((s) => s.key !== "completed").map((s) => ({ value: s.key, label: s.label }))} />
                  <Input name="reason" label="Reason (required for On Hold)" />
                  <Submit size="sm" variant="secondary">Update stage</Submit>
                </ActionForm>
                <Disclosure label="Edit dates & notes">
                  <ActionForm action={updateDatesAction.bind(null, id)} className="space-y-2"><VersionField at={p.updatedAt} />
                    <Input name="kickoffDate" label="Kickoff date" type="date" defaultValue={p.kickoffDate ?? ""} />
                    <Input name="targetGoLive" label="Target go-live" type="date" defaultValue={p.targetGoLive ?? ""} />
                    <Textarea name="internalNotes" label="Internal notes" defaultValue={p.internalNotes ?? ""} rows={3} />
                    <Submit size="sm">Save</Submit>
                  </ActionForm>
                </Disclosure>
              </div>
            )}
          </Card>
          <Card title="Training readiness" actions={<Link className="text-xs font-medium text-brand-700 underline" href={`/training/sessions/new?company=${p.companyId}&project=${id}`}>Schedule</Link>}>
            {d.training.perProgram.length === 0 ? <EmptyState title="No required training for this product" /> : (
              <ul className="space-y-2 text-sm">{d.training.perProgram.map((x) => (
                <li key={x.programId}><div className="flex justify-between gap-2"><span>{x.name}</span>{x.gap > 0 ? <Badge tone="red">{x.participants === 0 ? "Not scheduled" : `${x.gap} not complete`}</Badge> : <Badge tone="green">Complete</Badge>}</div><p className="text-xs text-slate-500">{x.completed}/{x.participants} participants complete · role: {x.audienceRole}</p></li>
              ))}</ul>
            )}
            {d.sessions.length > 0 && <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-xs">{d.sessions.map((s) => <li key={s.id}><Link className="hover:underline" href={`/training/sessions/${s.id}`}>{s.title}</Link> · {fmtDateTime(s.startsAt, tz)} · {s.status}</li>)}</ul>}
          </Card>
          {d.handover && (
            <Card title="Sales commitments (from handover)">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{d.handover.checklist.commitments || "—"}</p>
              <p className="mt-2 text-xs font-medium text-slate-500">Risks</p><p className="whitespace-pre-wrap text-sm text-slate-700">{d.handover.checklist.risks || "—"}</p>
            </Card>
          )}
          {d.canComplete && p.state !== "completed" && p.state !== "draft" && (
            <Card title="Confirm onboarding completion">
              <p className="mb-2 text-xs text-slate-600">Completion is an explicit confirmation by the onboarding owner — not automatic when tasks are ticked. Outstanding items need an exception reason (audit-logged).</p>
              <ActionForm action={completeProjectAction.bind(null, id)} className="space-y-2">
                <Input name="actualGoLive" label="Actual go-live date" type="date" required />
                <Textarea name="notes" label="Go-live / closure notes" required rows={3} />
                <Textarea name="exceptionReason" label="Exception reason (if anything is outstanding)" rows={2} />
                <Submit size="sm">Confirm completion</Submit>
              </ActionForm>
            </Card>
          )}
          {p.internalNotes && <Card title="Internal notes"><p className="whitespace-pre-wrap text-sm">{p.internalNotes}</p></Card>}
        </div>
      </div>
    </>
  );
}
