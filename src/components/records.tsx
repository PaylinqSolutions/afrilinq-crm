import Link from "next/link";
import { Phone, Mail, Video, Presentation, FileText, StickyNote, MessageCircle, CircleDot, LifeBuoy, Handshake, ArrowRightLeft, GraduationCap } from "lucide-react";
import { ACTIVITY_TYPES } from "@/lib/rules/sales";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, Checkbox, Disclosure, Grid, Input, Select, Submit, Textarea } from "./forms";
import { Badge, EmptyState, StatusBadge } from "./ui";
import { logActivityAction, completeTaskAction, createTaskAction } from "@/app/actions/crm";

const ICON: Record<string, typeof Phone> = { call: Phone, email: Mail, meeting: Video, demo: Presentation, proposal: FileText, note: StickyNote, whatsapp: MessageCircle, ticket: LifeBuoy, deal: Handshake, handover: ArrowRightLeft, training: GraduationCap };

export function Timeline({ items, tz, empty = "No activity yet." }: { items: { at: Date; kind: string; title: string; detail?: string | null; by?: string | null; link?: string; simulated?: boolean }[]; tz: string; empty?: string }) {
  if (!items.length) return <EmptyState title={empty} />;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {items.map((it, i) => {
        const Icon = ICON[it.kind] ?? CircleDot;
        return (
          <li key={i} className="relative">
            <span className="absolute -left-[29px] grid h-6 w-6 place-items-center rounded-full border border-slate-200 bg-white"><Icon className="h-3.5 w-3.5 text-brand-700" aria-hidden /></span>
            <div className="flex flex-wrap items-baseline gap-x-2">
              {it.link ? <Link href={it.link} className="text-sm font-medium text-slate-900 hover:underline">{it.title}</Link> : <span className="text-sm font-medium text-slate-900">{it.title}</span>}
              <span className="text-xs text-slate-500">{fmtDateTime(it.at, tz)}{it.by ? ` · ${it.by}` : ""}</span>
              {it.simulated && <Badge tone="amber">Simulated — not delivered</Badge>}
            </div>
            {it.detail && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">{it.detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export function ActivityForm({ link, contacts = [], emailEnabled = false }: { link: Record<string, string | null | undefined>; contacts?: { id: string; firstName: string; lastName: string }[]; emailEnabled?: boolean }) {
  return (
    <Disclosure label="Log activity" variant="primary">
      <ActionForm action={logActivityAction} resetOnSuccess className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        {Object.entries(link).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
        <Grid>
          <Select name="type" label="Type" options={ACTIVITY_TYPES.map((t) => ({ value: t.key, label: t.label }))} required />
          {contacts.length > 0 ? <Select name="contactId" label="Contact" placeholder="—" options={contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))} /> : <span />}
          <Input name="subject" label="Subject" required className="sm:col-span-2" />
          <Textarea name="body" label="Notes" className="sm:col-span-2" />
          <Input name="outcome" label="Outcome" placeholder="e.g. Agreed to a demo next week" />
          <Input name="occurredAt" label="When" type="datetime-local" hint="Leave empty for now" />
          <Input name="scheduledFor" label="Schedule for (appointments)" type="datetime-local" />
          <Input name="followUpTitle" label="Create follow-up task" placeholder="Optional" />
          <Input name="followUpDue" label="Follow-up due" type="datetime-local" />
        </Grid>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Logging records an interaction that already happened. {emailEnabled ? "Email is connected." : "Email/WhatsApp providers are not configured, so “Send” can only record a clearly labelled simulated message."}
          <div className="mt-1"><Checkbox name="confirmSimulated" label="Simulate send (demo mode) — I understand nothing will be delivered" /></div>
        </div>
        <div className="flex gap-2"><Submit name="intent" value="log">Log activity</Submit><Submit name="intent" value="send" variant="secondary">Send email / WhatsApp</Submit></div>
      </ActionForm>
    </Disclosure>
  );
}

export function TaskList({ tasks, tz, compact = false }: { tasks: { id: string; title: string; dueAt: Date | null; status: string; priority: string; ownerName?: string | null; outcome?: string | null }[]; tz: string; compact?: boolean }) {
  if (!tasks.length) return <EmptyState title="No tasks" />;
  const now = new Date();
  return (
    <ul className="divide-y divide-slate-100">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">{t.title}</p>
            <p className="text-xs text-slate-500">
              {t.dueAt ? <span className={t.status === "open" && t.dueAt < now ? "font-medium text-red-700" : ""}>{t.status === "open" && t.dueAt < now ? "Overdue · " : "Due "}{fmtDateTime(t.dueAt, tz)}</span> : "No due date"}
              {t.ownerName ? ` · ${t.ownerName}` : ""}{t.priority !== "normal" ? ` · ${t.priority}` : ""}{t.outcome ? ` · ${t.outcome}` : ""}
            </p>
          </div>
          {t.status === "open" ? (
            <ActionForm action={completeTaskAction.bind(null, t.id)} className="flex items-center gap-2">
              {!compact && <label className="sr-only" htmlFor={`o-${t.id}`}>Outcome</label>}
              {!compact && <input id={`o-${t.id}`} name="outcome" placeholder="Outcome" className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs" />}
              <Submit size="sm" variant="secondary">Done</Submit>
            </ActionForm>
          ) : <StatusBadge status={t.status} />}
        </li>
      ))}
    </ul>
  );
}

export function NewTaskForm({ users, link }: { users: { id: string; name: string }[]; link?: Record<string, string> }) {
  return (
    <ActionForm action={createTaskAction} resetOnSuccess className="space-y-3">
      {link && Object.entries(link).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Grid>
        <Input name="title" label="Task" required className="sm:col-span-2" />
        <Input name="dueAt" label="Due" type="datetime-local" />
        <Select name="priority" label="Priority" defaultValue="normal" options={["low", "normal", "high", "urgent"].map((p) => ({ value: p, label: p }))} />
        <Select name="ownerId" label="Owner" placeholder="Me" options={users.map((u) => ({ value: u.id, label: u.name }))} hint="Assigning to others needs a manager permission." />
        <Textarea name="description" label="Details" rows={2} />
      </Grid>
      <Submit>Add task</Submit>
    </ActionForm>
  );
}
