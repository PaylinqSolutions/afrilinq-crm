import Link from "next/link";
import { Lock } from "lucide-react";
import { ctx, load } from "@/server/page";
import { can } from "@/server/actor";
import { customer360 } from "@/server/services/accounts";
import { trainingSummaryForCompany } from "@/server/services/training";
import { simpleUsers } from "@/server/services/admin";
import { CONTACT_ROLES } from "@/lib/rules/sales";
import { stageLabel } from "@/lib/rules/onboarding";
import { ticketStatusLabel } from "@/lib/rules/tickets";
import { fmtDate, fmtDateTime, fmtMoney, ticketRef, titleCase } from "@/lib/format";
import { Badge, Card, EmptyState, HealthBadge, KV, LinkButton, PageHeader, PriorityBadge, Progress, RiskBadge, Stat, StatusBadge, Table, Tabs, Td, VersionField } from "@/components/ui";
import { ActionForm, Checkbox, Disclosure, Input, Select, Submit, Textarea } from "@/components/forms";
import { CompanyFields } from "@/components/company-form";
import { ActivityForm, NewTaskForm, TaskList, Timeline } from "@/components/records";
import { saveCustomFieldsAction, updateBillingAction, updateCompanyAction, uploadCompanyFileAction } from "@/app/actions/crm";
import { reviewHealthAction } from "@/app/actions/success";

const TABS = ["overview", "contacts", "deals", "onboarding", "training", "tickets", "activities", "files", "audit"] as const;

export default async function Company360({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? rawTab! : "overview";
  const { actor, db, tz, settings } = await ctx();
  const v = await load(() => customer360(db, actor, id));
  const c = v.company;
  const openTickets = v.tickets.filter((t) => !["resolved", "closed"].includes(t.status));
  const activeProject = v.projects.find((p) => p.state !== "completed") ?? v.projects[0];
  const training = await trainingSummaryForCompany(db, id);
  const wonValue = v.deals.filter((d) => d.isWon).reduce((s, d) => s + (d.amount ?? 0), 0);
  const href = (t: string) => `/companies/${id}/360?tab=${t}`;
  return (
    <>
      <PageHeader title={`${c.name} — Customer 360`} crumbs={[{ href: "/companies", label: "Companies" }, { href: `/companies/${id}`, label: c.name }]}
        subtitle={<>{[c.industry, c.city, c.region].filter(Boolean).join(" · ")} · Owner {v.owner?.name ?? "—"}{v.csm ? ` · CSM ${v.csm.name}` : ""}</>}
        actions={<><StatusBadge status={c.lifecycle} map={{ customer: "green", prospect: "blue", churned: "red" }} /><Badge>{c.segment}</Badge><Badge tone="violet">{c.tier}</Badge>{c.lifecycle === "customer" && <HealthBadge status={v.health?.status} score={v.health?.score} />}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Won value" value={fmtMoney(wonValue, settings.currency, true)} sub={`${v.deals.filter((d) => !d.isWon && !d.isLost).length} open deal(s)`} href={href("deals")} />
        <Stat label="Onboarding" value={activeProject ? stageLabel(activeProject.stage) : "—"} sub={activeProject ? <RiskBadge level={activeProject.riskLevel} /> : "No project"} href={href("onboarding")} />
        <Stat label="Training" value={`${training.completed}/${training.participants}`} sub={`${training.sessionsHeld} session(s) held`} href={href("training")} />
        <Stat label="Open tickets" value={openTickets.length} sub={`${openTickets.filter((t) => t.priority === "P1" || t.priority === "P2").length} P1/P2`} tone={openTickets.some((t) => t.priority === "P1" || t.priority === "P2") ? "amber" : undefined} href={href("tickets")} />
        <Stat label="Next renewal" value={v.renewals[0] ? fmtDate(v.renewals[0].renewalDate, tz) : "—"} sub={v.renewals[0] ? fmtMoney(v.renewals[0].amount, v.renewals[0].currency) : undefined} />
      </div>
      <Tabs current={tab} tabs={[
        { key: "overview", label: "Overview", href: href("overview") }, { key: "contacts", label: "Contacts", href: href("contacts"), count: v.contacts.length },
        { key: "deals", label: "Deals", href: href("deals"), count: v.deals.length }, { key: "onboarding", label: "Onboarding", href: href("onboarding"), count: v.projects.length },
        { key: "training", label: "Training", href: href("training"), count: v.sessions.length }, { key: "tickets", label: "Tickets", href: href("tickets"), count: v.tickets.length },
        { key: "activities", label: "Activities", href: href("activities"), count: v.activities.length }, { key: "files", label: "Files", href: href("files"), count: v.files.length },
        { key: "audit", label: "Audit history", href: href("audit") },
      ]} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Unified timeline" actions={can(actor, "activities.log") ? <ActivityForm link={{ companyId: id }} contacts={v.contacts} /> : undefined}>
              <Timeline tz={tz} items={v.timeline.slice(0, 40)} />
            </Card>
          </div>
          <div className="space-y-4">
            {v.health && (
              <Card title="Customer health" actions={<HealthBadge status={v.health.status} score={v.health.score} />}>
                <p className="mb-2 text-xs text-slate-500">Computed {fmtDateTime(v.health.computedAt, tz)} from the factors below (weights configurable in Settings). Not a prediction.</p>
                <ul className="space-y-2">
                  {v.health.components.map((h) => (
                    <li key={h.key}><div className="flex justify-between text-sm"><span>{h.label} <span className="text-xs text-slate-400">×{h.weight}</span></span><span className="tabular-nums">{h.score}</span></div><Progress value={h.score} label={h.label} /><p className="text-xs text-slate-500">{h.detail}</p></li>
                  ))}
                </ul>
                {v.health.reviewedAt ? <p className="mt-3 text-xs text-slate-600">Reviewed {fmtDateTime(v.health.reviewedAt, tz)}: {v.health.reviewNotes}</p> : can(actor, "success.manage") && (
                  <div className="mt-3"><Disclosure label="Record review & action plan">
                    <ActionForm action={reviewHealthAction.bind(null, v.health.id)} className="space-y-2"><Textarea name="notes" label="Review notes / plan" required rows={3} /><Submit size="sm">Save review</Submit></ActionForm>
                  </Disclosure></div>
                )}
              </Card>
            )}
            <Card title="Open tasks">
              <TaskList tasks={v.tasks.map((t) => ({ ...t, status: t.status }))} tz={tz} compact />
              <div className="mt-3"><Disclosure label="Add task"><NewTaskForm users={await simpleUsers(db)} link={{ relatedType: "company", relatedId: id, companyId: id }} /></Disclosure></div>
            </Card>
            {(v.renewals.length > 0 || v.expansions.length > 0) && (
              <Card title="Renewals & expansion">
                <ul className="space-y-2 text-sm">
                  {v.renewals.map((r) => <li key={r.id} className="flex justify-between gap-2"><span>Renewal {fmtDate(r.renewalDate, tz)}</span><span className="flex gap-2"><StatusBadge status={r.status} />{fmtMoney(r.amount, r.currency)}</span></li>)}
                  {v.expansions.map((x) => <li key={x.id} className="flex justify-between gap-2"><span>{x.description}</span><span className="flex gap-2"><StatusBadge status={x.status} />{fmtMoney(x.estimatedValue)}</span></li>)}
                </ul>
              </Card>
            )}
            <Card title="Account details"><KV items={[["Phone", c.phone], ["Website", c.website], ["Address", c.address], ["Created", fmtDate(c.createdAt, tz)], ...(v.canSeeBilling ? [["Billing status", c.billingStatus ? <StatusBadge key="b" status={c.billingStatus} map={{ current: "green", overdue: "amber", unpaid: "red" }} /> : "—"], ["Billing notes", c.billingNotes]] as [string, React.ReactNode][] : [])]} /></Card>
            {v.canBilling && (
              <Card title="Billing (Finance)">
                <ActionForm action={updateBillingAction.bind(null, id)} className="space-y-2"><VersionField at={c.updatedAt} />
                  <Select name="billingStatus" label="Payment / invoice status" defaultValue={c.billingStatus ?? ""} placeholder="—" options={[{ value: "current", label: "Current" }, { value: "overdue", label: "Overdue" }, { value: "unpaid", label: "Unpaid — flag account" }, { value: "n/a", label: "N/A" }]} />
                  <Textarea name="billingNotes" label="Notes" defaultValue={c.billingNotes ?? ""} rows={2} />
                  <Submit size="sm">Record</Submit>
                </ActionForm>
              </Card>
            )}
            {v.customFields.length > 0 && (
              <Card title="Custom fields">
                <ActionForm action={saveCustomFieldsAction.bind(null, "company", id)} className="space-y-2">
                  {v.customFields.map((f) => f.fieldType === "select"
                    ? <Select key={f.id} name={`cf_${f.key}`} label={f.label} required={f.required} defaultValue={f.value ?? ""} placeholder="—" options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
                    : <Input key={f.id} name={`cf_${f.key}`} label={f.label} required={f.required} type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : "text"} defaultValue={f.value ?? ""} />)}
                  {v.canEdit && <Submit size="sm">Save</Submit>}
                </ActionForm>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "contacts" && (
        <Card title="Contacts" actions={v.canEdit ? <LinkButton size="sm" href={`/contacts/new?company=${id}`}>Add contact</LinkButton> : undefined} pad={false}>
          <Table head={["Name", "Title", "Roles", "Email", "Phone"]} empty={<EmptyState title="No contacts yet" />}>
            {v.contacts.map((x) => (
              <tr key={x.id}><Td><Link className="font-medium hover:underline" href={`/contacts/${x.id}`}>{x.firstName} {x.lastName}</Link></Td><Td>{x.jobTitle}</Td>
                <Td><div className="flex flex-wrap gap-1">{x.contactRoles.map((r) => <Badge key={r}>{CONTACT_ROLES.find((cr) => cr.key === r)?.label ?? r}</Badge>)}</div></Td><Td className="text-xs">{x.email}</Td><Td className="text-xs">{x.phone}</Td></tr>
            ))}
          </Table>
        </Card>
      )}

      {tab === "deals" && (
        <Card title="Active and past deals" pad={false} actions={can(actor, "deals.edit") ? <LinkButton size="sm" href={`/deals/new?company=${id}`}>New deal</LinkButton> : undefined}>
          <Table head={["Deal", "Stage", "Value", "Close", "Owner"]} empty={<EmptyState title="No deals visible to you" />}>
            {v.deals.map((d) => <tr key={d.id}><Td><Link className="font-medium hover:underline" href={`/deals/${d.id}`}>{d.name}</Link></Td><Td><Badge tone={d.isWon ? "green" : d.isLost ? "gray" : "blue"}>{d.stage}</Badge></Td><Td className="tabular-nums">{fmtMoney(d.amount, d.currency)}</Td><Td>{fmtDate(d.closedAt ?? d.expectedCloseDate, tz)}</Td><Td>{d.ownerName}</Td></tr>)}
          </Table>
        </Card>
      )}

      {tab === "onboarding" && (
        <div className="space-y-4">
          {v.handovers.length > 0 && (
            <Card title="Handovers" pad={false}>
              <Table head={["Deal", "Status", "Completeness", "Updated"]}>{v.handovers.map((h) => <tr key={h.id}><Td><Link className="font-medium hover:underline" href={`/handovers/${h.id}`}>{h.dealName}</Link></Td><Td><StatusBadge status={h.status} /></Td><Td><Progress value={h.completeness} /></Td><Td>{fmtDate(h.updatedAt, tz)}</Td></tr>)}</Table>
            </Card>
          )}
          <Card title="Onboarding projects" pad={false}>
            <Table head={["Project", "Stage", "Risk", "Target go-live", "Actual go-live"]} empty={<EmptyState title="No onboarding projects" />}>
              {v.projects.map((p) => <tr key={p.id}><Td><Link className="font-medium hover:underline" href={`/onboarding/${p.id}`}>{p.name}</Link></Td><Td>{p.state === "draft" ? <Badge tone="amber">Handover Incomplete</Badge> : stageLabel(p.stage)}</Td><Td><RiskBadge level={p.riskLevel} /></Td><Td>{fmtDate(p.targetGoLive, tz)}</Td><Td>{fmtDate(p.actualGoLive, tz)}</Td></tr>)}
            </Table>
          </Card>
        </div>
      )}

      {tab === "training" && (
        <div className="space-y-4">
          <Card title="Training summary">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Sessions held" value={training.sessionsHeld} /><Stat label="Upcoming" value={training.upcoming} /><Stat label="Attended" value={`${training.attended}/${training.participants}`} />
              <Stat label="Completed" value={training.completed} /><Stat label="Avg feedback" value={training.avgFeedback ? `${training.avgFeedback.toFixed(1)}/5` : "—"} />
            </div>
            {training.needsRetraining > 0 && <p className="mt-3 text-sm text-amber-800">{training.needsRetraining} participant(s) flagged for retraining — schedule a refresher.</p>}
            {training.topics.length > 0 && <p className="mt-3 text-sm text-slate-700"><span className="font-medium">Topics covered:</span> {training.topics.join("; ")}</p>}
          </Card>
          <Card title="Sessions" pad={false}>
            <Table head={["Session", "Program", "When", "Status", "Attendance", "Completed"]} empty={<EmptyState title="No training sessions" />}>
              {v.sessions.map((s) => <tr key={s.id}><Td>{can(actor, "training.view_all", "training.view_assigned") ? <Link className="font-medium hover:underline" href={`/training/sessions/${s.id}`}>{s.title}</Link> : s.title}{s.isRefresher && <Badge tone="violet">Refresher</Badge>}</Td><Td className="text-xs">{s.program}</Td><Td>{fmtDateTime(s.startsAt, tz)}</Td><Td><StatusBadge status={s.status} /></Td><Td className="tabular-nums">{s.attended}/{s.participants}</Td><Td className="tabular-nums">{s.completed}</Td></tr>)}
            </Table>
          </Card>
        </div>
      )}

      {tab === "tickets" && (
        <Card title="Tickets" pad={false} actions={can(actor, "tickets.create") ? <LinkButton size="sm" href={`/tickets/new?company=${id}`}>New ticket</LinkButton> : undefined}>
          <Table head={["Ticket", "Priority", "Status", "Opened", "Resolved", "CSAT"]} empty={<EmptyState title="No tickets" />}>
            {v.tickets.map((t) => <tr key={t.id}><Td>{t.canOpen ? <Link className="font-medium hover:underline" href={`/tickets/${t.id}`}>{ticketRef(t.number)} {t.subject}</Link> : <span title="You can see the summary only">{ticketRef(t.number)} {t.subject}</span>}</Td><Td><PriorityBadge p={t.priority} /></Td><Td>{ticketStatusLabel(t.status)}{t.resolutionBreached && <Badge tone="red">SLA breached</Badge>}</Td><Td>{fmtDate(t.createdAt, tz)}</Td><Td>{fmtDate(t.resolvedAt, tz)}</Td><Td>{t.csatScore ?? "—"}</Td></tr>)}
          </Table>
        </Card>
      )}

      {tab === "activities" && (
        <Card title="Communications & activities" actions={can(actor, "activities.log") ? <ActivityForm link={{ companyId: id }} contacts={v.contacts} /> : undefined}>
          <Timeline tz={tz} items={v.activities.map((a) => ({ at: a.occurredAt, kind: a.type, title: a.subject, detail: [a.outcome, a.body].filter(Boolean).join(" — "), by: a.by, simulated: a.simulated, link: a.dealId ? `/deals/${a.dealId}` : undefined }))} />
        </Card>
      )}

      {tab === "files" && (
        <Card title="Files" actions={v.canEdit ? (
          <Disclosure label="Upload file" variant="primary">
            <ActionForm action={uploadCompanyFileAction.bind(null, id)} resetOnSuccess className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Input name="file" label="File" type="file" required hint="PDF, PNG, JPG, DOCX, XLSX, CSV or TXT · max 10 MB" />
              <Checkbox name="restricted" label="Restricted (contracts, financial documents)" hint="Only Finance, onboarding reviewers and admins can open restricted files." />
              <Submit size="sm">Upload</Submit>
            </ActionForm>
          </Disclosure>) : undefined} pad={false}>
          <Table head={["File", "Size", "Uploaded", "By"]} empty={<EmptyState title="No files" />}>
            {v.files.map((f) => <tr key={f.id}><Td><a className="font-medium text-brand-700 hover:underline" href={`/api/files/file/${f.id}`}>{f.filename}</a>{f.restricted && <Badge tone="amber" icon={<Lock className="h-3 w-3" aria-hidden />}>Restricted</Badge>}</Td><Td>{Math.ceil(f.sizeBytes / 1024)} KB</Td><Td>{fmtDateTime(f.createdAt, tz)}</Td><Td>{f.by}</Td></tr>)}
          </Table>
          {v.hiddenFiles > 0 && <p className="px-4 py-2 text-xs text-slate-500">{v.hiddenFiles} restricted file(s) hidden based on your role.</p>}
        </Card>
      )}

      {tab === "audit" && (
        <Card title="Audit history" pad={false}>
          {v.audit === null ? <div className="p-4"><EmptyState title="Audit history requires the audit permission" /></div> : (
            <Table head={["When", "Who", "Action", "Changes", "Reason"]} empty={<EmptyState title="No audit events" />}>
              {v.audit.map((a) => <tr key={a.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(a.createdAt, tz)}</Td><Td>{a.actor}</Td><Td><code className="text-xs">{a.action}</code><div className="text-xs text-slate-500">{titleCase(a.entityType)}</div></Td>
                <Td className="text-xs">{a.changes ? Object.entries(a.changes).map(([k, ch]) => <div key={k}><span className="font-medium">{k}</span>: {JSON.stringify(ch.from)} → {JSON.stringify(ch.to)}</div>) : "—"}</Td><Td className="text-xs">{a.reason}</Td></tr>)}
            </Table>
          )}
        </Card>
      )}

      {v.canEdit && tab === "overview" && (
        <div className="mt-4"><Disclosure label="Edit company"><Card><ActionForm action={updateCompanyAction.bind(null, id)}><VersionField at={c.updatedAt} /><CompanyFields c={c} users={await simpleUsers(db)} /></ActionForm></Card></Disclosure></div>
      )}
    </>
  );
}
