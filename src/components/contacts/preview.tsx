"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Calendar, ExternalLink, ListChecks, Loader2, Mail, MoreHorizontal, Phone, StickyNote, X } from "lucide-react";
import { Menu, MenuItem, money } from "../deals/kit";
import { CONTACT_LEAD_STATUSES, LIFECYCLE_STAGES, leadStatusLabel, lifecycleLabel } from "@/lib/rules/contacts";
import { contactPreviewAction } from "@/app/actions/contacts";
import { ago, Avatar, type CCtx, type CUser, dateTime, Floating, fullName, PhoneEditor, PickList, TextEditor, validEmail, type WContact } from "./kit";
import { KIND_META, type CKind } from "./composer";

type P = {
  activities: { id: string; type: string; subject: string; occurredAt: string; scheduledFor: string | null; by: string | null }[];
  tasks: { id: string; title: string; dueAt: string | null; ownerName: string }[];
  deals: { id: string; name: string; stage: string; amount: number | null; currency: string }[] | null;
  summary: { lines: string[]; next: string; missing: string[] };
};
type Field = "email" | "phone" | "leadStatus" | "lifecycle" | "owner" | "referral" | "company";

/** Slide-over quick view: key facts, inline edits, quick actions and recent activity without leaving the list. */
export function ContactPreview({ contact: c, users, ctx, sources, companies, onClose, onCompose, onPatch }: {
  contact: WContact; users: CUser[]; ctx: CCtx; sources: string[]; companies: { id: string; name: string }[];
  onClose: () => void; onCompose: (k: CKind) => void; onPatch: (p: Record<string, string | null>, optimistic: Partial<WContact>) => void;
}) {
  const [data, setData] = useState<P | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ f: Field; el: HTMLElement } | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    contactPreviewAction(c.id).then((r) => { if (!live) return; if (r.ok) setData(r.data as P); else setErr(r.message ?? "Couldn't load this contact."); });
    return () => { live = false; };
  }, [c.id, c.updatedAt]);
  useEffect(() => { panel.current?.focus(); }, []);
  const save = (p: Record<string, string | null>, o: Partial<WContact>) => { setEdit(null); onPatch(p, o); };
  const row = (f: Field, label: string, value: React.ReactNode) => (
    <div className="group rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{value ?? <span className="text-slate-400">--</span>}</span>
        {ctx.perms.edit && <button onClick={(e) => setEdit({ f, el: e.currentTarget })} className="shrink-0 rounded px-1.5 text-xs font-medium text-brand-700 opacity-0 hover:bg-slate-100 focus:opacity-100 group-hover:opacity-100" aria-label={`Edit ${label}`}>Edit</button>}
      </dd>
    </div>
  );
  return (
    <aside ref={panel} tabIndex={-1} aria-label={`Quick view: ${fullName(c)}`} className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl focus:outline-none">
      <header className="flex items-start gap-3 border-b border-slate-200 p-4">
        <Avatar name={fullName(c)} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-ink-950">{fullName(c)}</h2>
          <p className="truncate text-sm text-slate-600">{[c.jobTitle, c.companyName].filter(Boolean).join(" · ") || "No company yet"}</p>
          <Link href={`/contacts/${c.id}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Open full record<ExternalLink className="h-3.5 w-3.5" /></Link>
        </div>
        <button onClick={onClose} aria-label="Close quick view" className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {ctx.perms.log && (
          <div className="mb-4 grid grid-cols-6 gap-1 text-center text-xs">
            {([["note", StickyNote], ["email", Mail], ["call", Phone], ["task", ListChecks], ["meeting", Calendar]] as const).map(([k, Icon]) => (
              <button key={k} onClick={() => onCompose(k)} className="flex flex-col items-center gap-1 rounded-lg py-1.5 hover:bg-slate-50">
                <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-300"><Icon className="h-4 w-4" aria-hidden /></span>{KIND_META[k].label}
              </button>
            ))}
            <Menu icon={<span className="flex flex-col items-center gap-1"><span className="grid h-9 w-9 place-items-center rounded-full border border-slate-300"><MoreHorizontal className="h-4 w-4" /></span><span className="text-xs">More</span></span>} ariaLabel="More activity types" align="right">
              {(close) => (["whatsapp", "sms", "linkedin", "postal"] as CKind[]).map((k) => { const M = KIND_META[k]; return <MenuItem key={k} onClick={() => { close(); onCompose(k); }}><M.Icon className="h-4 w-4" />{M.title}</MenuItem>; })}
            </Menu>
          </div>
        )}
        <dl className="mb-4 grid grid-cols-1 gap-0.5">
          {row("email", "Email", c.email && <a href={`mailto:${c.email}`} className="font-medium text-accent-600 hover:underline">{c.email}</a>)}
          {row("phone", "Phone number", c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="font-medium text-accent-600 hover:underline">{c.phone}</a>)}
          {row("company", "Company", c.companyId && <Link href={`/companies/${c.companyId}`} className="hover:underline">{c.companyName}</Link>)}
          {row("leadStatus", "Lead status", leadStatusLabel(c.leadStatus))}
          {row("lifecycle", "Lifecycle stage", lifecycleLabel(c.lifecycleStage))}
          {row("referral", "Referral source", c.referralSource)}
          {row("owner", "Contact owner", c.ownerName)}
          <div className="px-2 py-1.5"><dt className="text-xs text-slate-500">Created · last activity</dt><dd className="text-sm">{dateTime(c.createdAt, ctx.tz, false)} · {ago(c.lastActivityAt, ctx.today) ?? "no activity yet"}</dd></div>
        </dl>
        {err && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{err}</p>}
        {!data && !err && <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>}
        {data && <>
          <section className="mb-4 rounded-xl border border-accent-400/40 bg-accent-50/50 p-3">
            <h3 className="mb-1 text-sm font-semibold">Summary</h3>
            <ul className="space-y-1 text-sm text-slate-700">{data.summary.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-2 text-sm"><span className="font-semibold">Next: </span>{data.summary.next}</p>
            {data.summary.missing.length > 0 && <p className="mt-1 text-xs text-slate-600">Missing: {data.summary.missing.join(", ")}</p>}
          </section>
          <section className="mb-4"><h3 className="mb-1 text-sm font-semibold">Open tasks ({data.tasks.length})</h3>
            {data.tasks.length ? <ul className="space-y-1 text-sm">{data.tasks.map((t) => <li key={t.id} className="flex justify-between gap-2"><span className="truncate">{t.title}</span><span className="shrink-0 text-xs text-slate-500">{dateTime(t.dueAt, ctx.tz, false) ?? "no date"}</span></li>)}</ul>
              : <p className="text-sm text-slate-500">None. {ctx.perms.log && <button onClick={() => onCompose("task")} className="font-medium text-brand-700 underline">Create a task</button>}</p>}
          </section>
          {data.deals && <section className="mb-4"><h3 className="mb-1 text-sm font-semibold">Deals ({data.deals.length})</h3>
            {data.deals.length ? <ul className="space-y-1 text-sm">{data.deals.map((d) => <li key={d.id} className="flex justify-between gap-2"><Link href={`/deals?preview=${d.id}`} className="truncate text-brand-700 hover:underline">{d.name}</Link><span className="shrink-0 text-xs text-slate-500">{d.stage} · {money(d.amount, d.currency)}</span></li>)}</ul> : <p className="text-sm text-slate-500">No deals yet.</p>}
          </section>}
          <section><h3 className="mb-1 text-sm font-semibold">Recent activity</h3>
            {data.activities.length ? <ol className="space-y-2 border-l-2 border-slate-200 pl-3 text-sm">{data.activities.map((a) => (
              <li key={a.id}><p className="font-medium">{a.subject}</p><p className="text-xs text-slate-500">{KIND_META[a.type as CKind]?.label ?? a.type} · {dateTime(a.scheduledFor ?? a.occurredAt, ctx.tz)}{a.by ? ` · ${a.by}` : ""}</p></li>
            ))}</ol> : <p className="text-sm text-slate-500">Nothing logged yet.</p>}
          </section>
        </>}
      </div>
      {edit && (() => {
        const close = () => setEdit(null);
        switch (edit.f) {
          case "email": return <Floating anchor={edit.el} onClose={close} width={340} align="right"><TextEditor label="Email" type="email" value={c.email} validate={validEmail} onCancel={close} onSave={(v) => save({ email: v }, { email: v })} /></Floating>;
          case "phone": return <Floating anchor={edit.el} onClose={close} width={420} align="right"><PhoneEditor label="Phone number" value={c.phone} onCancel={close} onSave={(v) => save({ phone: v }, { phone: v })} /></Floating>;
          case "leadStatus": return <Floating anchor={edit.el} onClose={close} width={280} align="right"><PickList clearLabel="Clear lead status" value={c.leadStatus} options={CONTACT_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label }))} onPick={(v) => save({ leadStatus: v }, { leadStatus: v })} /></Floating>;
          case "lifecycle": return <Floating anchor={edit.el} onClose={close} width={280} align="right"><PickList value={c.lifecycleStage} options={LIFECYCLE_STAGES.map((s) => ({ value: s.key, label: s.label }))} onPick={(v) => v && save({ lifecycleStage: v }, { lifecycleStage: v })} /></Floating>;
          case "referral": return <Floating anchor={edit.el} onClose={close} width={280} align="right"><PickList allowNew clearLabel="Clear referral source" value={c.referralSource} options={sources.map((s) => ({ value: s, label: s }))} onPick={(v) => save({ referralSource: v }, { referralSource: v })} /></Floating>;
          case "owner": return <Floating anchor={edit.el} onClose={close} width={280} align="right"><PickList clearLabel="Unassign" value={c.ownerId} options={users.map((u) => ({ value: u.id, label: u.name }))} onPick={(v) => save({ ownerId: v }, { ownerId: v, ownerName: users.find((u) => u.id === v)?.name ?? null })} /></Floating>;
          case "company": return <Floating anchor={edit.el} onClose={close} width={320} align="right"><PickList placeholder="Search companies" clearLabel="Remove company" value={c.companyId} options={companies.map((x) => ({ value: x.id, label: x.name }))} onPick={(v) => save({ companyId: v }, { companyId: v, companyName: companies.find((x) => x.id === v)?.name ?? null })} /></Floating>;
        }
      })()}
    </aside>
  );
}
