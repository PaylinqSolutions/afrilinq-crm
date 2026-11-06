"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import {
  Building2, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, GraduationCap, History, LayoutDashboard, LifeBuoy, Link2, ListChecks, Lock, Mail,
  MoreHorizontal, Phone, Plus, RefreshCw, Rocket, Search, Sparkles, StickyNote, Trash2, UserRound, X,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, Dialog, field, Label, Menu, MenuItem, money } from "../deals/kit";
import { CONTACT_LEAD_STATUSES, leadStatusLabel } from "@/lib/rules/contacts";
import { CONTACT_ROLES, REGIONS, SEGMENTS, TIERS } from "@/lib/rules/sales";
import { deleteCompaniesAction, patchCompanyAction, restoreCompaniesAction } from "@/app/actions/companies";
import { completeContactTaskAction, patchContactAction, pinActivityAction } from "@/app/actions/contacts";
import { uploadCompanyFileAction } from "@/app/actions/crm";
import { ago, type CCtx, type CUser, dateTime, Floating, PhoneEditor, PickList, TextEditor } from "../contacts/kit";
import { ContactComposer, KIND_META, type CKind } from "../contacts/composer";
import { ActivityFeed, ACT_TYPES, Card, DealCards, DocumentsBox, type DocPerms, type DocSummary, type Item } from "../contacts/record";

const LIFECYCLE: Record<string, string> = { prospect: "Prospect", customer: "Customer", churned: "Churned" };
type Act = { id: string; type: string; subject: string; body: string | null; outcome: string | null; occurredAt: string; scheduledFor: string | null; durationMinutes: number | null; simulated: boolean; pinnedAt: string | null; by: string | null; byId: string | null; contactId: string | null; dealId: string | null };
export type CompanyData = {
  c: {
    id: string; name: string; industry: string | null; segment: string; tier: string; lifecycle: string; region: string | null; city: string | null; address: string | null; website: string | null;
    phone: string | null; ownerId: string | null; csmId: string | null; notes: string | null; postalCode: string | null; employees: number | null; annualRevenue: number | null; timeZone: string | null;
    linkedinUrl: string | null; leadStatus: string | null; recordSource: string; createdAt: string; updatedAt: string; deletedAt: null; billingStatus: string | null; billingNotes: string | null;
  };
  owner: string | null; csm: string | null; createdBy: string | null; lastActivityAt: string | null;
  contacts: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; jobTitle: string | null; contactRoles: string[]; leadStatus: string | null; ownerName: string | null }[];
  deals: { id: string; name: string; amount: number | null; currency: string; stage: string; isWon: boolean; isLost: boolean; close: string | null; ownerName: string }[];
  tickets: { id: string; number: number; subject: string; status: string; priority: string; createdAt: string; canOpen: boolean }[];
  projects: { id: string; name: string; stage: string; riskLevel: string }[];
  sessions: { id: string; title: string; startsAt: string | null; status: string; attended: number; participants: number }[];
  files: { id: string; filename: string; sizeBytes: number; createdAt: string; by: string | null; restricted: boolean }[];
  activities: Act[];
  tasks: { id: string; title: string; dueAt: string | null; status: string; priority: string; ownerName: string }[];
  events: { id: string; kind: string; title: string; detail: string | null; at: string; by: string | null; link: string | null }[];
  history: { at: string; action: string; changes: Record<string, { from: unknown; to: unknown }> | null; by: string | null; reason: string | null }[];
  health: { score: number; status: string; components: { key: string; label: string; score: number; weight: number; detail: string }[] } | null;
  renewals: { id: string; date: string; amount: number | null; currency: string; status: string }[];
  summary: { lines: string[]; next: string; missing: string[]; engagement: number; recent30: number; daysSince: number | null; openTickets: number; generatedAt: string };
  documents: DocSummary[]; docPerms: DocPerms;
};
type Prop = "name" | "website" | "industry" | "owner" | "csm" | "lifecycle" | "leadStatus" | "segment" | "tier" | "phone" | "city" | "region" | "postalCode" | "address" | "employees" | "annualRevenue" | "timeZone" | "notes" | "linkedinUrl";
const TIME_ZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Europe/London", "America/New_York", "Asia/Dubai"];

export function CompanyRecord({ data, users, contactOptions, ctx, initialTab, journey }: {
  data: CompanyData; users: CUser[]; contactOptions: { id: string; name: string; hint: string; updatedAt: string }[]; ctx: CCtx; initialTab?: string; journey?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const { c } = data;
  const [tab, setTab] = useState<"overview" | "activities" | "intelligence">(initialTab === "activities" || initialTab === "intelligence" ? initialTab : "overview");
  const [sub, setSub] = useState("all");
  const [composer, setComposer] = useState<CKind | null>(null);
  const [edit, setEdit] = useState<{ p: Prop; el: HTMLElement } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(true);
  const [dialog, setDialog] = useState<"" | "history" | "delete" | "contact">("");
  const [generated, setGenerated] = useState(data.summary.generatedAt);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown>; fieldErrors?: Record<string, string> }>, after?: () => void, undo?: () => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toast({ tone: "success", text: r.message ?? "Saved.", action: undo ? { label: "Undo", run: undo } : undefined }); after?.(); router.refresh(); }
    else toast({ tone: "error", text: r.message ?? "That didn't save.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean), action: r.data?.stale ? { label: "Reload", run: () => router.refresh() } : undefined });
  });
  const patch = (p: Record<string, string | number | null>) => { setEdit(null); run(() => patchCompanyAction(c.id, p, c.updatedAt)); };
  const compose = (k: CKind) => { if (!ctx.perms.log) { toast({ tone: "error", text: "You don't have permission to log activity." }); return; } setComposer(k); };
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast({ tone: "success", text: `${what} copied.` }), () => toast({ tone: "error", text: "Your browser blocked clipboard access." }));
  const contactName = (id: string | null) => { const x = id && data.contacts.find((p) => p.id === id); return x ? `${x.firstName} ${x.lastName}` : null; };

  const items = useMemo<Item[]>(() => {
    const now = Date.now();
    return [
      ...data.activities.map((a) => ({
        id: a.id, kind: a.type, title: a.subject, body: a.body, at: a.scheduledFor ?? a.occurredAt, by: a.by, pinned: !!a.pinnedAt, upcoming: !!a.scheduledFor && Date.parse(a.scheduledFor) > now,
        act: { ...a }, meta: [a.outcome, contactName(a.contactId) && `with ${contactName(a.contactId)}`, a.simulated ? "SIMULATED" : null].filter(Boolean).join(" · "),
        link: a.contactId ? `/contacts/${a.contactId}` : a.dealId ? `/deals?preview=${a.dealId}` : undefined,
      })),
      ...data.tasks.map((t) => ({ id: t.id, kind: "task", title: t.title, at: t.dueAt ?? c.createdAt, by: t.ownerName, upcoming: true, link: `/tasks?task=${t.id}`, meta: t.dueAt && Date.parse(t.dueAt) < now ? "Overdue" : "Open",
        task: { id: t.id, title: t.title, description: null, dueAt: t.dueAt, remindAt: null, status: t.status, priority: t.priority, ownerId: "", ownerName: t.ownerName, createdAt: c.createdAt, completedAt: null } })),
      ...data.events.map((e) => ({ id: e.id, kind: e.kind, title: e.kind === "deal" ? "Deal activity" : e.kind === "ticket" ? "Ticket" : e.kind === "training" ? "Training" : "Handover", body: [e.title, e.detail].filter(Boolean).join(" — "), at: e.at, by: e.by, link: e.link?.replace(/^\/deals\/([\w-]+)$/, "/deals?preview=$1") ?? undefined })),
      { id: "created", kind: "system", title: "Created", at: c.createdAt, body: `This company was created${data.createdBy ? ` by ${data.createdBy}` : ""} (source: ${c.recordSource}).` },
      ...data.history.filter((h) => h.action === "company.updated" && h.changes && ["lifecycle", "ownerId", "leadStatus"].some((k) => h.changes![k])).map((h, i) => {
        const [k, v] = Object.entries(h.changes!).find(([k]) => ["lifecycle", "ownerId", "leadStatus"].includes(k))!;
        const to = k === "lifecycle" ? LIFECYCLE[String(v.to)] ?? v.to : k === "leadStatus" ? leadStatusLabel(v.to as string) ?? "no status" : users.find((u) => u.id === v.to)?.name ?? "no owner";
        return { id: `h${i}`, kind: "system", title: "Company activity", at: h.at, by: h.by, body: `${h.by ?? "System"} changed ${k === "ownerId" ? "owner" : k === "leadStatus" ? "lead status" : "lifecycle stage"} to ${to}.` };
      }),
    ].sort((a, b) => b.at.localeCompare(a.at)) as Item[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, users]);

  const web = (u: string) => (u.startsWith("http") ? u : `https://${u}`);
  const props: { p: Prop | null; label: string; value: React.ReactNode }[] = [
    { p: "website", label: "Company domain name", value: c.website && <a href={web(c.website)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-600 hover:underline">{c.website.replace(/^https?:\/\//, "")}<ExternalLink className="h-3 w-3" /></a> },
    { p: "industry", label: "Industry", value: c.industry },
    { p: "owner", label: "Company owner", value: data.owner },
    { p: "csm", label: "Customer success owner", value: data.csm },
    { p: "lifecycle", label: "Lifecycle stage", value: LIFECYCLE[c.lifecycle] },
    { p: "leadStatus", label: "Lead status", value: leadStatusLabel(c.leadStatus) },
    { p: "segment", label: "Type / segment", value: c.segment },
    { p: "tier", label: "Customer tier (sets SLA)", value: c.tier },
    { p: "phone", label: "Phone number", value: c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-accent-600 hover:underline">{c.phone}</a> },
    { p: "city", label: "City", value: c.city },
    { p: "region", label: "State/Region", value: c.region },
    { p: "postalCode", label: "Postal code", value: c.postalCode },
    { p: "address", label: "Street address", value: c.address },
    { p: "employees", label: "Number of employees", value: c.employees?.toLocaleString("en-US") },
    { p: "annualRevenue", label: "Annual revenue", value: c.annualRevenue != null ? money(c.annualRevenue, "NGN", false) : null },
    { p: "timeZone", label: "Time zone", value: c.timeZone },
    { p: "notes", label: "Description", value: c.notes && <span className="whitespace-pre-line">{c.notes}</span> },
    { p: "linkedinUrl", label: "LinkedIn company page", value: c.linkedinUrl && <a href={web(c.linkedinUrl)} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-600 hover:underline">Open page</a> },
    { p: null, label: "Record source", value: c.recordSource },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
      <aside className="space-y-4">
        <section className="z-10 rounded-xl border border-slate-200 bg-white lg:sticky lg:top-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <Link href="/companies" className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm font-semibold hover:bg-slate-100"><ChevronLeft className="h-4 w-4" />Companies</Link>
            <Menu label="Actions" align="right">
              {(close) => <>
                <MenuItem onClick={() => { close(); copy(window.location.href.split("?")[0], "Link to this company"); }}><Link2 className="h-4 w-4" />Copy link</MenuItem>
                <MenuItem onClick={() => { close(); router.push(`/companies/${c.id}/360`); }}><LayoutDashboard className="h-4 w-4" />Open Customer 360</MenuItem>
                <MenuItem onClick={() => { close(); setDialog("history"); }}><History className="h-4 w-4" />View property history</MenuItem>
                <MenuItem onClick={() => { close(); toast({ tone: "info", text: "Merging companies is coming later. Use “Find duplicates” on the Companies list to spot them." }); }} hint="Coming later">Merge</MenuItem>
                {ctx.perms.delete && <MenuItem danger onClick={() => { close(); setDialog("delete"); }}><Trash2 className="h-4 w-4" />Delete</MenuItem>}
              </>}
            </Menu>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 ring-1 ring-slate-200"><Building2 className="h-5 w-5 text-slate-500" aria-hidden /></span>
              <div className="min-w-0"><h1 className="truncate text-xl font-semibold text-ink-950" title={c.name}>{c.name}</h1>
                {ctx.perms.edit && <button onClick={(e) => setEdit({ p: "name", el: e.currentTarget })} className="text-xs font-medium text-brand-700 hover:underline">Edit name</button>}</div>
            </div>
            <div className="mt-4 grid grid-cols-6 gap-1 text-center text-xs">
              {([["note", StickyNote], ["email", Mail], ["call", Phone], ["task", ListChecks], ["meeting", Calendar]] as const).map(([k, Icon]) => (
                <button key={k} onClick={() => compose(k)} className="flex flex-col items-center gap-1 rounded-lg py-1 hover:bg-slate-50" title={KIND_META[k].title}>
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-300"><Icon className="h-4 w-4" aria-hidden /></span><span className="truncate">{KIND_META[k].label}</span>
                </button>
              ))}
              <Menu icon={<span className="flex flex-col items-center gap-1"><span className="grid h-10 w-10 place-items-center rounded-full border border-slate-300"><MoreHorizontal className="h-4 w-4" /></span><span className="text-xs">More</span></span>} ariaLabel="More activity types" align="right">
                {(close) => (["schedule", "whatsapp", "sms", "linkedin", "postal"] as CKind[]).map((k) => { const M = KIND_META[k]; return <MenuItem key={k} onClick={() => { close(); compose(k); }}><M.Icon className="h-4 w-4" />{M.title}</MenuItem>; })}
              </Menu>
            </div>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between px-3 py-2">
            <button onClick={() => setAboutOpen(!aboutOpen)} aria-expanded={aboutOpen} className="inline-flex items-center gap-1 rounded-lg px-1 py-1 font-semibold"><ChevronDown className={clsx("h-4 w-4 transition", !aboutOpen && "-rotate-90")} />About this company</button>
            <Menu label="Actions" align="right">
              {(close) => <>
                <MenuItem onClick={() => { close(); setDialog("history"); }}><History className="h-4 w-4" />View property history</MenuItem>
                <MenuItem onClick={() => { close(); copy([`Company: ${c.name}`, `Domain: ${c.website ?? ""}`, `Phone: ${c.phone ?? ""}`, `Industry: ${c.industry ?? ""}`, `City: ${c.city ?? ""}`, `Owner: ${data.owner ?? ""}`].join("\n"), "Company details"); }}><Copy className="h-4 w-4" />Copy details</MenuItem>
                <MenuItem onClick={() => { close(); router.push(`/companies/${c.id}/360?tab=overview`); }}>Billing & custom fields (Customer 360)</MenuItem>
              </>}
            </Menu>
          </div>
          {aboutOpen && <dl className="px-3 pb-3">
            {props.map(({ p, label, value }) => (
              <div key={label} className="group rounded-lg px-2 py-2 hover:bg-slate-50">
                <dt className="flex items-center justify-between text-sm text-slate-600">{label}
                  {p && ctx.perms.edit ? <button onClick={(e) => setEdit({ p, el: e.currentTarget })} className="rounded px-1.5 text-xs font-medium text-brand-700 opacity-0 hover:bg-slate-200 focus:opacity-100 group-hover:opacity-100" aria-label={`Edit ${label}`}>Edit</button>
                    : !p && <span className="flex gap-1 opacity-0 group-hover:opacity-100"><button onClick={() => setDialog("history")} className="rounded p-0.5 hover:bg-slate-200" aria-label="Property history" title="Property history"><History className="h-3.5 w-3.5" /></button>
                      <button onClick={() => copy(String(c.recordSource), "Record source")} className="rounded p-0.5 hover:bg-slate-200" aria-label="Copy value" title="Copy"><Copy className="h-3.5 w-3.5" /></button></span>}</dt>
                <dd className="mt-0.5 break-words text-sm">{value ?? <span className="text-slate-400">--</span>}</dd>
              </div>
            ))}
          </dl>}
        </section>
      </aside>

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
              {[["Create date", dateTime(c.createdAt, ctx.tz)], ["Lifecycle stage", LIFECYCLE[c.lifecycle]], ["Last activity date", data.lastActivityAt ? `${dateTime(data.lastActivityAt, ctx.tz, false)} (${ago(data.lastActivityAt, ctx.today)})` : null],
                [data.health ? "Customer health" : "Open deals", data.health ? `${data.health.score}/100 · ${data.health.status.replace(/_/g, " ")}` : String(data.deals.filter((d) => !d.isWon && !d.isLost).length)]].map(([l, v]) => (
                <div key={l}><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{l}</p><p className="mt-1 text-sm capitalize">{v ?? "--"}</p></div>
              ))}
            </div>
          </Card>
          {items.some((i) => i.pinned) && <Card title="Pinned activity"><ActivityFeed items={items.filter((i) => i.pinned)} ctx={ctx} onCompose={compose} onPin={(id, p) => run(() => pinActivityAction(id, p))} onTask={(id, cancel) => run(() => completeContactTaskAction(id, cancel))} showTypeFilter={false} /></Card>}
          <Card title="Recent activities"><ActivityFeed items={items.filter((i) => !i.upcoming)} ctx={ctx} onCompose={compose} onPin={(id, p) => run(() => pinActivityAction(id, p))} onTask={(id, cancel) => run(() => completeContactTaskAction(id, cancel))} limit={8} onMore={() => setTab("activities")} /></Card>
          <section id="contacts"><ContactsTable data={data} ctx={ctx} onAdd={() => setDialog("contact")} /></section>
          <Card title={`Deals (${data.deals.length})`} actions={ctx.perms.dealsEdit && <Link href={`/deals?tab=all&q=${encodeURIComponent(c.name)}`} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />Add on Deals board</Link>}>
            <div id="deals">{data.deals.length ? <DealCards deals={data.deals} company={c.name} /> : <p className="text-sm text-slate-500">No deals with this company yet.</p>}</div>
          </Card>
          <Card title="Upcoming activities"><ActivityFeed upcoming items={items.filter((i) => i.upcoming).reverse()} ctx={ctx} onCompose={compose} onPin={(id, p) => run(() => pinActivityAction(id, p))} onTask={(id, cancel) => run(() => completeContactTaskAction(id, cancel))} /></Card>
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
        {tab === "intelligence" && <Intelligence data={data} ctx={ctx} onCompose={compose} onFix={(p, el) => setEdit({ p, el })} />}
      </div>

      <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Record summary</h2><span className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[11px] font-semibold text-accent-600" title="Built from this record's data using fixed rules — no AI, no data leaves the CRM.">Rule-based</span></div>
          <div className="rounded-xl border border-accent-400/40 p-3">
            <div className="mb-2 flex items-start justify-between gap-2 text-xs text-slate-500"><span>Generated {dateTime(generated, ctx.tz)}</span>
              <button onClick={() => { router.refresh(); setGenerated(new Date().toISOString()); toast({ tone: "info", text: "Summary regenerated from the latest data." }); }} aria-label="Regenerate summary" title="Regenerate" className="rounded p-1 hover:bg-slate-100"><RefreshCw className={clsx("h-4 w-4 text-accent-600", pending && "animate-spin")} /></button></div>
            <ul className="space-y-1.5 text-sm text-slate-800">{data.summary.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm"><Sparkles className="mr-1 inline h-3.5 w-3.5 text-accent-600" aria-hidden /><span className="font-semibold">Next best action: </span>{data.summary.next}</p>
            <div className="mt-2 flex gap-2"><button onClick={() => copy([...data.summary.lines, `Next: ${data.summary.next}`].join("\n"), "Summary")} className={btn("outline", "sm")}><Copy className="h-3.5 w-3.5" />Copy</button>
              <button onClick={() => setTab("intelligence")} className={btn("ghost", "sm")}>See intelligence<ChevronRight className="h-3.5 w-3.5" /></button></div>
          </div>
        </section>
        <Side data={data} ctx={ctx} onAddContact={() => setDialog("contact")} copy={copy} />
      </aside>

      {edit && (() => {
        const close = () => setEdit(null);
        const F = (w: number, node: React.ReactNode) => <Floating anchor={edit.el} onClose={close} width={w}>{node}</Floating>;
        const text = (label: string, key: Prop, value: string | null, extra?: { type?: string; validate?: (v: string) => string | null }) => F(340, <TextEditor label={label} value={value} type={extra?.type} validate={extra?.validate} busy={pending} onCancel={close} onSave={(v) => patch({ [key]: v })} />);
        const userOpts = users.map((u) => ({ value: u.id, label: u.id === ctx.me.id ? `${u.name} (you)` : u.name }));
        switch (edit.p) {
          case "name": return text("Company name", "name", c.name);
          case "website": return text("Company domain name", "website", c.website);
          case "industry": return text("Industry", "industry", c.industry);
          case "city": return text("City", "city", c.city);
          case "postalCode": return text("Postal code", "postalCode", c.postalCode);
          case "address": return text("Street address", "address", c.address);
          case "linkedinUrl": return text("LinkedIn company page", "linkedinUrl", c.linkedinUrl);
          case "employees": return text("Number of employees", "employees", c.employees?.toString() ?? null, { type: "number", validate: (v) => (/^\d+$/.test(v) ? null : "Whole numbers only.") });
          case "annualRevenue": return text("Annual revenue (NGN)", "annualRevenue", c.annualRevenue?.toString() ?? null, { validate: (v) => (/^[\d,.]+$/.test(v) ? null : "Numbers only.") });
          case "phone": return F(460, <PhoneEditor label="Phone number" value={c.phone} busy={pending} onCancel={close} onSave={(v) => patch({ phone: v })} />);
          case "notes": return F(420, <NotesEditor value={c.notes} onCancel={close} onSave={(v) => patch({ notes: v })} />);
          case "owner": return F(280, <PickList clearLabel="Unassign" value={c.ownerId} options={userOpts} busy={pending} onPick={(v) => patch({ ownerId: v })} />);
          case "csm": return F(280, <PickList clearLabel="No customer success owner" value={c.csmId} options={userOpts} busy={pending} onPick={(v) => patch({ csmId: v })} />);
          case "lifecycle": return F(260, <PickList value={c.lifecycle} options={Object.entries(LIFECYCLE).map(([value, label]) => ({ value, label }))} busy={pending} onPick={(v) => v && patch({ lifecycle: v })} />);
          case "leadStatus": return F(280, <PickList clearLabel="Clear lead status" value={c.leadStatus} options={CONTACT_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label }))} busy={pending} onPick={(v) => patch({ leadStatus: v })} />);
          case "segment": return F(260, <PickList value={c.segment} options={SEGMENTS.map((s) => ({ value: s, label: s }))} busy={pending} onPick={(v) => v && patch({ segment: v })} />);
          case "tier": return F(260, <PickList value={c.tier} options={TIERS.map((s) => ({ value: s, label: s }))} busy={pending} onPick={(v) => v && patch({ tier: v })} />);
          case "region": return F(280, <PickList clearLabel="Clear region" value={c.region} options={REGIONS.map((s) => ({ value: s, label: s }))} busy={pending} onPick={(v) => patch({ region: v })} />);
          case "timeZone": return F(280, <PickList allowNew clearLabel="Clear time zone" value={c.timeZone} options={TIME_ZONES.map((s) => ({ value: s, label: s }))} busy={pending} onPick={(v) => patch({ timeZone: v })} />);
        }
      })()}
      {composer && <ContactComposer kind={composer} users={users} ctx={ctx} onClose={() => setComposer(null)} onSwitch={setComposer} onDone={() => router.refresh()}
        contact={{ target: "company", id: c.id, name: c.name, email: null, phone: c.phone, whatsapp: c.phone, companyName: null }} />}
      {dialog === "history" && (
        <Dialog title="Property history" wide onClose={() => setDialog("")}>
          {!data.history.length ? <p className="text-sm text-slate-600">No changes recorded yet.</p> : (
            <ol className="space-y-2 text-sm">{data.history.map((h, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-2"><p className="text-xs text-slate-500">{dateTime(h.at, ctx.tz)} · {h.by ?? "System"} · {h.action.replace("company.", "").replace(/_/g, " ")}</p>
                {h.changes && <ul className="mt-1 space-y-0.5">{Object.entries(h.changes).map(([k, v]) => <li key={k}><span className="font-medium">{k}</span>: {String(v.from ?? "—")} → {String(v.to ?? "—")}</li>)}</ul>}
                {h.reason && <p className="mt-1 text-xs italic text-slate-600">Reason: {h.reason}</p>}</li>
            ))}</ol>
          )}
        </Dialog>
      )}
      {dialog === "delete" && <DeleteCompany name={c.name} pending={pending} onClose={() => setDialog("")} onConfirm={(reason) => run(() => deleteCompaniesAction([c.id], reason), () => { setDialog(""); router.push("/companies"); }, () => run(() => restoreCompaniesAction([c.id])))} />}
      {dialog === "contact" && (
        <Dialog title={`Add a contact to ${c.name}`} onClose={() => setDialog("")} footer={<Link href={`/contacts/new?company=${c.id}`} className={btn("primary")}><Plus className="h-4 w-4" />Create a new contact</Link>}>
          <p className="mb-2 text-sm text-slate-600">Link someone already in the CRM. Their company changes to {c.name}.</p>
          <PickList placeholder="Search contacts" value={null} busy={pending} options={contactOptions.map((x) => ({ value: x.id, label: x.name, hint: x.hint }))}
            onPick={(v) => { const x = contactOptions.find((o) => o.id === v); if (x) run(() => patchContactAction(x.id, { companyId: c.id }, x.updatedAt), () => setDialog("")); }} />
        </Dialog>
      )}
    </div>
  );
}

function ContactsTable({ data, ctx, onAdd }: { data: CompanyData; ctx: CCtx; onAdd: () => void }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [sort, setSort] = useState<"name" | "status">("name");
  const list = data.contacts.filter((p) => `${p.firstName} ${p.lastName} ${p.email ?? ""} ${p.jobTitle ?? ""}`.toLowerCase().includes(q.toLowerCase()) && (!role || p.contactRoles.includes(role)))
    .sort((a, b) => sort === "name" ? a.lastName.localeCompare(b.lastName) : (leadStatusLabel(a.leadStatus) ?? "~").localeCompare(leadStatusLabel(b.leadStatus) ?? "~"));
  return (
    <Card title={`Contacts (${data.contacts.length})`} actions={ctx.perms.edit && <button onClick={onAdd} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />Add</button>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search this company's contacts" className="w-full rounded-full border border-slate-300 py-1.5 pl-9 pr-3 text-sm" /></div>
        <Menu label={role ? CONTACT_ROLES.find((r) => r.key === role)?.label : "Filters"} variant="outline">
          {(close) => <><MenuItem onClick={() => { close(); setRole(""); }}>All buying roles</MenuItem>{CONTACT_ROLES.map((r) => <MenuItem key={r.key} onClick={() => { close(); setRole(r.key); }} hint={role === r.key ? "✓" : undefined}>{r.label}</MenuItem>)}</>}
        </Menu>
        <Menu label={`Sort: ${sort === "name" ? "Name" : "Lead status"}`} variant="outline">
          {(close) => <><MenuItem onClick={() => { close(); setSort("name"); }}>Name</MenuItem><MenuItem onClick={() => { close(); setSort("status"); }}>Lead status</MenuItem></>}
        </Menu>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700"><tr><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">Phone</th><th className="px-3 py-2 font-medium">Lead status</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2"><Link href={`/contacts/${p.id}`} className="font-semibold text-accent-600 hover:underline">{p.firstName} {p.lastName}</Link>{p.jobTitle && <p className="text-xs text-slate-500">{p.jobTitle}</p>}</td>
                <td className="px-3 py-2">{p.email ? <a href={`mailto:${p.email}`} className="text-accent-600 hover:underline">{p.email}</a> : <span className="text-slate-400">--</span>}</td>
                <td className="whitespace-nowrap px-3 py-2">{p.phone ? <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="text-accent-600 hover:underline">{p.phone}</a> : <span className="text-slate-400">--</span>}</td>
                <td className="px-3 py-2">{leadStatusLabel(p.leadStatus) ?? <span className="text-slate-400">--</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="px-3 py-6 text-center text-sm text-slate-500">{data.contacts.length ? "No contacts match." : "No contacts at this company yet."}</p>}
      </div>
    </Card>
  );
}

function Side({ data, ctx, onAddContact, copy }: { data: CompanyData; ctx: CCtx; onAddContact: () => void; copy: (t: string, w: string) => void }) {
  const documentsBox = <DocumentsBox docs={data.documents} companyId={data.c.id} perms={data.docPerms} />;
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const box = (key: string, title: string, add: React.ReactNode, body: React.ReactNode) => (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={() => setOpen({ ...open, [key]: !(open[key] ?? true) })} aria-expanded={open[key] ?? true} className="inline-flex items-center gap-1 font-semibold"><ChevronDown className={clsx("h-4 w-4 transition", !(open[key] ?? true) && "-rotate-90")} />{title}</button>{add}
      </div>
      {(open[key] ?? true) && <div className="px-4 pb-4 text-sm">{body}</div>}
    </section>
  );
  const addLink = (label: string, href?: string, onClick?: () => void) => href ? <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />{label}</Link>
    : <button onClick={onClick} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />{label}</button>;
  const upload = (file: File) => start(async () => {
    const fd = new FormData(); fd.set("file", file);
    const r = await uploadCompanyFileAction(data.c.id, null, fd);
    toast({ tone: r.ok ? "success" : "error", text: r.message ?? (r.ok ? "Uploaded." : "Upload failed."), detail: Object.values(r.fieldErrors ?? {}) });
    if (r.ok) router.refresh();
  });
  const primary = data.contacts.find((p) => p.contactRoles.includes("decision_maker")) ?? data.contacts[0];
  return (
    <div className="space-y-4">
      {box("contacts", `Contacts (${data.contacts.length})`, ctx.perms.edit && addLink("Add", undefined, onAddContact), <>
        {data.contacts.slice(0, 3).map((p) => (
          <article key={p.id} className="mb-2 rounded-lg border border-slate-200 p-3">
            <Link href={`/contacts/${p.id}`} className="flex items-center gap-1.5 font-semibold text-accent-600 hover:underline"><UserRound className="h-4 w-4" />{p.firstName} {p.lastName}</Link>
            <p className="text-xs text-slate-700">{data.c.name}</p>
            <p className="text-xs">Email: {p.email ? <a className="text-accent-600 hover:underline" href={`mailto:${p.email}`}>{p.email}</a> : "--"}</p>
            <p className="flex items-center gap-1 text-xs">Phone number: {p.phone ? <><a className="truncate text-accent-600 hover:underline" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a><button onClick={() => copy(p.phone!, "Phone number")} aria-label="Copy phone number" className="rounded p-0.5 hover:bg-slate-100"><Copy className="h-3 w-3" /></button></> : "--"}</p>
            {p.id === primary?.id && <span className="mt-1 inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold">{p.contactRoles.includes("decision_maker") ? "Decision-maker" : "Primary contact"}</span>}
          </article>
        ))}
        {!data.contacts.length && <p className="text-slate-500">See the people associated with this company here.</p>}
        {data.contacts.length > 0 && <Link href={`/contacts?tab=all&q=${encodeURIComponent(data.c.name)}`} className="inline-flex items-center gap-1 font-semibold text-accent-600 hover:underline">View all associated contacts<ExternalLink className="h-3.5 w-3.5" /></Link>}
      </>)}
      {box("deals", `Deals (${data.deals.length})`, ctx.perms.dealsEdit && addLink("Add", `/deals?tab=all&q=${encodeURIComponent(data.c.name)}`),
        data.deals.length ? <DealCards deals={data.deals.slice(0, 3)} company={data.c.name} /> : <p className="text-slate-500">No deals yet.</p>)}
      {box("tickets", `Tickets (${data.tickets.length})`, ctx.perms.tickets && addLink("Add", `/tickets/new?company=${data.c.id}`),
        data.tickets.length ? <ul className="space-y-2">{data.tickets.slice(0, 5).map((t) => <li key={t.id}>{t.canOpen ? <Link href={`/tickets/${t.id}`} className="font-medium text-brand-700 hover:underline">#{t.number} {t.subject}</Link> : <span>#{t.number} {t.subject}</span>}<p className="text-xs text-slate-500">{t.priority} · {t.status.replace(/_/g, " ")}</p></li>)}</ul>
          : <p className="text-slate-500">Track the customer requests for this company here.</p>)}
      {box("onboarding", `Onboarding (${data.projects.length})`, null,
        data.projects.length ? <ul className="space-y-2">{data.projects.map((p) => <li key={p.id}><Link href={`/onboarding/${p.id}`} className="font-medium text-brand-700 hover:underline"><Rocket className="mr-1 inline h-3.5 w-3.5" />{p.name}</Link><p className="text-xs text-slate-500">{p.stage.replace(/_/g, " ")} · risk {p.riskLevel}</p></li>)}</ul> : <p className="text-slate-500">No onboarding projects.</p>)}
      {box("training", `Training (${data.sessions.length})`, null,
        data.sessions.length ? <ul className="space-y-2">{data.sessions.slice(0, 5).map((s) => <li key={s.id}><Link href={`/training/sessions/${s.id}`} className="font-medium text-brand-700 hover:underline"><GraduationCap className="mr-1 inline h-3.5 w-3.5" />{s.title}</Link><p className="text-xs text-slate-500">{s.status} · {s.attended}/{s.participants} attended</p></li>)}</ul> : <p className="text-slate-500">No training sessions.</p>)}
      {box("renewals", `Renewals (${data.renewals.length})`, null,
        data.renewals.length ? <ul className="space-y-1">{data.renewals.map((r) => <li key={r.id} className="flex justify-between gap-2"><span>{r.date}</span><span className="text-xs text-slate-500">{money(r.amount, r.currency)} · {r.status.replace(/_/g, " ")}</span></li>)}</ul> : <p className="text-slate-500">No renewals scheduled.</p>)}
      {box("files", `Attachments (${data.files.length})`, ctx.perms.edit && <label className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-accent-600 hover:underline"><Plus className="h-4 w-4" />{busy ? "Uploading…" : "Add"}
        <input type="file" className="sr-only" disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label>,
        data.files.length ? <ul className="space-y-1.5">{data.files.slice(0, 6).map((f) => <li key={f.id}><a href={`/api/files/file/${f.id}`} className="font-medium text-brand-700 hover:underline">{f.restricted && <Lock className="mr-1 inline h-3 w-3" />}{f.filename}</a><p className="text-xs text-slate-500">{Math.max(1, Math.round(f.sizeBytes / 1024))} KB · {f.by ?? "—"}</p></li>)}
          {data.files.length > 6 && <li><Link href={`/companies/${data.c.id}/360?tab=files`} className="text-xs font-semibold text-accent-600 hover:underline">All {data.files.length} files</Link></li>}</ul>
          : <p className="text-slate-500">No files yet. PDF, images, Word, Excel or CSV up to 10 MB. Restricted contract uploads are on Customer 360.</p>)}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">Customer 360</h2>
        <p className="mb-2 text-sm text-slate-600">Billing status, custom fields, handovers, health breakdown and the full audit history.</p>
        <Link href={`/companies/${data.c.id}/360`} className={btn("outline", "sm")}><LayoutDashboard className="h-3.5 w-3.5" />Open Customer 360</Link>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">Playbooks</h2>
        <p className="mb-2 text-sm text-slate-600">Call scripts, objection handling and product guides live in the Knowledge Base.</p>
        <Link href="/kb" className={btn("outline", "sm")}>Open playbooks<ExternalLink className="h-3.5 w-3.5" /></Link>
      </section>
      {documentsBox}
    </div>
  );
}

function Intelligence({ data, ctx, onCompose, onFix }: { data: CompanyData; ctx: CCtx; onCompose: (k: CKind) => void; onFix: (p: Prop, el: HTMLElement) => void }) {
  const s = data.summary;
  const { c } = data;
  const fixes = ([!c.ownerId && ["owner", "Assign an owner"], !c.phone && ["phone", "Add a phone number"], !c.website && ["website", "Add the company domain"], !c.industry && ["industry", "Set the industry"],
    !c.city && ["city", "Add the city"], !c.employees && ["employees", "Record the number of employees"]].filter(Boolean) as [Prop, string][]);
  const tone = s.engagement >= 60 ? "bg-emerald-500" : s.engagement >= 30 ? "bg-amber-500" : "bg-red-500";
  const mix = ["call", "email", "meeting", "note", "whatsapp", "demo"].map((t) => ({ t, n: data.activities.filter((a) => a.type === t).length })).filter((x) => x.n);
  const maxN = Math.max(1, ...mix.map((x) => x.n));
  const roles = CONTACT_ROLES.map((r) => ({ ...r, who: data.contacts.filter((p) => p.contactRoles.includes(r.key)) }));
  return (
    <div className="space-y-4">
      <Card title="Firmographics">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[["Lifecycle stage", LIFECYCLE[c.lifecycle]], ["Industry", c.industry], ["Segment / tier", `${c.segment} · ${c.tier}`], ["Employees", c.employees?.toLocaleString("en-US")], ["Annual revenue", c.annualRevenue != null ? money(c.annualRevenue, "NGN") : null], ["City", c.city], ["State/Region", c.region], ["Time zone", c.timeZone]].map(([l, v]) => (
            <div key={l as string}><dt className="text-xs text-slate-500">{l}</dt><dd>{v || "--"}</dd></div>))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {[["LinkedIn", c.linkedinUrl ?? `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(c.name)}`], ["Google", `https://www.google.com/search?q=${encodeURIComponent(`"${c.name}" ${c.city ?? ""}`)}`], ["Google Maps", `https://www.google.com/maps/search/${encodeURIComponent(`${c.name} ${c.city ?? ""}`)}`]].map(([l, u]) => (
            <a key={l} href={u} target="_blank" rel="noopener noreferrer" className={btn("outline", "sm")}>{l}<ExternalLink className="h-3.5 w-3.5" /></a>))}
        </div>
        <p className="mt-2 text-xs text-slate-500">We don&apos;t buy third-party enrichment data; these links open in a new tab.</p>
      </Card>
      <Card title="Buying committee">
        <ul className="grid gap-2 sm:grid-cols-2">{roles.map((r) => <li key={r.key} className="flex items-start gap-2 text-sm">{r.who.length ? <Check className="mt-0.5 h-4 w-4 text-emerald-600" /> : <X className="mt-0.5 h-4 w-4 text-slate-400" />}
          <span><span className="font-medium">{r.label}: </span>{r.who.length ? r.who.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link href={`/contacts/${p.id}`} className="text-brand-700 hover:underline">{p.firstName} {p.lastName}</Link></span>) : <span className="text-slate-500">not identified</span>}</span></li>)}</ul>
      </Card>
      <Card title="Engagement">
        <div className="mb-1 flex items-end justify-between"><span className="text-3xl font-bold">{s.engagement}<span className="text-base font-normal text-slate-500">/100</span></span><span className="text-sm text-slate-600">{s.engagement >= 60 ? "Warm" : s.engagement >= 30 ? "Cooling" : "Cold"}</span></div>
        <div className="h-2 rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.engagement} aria-label="Engagement score"><div className={clsx("h-2 rounded-full", tone)} style={{ width: `${s.engagement}%` }} /></div>
        <p className="mt-2 text-xs text-slate-500">10 points per activity in the last 30 days (any contact), +20 for an open deal, +20 if touched in the last 2 weeks, +5 per contact (up to 20).</p>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">{[["Activities (30 days)", s.recent30], ["Days since last touch", s.daysSince ?? "—"], ["Open tickets", s.openTickets]].map(([l, v]) => <div key={l as string} className="rounded-lg bg-slate-50 p-2"><p className="text-xl font-bold">{v}</p><p className="text-xs text-slate-600">{l}</p></div>)}</div>
        {mix.length > 0 && <ul className="mt-4 space-y-2">{mix.map((x) => <li key={x.t} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-sm"><span className="capitalize">{x.t}</span><span className="h-2 rounded-full bg-slate-100"><span className="block h-2 rounded-full bg-accent-500" style={{ width: `${(x.n / maxN) * 100}%` }} /></span><span className="text-right tabular-nums">{x.n}</span></li>)}</ul>}
      </Card>
      {data.health && <Card title={`Customer health: ${data.health.score}/100`}>
        <ul className="space-y-2 text-sm">{data.health.components.map((h) => <li key={h.key}><div className="flex justify-between"><span className="font-medium">{h.label}</span><span className="tabular-nums">{h.score} · weight {h.weight}%</span></div><p className="text-xs text-slate-500">{h.detail}</p></li>)}</ul>
      </Card>}
      <Card title="Next best action">
        <p className="mb-3 text-sm">{s.next}</p>
        {ctx.perms.log && <div className="flex flex-wrap gap-2"><button className={btn("primary", "sm")} onClick={() => onCompose("call")}><Phone className="h-3.5 w-3.5" />Log a call</button><button className={btn("outline", "sm")} onClick={() => onCompose("task")}><ListChecks className="h-3.5 w-3.5" />Create task</button><button className={btn("outline", "sm")} onClick={() => onCompose("schedule")}><Calendar className="h-3.5 w-3.5" />Schedule meeting</button></div>}
      </Card>
      <Card title={`Data completeness (${6 - fixes.length}/6)`}>
        {fixes.length ? <ul className="space-y-1.5">{fixes.map(([p, l]) => <li key={p} className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><X className="h-4 w-4 text-red-500" />{l}</span>{ctx.perms.edit && <button className={btn("outline", "sm")} onClick={(e) => onFix(p, e.currentTarget)}>Fix</button>}</li>)}</ul>
          : <p className="flex items-center gap-2 text-sm text-emerald-700"><Check className="h-4 w-4" />All key details are filled in.</p>}
      </Card>
      <Card title="Support"><p className="text-sm text-slate-600"><LifeBuoy className="mr-1 inline h-4 w-4" />{data.tickets.length} tickets in total, {s.openTickets} open. <Link href={`/companies/${c.id}/360?tab=tickets`} className="font-medium text-brand-700 underline">See all on Customer 360</Link></p></Card>
    </div>
  );
}

function NotesEditor({ value, onSave, onCancel }: { value: string | null; onSave: (v: string | null) => void; onCancel: () => void }) {
  const [v, setV] = useState(value ?? "");
  return (
    <form className="space-y-2 p-4" onSubmit={(e) => { e.preventDefault(); onSave(v.trim() || null); }}>
      <Label htmlFor="co-desc">Description</Label>
      <textarea id="co-desc" autoFocus rows={6} value={v} onChange={(e) => setV(e.target.value)} className={field} placeholder="What they do, how they buy, anything the team should know" />
      <div className="flex gap-2"><button disabled={(v.trim() || null) === (value ?? null)} className={btn("primary", "sm")}>Save</button><button type="button" className={btn("outline", "sm")} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
function DeleteCompany({ name, pending, onClose, onConfirm }: { name: string; pending: boolean; onClose: () => void; onConfirm: (r: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog title={`Delete ${name}?`} onClose={onClose} footer={<><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("danger")} disabled={pending || !reason.trim()} onClick={() => onConfirm(reason)}>Delete</button></>}>
      <p className="mb-3 text-sm text-slate-600">The company is hidden from lists; its history is kept and you can undo right after.</p>
      <Label htmlFor="cod-r">Reason *</Label><textarea id="cod-r" autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
    </Dialog>
  );
}
