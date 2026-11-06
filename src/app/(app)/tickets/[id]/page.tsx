import { appUrl } from "@/lib/app-url";
import { customerJourney, relatedFor } from "@/server/services/journey";
import { EscalationsPanel } from "@/components/tickets/escalations";
import { companies as companiesTable, users as usersTable } from "@/db/schema";
import { usersInRoles } from "@/server/services/admin";
import { JourneyTracker, RelatedPanel } from "@/components/related";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Lock, Globe, Paperclip, ShieldAlert, Wrench } from "lucide-react";
import { ctx, load } from "@/server/page";
import { getTicketDetail } from "@/server/services/tickets";
import { simpleUsers, listTeams } from "@/server/services/admin";
import { onboardingProjects, deals, products } from "@/db/schema";
import { RESOLUTION_CODES, NOT_YET_KNOWN, ticketStatusLabel, WAITING_STATUSES } from "@/lib/rules/tickets";
import { stageLabel } from "@/lib/rules/onboarding";
import { fmtDateTime, ticketRef } from "@/lib/format";
import { slaLabel } from "@/lib/sla-label";
import { Badge, Card, EmptyState, KV, Notice, PageHeader, PriorityBadge, RiskBadge, SlaBadge, StatusBadge, VersionField } from "@/components/ui";
import { ActionForm, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { TriageFields } from "@/components/triage-fields";
import {
  assignAction, closeAction, linkArticleAction, linkRecordsAction, overridePriorityAction, reopenAction, replyAction, resolveAction, statusAction, takeTicketAction, triageAction, uploadAttachmentAction,
} from "@/app/actions/tickets";

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const related = await relatedFor(db, actor, "ticket", id);
  const journey = related.companyId ? await customerJourney(db, related.companyId) : [];
  const d = await load(() => getTicketDetail(db, actor, id));
  const { t, perms } = d;
  const open = !["resolved", "closed"].includes(t.status);
  const users = await simpleUsers(db);
  const teams = (await listTeams(db)).filter((x) => x.kind === "support" || x.kind === "engineering");
  const engTeams = teams.filter((x) => x.kind === "engineering");
  const roleGroup = async (keys: string[]) => (await usersInRoles(db, keys)).filter((u) => u.id !== actor.id);
  const escPeople = { support: await roleGroup(["support_agent", "support_lead"]), leads: await roleGroup(["support_lead"]), sales: await roleGroup(["sales_executive", "sales_manager"]), onboarding: await roleGroup(["onboarding_manager", "trainer"]), everyone: users };
  const [accountOwner] = t.companyId ? await db.select({ id: usersTable.id, name: usersTable.name }).from(companiesTable).innerJoin(usersTable, eq(usersTable.id, companiesTable.ownerId)).where(eq(companiesTable.id, t.companyId)) : [];
  const [onboardingOwner] = t.companyId ? await db.select({ id: usersTable.id, name: usersTable.name }).from(onboardingProjects).innerJoin(usersTable, eq(usersTable.id, onboardingProjects.ownerId)).where(eq(onboardingProjects.companyId, t.companyId)).limit(1) : [];
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  const projects = t.companyId ? await db.select({ id: onboardingProjects.id, name: onboardingProjects.name }).from(onboardingProjects).where(eq(onboardingProjects.companyId, t.companyId)) : [];
  const companyDeals = t.companyId ? await db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.companyId, t.companyId)) : [];
  const conversation = [
    ...d.messages.map((m) => ({ kind: "public" as const, at: m.createdAt, author: m.authorName, body: m.body, automated: m.isAutomated, delivery: m.deliveryStatus, customer: !!m.authorContactId || (!m.authorUserId && !m.isAutomated) })),
    ...(d.notes ?? []).map((n) => ({ kind: "note" as const, at: n.createdAt, author: n.author, body: n.body, automated: false, delivery: "", customer: false })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const prevResolutions = d.statusHistory.filter((h) => h.toStatus === "reopened" && h.snapshot).map((h) => ({ at: h.createdAt, reason: h.reason, prev: (h.snapshot as { previousResolution: { resolutionSummary: string | null; resolutionCode: string | null } }).previousResolution }));
  const portalUrl = `${appUrl()}/portal/t/${t.portalToken}`;
  return (
    <>
      <PageHeader title={<>{ticketRef(t.number)} · {t.subject}</>} crumbs={[{ href: "/tickets", label: "Tickets" }]}
        subtitle={<>{d.company ? <Link className="hover:underline" href={`/companies/${d.company.id}`}>{d.company.name}</Link> : t.requesterEmail} · {d.product?.name} · {t.category}{t.subcategory ? ` / ${t.subcategory}` : ""} · via {t.channel} · opened {fmtDateTime(t.createdAt, tz)}</>}
        actions={<><PriorityBadge p={t.priority} />{t.priorityOverridden && <Badge tone="violet">Overridden</Badge>}<StatusBadge status={t.status} />{t.escalationLevel > 0 && <Badge tone="orange">Escalation L{t.escalationLevel}</Badge>}</>} />
      {t.isIncident && <Notice tone="red" title={`Incident workflow active — ${t.incidentType?.replace("_", " ")}`}>Support Lead and management have been notified. Update the customer at least every {d.clocks?.target.updateMins ?? 30} minutes. Only an authorised confirmer can mark this fixed, with evidence.</Notice>}
      {d.duplicates.length > 0 && <Notice tone="amber" title="Possible duplicates">{d.duplicates.map((x) => <Link key={x.id} className="mr-3 underline" href={`/tickets/${x.id}`}>{ticketRef(x.number)} {x.subject}</Link>)}</Notice>}
      {t.waitingReason && open && <Notice tone="amber" title={ticketStatusLabel(t.status)}>Waiting for: {t.waitingReason}{t.waitingFollowUpAt && ` · follow up ${fmtDateTime(t.waitingFollowUpAt, tz)}`}{t.slaPausedAt ? ` · SLA paused since ${fmtDateTime(t.slaPausedAt, tz)}` : " · SLA clock continues (policy)"}</Notice>}

      {journey.length > 0 && <div className="mb-4"><JourneyTracker steps={journey} /></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="SLA">
            <div className="mb-3 flex flex-wrap gap-2">
              {d.clocks ? <><SlaBadge state={d.clocks.firstResponse.state} label={slaLabel(d.clocks.firstResponse)} /><SlaBadge state={d.clocks.resolution.state} label={slaLabel(d.clocks.resolution)} /></> : <Badge>No SLA target</Badge>}
            </div>
            <KV items={[["Policy", <span key="p">{d.policy.name} <span className="text-xs text-slate-500">({d.clocks?.target.businessHours ? `business hours ${d.policy.calendar.start}–${d.policy.calendar.end} ${d.policy.calendar.timezone}` : "24×7"})</span></span>], ["First response due", fmtDateTime(t.firstResponseDueAt, tz)], ["First human response", fmtDateTime(t.firstRespondedAt, tz)], ["Resolution due", fmtDateTime(t.resolutionDueAt, tz)], ["Resolved", fmtDateTime(t.resolvedAt, tz)], ["Next customer update due", fmtDateTime(t.nextUpdateDueAt, tz)], ["Paused total", `${t.slaPausedTotalMins} min`]]} />
          </Card>

          <Card title="Conversation">
            <p className="mb-3 flex flex-wrap gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" aria-hidden />Public — visible to the customer</span><span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" aria-hidden />Internal note — never shown to the customer</span></p>
            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-slate-500">Original request</p><p className="whitespace-pre-wrap">{t.description}</p></div>
            <ol className="space-y-3">
              {conversation.map((m, i) => (
                <li key={i} className={`rounded-lg border p-3 ${m.kind === "note" ? "border-amber-300 bg-amber-50" : m.customer ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    {m.kind === "note" ? <Badge tone="amber" icon={<Lock className="h-3 w-3" aria-hidden />}>Internal note</Badge> : <Badge tone={m.customer ? "blue" : "green"} icon={<Globe className="h-3 w-3" aria-hidden />}>{m.customer ? "Customer" : m.automated ? "Automated (public)" : "Public reply"}</Badge>}
                    <span className="font-medium text-slate-800">{m.author}</span><span className="text-slate-500">{fmtDateTime(m.at, tz)}</span>
                    {m.delivery === "simulated" && <Badge tone="amber">Email simulated — not delivered</Badge>}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-800">{m.body}</p>
                </li>
              ))}
            </ol>
            {perms.reply && (
              <ActionForm action={replyAction.bind(null, id)} resetOnSuccess className="mt-4 space-y-2 rounded-lg border border-slate-200 p-3">
                <input type="hidden" name="kind" value="public" />
                <Textarea name="body" label={<span className="inline-flex items-center gap-1"><Globe className="h-4 w-4" aria-hidden />Public reply to customer</span>} rows={3} required hint="Visible on the customer's ticket page and emailed when a provider is configured." />
                <Submit>Send public reply</Submit>
              </ActionForm>
            )}
            {perms.notes && (
              <ActionForm action={replyAction.bind(null, id)} resetOnSuccess className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
                <input type="hidden" name="kind" value="note" />
                <Textarea name="body" label={<span className="inline-flex items-center gap-1"><Lock className="h-4 w-4" aria-hidden />Internal note</span>} rows={2} required hint="Stored separately from customer messages; never returned to customer-facing pages." />
                <Submit variant="secondary">Add internal note</Submit>
              </ActionForm>
            )}
          </Card>

          <EscalationsPanel ticketId={id} escalations={d.escalations} updates={d.escUpdates} canRaise={perms.escalate} ticketOpen={open} defaultSeverity={t.priority} engTeams={engTeams.map((x) => ({ id: x.id, name: x.name }))}
            people={escPeople} accountOwner={accountOwner} onboardingOwner={onboardingOwner} tz={tz} />

          <Card title="History">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Status history</h3>
                <ol className="space-y-2 text-sm">{d.statusHistory.map((h) => <li key={h.id}><span className="font-medium">{h.fromStatus ? `${ticketStatusLabel(h.fromStatus)} → ` : ""}{ticketStatusLabel(h.toStatus)}</span><p className="text-xs text-slate-500">{fmtDateTime(h.createdAt, tz)} · {h.changedByLabel}{h.reason ? ` · ${h.reason}` : ""}</p></li>)}</ol></div>
              <div><h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">SLA events</h3>
                <ol className="space-y-2 text-sm">{d.events.map((e) => <li key={e.id}><span className="font-medium capitalize">{e.kind.replace("_", " ")}</span> <span className="text-xs text-slate-500">({e.metric.replace("_", " ")})</span><p className="text-xs text-slate-500">{fmtDateTime(e.createdAt, tz)}{e.details ? ` · ${e.details}` : ""}</p></li>)}</ol></div>
            </div>
            {prevResolutions.length > 0 && <div className="mt-4 rounded-lg bg-slate-50 p-3"><h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Previous resolutions (preserved on reopen)</h3>{prevResolutions.map((p, i) => <p key={i} className="text-sm">{fmtDateTime(p.at, tz)}: <em>{p.prev.resolutionSummary}</em> ({p.prev.resolutionCode}) — reopened because: {p.reason}</p>)}</div>}
          </Card>
        </div>

        <div className="space-y-4">
          <RelatedPanel groups={related.groups} />
          {perms.edit && (
            <Card title="Work this ticket">
              <div className="space-y-4">
                {!t.ownerId && open && <ActionForm action={takeTicketAction.bind(null, id)}><Submit size="sm">Assign to me</Submit></ActionForm>}
                {open && (
                  <ActionForm action={statusAction.bind(null, id)} className="space-y-2"><VersionField at={t.updatedAt} />
                    <Select name="status" label="Change status" required placeholder="Choose…" options={d.transitions.filter((s) => s !== "resolved" && s !== "reopened").map((s) => ({ value: s, label: ticketStatusLabel(s) }))} />
                    <Input name="waitingReason" label="Waiting for (required for waiting statuses)" />
                    <Input name="followUpAt" label="Next follow-up (waiting on customer)" type="datetime-local" />
                    <Input name="reason" label="Note / reason" />
                    <Submit size="sm" variant="secondary">Update status</Submit>
                    <p className="text-xs text-slate-500">SLA pauses only for: {d.policy.pauseStatuses.map(ticketStatusLabel).join(", ") || "nothing"} (policy “{d.policy.name}”). {WAITING_STATUSES.filter((w) => !d.policy.pauseStatuses.includes(w)).map(ticketStatusLabel).join(", ")} keep the clock running.</p>
                  </ActionForm>
                )}
                {(perms.reassign || !t.ownerId || t.ownerId === actor.id) && open && (
                  <Disclosure label="Assignment">
                    <ActionForm action={assignAction.bind(null, id)} className="space-y-2"><VersionField at={t.updatedAt} />
                      <Select name="ownerId" label="Agent" defaultValue={t.ownerId ?? ""} placeholder="Unassigned" options={(perms.reassign ? users : users.filter((u) => u.id === actor.id)).map((u) => ({ value: u.id, label: u.name }))} />
                      {perms.reassign && <Select name="teamId" label="Team queue" defaultValue={t.teamId ?? ""} options={teams.map((x) => ({ value: x.id, label: x.name }))} />}
                      <Submit size="sm" variant="secondary">Save assignment</Submit>
                    </ActionForm>
                  </Disclosure>
                )}
                {open && (
                  <Disclosure label="Triage & priority">
                    <ActionForm action={triageAction.bind(null, id)} className="space-y-2"><VersionField at={t.updatedAt} />
                      <TriageFields products={ps} init={{ ...t }} />
                      <Submit size="sm" variant="secondary">Save triage</Submit>
                    </ActionForm>
                    {perms.override && (
                      <ActionForm action={overridePriorityAction.bind(null, id)} className="mt-3 space-y-2 border-t border-slate-100 pt-3"><VersionField at={t.updatedAt} />
                        <Select name="priority" label="Override priority" defaultValue={t.priority} options={["P1", "P2", "P3", "P4"].map((p) => ({ value: p, label: p }))} />
                        <Input name="reason" label="Reason (logged)" required />
                        <Submit size="sm" variant="secondary">Override</Submit>
                      </ActionForm>
                    )}
                  </Disclosure>
                )}
                {open && (
                  <Disclosure label="Resolve" variant="primary">
                    <ActionForm action={resolveAction.bind(null, id)} className="space-y-2"><VersionField at={t.updatedAt} />
                      <Textarea name="resolutionSummary" label="Customer-facing resolution summary" required rows={3} />
                      <Select name="resolutionCode" label="Resolution category" required placeholder="Choose…" options={RESOLUTION_CODES.map((r) => ({ value: r, label: r }))} />
                      <Input name="rootCause" label={`Root cause${t.priority === "P1" || t.priority === "P2" || t.isIncident ? " (required)" : ""}`} hint={`Or enter “${NOT_YET_KNOWN}” and choose a follow-up owner.`} />
                      <Select name="rootCauseFollowUpOwnerId" label="Root-cause follow-up owner" placeholder="—" options={users.map((u) => ({ value: u.id, label: u.name }))} />
                      <Input name="workaround" label="Workaround (if any)" defaultValue={t.workaround ?? ""} />
                      {t.isIncident && <Textarea name="incidentEvidence" label="Evidence the incident is contained/fixed (confirmer)" rows={2} required />}
                      <Submit size="sm">Resolve — pending confirmation</Submit>
                    </ActionForm>
                  </Disclosure>
                )}
                {t.status === "resolved" && <ActionForm action={closeAction.bind(null, id)} className="space-y-2"><Input name="reason" label="Closing note" placeholder="e.g. Customer confirmed by phone" /><Submit size="sm" variant="secondary">Close ticket</Submit></ActionForm>}
                {!open && <ActionForm action={reopenAction.bind(null, id)} className="space-y-2"><Input name="reason" label="Why reopen?" required /><Submit size="sm" variant="secondary">Reopen</Submit></ActionForm>}
              </div>
            </Card>
          )}
          {t.resolutionSummary && <Card title="Resolution"><KV items={[["Summary", t.resolutionSummary], ["Category", t.resolutionCode], ["Root cause", t.rootCause], ["CSAT", t.csatScore ? `${t.csatScore}/5${t.csatComment ? ` — ${t.csatComment}` : ""}` : "—"]]} /></Card>}
          <Card title="Customer">
            {d.company ? <KV items={[["Account", <Link key="c" className="hover:underline" href={`/companies/${d.company.id}`}>{d.company.name}</Link>], ["Tier / segment", `${d.company.tier} · ${d.company.segment}`], ["Contact", d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : t.requesterEmail], ["Email", d.contact?.email ?? t.requesterEmail], ["Owner", d.owner?.name ?? "Unassigned"], ["Team", d.team?.name]]} /> : <p className="text-sm">{t.requesterEmail}</p>}
            <p className="mt-3 break-all text-xs text-slate-500">Customer ticket page (public replies only): <a className="text-brand-700 underline" href={portalUrl} target="_blank" rel="noopener noreferrer">open</a></p>
          </Card>
          {d.onboarding.length > 0 && <Card title="Onboarding context"><ul className="space-y-2">{d.onboarding.map((p) => <li key={p.id} className="text-sm"><Link className="hover:underline" href={`/onboarding/${p.id}`}>{p.name}</Link><div className="mt-0.5 flex gap-2 text-xs"><span>{stageLabel(p.stage)}</span><RiskBadge level={p.riskLevel} /></div></li>)}</ul></Card>}
          {perms.edit && (t.companyId) && (
            <Card title="Links">
              <ActionForm action={linkRecordsAction.bind(null, id)} className="space-y-2">
                <Select name="onboardingProjectId" label="Onboarding project" defaultValue={t.onboardingProjectId ?? ""} placeholder="—" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                <Select name="dealId" label="Deal" defaultValue={t.dealId ?? ""} placeholder="—" options={companyDeals.map((p) => ({ value: p.id, label: p.name }))} />
                <Submit size="sm" variant="secondary">Save links</Submit>
              </ActionForm>
            </Card>
          )}
          <Card title="Knowledge">
            {d.linkedArticles.length > 0 && <ul className="mb-3 space-y-1 text-sm">{d.linkedArticles.map((a) => <li key={a.id}>🔗 <Link className="hover:underline" href={`/kb/${a.id}`}>{a.title}</Link> {a.audience === "internal" && <Badge tone="amber">Internal</Badge>}</li>)}</ul>}
            <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Suggested articles</p>
            {d.suggested.length === 0 ? <p className="text-sm text-slate-500">No suggestions.</p> : (
              <ul className="space-y-2">{d.suggested.map((a) => (
                <li key={a.id} className="text-sm"><Link className="font-medium hover:underline" href={`/kb/${a.id}`}>{a.title}</Link> {a.audience === "internal" ? <Badge tone="amber">Internal — don't share</Badge> : <Badge tone="green">Customer-safe</Badge>}
                  {perms.edit && <ActionForm action={linkArticleAction.bind(null, id)} className="inline"><input type="hidden" name="articleId" value={a.id} /><Submit size="sm" variant="ghost">Link</Submit></ActionForm>}</li>
              ))}</ul>
            )}
          </Card>
          <Card title="Attachments">
            {d.attachments.length === 0 ? <p className="text-sm text-slate-500">No attachments.</p> : <ul className="space-y-1 text-sm">{d.attachments.map((a) => <li key={a.id}><Paperclip className="mr-1 inline h-3.5 w-3.5" aria-hidden /><a className="text-brand-700 hover:underline" href={`/api/files/attachment/${a.id}`}>{a.filename}</a> {a.visibility === "internal" ? <Badge tone="amber">Internal</Badge> : <Badge tone="green">Shared with customer</Badge>}</li>)}</ul>}
            {(perms.edit || perms.engineering) && <div className="mt-2"><Disclosure label="Upload">
              <ActionForm action={uploadAttachmentAction.bind(null, id)} resetOnSuccess className="space-y-2">
                <Input name="file" label="File" type="file" required hint="Max 10 MB · PDF, images, Office, CSV, TXT" />
                <Select name="visibility" label="Visibility" options={[{ value: "internal", label: "Internal only" }, { value: "public", label: "Share with customer" }]} />
                <Submit size="sm">Upload</Submit>
              </ActionForm>
            </Disclosure></div>}
          </Card>
          {d.related.length > 0 && <Card title="Related tickets (same customer)"><ul className="space-y-1 text-sm">{d.related.map((r) => <li key={r.id} className="flex items-center gap-2"><PriorityBadge p={r.priority} /><Link className="truncate hover:underline" href={`/tickets/${r.id}`}>{ticketRef(r.number)} {r.subject}</Link></li>)}</ul></Card>}
        </div>
      </div>
    </>
  );
}
