"use client";

import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Clock, Lock, ShieldAlert, Wrench } from "lucide-react";
import { ActionForm, Disclosure, Grid, Input, Select, Submit, Textarea } from "../forms";
import { ESCALATION_STATUSES, ESCALATION_TARGETS, escalationKindLabel, escalationTarget } from "@/lib/rules/escalations";
import {
  acceptEscalationAction, cancelEscalationAction, confirmEscalationAction, decideEscalationAction, escalateAction, escalationUpdateAction, reassignEscalationAction,
  reopenEscalationAction, resolveEscalationAction,
} from "@/app/actions/tickets";

type Person = { id: string; name: string };
type Perms = { approve: boolean; accept: boolean; resolve: boolean; reassign: boolean; update: boolean; engineering: boolean; confirm: boolean; reopen: boolean; cancel: boolean };
export type EscView = {
  id: string; kind: string; severity: string; status: string; reason: string | null; createdAt: Date; dueAt: Date | null; acceptedAt: Date | null; resolvedAt: Date | null; confirmedAt: Date | null;
  resolution: string | null; reopenCount: number; assigneeName: string | null; teamName: string | null; raisedByName: string | null; resolvedByName: string | null; confirmedByName: string | null;
  reproductionSteps: string | null; expectedResult: string | null; actualResult: string | null; environment: string | null; customerImpact: string | null; workaround: string | null;
  engineeringStatus: string | null; rootCause: string | null; fixVersion: string | null; can: Perms;
};
type Update = { id: string; escalationId: string; body: string; createdAt: Date; author: string };

const fmt = (d: Date | null, tz: string) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "");
const TONE = { amber: "bg-amber-50 text-amber-900 ring-amber-200", blue: "bg-sky-50 text-sky-800 ring-sky-200", violet: "bg-violet-50 text-violet-800 ring-violet-200", green: "bg-emerald-50 text-emerald-800 ring-emerald-200", gray: "bg-slate-100 text-slate-700 ring-slate-200", red: "bg-red-50 text-red-800 ring-red-200" };

/** Escalations on a ticket: raise one, then accept → work → resolve → confirm, with every step recorded. */
export function EscalationsPanel({ ticketId, escalations, updates, canRaise, ticketOpen, defaultSeverity, people, engTeams, accountOwner, onboardingOwner, tz }: {
  ticketId: string; escalations: EscView[]; updates: Update[]; canRaise: boolean; ticketOpen: boolean; defaultSeverity: string;
  people: { support: Person[]; leads: Person[]; sales: Person[]; onboarding: Person[]; everyone: Person[] }; engTeams: Person[]; accountOwner: Person | null; onboardingOwner: Person | null; tz: string;
}) {
  const active = escalations.filter((e) => ESCALATION_STATUSES[e.status]?.active).length;
  return (
    <section id="escalations" aria-label="Escalations" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-950">Escalations ({escalations.length}){active > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{active} active</span>}</h2>
        {canRaise && ticketOpen && <Disclosure label="Escalate"><RaiseForm ticketId={ticketId} defaultSeverity={defaultSeverity} people={people} engTeams={engTeams} accountOwner={accountOwner} onboardingOwner={onboardingOwner} /></Disclosure>}
      </header>
      <div className="p-4">
        {!escalations.length ? <p className="text-sm text-slate-500">No escalations. Use <span className="font-medium">Escalate</span> to bring in engineering, a colleague, Sales, Onboarding or management.</p> : (
          <ul className="space-y-4">{escalations.map((e) => <EscalationCard key={e.id} e={e} updates={updates.filter((u) => u.escalationId === e.id)} people={people.everyone} tz={tz} />)}</ul>
        )}
      </div>
    </section>
  );
}

function RaiseForm({ ticketId, defaultSeverity, people, engTeams, accountOwner, onboardingOwner }: { ticketId: string; defaultSeverity: string; people: { support: Person[]; leads: Person[]; sales: Person[]; onboarding: Person[] }; engTeams: Person[]; accountOwner: Person | null; onboardingOwner: Person | null }) {
  const [kind, setKind] = useState<string>("support_peer");
  const target = escalationTarget(kind)!;
  const list = kind === "support_peer" ? people.support : kind === "support_lead" ? people.leads : kind === "sales" ? people.sales : kind === "onboarding" ? people.onboarding : [];
  const def = kind === "sales" ? accountOwner?.id : kind === "onboarding" ? onboardingOwner?.id : undefined;
  return (
    <ActionForm action={escalateAction.bind(null, ticketId)} className="mt-3 w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <Grid>
        <Select name="kind" label="Escalate to" value={kind} onChange={(e) => setKind(e.target.value)} options={ESCALATION_TARGETS.map((t) => ({ value: t.key, label: t.label }))} required />
        <Select name="severity" label="Severity" defaultValue={defaultSeverity} options={["P1", "P2", "P3", "P4"].map((p) => ({ value: p, label: `${p} — respond within ${{ P1: "4 hours", P2: "1 day", P3: "3 days", P4: "5 days" }[p]}` }))} />
        {kind === "engineering" && <Select name="requestedTeamId" label="Engineering team" required placeholder="Choose…" options={engTeams.map((x) => ({ value: x.id, label: x.name }))} />}
        {target.target === "person" && <Select key={kind} name="assignedToId" label={kind === "support_lead" ? "Support Lead (optional)" : "Person"} defaultValue={def ?? ""} required={kind !== "support_lead"}
          placeholder={kind === "support_lead" ? "Any Support Lead" : "Choose…"} options={list.map((p) => ({ value: p.id, label: p.id === accountOwner?.id && kind === "sales" ? `${p.name} (account owner)` : p.id === onboardingOwner?.id && kind === "onboarding" ? `${p.name} (onboarding owner)` : p.name }))} />}
        <Textarea name="reason" label="What do you need from them?" required rows={3} className="sm:col-span-2" hint="Be specific: the question, what you've tried, and what the customer is waiting for." />
        {kind === "engineering" && <>
          <Input name="environment" label="Environment / version" />
          <Textarea name="evidence" label="Evidence (logs, IDs, screenshots)" rows={2} />
          <Textarea name="reproductionSteps" label="Reproduction steps" rows={2} /><Textarea name="expectedResult" label="Expected result" rows={2} />
          <Textarea name="actualResult" label="Actual result" rows={2} /><Textarea name="customerImpact" label="Customer impact" rows={2} />
          <Textarea name="businessConsequence" label="Business consequence" rows={2} /><Textarea name="workaround" label="Workaround" rows={2} />
        </>}
      </Grid>
      <p className="text-xs text-slate-600">{target.hint}</p>
      <Submit size="sm">Raise escalation</Submit>
    </ActionForm>
  );
}

function Steps({ e, tz }: { e: EscView; tz: string }) {
  const steps = [
    { label: "Raised", at: e.createdAt, done: true },
    ...(e.status === "pending_approval" || e.status === "rejected" ? [{ label: e.status === "rejected" ? "Declined" : "Approval", at: null, done: e.status === "rejected", bad: e.status === "rejected" }] : []),
    { label: "Accepted", at: e.acceptedAt, done: !!e.acceptedAt },
    { label: "Resolved", at: e.resolvedAt, done: !!e.resolvedAt },
    { label: "Confirmed", at: e.confirmedAt, done: !!e.confirmedAt },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs" aria-label="Escalation progress">
      {steps.map((s, i) => {
        const Icon = "bad" in s && s.bad ? AlertTriangle : s.done ? CheckCircle2 : i === current && e.status !== "cancelled" ? CircleDot : Circle;
        return (
          <li key={s.label} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1 h-px w-4 bg-slate-300" aria-hidden />}
            <Icon className={clsx("h-3.5 w-3.5", "bad" in s && s.bad ? "text-red-600" : s.done ? "text-emerald-600" : i === current ? "text-accent-600" : "text-slate-300")} aria-hidden />
            <span className={clsx(s.done || i === current ? "text-slate-800" : "text-slate-400")}>{s.label}{s.at && <span className="text-slate-500"> {fmt(s.at, tz)}</span>}</span>
          </li>
        );
      })}
    </ol>
  );
}

function EscalationCard({ e, updates, people, tz }: { e: EscView; updates: Update[]; people: Person[]; tz: string }) {
  const st = ESCALATION_STATUSES[e.status] ?? { label: e.status, tone: "gray" as const, active: false };
  const overdue = !!e.dueAt && !e.acceptedAt && ["open", "pending_approval"].includes(e.status) && new Date(e.dueAt).getTime() < Date.now();
  const who = e.assigneeName ?? e.teamName ?? (e.kind === "management" ? "Management" : e.kind === "support_lead" ? "Support Leads" : "—");
  return (
    <li className={clsx("rounded-lg border p-3", overdue ? "border-red-300" : e.status === "resolved" ? "border-emerald-300" : "border-slate-200")}>
      <div className="flex flex-wrap items-center gap-2">
        {e.kind === "incident" ? <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden /> : <Wrench className="h-4 w-4 text-slate-500" aria-hidden />}
        <span className="text-sm font-semibold">{escalationKindLabel(e.kind)}</span>
        <span className="text-sm text-slate-600">→ {who}</span>
        <span className={clsx("rounded-full px-2 py-0.5 text-xs font-medium ring-1", TONE[st.tone])}>{st.label}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{e.severity}</span>
        {e.reopenCount > 0 && <span className="text-xs text-amber-700">Reopened {e.reopenCount}×</span>}
        {overdue && <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700"><Clock className="h-3.5 w-3.5" />Not accepted — due {fmt(e.dueAt, tz)}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">Raised by {e.raisedByName ?? "—"} · {fmt(e.createdAt, tz)}{e.dueAt && !e.acceptedAt && !overdue && ["open", "pending_approval"].includes(e.status) && ` · accept by ${fmt(e.dueAt, tz)}`}</p>
      <Steps e={e} tz={tz} />
      <p className="mt-2 whitespace-pre-line text-sm">{e.reason}</p>
      {(e.reproductionSteps || e.actualResult) && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 rounded bg-slate-50 p-2 text-xs sm:grid-cols-2">
          {[["Repro", e.reproductionSteps], ["Expected", e.expectedResult], ["Actual", e.actualResult], ["Environment", e.environment], ["Customer impact", e.customerImpact], ["Workaround", e.workaround], ["Engineering status", e.engineeringStatus?.replace(/_/g, " ")], ["Root cause", e.rootCause], ["Fix version", e.fixVersion]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="font-medium text-slate-600">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {e.resolution && <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm"><p className="text-xs font-semibold text-emerald-900">Resolution{e.resolvedByName && ` by ${e.resolvedByName}`} · {fmt(e.resolvedAt, tz)}</p><p className="whitespace-pre-line">{e.resolution}</p>
        {e.confirmedAt && <p className="mt-1 text-xs text-emerald-900">Confirmed by {e.confirmedByName} · {fmt(e.confirmedAt, tz)}</p>}</div>}
      {updates.length > 0 && <ol className="mt-2 space-y-1.5">{updates.map((u) => <li key={u.id} className="rounded bg-amber-50 p-2 text-xs"><Lock className="mr-1 inline h-3 w-3" aria-hidden /><strong>{u.author}</strong> · {fmt(u.createdAt, tz)}<p className="mt-0.5 whitespace-pre-line text-sm">{u.body}</p></li>)}</ol>}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {e.can.approve && <ActionForm action={decideEscalationAction.bind(null, e.id)} className="flex flex-wrap items-end gap-2"><Input name="comment" label="Comment (required to decline)" /><Submit size="sm" name="decision" value="approve">Approve</Submit><Submit size="sm" variant="danger" name="decision" value="reject">Decline</Submit></ActionForm>}
        {e.can.accept && <ActionForm action={acceptEscalationAction.bind(null, e.id)}><Submit size="sm">Accept</Submit></ActionForm>}
        {e.can.confirm && <ActionForm action={confirmEscalationAction.bind(null, e.id)}><Submit size="sm">Confirm resolved</Submit></ActionForm>}
        {e.can.resolve && <Disclosure label="Mark resolved" variant="primary"><ActionForm action={resolveEscalationAction.bind(null, e.id)} className="mt-2 w-full space-y-2"><Textarea name="resolution" label="How was it resolved?" required rows={3} hint="This is sent to the person who raised it so they can confirm and update the customer." /><Submit size="sm">Mark resolved</Submit></ActionForm></Disclosure>}
        {e.can.update && <Disclosure label={e.can.engineering ? "Add engineering update" : "Add update"}>
          <ActionForm action={escalationUpdateAction.bind(null, e.id)} resetOnSuccess className="mt-2 space-y-2">
            <Textarea name="body" label="Internal update" required rows={2} hint="Visible to everyone on this escalation, never to the customer." />
            {e.can.engineering && <Grid cols={3}><Select name="engineeringStatus" label="Engineering status" defaultValue={e.engineeringStatus ?? "investigating"} options={["investigating", "identified", "fix_in_progress", "fix_released", "wont_fix"].map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} /><Input name="rootCause" label="Root cause" defaultValue={e.rootCause ?? ""} /><Input name="fixVersion" label="Fix version" defaultValue={e.fixVersion ?? ""} /></Grid>}
            <Submit size="sm">Post update</Submit>
          </ActionForm></Disclosure>}
        {e.can.reassign && <Disclosure label="Reassign" variant="ghost"><ActionForm action={reassignEscalationAction.bind(null, e.id)} className="mt-2 space-y-2"><Select name="assignedToId" label="New owner" required placeholder="Choose…" options={people.map((p) => ({ value: p.id, label: p.name }))} /><Input name="note" label="Note for them" /><Submit size="sm">Reassign</Submit></ActionForm></Disclosure>}
        {e.can.reopen && <Disclosure label="Reopen" variant="ghost"><ActionForm action={reopenEscalationAction.bind(null, e.id)} className="mt-2 space-y-2"><Textarea name="reason" label="What's still not right?" required rows={2} /><Submit size="sm">Reopen</Submit></ActionForm></Disclosure>}
        {e.can.cancel && <Disclosure label="Withdraw" variant="ghost"><ActionForm action={cancelEscalationAction.bind(null, e.id)} className="mt-2 space-y-2"><Input name="reason" label="Why withdraw it?" required /><Submit size="sm" variant="secondary">Withdraw escalation</Submit></ActionForm></Disclosure>}
      </div>
    </li>
  );
}
