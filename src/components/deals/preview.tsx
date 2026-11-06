"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import clsx from "clsx";
import {
  Building2, Calendar, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Handshake, LifeBuoy, ListChecks, Loader2, Mail, MessageCircle, MoreHorizontal,
  Pencil, Phone, Search, StickyNote, Trash2, X,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, field, initials, Menu, MenuItem, money, shortDate } from "./kit";
import type { ComposerKind } from "./composers";
import type { WCtx, WStage, WUser } from "./workspace";
import { bulkDeleteAction, moveOneAction, patchDealAction, previewAction, restoreAction } from "@/app/actions/deals";
import { completeTaskAction } from "@/app/actions/crm";

type Preview = {
  deal: { id: string; name: string; amount: number | null; currency: string; expectedCloseDate: string | null; stageId: string; ownerId: string; nextStep: string | null; nextStepDue: string | null;
    forecastCategory: string; billingFrequency: string | null; contractReference: string | null; startDate: string | null; discountPct: number | null; discountStatus: string; createdAt: string;
    competitor: string | null; leadSource: string | null; version: string; companyId: string };
  stage: { id: string; name: string; isWon: boolean; isLost: boolean; probability: number };
  company: { id: string; name: string; city: string | null; segment: string; tier: string; phone: string | null; website: string | null };
  owner: { id: string; name: string };
  contacts: { id: string; firstName: string; lastName: string; jobTitle: string | null; email: string | null; phone: string | null; whatsapp: string | null; role: string | null }[];
  activities: { id: string; type: string; subject: string; body: string | null; outcome: string | null; occurredAt: string; scheduledFor: string | null; simulated: boolean; by: string | null }[];
  openTasks: { id: string; title: string; dueAt: string | null; priority: string; ownerName: string }[];
  tickets: { id: string; ref: string; subject: string; priority: string; status: string }[];
  lines: { name: string; quantity: number; unitPrice: number }[];
  handover: { id: string; status: string; completeness: number } | null;
  probability: number; lastContactedAt: string | null;
  wonReadiness: { key: string; label: string; ok: boolean }[];
  perms: { edit: boolean; reassign: boolean; delete: boolean; log: boolean; ticket: boolean };
};

const TYPE_ICON: Record<string, typeof Phone> = { call: Phone, email: Mail, meeting: Calendar, note: StickyNote, whatsapp: MessageCircle, demo: Handshake, proposal: ListChecks };
const fmtDT = (iso: string) => { const d = new Date(iso); return `${shortDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

function Section({ title, children, actions, defaultOpen = true, count }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; count?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-slate-200 px-4 py-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex flex-1 items-center gap-1.5 text-left text-sm font-semibold text-ink-950">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}{title}{count !== undefined && <span className="font-normal text-slate-500">({count})</span>}
        </button>
        {actions}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

/** Click-to-edit field. Saves through the server (validation + conflict detection) and reports the result. */
function Editable({ label, display, input, onSave, disabled }: { label: string; display: ReactNode; input: (ref: (v: string) => void, initial: string) => ReactNode; onSave: (v: string) => Promise<boolean>; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="group py-1.5">
      <p className="text-xs text-slate-500">{label}</p>
      {editing ? (
        <form className="mt-0.5 flex items-center gap-1" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const ok = await onSave(val); setBusy(false); if (ok) setEditing(false); }}>
          <div className="min-w-0 flex-1">{input(setVal, val)}</div>
          <button disabled={busy} className={btn("primary", "sm")} aria-label={`Save ${label}`}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>
          <button type="button" onClick={() => setEditing(false)} className={btn("ghost", "sm")} aria-label="Cancel"><X className="h-3.5 w-3.5" /></button>
        </form>
      ) : (
        <div className="flex items-center gap-1 text-sm text-slate-900">
          <span className="min-w-0 flex-1 break-words">{display}</span>
          {!disabled && <button onClick={() => setEditing(true)} aria-label={`Edit ${label}`} className="rounded p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-brand-600 focus:opacity-100 group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>}
        </div>
      )}
    </div>
  );
}

export function DealPreview({ id, stages, users, ctx, onClose, onCompose, onChanged, lossReasons }: {
  id: string; stages: WStage[]; users: WUser[]; ctx: WCtx; onClose: () => void; onCompose: (k: ComposerKind) => void; onChanged: () => void; lossReasons: string[];
}) {
  const toast = useToast();
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [actQ, setActQ] = useState("");
  const [actType, setActType] = useState("");
  const [lostPrompt, setLostPrompt] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();

  const load = () => start(async () => {
    const r = await previewAction(id);
    if (r.ok) { const p = r.data?.preview as Preview; setData(p); setVersion(p.deal.version); setError(null); }
    else setError(r.message ?? "Couldn't load this deal.");
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const save = async (patch: Record<string, unknown>, label: string) => {
    const r = await patchDealAction(id, patch, version);
    if (r.ok) { setVersion(String(r.data?.version)); toast({ tone: "success", text: `${label} updated.` }); load(); onChanged(); return true; }
    toast({ tone: "error", text: r.message ?? "Couldn't save.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean) });
    if (r.data?.stale) load();
    return false;
  };
  const move = (stageId: string, lossReason?: string) => start(async () => {
    const target = stages.find((s) => s.id === stageId)!;
    if (target.isLost && !lossReason) { setLostPrompt(stageId); return; }
    const r = await moveOneAction(id, stageId, version, lossReason ?? null);
    toast(r.ok ? { tone: "success", text: `Moved to ${target.name}. ${r.message ?? ""}` } : { tone: "error", text: r.message ?? "Couldn't move.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean) });
    setLostPrompt(null); load(); onChanged();
  });
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast({ tone: "success", text: `${what} copied.` }); } catch { toast({ tone: "info", text: `${what}: ${text}` }); } };
  const doneTask = (taskId: string, title: string) => start(async () => {
    const r = await completeTaskAction(taskId, null, new FormData());
    toast(r.ok ? { tone: "success", text: `Completed “${title}”.` } : { tone: "error", text: r.message ?? "Couldn't complete." });
    load(); onChanged();
  });
  const del = (reason: string) => start(async () => {
    const r = await bulkDeleteAction([id], reason);
    if (r.ok) { toast({ tone: "success", text: "Deal deleted.", action: { label: "Undo", run: async () => { const u = await restoreAction([id]); toast(u.ok ? { tone: "success", text: "Deal restored." } : { tone: "error", text: u.message ?? "Couldn't restore." }); onChanged(); } } }); onChanged(); onClose(); }
    else toast({ tone: "error", text: r.message ?? "Couldn't delete." });
  });

  const acts = data?.activities.filter((a) => (!actType || a.type === actType) && `${a.subject} ${a.body ?? ""} ${a.outcome ?? ""}`.toLowerCase().includes(actQ.toLowerCase())) ?? [];
  const nowIso = new Date().toISOString();
  const quick: [ComposerKind, typeof Phone, string][] = [["note", StickyNote, "Note"], ["email", Mail, "Email"], ["call", Phone, "Call"], ["task", ListChecks, "Task"], ["meeting", Calendar, "Meeting"]];

  return (
    <aside aria-label="Deal preview" className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-white shadow-2xl lg:static lg:inset-auto lg:z-auto lg:h-[calc(100vh-6.5rem)] lg:w-[25rem] lg:shrink-0 lg:rounded-2xl lg:border lg:border-slate-200 lg:sticky lg:top-[4.5rem]">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-semibold text-ink-950">Preview</h2>
        <button onClick={onClose} aria-label="Close preview" className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>
      {!data ? (
        <div className="grid flex-1 place-items-center p-6 text-sm text-slate-500">{error ? <div className="text-center"><p className="text-red-700">{error}</p><button onClick={load} className={clsx(btn("outline", "sm"), "mt-2")}>Retry</button></div> : <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />}</div>
      ) : (
        <div className="flex-1 overflow-y-auto" aria-busy={pending}>
          <div className="flex items-center justify-between px-4 py-2">
            <Link href={`/deals/${id}`} className="text-sm font-semibold text-brand-600 hover:underline">View full record</Link>
            <Menu label="Actions" align="right">
              {(close) => <>
                <Link href={`/deals/${id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"><ExternalLink className="h-4 w-4" /> Open full record</Link>
                <Link href={`/companies/${data.company.id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"><Building2 className="h-4 w-4" /> Open company</Link>
                <MenuItem onClick={() => { close(); copy(`${window.location.origin}/deals/${id}`, "Deal link"); }}><Copy className="h-4 w-4" /> Copy link to deal</MenuItem>
                {data.handover && <Link href={`/handovers/${data.handover.id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"><Handshake className="h-4 w-4" /> Open handover</Link>}
                {data.perms.delete && !data.stage.isWon && <MenuItem danger onClick={() => { close(); setDeleting(true); }}><Trash2 className="h-4 w-4" /> Delete deal</MenuItem>}
              </>}
            </Menu>
          </div>
          {deleting && (
            <form className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm" onSubmit={(e) => { e.preventDefault(); del(String(new FormData(e.currentTarget).get("reason"))); }}>
              <label htmlFor="pv-del" className="mb-1 block text-xs font-medium text-red-900">Reason for deleting (audit-logged)</label>
              <input id="pv-del" name="reason" required autoFocus className={field} />
              <div className="mt-2 flex gap-2"><button className={btn("danger", "sm")}>Delete</button><button type="button" onClick={() => setDeleting(false)} className={btn("ghost", "sm")}>Cancel</button></div>
            </form>
          )}

          <div className="flex items-start gap-3 px-4 pb-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600" aria-hidden><Handshake className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1">
              <Editable label="Deal name" disabled={!data.perms.edit} display={<span className="text-lg font-semibold">{data.deal.name}</span>}
                input={(set) => <input autoFocus defaultValue={data.deal.name} onChange={(e) => set(e.target.value)} className={field} aria-label="Deal name" />}
                onSave={(v) => (v.trim() ? save({ name: v.trim() }, "Name") : Promise.resolve(false))} />
              <Editable label="Amount" disabled={!data.perms.edit || data.stage.isWon} display={money(data.deal.amount, data.deal.currency, false)}
                input={(set) => <input autoFocus inputMode="decimal" defaultValue={data.deal.amount ?? ""} onChange={(e) => set(e.target.value)} className={field} aria-label="Amount" />}
                onSave={(v) => save({ amount: v ? Number(v.replace(/[, ]/g, "")) : null }, "Amount")} />
              <Editable label="Close date" disabled={!data.perms.edit || data.stage.isWon || data.stage.isLost} display={<span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden />{shortDate(data.deal.expectedCloseDate)}</span>}
                input={(set) => <input autoFocus type="date" defaultValue={data.deal.expectedCloseDate ?? ""} onChange={(e) => set(e.target.value)} className={field} aria-label="Close date" />}
                onSave={(v) => save({ expectedCloseDate: v || null }, "Close date")} />
              <div className="py-1.5"><p className="text-xs text-slate-500">Pipeline · stage ({data.probability}%)</p>
                {data.perms.edit && !data.stage.isWon ? (
                  <select aria-label="Deal stage" value={data.deal.stageId} onChange={(e) => move(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm">{stages.map((s) => <option key={s.id} value={s.id}>New business · {s.name}</option>)}</select>
                ) : <p className="text-sm">New business · {data.stage.name}</p>}
                {lostPrompt && (
                  <form className="mt-2 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); move(lostPrompt, String(new FormData(e.currentTarget).get("r"))); }}>
                    <label className="flex-1 text-xs font-medium text-slate-600">Loss reason<select name="r" className={field}>{lossReasons.map((r) => <option key={r}>{r}</option>)}</select></label>
                    <button className={btn("danger", "sm")}>Mark lost</button><button type="button" onClick={() => setLostPrompt(null)} className={btn("ghost", "sm")}>Cancel</button>
                  </form>
                )}
              </div>
            </div>
          </div>

          {data.perms.log && (
            <div className="flex justify-between gap-1 px-4 pb-4">
              {quick.map(([k, Icon, l]) => (
                <button key={k} onClick={() => onCompose(k)} className="group flex flex-1 flex-col items-center gap-1 text-xs text-slate-700">
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-300 group-hover:border-accent-500 group-hover:bg-accent-50 group-hover:text-accent-600"><Icon className="h-4 w-4" aria-hidden /></span>{l}
                </button>
              ))}
              <Menu icon={<span className="flex flex-col items-center gap-1 text-xs text-slate-700"><span className="grid h-10 w-10 place-items-center rounded-full border border-slate-300"><MoreHorizontal className="h-4 w-4" /></span>More</span>} ariaLabel="More actions" align="right">
                {(close) => <>
                  <MenuItem onClick={() => { close(); onCompose("whatsapp"); }}><MessageCircle className="h-4 w-4" /> Log WhatsApp</MenuItem>
                  {data.perms.ticket && <Link href={`/tickets/new?company=${data.company.id}`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"><LifeBuoy className="h-4 w-4" /> Create ticket</Link>}
                  <MenuItem onClick={() => { close(); copy(data.deal.name, "Deal name"); }}><Copy className="h-4 w-4" /> Copy deal name</MenuItem>
                </>}
              </Menu>
            </div>
          )}

          {!data.stage.isWon && !data.stage.isLost && (() => {
            const missing = data.wonReadiness.filter((r) => !r.ok);
            return (
              <Section title={missing.length ? `Ready for Closed Won? ${data.wonReadiness.length - missing.length}/${data.wonReadiness.length}` : "Ready for Closed Won ✓"} defaultOpen>
                <ul className="space-y-1 text-sm">
                  {data.wonReadiness.map((r) => (
                    <li key={r.key} className={clsx("flex items-center gap-2", r.ok ? "text-emerald-800" : "text-red-700")}>
                      <span aria-hidden>{r.ok ? "✓" : "✗"}</span>
                      {r.ok ? r.label : <Link href={`/deals/${id}${r.key === "products" ? "#products" : "#deal-details"}`} className="underline">{r.label}</Link>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">{missing.length ? <>Fill in the missing items on the <Link href={`/deals/${id}#deal-details`} className="font-medium text-brand-700 underline">full deal page</Link> (Billing frequency can also be set below), then drag the deal to Closed Won.</> : "Everything's in place. Drag the deal to Closed Won, or use Move on the deal page."}</p>
              </Section>
            );
          })()}
          <Section title="About this deal">
            <div className="divide-y divide-slate-100">
              {data.perms.reassign ? (
                <div className="py-1.5"><label htmlFor="pv-owner" className="text-xs text-slate-500">Deal owner</label>
                  <select id="pv-owner" value={data.deal.ownerId} onChange={(e) => save({ ownerId: e.target.value }, "Owner")} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm">{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              ) : <div className="py-1.5"><p className="text-xs text-slate-500">Deal owner</p><p className="text-sm">{data.owner.name}</p></div>}
              <div className="py-1.5"><p className="text-xs text-slate-500">Last contacted</p><p className="text-sm">{data.lastContactedAt ? fmtDT(data.lastContactedAt) : "Never"}</p></div>
              <Editable label="Next step" disabled={!data.perms.edit || data.stage.isWon || data.stage.isLost} display={<>{data.deal.nextStep ?? "—"}{data.deal.nextStepDue && <span className={clsx("ml-1 text-xs", data.deal.nextStepDue < ctx.today ? "font-medium text-red-700" : "text-slate-500")}>· due {shortDate(data.deal.nextStepDue)}</span>}</>}
                input={(set) => <input autoFocus defaultValue={data.deal.nextStep ?? ""} onChange={(e) => set(e.target.value)} className={field} aria-label="Next step" />}
                onSave={(v) => save({ nextStep: v || null }, "Next step")} />
              <Editable label="Next step due" disabled={!data.perms.edit || data.stage.isWon || data.stage.isLost} display={shortDate(data.deal.nextStepDue)}
                input={(set) => <input autoFocus type="date" defaultValue={data.deal.nextStepDue ?? ""} onChange={(e) => set(e.target.value)} className={field} aria-label="Next step due" />}
                onSave={(v) => save({ nextStepDue: v || null }, "Next step due date")} />
              <div className="py-1.5"><label htmlFor="pv-fc" className="text-xs text-slate-500">Forecast category</label>
                <select id="pv-fc" disabled={!data.perms.edit || data.stage.isWon || data.stage.isLost} value={data.deal.forecastCategory} onChange={(e) => save({ forecastCategory: e.target.value }, "Forecast category")} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-50">
                  {[["pipeline", "Pipeline"], ["best_case", "Best case"], ["commit", "Commit"], ["closed", "Closed"], ["omitted", "Omitted"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="py-1.5"><label htmlFor="pv-bf" className="text-xs text-slate-500">Billing frequency</label>
                <select id="pv-bf" disabled={!data.perms.edit || data.stage.isWon} value={data.deal.billingFrequency ?? ""} onChange={(e) => save({ billingFrequency: e.target.value || null }, "Billing frequency")} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm disabled:bg-slate-50">
                  <option value="">—</option>{["One-off", "Monthly", "Quarterly", "Annually", "Multi-year"].map((b) => <option key={b}>{b}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-2 py-1.5 text-sm">
                <div><p className="text-xs text-slate-500">Deal type / source</p><p>{data.deal.leadSource ?? "New business"}</p></div>
                <div><p className="text-xs text-slate-500">Created</p><p>{shortDate(data.deal.createdAt)}</p></div>
                <div><p className="text-xs text-slate-500">Discount</p><p>{data.deal.discountPct ? `${data.deal.discountPct}% (${data.deal.discountStatus})` : "None"}</p></div>
                <div><p className="text-xs text-slate-500">Contract ref.</p><p className="truncate">{data.deal.contractReference ?? "—"}</p></div>
              </div>
            </div>
          </Section>

          <Section title="Recent activities" count={data.activities.length} actions={data.perms.log ? (
            <Menu label="Add" align="right">{(close) => (["note", "email", "call", "meeting", "whatsapp"] as ComposerKind[]).map((k) => <MenuItem key={k} onClick={() => { close(); onCompose(k); }}>{k === "whatsapp" ? "WhatsApp" : k[0].toUpperCase() + k.slice(1)}</MenuItem>)}</Menu>
          ) : undefined}>
            <div className="mb-2 flex gap-2">
              <div className="relative flex-1"><Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-slate-400" aria-hidden /><input value={actQ} onChange={(e) => setActQ(e.target.value)} placeholder="Search activities" aria-label="Search activities" className="w-full rounded-full border border-slate-300 py-1.5 pl-7 pr-2 text-sm" /></div>
              <select value={actType} onChange={(e) => setActType(e.target.value)} aria-label="Activity type" className="rounded-full border border-slate-300 bg-white px-2 text-sm"><option value="">All types</option>{["call", "email", "meeting", "note", "whatsapp", "demo", "proposal"].map((t) => <option key={t} value={t}>{t}</option>)}</select>
            </div>
            {acts.length === 0 ? <p className="py-3 text-center text-sm text-slate-500">{data.activities.length ? "No activities match." : "No activity yet — log a call, email or note above."}</p> : (
              <ol className="space-y-2">
                {acts.slice(0, 15).map((a) => {
                  const Icon = TYPE_ICON[a.type] ?? StickyNote;
                  const upcoming = a.scheduledFor && a.scheduledFor > nowIso;
                  return (
                    <li key={a.id} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="flex items-start gap-2"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden />
                        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{a.subject}{upcoming && <span className="ml-1 rounded bg-emerald-50 px-1 text-[11px] text-emerald-800">Upcoming</span>}{a.simulated && <span className="ml-1 rounded bg-amber-50 px-1 text-[11px] text-amber-900">Simulated</span>}</p>
                          <p className="text-xs text-slate-500">{fmtDT(a.scheduledFor ?? a.occurredAt)}{a.by ? ` · ${a.by}` : ""}</p>
                          {(a.outcome || (a.body && a.body.trim() !== a.subject)) && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{[a.outcome, a.body?.trim() !== a.subject ? a.body : null].filter(Boolean).join(" — ")}</p>}</div></div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section title="Upcoming tasks" count={data.openTasks.length} actions={data.perms.log ? <button onClick={() => onCompose("task")} className={btn("ghost", "sm")}>+ Add</button> : undefined}>
            {data.openTasks.length === 0 ? <p className="text-sm text-amber-800">No upcoming tasks — schedule the next step so this deal doesn't go stale.</p> : (
              <ul className="space-y-1.5">{data.openTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <button onClick={() => doneTask(t.id, t.title)} aria-label={`Mark ${t.title} done`} className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-slate-400 hover:border-emerald-600 hover:bg-emerald-50"><Check className="h-3 w-3 opacity-0 hover:opacity-100" /></button>
                  <span className="min-w-0 flex-1"><span className="block truncate">{t.title}</span><span className={clsx("text-xs", t.dueAt && t.dueAt < nowIso ? "text-red-700" : "text-slate-500")}>{t.dueAt ? fmtDT(t.dueAt) : "No due date"} · {t.ownerName}</span></span>
                </li>
              ))}</ul>
            )}
          </Section>

          <Section title="Contacts" count={data.contacts.length}>
            {data.contacts.length === 0 ? <p className="text-sm text-slate-500">No contacts linked. <Link className="text-brand-600 underline" href={`/contacts/new?company=${data.company.id}`}>Add one</Link></p> : (
              <ul className="space-y-2">{data.contacts.map((c) => (
                <li key={c.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold" aria-hidden>{initials(`${c.firstName} ${c.lastName}`)}</span>
                    <Link href={`/contacts/${c.id}`} className="font-semibold text-brand-600 hover:underline">{c.firstName} {c.lastName}</Link>{c.role && <span className="text-xs text-slate-500">{c.role}</span>}</div>
                  {c.jobTitle && <p className="mt-1 text-sm text-slate-600">{c.jobTitle}</p>}
                  <p className="mt-1 flex items-center gap-1 text-sm">Email: {c.email ? <><a className="text-brand-600 hover:underline" href={`mailto:${c.email}`}>{c.email}</a><button onClick={() => copy(c.email!, "Email")} aria-label="Copy email" className="rounded p-0.5 text-slate-400 hover:text-brand-600"><Copy className="h-3.5 w-3.5" /></button></> : "—"}</p>
                  <p className="flex items-center gap-1 text-sm">Phone: {c.phone ? <><a className="text-brand-600 hover:underline" href={`tel:${c.phone.replace(/\s/g, "")}`}>{c.phone}</a><button onClick={() => copy(c.phone!, "Phone number")} aria-label="Copy phone" className="rounded p-0.5 text-slate-400 hover:text-brand-600"><Copy className="h-3.5 w-3.5" /></button></> : "—"}</p>
                </li>
              ))}</ul>
            )}
          </Section>

          <Section title="Company" count={1}>
            <Link href={`/companies/${data.company.id}`} className="font-semibold text-brand-600 hover:underline">{data.company.name}</Link>
            <p className="text-sm text-slate-600">{[data.company.city, data.company.segment, data.company.tier].filter(Boolean).join(" · ")}</p>
            {data.company.phone && <p className="text-sm">Phone: <a className="text-brand-600 hover:underline" href={`tel:${data.company.phone.replace(/\s/g, "")}`}>{data.company.phone}</a></p>}
          </Section>

          <Section title="Open tickets" count={data.tickets.length} defaultOpen={data.tickets.length > 0} actions={data.perms.ticket ? <Link href={`/tickets/new?company=${data.company.id}`} className={btn("ghost", "sm")}>+ Add</Link> : undefined}>
            {data.tickets.length === 0 ? <p className="text-sm text-slate-500">No open tickets for this customer.</p> : <ul className="space-y-1 text-sm">{data.tickets.map((t) => <li key={t.id}><Link className="text-brand-600 hover:underline" href={`/tickets/${t.id}`}>{t.ref} {t.subject}</Link> <span className="text-xs text-slate-500">{t.priority} · {t.status.replace(/_/g, " ")}</span></li>)}</ul>}
          </Section>

          <Section title="Products" count={data.lines.length} defaultOpen={false}>
            {data.lines.length === 0 ? <p className="text-sm text-slate-500">No products on this deal.</p> : <ul className="space-y-1 text-sm">{data.lines.map((l, i) => <li key={i} className="flex justify-between gap-2"><span>{l.quantity} × {l.name}</span><span className="tabular-nums">{money(l.unitPrice * l.quantity, data.deal.currency, false)}</span></li>)}</ul>}
          </Section>

          {data.handover && (
            <Section title="Handover" defaultOpen>
              <Link href={`/handovers/${data.handover.id}`} className="text-sm font-semibold text-brand-600 hover:underline">{data.handover.status}</Link>
              <p className="text-xs text-slate-500">{data.handover.completeness}% of required items complete</p>
            </Section>
          )}
        </div>
      )}
    </aside>
  );
}
