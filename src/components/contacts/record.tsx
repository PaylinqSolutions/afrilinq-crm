"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import {
  Building2, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, GraduationCap, Handshake, History, LifeBuoy, Link2, ListChecks, Mail, MoreHorizontal,
  Phone, Pin, PinOff, Plus, RefreshCw, Rocket, Search, Sparkles, StickyNote, Trash2, UserRound, X,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, Dialog, field, Label, Menu, MenuItem, money } from "../deals/kit";
import { CONTACT_LEAD_STATUSES, LIFECYCLE_STAGES, leadStatusLabel, lifecycleLabel } from "@/lib/rules/contacts";
import { CONTACT_ROLES } from "@/lib/rules/sales";
import { associateDealAction, completeContactTaskAction, uploadContactFileAction, deleteContactsAction, patchContactAction, pinActivityAction, restoreContactsAction } from "@/app/actions/contacts";
import { ago, Avatar, type CCtx, type CUser, dateTime, Floating, PhoneEditor, PickList, TextEditor, validEmail } from "./kit";
import { ContactComposer, KIND_META, type CKind } from "./composer";

export type Act = { id: string; type: string; subject: string; body: string | null; outcome: string | null; occurredAt: string; scheduledFor: string | null; durationMinutes: number | null; simulated: boolean; pinnedAt: string | null; by: string | null; byId: string | null };
export type Task = { id: string; title: string; description: string | null; dueAt: string | null; remindAt: string | null; status: string; priority: string; ownerId: string; ownerName: string; createdAt: string; completedAt: string | null };
export type RecordData = {
  c: {
    id: string; firstName: string; lastName: string; email: string | null; phone: string | null; whatsapp: string | null; jobTitle: string | null; companyId: string | null;
    contactRoles: string[]; preferredChannel: string | null; marketingConsent: boolean; ownerId: string | null; leadStatus: string | null; lifecycleStage: string;
    referralSource: string | null; city: string | null; createdAt: string; updatedAt: string; deletedAt: null;
  };
  company: { id: string; name: string; city: string | null; segment: string; lifecycle: string; industry: string | null; region: string | null; website: string | null; notes: string | null } | null;
  owner: { id: string; name: string } | null; lastActivityAt: string | null;
  colleagues: { id: string; firstName: string; lastName: string; jobTitle: string | null; email: string | null; phone: string | null }[];
  attachments: { id: string; filename: string; sizeBytes: number; createdAt: string; by: string | null }[];
  dealEvents: { id: string; dealId: string; dealName: string; stage: string; at: string; by: string | null }[];
  activities: Act[]; tasks: Task[];
  deals: { id: string; name: string; amount: number | null; currency: string; stage: string; isWon: boolean; isLost: boolean; close: string | null; ownerName: string }[] | null;
  tickets: { id: string; number: number; subject: string; status: string; priority: string; createdAt: string }[] | null;
  training: { id: string; title: string; startsAt: string | null; attendance: string; completed: boolean }[];
  projects: { id: string; name: string; stage: string; riskLevel: string }[] | null;
  history: { at: string; action: string; changes: Record<string, { from: unknown; to: unknown }> | null; by: string | null; reason: string | null }[];
  summary: { lines: string[]; next: string; missing: string[]; engagement: number; recent30: number; daysSince: number | null; overdue: number; openTickets: number; generatedAt: string };
  documents: DocSummary[]; docPerms: DocPerms;
};
type Prop = "email" | "phone" | "whatsapp" | "company" | "jobTitle" | "referral" | "leadStatus" | "lifecycle" | "roles" | "owner" | "city" | "channel" | "consent" | "name";

const TIME = { all: "All time so far", today: "Today", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", year: "This year", upcoming: "All upcoming" } as const;
type Time = keyof typeof TIME;
export const ACT_TYPES: { key: string; label: string; types: string[] }[] = [
  { key: "note", label: "Notes", types: ["note"] }, { key: "email", label: "Emails", types: ["email"] }, { key: "call", label: "Calls", types: ["call"] },
  { key: "task", label: "Tasks", types: ["task"] }, { key: "meeting", label: "Meetings", types: ["meeting", "demo"] },
  { key: "message", label: "Messages", types: ["whatsapp", "sms", "linkedin", "postal"] }, { key: "system", label: "Contact activity", types: ["system"] },
  { key: "deal", label: "Deal activity", types: ["deal"] },
  { key: "service", label: "Tickets, training & handover", types: ["ticket", "training", "handover"] },
];
export type Item = { id: string; kind: string; title: string; body?: string | null; at: string; by?: string | null; meta?: string; pinned?: boolean; task?: Task; act?: Act; upcoming?: boolean; link?: string };
const PROP_LABEL: Record<string, string> = { leadStatus: "lead status", lifecycleStage: "lifecycle stage", ownerId: "owner", referralSource: "referral source", companyId: "company", email: "email", phone: "phone number", city: "city" };

export function ContactRecord({ data, users, companies, sources, dealOptions, ctx, initialTab, journey }: {
  data: RecordData; users: CUser[]; companies: { id: string; name: string }[]; sources: string[]; dealOptions: { id: string; name: string; company: string }[]; ctx: CCtx; initialTab?: string; journey?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const { c } = data;
  const name = `${c.firstName} ${c.lastName}`;
  const [tab, setTab] = useState<"overview" | "activities" | "intelligence">(initialTab === "activities" || initialTab === "intelligence" ? initialTab : "overview");
  const [sub, setSub] = useState("all");
  const [composer, setComposer] = useState<CKind | null>(null);
  const [edit, setEdit] = useState<{ p: Prop; el: HTMLElement } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(true);
  const [dialog, setDialog] = useState<"" | "history" | "delete" | "deal">("");
  const [srcs, setSrcs] = useState(sources);
  const [generated, setGenerated] = useState(data.summary.generatedAt);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown>; fieldErrors?: Record<string, string> }>, after?: () => void, undo?: () => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toast({ tone: "success", text: r.message ?? "Saved.", action: undo ? { label: "Undo", run: undo } : undefined }); after?.(); router.refresh(); }
    else toast({ tone: "error", text: r.message ?? "That didn't save.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean), action: r.data?.stale ? { label: "Reload", run: () => router.refresh() } : undefined });
  });
  const patch = (p: Record<string, string | string[] | boolean | null>) => { setEdit(null); run(() => patchContactAction(c.id, p, c.updatedAt)); };
  const compose = (k: CKind) => { if (!ctx.perms.log) { toast({ tone: "error", text: "You don't have permission to log activity on contacts." }); return; } setComposer(k); };

  // Timeline: activities + tasks + system events from the audit trail, newest first.
  const items = useMemo<Item[]>(() => {
    const now = Date.now();
    const acts: Item[] = data.activities.map((a) => ({
      id: a.id, kind: a.type, title: a.subject, body: a.body, at: a.scheduledFor ?? a.occurredAt, by: a.by, pinned: !!a.pinnedAt, act: a,
      upcoming: !!a.scheduledFor && Date.parse(a.scheduledFor) > now,
      meta: [a.outcome, a.durationMinutes ? `${a.durationMinutes} min` : null, a.simulated ? "SIMULATED" : null].filter(Boolean).join(" · "),
    }));
    const ts: Item[] = data.tasks.map((t) => ({ id: t.id, kind: "task", title: t.title, body: t.description, at: t.dueAt ?? t.createdAt, by: t.ownerName, task: t, upcoming: t.status === "open", link: `/tasks?task=${t.id}`, meta: t.status === "open" ? (t.dueAt && Date.parse(t.dueAt) < now ? "Overdue" : "Open") : t.status === "done" ? "Completed" : "Cancelled" }));
    const sys: Item[] = [
      { id: "created", kind: "system", title: "Contact created", at: c.createdAt, body: `${name} was added to the CRM${c.referralSource ? ` (source: ${c.referralSource})` : ""}.` },
      ...data.history.filter((h) => h.action === "contact.updated" && h.changes && ["leadStatus", "lifecycleStage", "ownerId"].some((k) => h.changes![k])).map((h, i) => {
        const [k, v] = Object.entries(h.changes!).find(([k]) => ["lifecycleStage", "leadStatus", "ownerId"].includes(k))!;
        const to = k === "lifecycleStage" ? lifecycleLabel(String(v.to)) : k === "leadStatus" ? leadStatusLabel(v.to as string) ?? "no status" : users.find((u) => u.id === v.to)?.name ?? "no owner";
        return { id: `h${i}`, kind: "system", title: "Contact activity", at: h.at, by: h.by, body: `${h.by ?? "System"} changed ${PROP_LABEL[k]} to ${to}${h.reason ? ` (${h.reason})` : ""}.` };
      }),
    ];
    const dealItems: Item[] = data.dealEvents.map((e) => ({ id: e.id, kind: "deal", title: "Deal activity", at: e.at, by: e.by, body: `${e.by ?? "System"} moved ${e.dealName} to ${e.stage}.`, link: `/deals?preview=${e.dealId}` }));
    return [...acts, ...ts, ...sys, ...dealItems].sort((a, b) => b.at.localeCompare(a.at));
  }, [data, c.createdAt, c.referralSource, name, users]);

  const props: { p: Prop; label: string; value: React.ReactNode }[] = [
    { p: "email", label: "Email", value: c.email && <a href={`mailto:${c.email}`} className="font-semibold text-accent-600 hover:underline">{c.email}</a> },
    { p: "phone", label: "Phone number", value: c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-accent-600 hover:underline">{c.phone}</a> },
    { p: "whatsapp", label: "WhatsApp", value: c.whatsapp && <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-600 hover:underline">{c.whatsapp}</a> },
    { p: "company", label: "Company name", value: data.company && <Link href={`/companies/${data.company.id}`} className="hover:underline">{data.company.name}</Link> },
    { p: "jobTitle", label: "Job title", value: c.jobTitle },
    { p: "referral", label: "Referral source", value: c.referralSource && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" aria-hidden />{c.referralSource}</span> },
    { p: "leadStatus", label: "Lead status", value: leadStatusLabel(c.leadStatus) },
    { p: "lifecycle", label: "Lifecycle stage", value: lifecycleLabel(c.lifecycleStage) },
    { p: "roles", label: "Buying role", value: c.contactRoles.length ? <span className="flex flex-wrap gap-1">{c.contactRoles.map((r) => (
      <span key={r} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-xs font-semibold text-white">{CONTACT_ROLES.find((x) => x.key === r)?.label ?? r}
        {ctx.perms.edit && <button onClick={() => patch({ contactRoles: c.contactRoles.filter((x) => x !== r) })} aria-label={`Remove buying role ${CONTACT_ROLES.find((x) => x.key === r)?.label ?? r}`} className="rounded hover:bg-violet-500"><X className="h-3 w-3" /></button>}</span>))}</span> : null },
    { p: "owner", label: "Contact owner", value: data.owner?.name },
    { p: "city", label: "City", value: c.city },
    { p: "channel", label: "Preferred channel", value: c.preferredChannel && c.preferredChannel[0].toUpperCase() + c.preferredChannel.slice(1) },
    { p: "consent", label: "Marketing consent", value: c.marketingConsent ? "Yes" : "No" },
  ];

  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).then(() => toast({ tone: "success", text: `${what} copied.` }), () => toast({ tone: "error", text: "Couldn't copy — your browser blocked clipboard access." })); };

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
      {/* Left: identity, quick actions, properties */}
      <aside className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <Link href="/contacts" className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm font-semibold hover:bg-slate-100"><ChevronLeft className="h-4 w-4" />Contacts</Link>
            <Menu label="Actions" align="right">
              {(close) => <>
                <MenuItem onClick={() => { close(); copy(window.location.href.split("?")[0], "Link to this contact"); }}><Link2 className="h-4 w-4" />Copy link</MenuItem>
                <MenuItem onClick={() => { close(); setDialog("history"); }}><History className="h-4 w-4" />View property history</MenuItem>
                <MenuItem onClick={() => { close(); router.push(`/contacts?preview=${c.id}&tab=all`); }}><UserRound className="h-4 w-4" />Show in contacts list</MenuItem>
                <MenuItem onClick={() => { close(); toast({ tone: "info", text: "Merging two contacts is coming later. Use “Find duplicates” on the Contacts list to spot them." }); }} hint="Coming later">Merge</MenuItem>
                {ctx.perms.delete && <MenuItem danger onClick={() => { close(); setDialog("delete"); }}><Trash2 className="h-4 w-4" />Delete</MenuItem>}
              </>}
            </Menu>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={name} size="lg" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-ink-950">{name}</h1>
                {ctx.perms.edit && <button onClick={(e) => setEdit({ p: "name", el: e.currentTarget })} className="text-xs font-medium text-brand-700 hover:underline">Edit name</button>}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-6 gap-1 text-center text-xs">
              {([["note", StickyNote], ["email", Mail], ["call", Phone], ["task", ListChecks], ["meeting", Calendar]] as const).map(([k, Icon]) => (
                <button key={k} onClick={() => compose(k)} className="flex flex-col items-center gap-1 rounded-lg py-1 hover:bg-slate-50" title={KIND_META[k].title}>
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-300"><Icon className="h-4 w-4" aria-hidden /></span><span className="truncate">{KIND_META[k].label}</span>
                </button>
              ))}
              <MoreActions onPick={compose} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between px-3 py-2">
            <button onClick={() => setAboutOpen(!aboutOpen)} aria-expanded={aboutOpen} className="inline-flex items-center gap-1 rounded-lg px-1 py-1 font-semibold"><ChevronDown className={clsx("h-4 w-4 transition", !aboutOpen && "-rotate-90")} />About this contact</button>
            <Menu label="Actions" align="right">
              {(close) => <>
                <MenuItem onClick={() => { close(); setDialog("history"); }}><History className="h-4 w-4" />View property history</MenuItem>
                <MenuItem onClick={() => { close(); copy(props.map((x) => `${x.label}: ${typeof x.value === "string" ? x.value : ""}`).join("\n") + `\nEmail: ${c.email ?? ""}\nPhone: ${c.phone ?? ""}`, "Contact details"); }}><Copy className="h-4 w-4" />Copy details</MenuItem>
                <MenuItem onClick={() => { close(); setAboutOpen(true); toast({ tone: "info", text: "Hover a property and click Edit to change it." }); }}>How to edit</MenuItem>
              </>}
            </Menu>
          </div>
          {aboutOpen && (
            <dl className="px-3 pb-3">
              {props.map(({ p, label, value }) => (
                <div key={p} className="group rounded-lg px-2 py-2 hover:bg-slate-50">
                  <dt className="flex items-center justify-between text-sm text-slate-600">{label}
                    {ctx.perms.edit && <button onClick={(e) => setEdit({ p, el: e.currentTarget })} className="rounded px-1.5 text-xs font-medium text-brand-700 opacity-0 hover:bg-slate-200 focus:opacity-100 group-hover:opacity-100" aria-label={`Edit ${label}`}>Edit</button>}</dt>
                  <dd className="mt-0.5 break-words text-sm">{value ?? <span className="text-slate-400">--</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Communication preferences</h2>
          <p className="mb-3 text-sm text-slate-600">Respect these before sending marketing or bulk messages.</p>
          <div className="space-y-2 text-sm">
            <label className="flex items-center justify-between gap-2"><span>Marketing messages</span>
              <select aria-label="Marketing consent" disabled={!ctx.perms.edit || pending} value={c.marketingConsent ? "yes" : "no"} onChange={(e) => patch({ marketingConsent: e.target.value === "yes" })} className="rounded-md border border-slate-300 px-1.5 py-1">
                <option value="yes">Subscribed (consented)</option><option value="no">Not subscribed</option></select></label>
            <label className="flex items-center justify-between gap-2"><span>Preferred channel</span>
              <select aria-label="Preferred channel" disabled={!ctx.perms.edit || pending} value={c.preferredChannel ?? ""} onChange={(e) => patch({ preferredChannel: e.target.value || null })} className="rounded-md border border-slate-300 px-1.5 py-1">
                <option value="">No preference</option><option value="email">Email</option><option value="phone">Phone</option><option value="whatsapp">WhatsApp</option></select></label>
            <p className="flex items-center gap-2 text-xs text-slate-500"><span className={clsx("h-2 w-2 rounded-full", c.marketingConsent ? "bg-emerald-500" : "bg-slate-300")} aria-hidden />{c.marketingConsent ? "Can receive marketing emails and WhatsApp broadcasts." : "Only send one-to-one service messages."}</p>
          </div>
        </section>
      </aside>

      {/* Middle */}
      <div className="min-w-0 space-y-4">
        <div role="tablist" aria-label="Record sections" className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {(["overview", "activities", "intelligence"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("border-b-2 px-3 py-3 text-sm font-medium capitalize", tab === t ? "border-brand-600 bg-white text-ink-950" : "border-transparent bg-slate-50 text-slate-600 hover:text-slate-900")}>{t}</button>
          ))}
        </div>

        {tab === "overview" && <>
          {journey}
          <Card title="Data highlights">
            <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
              {[["Create date", dateTime(c.createdAt, ctx.tz)], ["Lifecycle stage", lifecycleLabel(c.lifecycleStage)], ["Last activity date", data.lastActivityAt ? `${dateTime(data.lastActivityAt, ctx.tz, false)} (${ago(data.lastActivityAt, ctx.today)})` : null], ["Lead status", leadStatusLabel(c.leadStatus)]].map(([l, v]) => (
                <div key={l}><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l}</p><p className="mt-1 text-sm">{v ?? "--"}</p></div>
              ))}
            </div>
          </Card>
          {items.some((i) => i.pinned) && <Card title="Pinned activity"><Timeline items={items.filter((i) => i.pinned)} ctx={ctx} onPin={(id, p) => run(() => pinActivityAction(id, p))} onTask={(id, cancel) => run(() => completeContactTaskAction(id, cancel))} /></Card>}
          <Card title="Recent activities"><ActivityFeed items={items.filter((i) => !i.upcoming)} ctx={ctx} onCompose={compose} onPin={(id, p) => run(() => pinActivityAction(id, p))} onTask={(id, cancel) => run(() => completeContactTaskAction(id, cancel))} limit={8} onMore={() => setTab("activities")} /></Card>
          <Card title="Upcoming activities"><ActivityFeed upcoming items={items.filter((i) => i.upcoming).reverse()} ctx={ctx} onCompose={compose} onPin={(id, p) => run(() => pinActivityAction(id, p))} onTask={(id, cancel) => run(() => completeContactTaskAction(id, cancel))} /></Card>
          <Associations data={data} ctx={ctx} onAddCompany={(el) => setEdit({ p: "company", el })} onAddDeal={() => setDialog("deal")} wide />
        </>}

        {tab === "activities" && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div role="tablist" aria-label="Activity types" className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">
              {[{ key: "all", label: "All activities" }, ...ACT_TYPES.filter((t) => t.key !== "system")].map((t) => (
                <button key={t.key} role="tab" aria-selected={sub === t.key} onClick={() => setSub(t.key)} className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", sub === t.key ? "border-ink-950 text-ink-950" : "border-transparent text-slate-600 hover:text-slate-900")}>{t.label}</button>
              ))}
            </div>
            <ActivityFeed key={sub} items={sub === "all" ? items : items.filter((i) => ACT_TYPES.find((t) => t.key === sub)!.types.includes(i.kind))} ctx={ctx} onCompose={compose}
              onPin={(id, p) => run(() => pinActivityAction(id, p))} onTask={(id, cancel) => run(() => completeContactTaskAction(id, cancel))} createFor={sub} showTypeFilter={sub === "all"} />
          </section>
        )}

        {tab === "intelligence" && <Intelligence data={data} items={items} ctx={ctx} onCompose={compose} onFix={(p, el) => setEdit({ p, el })} />}
      </div>

      {/* Right */}
      <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Record summary</h2><span className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[11px] font-semibold text-accent-600" title="Built from this record's data using fixed rules — no AI, no data leaves the CRM.">Rule-based</span></div>
          <div className="rounded-xl border border-accent-400/40 p-3">
            <div className="mb-2 flex items-start justify-between gap-2 text-xs text-slate-500"><span>Generated {dateTime(generated, ctx.tz)}</span>
              <button onClick={() => { router.refresh(); setGenerated(new Date().toISOString()); toast({ tone: "info", text: "Summary regenerated from the latest data." }); }} aria-label="Regenerate summary" title="Regenerate" className="rounded p-1 hover:bg-slate-100"><RefreshCw className={clsx("h-4 w-4 text-accent-600", pending && "animate-spin")} /></button></div>
            <ul className="space-y-1.5 text-sm text-slate-800">{data.summary.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm"><Sparkles className="mr-1 inline h-3.5 w-3.5 text-accent-600" aria-hidden /><span className="font-semibold">Next best action: </span>{data.summary.next}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => copy([...data.summary.lines, `Next: ${data.summary.next}`].join("\n"), "Summary")} className={btn("outline", "sm")}><Copy className="h-3.5 w-3.5" />Copy</button>
              <button onClick={() => setTab("intelligence")} className={btn("ghost", "sm")}>See intelligence<ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </section>
        <div className="hidden xl:block"><Associations data={data} ctx={ctx} onAddCompany={(el) => setEdit({ p: "company", el })} onAddDeal={() => setDialog("deal")} /></div>
      </aside>

      {/* Editors and dialogs */}
      {edit && (() => {
        const close = () => setEdit(null);
        const F = (w: number, node: React.ReactNode) => <Floating anchor={edit.el} onClose={close} width={w}>{node}</Floating>;
        switch (edit.p) {
          case "email": return F(360, <TextEditor label="Email" type="email" value={c.email} validate={validEmail} busy={pending} onCancel={close} onSave={(v) => patch({ email: v })} />);
          case "phone": return F(460, <PhoneEditor label="Phone number" value={c.phone} busy={pending} onCancel={close} onSave={(v) => patch({ phone: v })} />);
          case "whatsapp": return F(460, <PhoneEditor label="WhatsApp" value={c.whatsapp} busy={pending} onCancel={close} onSave={(v) => patch({ whatsapp: v })} />);
          case "jobTitle": return F(320, <TextEditor label="Job title" value={c.jobTitle} busy={pending} onCancel={close} onSave={(v) => patch({ jobTitle: v })} />);
          case "city": return F(320, <TextEditor label="City" value={c.city} busy={pending} onCancel={close} onSave={(v) => patch({ city: v })} />);
          case "company": return F(320, <PickList placeholder="Search companies" clearLabel="Remove company" value={c.companyId} options={companies.map((x) => ({ value: x.id, label: x.name }))} onPick={(v) => patch({ companyId: v })} busy={pending} />);
          case "referral": return F(300, <PickList allowNew placeholder="Search or add a source" clearLabel="Clear referral source" value={c.referralSource} options={srcs.map((s) => ({ value: s, label: s }))} onPick={(v) => { if (v && !srcs.includes(v)) setSrcs([...srcs, v]); patch({ referralSource: v }); }} busy={pending} />);
          case "leadStatus": return F(280, <PickList clearLabel="Clear lead status" value={c.leadStatus} options={CONTACT_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label }))} onPick={(v) => patch({ leadStatus: v })} busy={pending} />);
          case "lifecycle": return F(280, <PickList value={c.lifecycleStage} options={LIFECYCLE_STAGES.map((s) => ({ value: s.key, label: s.label }))} onPick={(v) => v && patch({ lifecycleStage: v })} busy={pending} />);
          case "owner": return F(280, <PickList clearLabel="Unassign" value={c.ownerId} options={users.map((u) => ({ value: u.id, label: u.id === ctx.me.id ? `${u.name} (you)` : u.name }))} onPick={(v) => patch({ ownerId: v })} busy={pending} />);
          case "channel": return F(260, <PickList clearLabel="No preference" value={c.preferredChannel} options={[{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }, { value: "whatsapp", label: "WhatsApp" }]} onPick={(v) => patch({ preferredChannel: v })} busy={pending} />);
          case "consent": return F(300, <div className="p-4"><p className="mb-2 font-semibold">Marketing consent</p><p className="mb-3 text-sm text-slate-600">Only record consent the contact actually gave.</p>
            <div className="flex gap-2"><button className={btn(c.marketingConsent ? "outline" : "primary", "sm")} onClick={() => patch({ marketingConsent: true })}>Consented</button><button className={btn(c.marketingConsent ? "primary" : "outline", "sm")} onClick={() => patch({ marketingConsent: false })}>No consent</button></div></div>);
          case "roles": return F(300, <RolesEditor value={c.contactRoles} onSave={(v) => patch({ contactRoles: v })} onCancel={close} />);
          case "name": return F(340, <NameEditor first={c.firstName} last={c.lastName} onCancel={close} onSave={(f, l) => patch({ firstName: f, lastName: l })} />);
        }
      })()}
      {composer && <ContactComposer kind={composer} users={users} ctx={ctx} onClose={() => setComposer(null)} onSwitch={setComposer} onDone={() => router.refresh()}
        contact={{ id: c.id, name, email: c.email, phone: c.phone, whatsapp: c.whatsapp, companyName: data.company?.name ?? null }} />}
      {dialog === "history" && (
        <Dialog title="Property history" wide onClose={() => setDialog("")}>
          {!data.history.length ? <p className="text-sm text-slate-600">No changes recorded yet.</p> : (
            <ol className="space-y-2 text-sm">{data.history.map((h, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-2"><p className="text-xs text-slate-500">{dateTime(h.at, ctx.tz)} · {h.by ?? "System"} · {h.action.replace("contact.", "")}</p>
                {h.changes && <ul className="mt-1 space-y-0.5">{Object.entries(h.changes).map(([k, v]) => <li key={k}><span className="font-medium">{k}</span>: {fmtVal(k, v.from, users)} → {fmtVal(k, v.to, users)}</li>)}</ul>}
                {h.reason && <p className="mt-1 text-xs italic text-slate-600">Reason: {h.reason}</p>}</li>
            ))}</ol>
          )}
        </Dialog>
      )}
      {dialog === "delete" && <DeleteDialog name={name} pending={pending} onClose={() => setDialog("")} onConfirm={(reason) => run(() => deleteContactsAction([c.id], reason), () => { setDialog(""); router.push("/contacts"); }, () => run(() => restoreContactsAction([c.id])))} />}
      {dialog === "deal" && (
        <Dialog title="Associate a deal" onClose={() => setDialog("")} footer={<Link href={`/deals?tab=all`} className={btn("ghost")}>Create a new deal on the Deals board</Link>}>
          {!ctx.perms.dealsEdit ? <p className="text-sm text-slate-600">You need deal edit access to associate deals.</p> :
            <PickList placeholder="Search deals" value={null} options={dealOptions.filter((d) => !data.deals?.some((x) => x.id === d.id)).map((d) => ({ value: d.id, label: d.name, hint: d.company }))} onPick={(v) => v && run(() => associateDealAction(c.id, v), () => setDialog(""))} busy={pending} />}
        </Dialog>
      )}
    </div>
  );
}

const fmtVal = (k: string, v: unknown, users: CUser[]) => v === null || v === undefined || v === "" ? "—" : k === "leadStatus" ? leadStatusLabel(String(v)) : k === "lifecycleStage" ? lifecycleLabel(String(v)) : k === "ownerId" ? users.find((u) => u.id === v)?.name ?? "someone" : Array.isArray(v) ? v.join(", ") : String(v);

export function Card({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-ink-950">{title}</h2>{actions}</div>{children}</section>;
}

function MoreActions({ onPick }: { onPick: (k: CKind) => void }) {
  const [q, setQ] = useState("");
  const list = (["whatsapp", "sms", "linkedin", "postal", "call", "meeting", "email"] as CKind[]).filter((k) => KIND_META[k].title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Menu icon={<span className="flex flex-col items-center gap-1"><span className="grid h-10 w-10 place-items-center rounded-full border border-slate-300"><MoreHorizontal className="h-4 w-4" /></span><span className="text-xs">More</span></span>} ariaLabel="More activity types" align="right">
      {(close) => <div className="w-64">
        <div className="relative px-2 pb-1 pt-1"><Search className="pointer-events-none absolute left-4 top-3 h-4 w-4 text-slate-400" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search activity types" className="w-full rounded-full border border-slate-300 py-1.5 pl-8 pr-3 text-sm" /></div>
        {list.map((k) => { const M = KIND_META[k]; return <MenuItem key={k} onClick={() => { close(); onPick(k); }}><M.Icon className="h-4 w-4" />{M.title}</MenuItem>; })}
        {!list.length && <p className="px-3 py-2 text-sm text-slate-500">No matches.</p>}
      </div>}
    </Menu>
  );
}

function inTime(at: string, t: Time, today: string) {
  if (t === "all") return true;
  if (t === "upcoming") return at.slice(0, 10) >= today;
  const d = at.slice(0, 10);
  if (t === "today") return d === today;
  if (t === "year") return d.slice(0, 4) === today.slice(0, 4);
  const from = new Date(Date.parse(`${today}T12:00:00Z`) - Number(t) * 86400000).toISOString().slice(0, 10);
  return d >= from && d <= today;
}

export function ActivityFeed({ items, ctx, onCompose, onPin, onTask, limit, onMore, upcoming, createFor, showTypeFilter = true }: {
  items: Item[]; ctx: CCtx; onCompose: (k: CKind) => void; onPin: (id: string, p: boolean) => void; onTask: (id: string, cancel: boolean) => void;
  limit?: number; onMore?: () => void; upcoming?: boolean; createFor?: string; showTypeFilter?: boolean;
}) {
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<string[]>(ACT_TYPES.map((t) => t.key));
  const [time, setTime] = useState<Time>(upcoming ? "upcoming" : "all");
  const [who, setWho] = useState<"anyone" | "me">("anyone");
  const [collapsed, setCollapsed] = useState(false);
  const allTypes = ACT_TYPES.flatMap((t) => (types.includes(t.key) ? t.types : []));
  const list = items.filter((i) => (!showTypeFilter || allTypes.includes(i.kind)) && inTime(i.at, time, ctx.today) && (who === "anyone" || i.by === ctx.me.name) &&
    (!q || `${i.title} ${i.body ?? ""} ${i.meta ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const shown = limit ? list.slice(0, limit) : list;
  const typeCount = types.length;
  const createBtns: Record<string, [string, CKind][]> = {
    note: [["Create a note", "note"]], email: [["Log an email", "email"]], call: [["Log a call", "call"]], task: [["Create task", "task"]], meeting: [["Log a meeting", "meeting"], ["Schedule a meeting", "schedule"]], message: [["Log WhatsApp", "whatsapp"], ["Log SMS", "sms"]],
  };
  const filtersOn = (showTypeFilter && typeCount !== ACT_TYPES.length) || time !== (upcoming ? "upcoming" : "all") || who !== "anyone" || !!q;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={createFor && createFor !== "all" ? `Search ${ACT_TYPES.find((t) => t.key === createFor)?.label.toLowerCase()}` : "Search activities"} aria-label="Search activities" className="w-full rounded-full border border-slate-300 py-1.5 pl-9 pr-3 text-sm" /></div>
        {!upcoming && ctx.perms.log && (!createFor || createFor === "all") && (
          <Menu label="Add activities" variant="outline">
            {(close) => (Object.keys(KIND_META) as CKind[]).map((k) => { const M = KIND_META[k]; return <MenuItem key={k} onClick={() => { close(); onCompose(k); }}><M.Icon className="h-4 w-4" />{M.title}</MenuItem>; })}
          </Menu>
        )}
        {createFor && createBtns[createFor] && ctx.perms.log && createBtns[createFor].map(([l, k]) => <button key={l} onClick={() => onCompose(k)} className={btn("outline", "sm")}><Plus className="h-3.5 w-3.5" />{l}</button>)}
        {createFor === "call" && <span className="text-xs text-slate-500">Use the phone number on the left to dial from your device.</span>}
        <Menu label={collapsed ? "Expand all" : "Collapse all"} align="right">
          {(close) => <><MenuItem onClick={() => { close(); setCollapsed(true); }}>Collapse all</MenuItem><MenuItem onClick={() => { close(); setCollapsed(false); }}>Expand all</MenuItem></>}
        </Menu>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {showTypeFilter && (
          <Menu label={`Activity (${typeCount}/${ACT_TYPES.length})`} variant="ghost">
            {() => <div className="w-56 p-1">{ACT_TYPES.map((t) => <label key={t.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"><input type="checkbox" className="h-4 w-4" checked={types.includes(t.key)} onChange={() => setTypes(types.includes(t.key) ? types.filter((x) => x !== t.key) : [...types, t.key])} />{t.label}</label>)}
              <button onClick={() => setTypes(ACT_TYPES.map((t) => t.key))} className="mt-1 w-full rounded px-2 py-1 text-left text-xs font-medium text-brand-700 hover:bg-slate-50">Select all</button></div>}
          </Menu>
        )}
        <Menu label={TIME[time]}>
          {(close) => (Object.keys(TIME) as Time[]).filter((t) => (upcoming ? t === "upcoming" || t === "all" : t !== "upcoming")).map((t) => <MenuItem key={t} onClick={() => { close(); setTime(t); }} hint={t === time ? "✓" : undefined}>{TIME[t]}</MenuItem>)}
        </Menu>
        <Menu label={who === "me" ? "By me" : "Activity assigned to"}>
          {(close) => <><MenuItem onClick={() => { close(); setWho("anyone"); }}>Anyone</MenuItem><MenuItem onClick={() => { close(); setWho("me"); }}>Me ({ctx.me.name})</MenuItem></>}
        </Menu>
        {filtersOn && <button onClick={() => { setTypes(ACT_TYPES.map((t) => t.key)); setTime(upcoming ? "upcoming" : "all"); setWho("anyone"); setQ(""); }} className="rounded-lg px-2 py-1 text-sm font-semibold hover:bg-slate-100">Clear all</button>}
      </div>
      {shown.length ? <Timeline items={shown} ctx={ctx} collapsed={collapsed} onPin={onPin} onTask={onTask} grouped /> : (
        <div className="grid place-items-center gap-1 py-8 text-center">
          <Search className="h-8 w-8 text-slate-300" aria-hidden />
          <p className="font-semibold">{filtersOn ? "No activities match the current filters." : upcoming ? "Nothing upcoming." : "No activity yet."}</p>
          <p className="text-sm text-slate-600">{filtersOn ? "Change filters to broaden your search." : upcoming ? "Create a task or schedule a meeting to plan the next step." : "Log a call, email or note to start the history."}</p>
          {upcoming && ctx.perms.log && <div className="mt-2 flex gap-2"><button className={btn("outline", "sm")} onClick={() => onCompose("task")}>Create task</button><button className={btn("outline", "sm")} onClick={() => onCompose("meeting")}>Schedule meeting</button></div>}
        </div>
      )}
      {limit && list.length > limit && <button onClick={onMore} className="mt-2 text-sm font-semibold text-brand-700 hover:underline">See all {list.length} activities</button>}
    </div>
  );
}

const ICON: Record<string, typeof Phone> = { ticket: LifeBuoy, training: GraduationCap, handover: Rocket, deal: Handshake, note: StickyNote, email: Mail, call: Phone, task: ListChecks, meeting: Calendar, demo: Calendar, system: UserRound };
function Timeline({ items, ctx, collapsed, onPin, onTask, grouped }: { items: Item[]; ctx: CCtx; collapsed?: boolean; onPin: (id: string, p: boolean) => void; onTask: (id: string, cancel: boolean) => void; grouped?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  let lastMonth = "";
  return (
    <ol className="space-y-3">
      {items.map((i) => {
        const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: ctx.tz }).format(new Date(i.at));
        const head = grouped && month !== lastMonth ? (lastMonth = month) : null;
        const Icon = ICON[i.kind] ?? KIND_META[i.kind as CKind]?.Icon ?? StickyNote;
        const isOpen = open[i.id] ?? !collapsed;
        const label = ["system", "deal", "ticket", "training", "handover"].includes(i.kind) ? i.title : i.kind === "task" ? "Task" : KIND_META[i.kind as CKind]?.title.replace("Log ", "").replace(/^\w/, (x) => x.toUpperCase()) ?? i.kind;
        return (
          <li key={i.id}>
            {head && <h3 className="mb-2 mt-1 font-semibold text-ink-950">{head}</h3>}
            <div className="flex gap-3">
              <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-slate-600"><Icon className="h-4 w-4" aria-hidden /></span>
              <div className="min-w-0 flex-1 rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <button onClick={() => setOpen({ ...open, [i.id]: !isOpen })} aria-expanded={isOpen} className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold">{label}{!["system", "deal", "ticket", "training", "handover"].includes(i.kind) && <span className="font-normal text-slate-700"> · {i.title}</span>}</p>
                  </button>
                  <span className="shrink-0 text-xs text-slate-500">{i.upcoming && i.kind !== "task" ? "Scheduled " : ""}{dateTime(i.at, ctx.tz)}</span>
                </div>
                {isOpen && <>
                  {i.body && <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-700">{i.body.replace(/\*\*|<\/?u>/g, "")}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {i.meta && <span className={clsx("rounded px-1.5 py-0.5", i.meta === "Overdue" ? "bg-red-50 text-red-700" : i.meta.includes("SIMULATED") ? "bg-amber-50 text-amber-800" : "bg-slate-100")}>{i.meta}</span>}
                    {i.by && <span>{i.kind === "task" ? "Assigned to" : "By"} {i.by}</span>}
                    {i.link && <Link href={i.link} className="font-semibold text-accent-600 hover:underline">View details</Link>}
                    <span className="ml-auto flex gap-1">
                      {i.task?.status === "open" && <>
                        <button onClick={() => onTask(i.task!.id, false)} className={btn("outline", "sm")}><Check className="h-3.5 w-3.5" />Complete</button>
                        <button onClick={() => { if (confirm("Cancel this task?")) onTask(i.task!.id, true); }} className={btn("ghost", "sm")}>Cancel</button>
                      </>}
                      {i.act && ctx.perms.log && <button onClick={() => onPin(i.id, !i.pinned)} className={btn("ghost", "sm")} aria-label={i.pinned ? "Unpin" : "Pin to top"}>{i.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}{i.pinned ? "Unpin" : "Pin"}</button>}
                    </span>
                  </div>
                </>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Associations({ data, ctx, onAddCompany, onAddDeal, wide }: { data: RecordData; ctx: CCtx; onAddCompany: (el: HTMLElement) => void; onAddDeal: () => void; wide?: boolean }) {
  const documentsBox = <DocumentsBox docs={data.documents} companyId={data.c.companyId} contactId={data.c.id} perms={data.docPerms} />;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const box = (key: string, title: string, Icon: typeof Phone, count: number | null, add: React.ReactNode, body: React.ReactNode, empty: string) => count === null ? null : (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setOpen({ ...open, [key]: !(open[key] ?? true) })} aria-expanded={open[key] ?? true} className="inline-flex items-center gap-1 font-semibold"><ChevronDown className={clsx("h-4 w-4 transition", !(open[key] ?? true) && "-rotate-90")} />{title} ({count})</button>
        {add}
      </div>
      {(open[key] ?? true) && <div className="px-4 pb-4 text-sm">{count ? body : <p className="flex items-center gap-2 text-slate-500"><Icon className="h-4 w-4 shrink-0" aria-hidden />{empty}</p>}</div>}
    </section>
  );
  const addBtn = (label: string, onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void, href?: string) => href
    ? <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />{label}</Link>
    : <button onClick={onClick} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />{label}</button>;
  return (
    <div className={clsx("grid gap-4", wide && "md:grid-cols-2")}>
      {box("company", "Companies", Building2, data.company ? 1 : 0, ctx.perms.edit && addBtn(data.company ? "Change" : "Add", (e) => onAddCompany(e.currentTarget)),
        data.company && <div><Link href={`/companies/${data.company.id}`} className="font-semibold text-brand-700 hover:underline">{data.company.name}</Link><p className="text-xs text-slate-500">{[data.company.segment, data.company.city, data.company.lifecycle].filter(Boolean).join(" · ")}</p></div>,
        "Link the business or organisation this person works for.")}
      {box("deals", "Deals", Handshake, data.deals?.length ?? null, ctx.perms.dealsEdit && addBtn("Add", () => onAddDeal()),
        <DealCards deals={data.deals ?? []} company={data.company?.name ?? null} />, "No deals involve this contact yet.")}
      {box("tickets", "Tickets", LifeBuoy, data.tickets?.length ?? null, ctx.perms.tickets && addBtn("Add", undefined, `/tickets/new?contact=${data.c.id}`),
        <ul className="space-y-2">{data.tickets?.map((t) => <li key={t.id}><Link href={`/tickets/${t.id}`} className="font-medium text-brand-700 hover:underline">#{t.number} {t.subject}</Link><p className="text-xs text-slate-500">{t.priority} · {t.status.replace(/_/g, " ")}</p></li>)}</ul>,
        "No support tickets from this contact.")}
      {box("training", "Training", GraduationCap, data.training.length, null,
        <ul className="space-y-2">{data.training.map((t) => <li key={t.id}><Link href={`/training/sessions/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.title}</Link><p className="text-xs text-slate-500">{t.attendance}{t.completed ? " · completed" : ""}</p></li>)}
          <li><Link href={`/training/participants/${data.c.id}`} className="text-xs font-semibold text-accent-600 hover:underline">Full training record</Link></li></ul>,
        "Not enrolled in any training sessions.")}
      {box("contacts", "Contacts at this company", UserRound, data.company ? data.colleagues.length : null, ctx.perms.edit && data.company && addBtn("Add", undefined, `/contacts/new?company=${data.company.id}`),
        <ul className="space-y-2">{data.colleagues.slice(0, 8).map((p) => <li key={p.id}><Link href={`/contacts/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.firstName} {p.lastName}</Link><p className="truncate text-xs text-slate-500">{[p.jobTitle, p.email ?? p.phone].filter(Boolean).join(" · ") || "No details"}</p></li>)}
          {data.colleagues.length > 8 && <li><Link href={`/companies/${data.company!.id}`} className="text-xs font-semibold text-accent-600 hover:underline">View all {data.colleagues.length} at {data.company!.name}</Link></li>}</ul>,
        "No one else from this company is in the CRM yet.")}
      <Attachments data={data} canEdit={ctx.perms.edit} />
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">Playbooks</h2>
        <p className="mb-2 text-sm text-slate-600">Call scripts, objection handling and product guides live in the Knowledge Base.</p>
        <Link href="/kb" className={btn("outline", "sm")}>Open playbooks<ExternalLink className="h-3.5 w-3.5" /></Link>
      </section>
      {documentsBox}
      {box("onboarding", "Onboarding", Rocket, data.projects?.length ?? null, null,
        <ul className="space-y-2">{data.projects?.map((p) => <li key={p.id}><Link href={`/onboarding/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link><p className="text-xs text-slate-500">{p.stage.replace(/_/g, " ")} · risk {p.riskLevel}</p></li>)}</ul>,
        "Their company has no onboarding projects.")}
    </div>
  );
}

export function DealCards({ deals, company }: { deals: NonNullable<RecordData["deals"]>; company: string | null }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"close" | "amount">("close");
  const list = deals.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === "amount" ? (b.amount ?? 0) - (a.amount ?? 0) : (a.close ?? "9999").localeCompare(b.close ?? "9999"));
  return (
    <div className="space-y-2">
      {deals.length > 2 && <div className="flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals" aria-label="Search associated deals" className="min-w-0 flex-1 rounded-full border border-slate-300 px-3 py-1 text-sm" />
        <button onClick={() => setSort(sort === "close" ? "amount" : "close")} className={btn("outline", "sm")}>Sort: {sort === "close" ? "Close date" : "Amount"}</button></div>}
      {list.map((d) => (
        <article key={d.id} className="rounded-lg border border-slate-200 p-3">
          <Link href={`/deals?preview=${d.id}`} className="flex items-center gap-1.5 font-semibold text-accent-600 hover:underline"><Handshake className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{d.name}</span></Link>
          <dl className="mt-1 space-y-0.5 text-xs text-slate-700">
            <div>Amount: <span className="font-semibold">{money(d.amount, d.currency, false)}</span></div>
            <div>Close date: <span className="font-semibold">{d.close ?? "—"}</span></div>
            <div>Deal stage: <span className={clsx("font-semibold", d.isWon && "text-emerald-700", d.isLost && "text-red-700")}>{d.stage}</span></div>
            <div>Owner: {d.ownerName}</div>
          </dl>
          <Link href={`/deals?preview=${d.id}`} className="mt-1 inline-block text-xs font-semibold text-accent-600 hover:underline">Change stage or details</Link>
        </article>
      ))}
      {!list.length && <p className="text-xs text-slate-500">No deals match “{q}”.</p>}
      <Link href={`/deals?layout=table${company ? `&q=${encodeURIComponent(company)}` : ""}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:underline">View all associated deals<ExternalLink className="h-3.5 w-3.5" /></Link>
    </div>
  );
}

function Attachments({ data, canEdit }: { data: RecordData; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const upload = (file: File) => start(async () => {
    const fd = new FormData(); fd.set("file", file);
    const r = await uploadContactFileAction(data.c.id, fd);
    toast({ tone: r.ok ? "success" : "error", text: r.message ?? (r.ok ? "Attached." : "Upload failed."), detail: Object.values(r.fieldErrors ?? {}) });
    if (r.ok) router.refresh();
  });
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Attachments ({data.attachments.length})</h2>
        {canEdit && <label className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />{busy ? "Uploading…" : "Add"}
          <input type="file" className="sr-only" disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label>}</div>
      {data.attachments.length ? <ul className="space-y-1.5 text-sm">{data.attachments.map((a) => <li key={a.id}><a href={`/api/files/file/${a.id}`} className="font-medium text-brand-700 hover:underline">{a.filename}</a><p className="text-xs text-slate-500">{Math.max(1, Math.round(a.sizeBytes / 1024))} KB · {a.by ?? "—"}</p></li>)}</ul>
        : <p className="text-sm text-slate-500">No files yet. PDF, images, Word, Excel or CSV up to 10 MB.</p>}
    </section>
  );
}

export type DocSummary = { id: string; number: string; type: string; title: string; total: number; amountPaid: number; currency: string; dueDate: string | null; view: { label: string; tone: string } };
export type DocPerms = { sla: boolean; quote: boolean; invoice: boolean };

/** Quotes, invoices and SLA agreements for this customer, with shortcuts to create new ones. */
export function DocumentsBox({ docs, companyId, contactId, perms }: { docs: DocSummary[]; companyId: string | null; contactId?: string; perms: DocPerms }) {
  const q = (type: string) => `/documents/new?type=${type}${companyId ? `&company=${companyId}` : ""}${contactId ? `&contact=${contactId}` : ""}`;
  const TONE: Record<string, string> = { green: "text-emerald-700", red: "text-red-700", amber: "text-amber-700", blue: "text-sky-700", violet: "text-violet-700", gray: "text-slate-500" };
  const label: Record<string, string> = { sla: "SLA", quote: "Quote", invoice: "Invoice" };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 font-semibold">Quotes, invoices &amp; agreements ({docs.length})</h2>
      {docs.length ? (
        <ul className="mb-3 space-y-2 text-sm">{docs.slice(0, 8).map((d) => (
          <li key={d.id}><Link href={`/documents/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.number}</Link> <span className="text-xs text-slate-500">{label[d.type]}</span>
            <p className="text-xs"><span className={TONE[d.view.tone] ?? ""}>{d.view.label}</span>{d.type !== "sla" && <span className="text-slate-500"> · {money(d.total, d.currency)}{d.type === "invoice" && d.amountPaid > 0 && d.amountPaid < d.total ? ` · ${money(d.total - d.amountPaid, d.currency)} due` : ""}</span>}</p></li>
        ))}</ul>
      ) : <p className="mb-3 text-sm text-slate-500">{companyId ? "Nothing sent yet." : "Link this contact to a company to send quotes, invoices or agreements."}</p>}
      {companyId && <div className="flex flex-wrap gap-2">
        {perms.quote && <Link href={q("quote")} className={btn("outline", "sm")}>New quote</Link>}
        {perms.invoice && <Link href={q("invoice")} className={btn("outline", "sm")}>New invoice</Link>}
        {perms.sla && <Link href={q("sla")} className={btn("outline", "sm")}>New SLA agreement</Link>}
      </div>}
      {docs.length > 8 && <Link href="/billing" className="mt-2 inline-block text-xs font-semibold text-accent-600 hover:underline">All billing</Link>}
    </section>
  );
}

function Intelligence({ data, items, ctx, onCompose, onFix }: { data: RecordData; items: Item[]; ctx: CCtx; onCompose: (k: CKind) => void; onFix: (p: Prop, el: HTMLElement) => void }) {
  const s = data.summary;
  const mix = ["call", "email", "meeting", "note", "whatsapp", "sms"].map((t) => ({ t, n: data.activities.filter((a) => a.type === t).length })).filter((x) => x.n);
  const maxN = Math.max(1, ...mix.map((x) => x.n));
  const fixes: { p: Prop; label: string }[] = [
    !data.c.email && { p: "email" as Prop, label: "Add an email address" }, !data.c.phone && { p: "phone" as Prop, label: "Add a phone number" },
    !data.c.leadStatus && { p: "leadStatus" as Prop, label: "Set a lead status" }, !data.c.ownerId && { p: "owner" as Prop, label: "Assign an owner" },
    !data.c.companyId && { p: "company" as Prop, label: "Link a company" }, !data.c.referralSource && { p: "referral" as Prop, label: "Record the referral source" },
  ].filter(Boolean) as { p: Prop; label: string }[];
  const tone = s.engagement >= 60 ? "bg-emerald-500" : s.engagement >= 30 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-4">
      <Card title="Profile">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[["Lifecycle stage", lifecycleLabel(data.c.lifecycleStage)], ["Related company", data.company?.name], ["Employment role", data.c.jobTitle], ["City", data.c.city ?? data.company?.city], ["Region", data.company?.region]].map(([l, v]) => (
            <div key={l as string}><dt className="text-xs text-slate-500">{l}</dt><dd>{v || "--"}</dd></div>))}
        </dl>
        <div className="mt-3 flex gap-2">
          {[["LinkedIn", `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${data.c.firstName} ${data.c.lastName} ${data.company?.name ?? ""}`)}`], ["Google", `https://www.google.com/search?q=${encodeURIComponent(`"${data.c.firstName} ${data.c.lastName}" ${data.company?.name ?? ""}`)}`]].map(([l, u]) => (
            <a key={l} href={u} target="_blank" rel="noopener noreferrer" className={btn("outline", "sm")}>Search {l}<ExternalLink className="h-3.5 w-3.5" /></a>))}
        </div>
        <p className="mt-2 text-xs text-slate-500">We don&apos;t buy third-party enrichment data; these open a web search in a new tab.</p>
      </Card>
      {data.company && <Card title="Company">
        <dl className="space-y-2 text-sm">
          <div><dt className="text-xs text-slate-500">Industry</dt><dd>{data.company.industry ?? "--"} · {data.company.segment}</dd></div>
          <div><dt className="text-xs text-slate-500">Company description</dt><dd className="whitespace-pre-line">{data.company.notes ?? "--"}</dd></div>
          {data.company.website && <div><dt className="text-xs text-slate-500">Website</dt><dd><a href={data.company.website.startsWith("http") ? data.company.website : `https://${data.company.website}`} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">{data.company.website}</a></dd></div>}
        </dl>
        <Link href={`/companies/${data.company.id}`} className="mt-2 inline-block text-sm font-semibold text-accent-600 hover:underline">Open company 360</Link>
      </Card>}
      <Card title="Contact outreach">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-slate-500">Email</dt><dd>{data.c.email ?? "--"}</dd></div>
          <div><dt className="text-xs text-slate-500">Phone</dt><dd>{data.c.phone ?? "--"}</dd></div>
          <div><dt className="text-xs text-slate-500">Buying role</dt><dd>{data.c.contactRoles.map((r) => CONTACT_ROLES.find((x) => x.key === r)?.label ?? r).join(", ") || "--"}</dd></div>
        </dl>
      </Card>
      <Card title="Engagement">
        <div className="mb-1 flex items-end justify-between"><span className="text-3xl font-bold text-ink-950">{s.engagement}<span className="text-base font-normal text-slate-500">/100</span></span><span className="text-sm text-slate-600">{s.engagement >= 60 ? "Warm" : s.engagement >= 30 ? "Cooling" : "Cold"}</span></div>
        <div className="h-2 rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.engagement} aria-label="Engagement score"><div className={clsx("h-2 rounded-full", tone)} style={{ width: `${s.engagement}%` }} /></div>
        <p className="mt-2 text-xs text-slate-500">15 points per activity in the last 30 days, +20 for an open deal, +20 if touched in the last 2 weeks.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          {[["Activities (30 days)", s.recent30], ["Days since last touch", s.daysSince ?? "—"], ["Overdue tasks", s.overdue], ["Open tickets", s.openTickets]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-slate-50 p-2"><p className="text-xl font-bold">{v}</p><p className="text-xs text-slate-600">{l}</p></div>
          ))}
        </div>
      </Card>
      <Card title="Next best action">
        <p className="mb-3 text-sm">{s.next}</p>
        {ctx.perms.log && <div className="flex flex-wrap gap-2"><button className={btn("primary", "sm")} onClick={() => onCompose("call")}><Phone className="h-3.5 w-3.5" />Log a call</button><button className={btn("outline", "sm")} onClick={() => onCompose("email")}><Mail className="h-3.5 w-3.5" />Log an email</button><button className={btn("outline", "sm")} onClick={() => onCompose("task")}><ListChecks className="h-3.5 w-3.5" />Create task</button></div>}
      </Card>
      <Card title="Channel mix">
        {mix.length ? <ul className="space-y-2">{mix.map((x) => <li key={x.t} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-sm"><span className="capitalize">{x.t}</span><span className="h-2 rounded-full bg-slate-100"><span className="block h-2 rounded-full bg-accent-500" style={{ width: `${(x.n / maxN) * 100}%` }} /></span><span className="text-right tabular-nums">{x.n}</span></li>)}</ul> : <p className="text-sm text-slate-500">No activity logged yet.</p>}
        {data.c.preferredChannel && <p className="mt-2 text-xs text-slate-600">Prefers {data.c.preferredChannel}.</p>}
      </Card>
      <Card title={`Data completeness (${6 - fixes.length}/6)`}>
        {fixes.length ? <ul className="space-y-1.5">{fixes.map((f) => <li key={f.p} className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><X className="h-4 w-4 text-red-500" aria-hidden />{f.label}</span>{ctx.perms.edit && <button className={btn("outline", "sm")} onClick={(e) => onFix(f.p, e.currentTarget)}>Fix</button>}</li>)}</ul>
          : <p className="flex items-center gap-2 text-sm text-emerald-700"><Check className="h-4 w-4" />All key details are filled in.</p>}
      </Card>
      <Card title="Timeline at a glance"><p className="text-sm text-slate-600">{items.filter((i) => i.kind !== "system").length} activities and tasks since {dateTime(data.c.createdAt, ctx.tz, false)}. <Link href={`/contacts/${data.c.id}?tab=activities`} className="font-medium text-brand-700 underline">Open the full activity log <ExternalLink className="inline h-3 w-3" /></Link></p></Card>
    </div>
  );
}

function RolesEditor({ value, onSave, onCancel }: { value: string[]; onSave: (v: string[]) => void; onCancel: () => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="p-4"><p className="mb-2 font-semibold">Buying role</p>
      {CONTACT_ROLES.map((r) => <label key={r.key} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={v.includes(r.key)} onChange={() => setV(v.includes(r.key) ? v.filter((x) => x !== r.key) : [...v, r.key])} />{r.label}</label>)}
      <div className="mt-3 flex gap-2"><button className={btn("primary", "sm")} onClick={() => onSave(v)}>Save</button><button className={btn("outline", "sm")} onClick={onCancel}>Cancel</button></div></div>
  );
}
function NameEditor({ first, last, onSave, onCancel }: { first: string; last: string; onSave: (f: string, l: string) => void; onCancel: () => void }) {
  const [f, setF] = useState(first); const [l, setL] = useState(last);
  return (
    <form className="space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); if (f.trim() && l.trim()) onSave(f.trim(), l.trim()); }}>
      <p className="font-semibold">Edit name</p>
      <div><Label htmlFor="ne-f">First name</Label><input id="ne-f" autoFocus value={f} onChange={(e) => setF(e.target.value)} className={field} /></div>
      <div><Label htmlFor="ne-l">Last name</Label><input id="ne-l" value={l} onChange={(e) => setL(e.target.value)} className={field} /></div>
      <div className="flex gap-2"><button disabled={!f.trim() || !l.trim()} className={btn("primary", "sm")}>Save</button><button type="button" className={btn("outline", "sm")} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
function DeleteDialog({ name, pending, onClose, onConfirm }: { name: string; pending: boolean; onClose: () => void; onConfirm: (r: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog title={`Delete ${name}?`} onClose={onClose} footer={<><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("danger")} disabled={pending || !reason.trim()} onClick={() => onConfirm(reason)}>Delete</button></>}>
      <p className="mb-3 text-sm text-slate-600">The contact is hidden from lists; history is kept and you can undo right after.</p>
      <Label htmlFor="cd-r">Reason *</Label><textarea id="cd-r" autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
    </Dialog>
  );
}
