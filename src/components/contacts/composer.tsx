"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import {
  Bold, Calendar, ChevronDown, ChevronUp, Italic, Link2, List, ListChecks, Loader2, Mail, Maximize2, MessageCircle, MessageSquare, Minimize2, Phone, Send, StickyNote, Underline, X,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, field, Label, Menu } from "../deals/kit";
import { CALL_OUTCOMES } from "@/lib/rules/contacts";
import { toLocalInput } from "@/lib/format";
import { contactTaskAction, logContactActivityAction } from "@/app/actions/contacts";
import { companyTaskAction, logCompanyActivityAction } from "@/app/actions/companies";
import type { CCtx, CUser } from "./kit";

export type CKind = "note" | "email" | "call" | "task" | "meeting" | "schedule" | "whatsapp" | "sms" | "linkedin" | "postal";
export type ComposerContact = { target?: "contact" | "company"; id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null; companyName: string | null };

export const KIND_META: Record<CKind, { label: string; title: string; Icon: typeof Phone }> = {
  note: { label: "Note", title: "Note", Icon: StickyNote }, email: { label: "Email", title: "Log email", Icon: Mail }, call: { label: "Call", title: "Log call", Icon: Phone },
  task: { label: "Task", title: "Task", Icon: ListChecks }, meeting: { label: "Meeting", title: "Log meeting", Icon: Calendar }, schedule: { label: "Schedule", title: "Schedule meeting", Icon: Calendar },
  whatsapp: { label: "WhatsApp", title: "Log WhatsApp message", Icon: MessageCircle }, sms: { label: "SMS", title: "Log SMS", Icon: MessageSquare },
  linkedin: { label: "LinkedIn", title: "Log LinkedIn message", Icon: Link2 }, postal: { label: "Postal mail", title: "Log postal mail", Icon: Send },
};

const p2 = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
function addBusinessDays(from: Date, n: number) { const d = new Date(from); let left = n; while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) left--; } return d; }
const fmtShort = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
const weekday = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d);
/** Due-date presets like a sales rep would say them, each showing the actual date. */
export function duePresets(now = new Date()) {
  const add = (days: number) => new Date(now.getTime() + days * 86400000);
  const month = (m: number) => { const d = new Date(now); d.setMonth(d.getMonth() + m); return d; };
  const list: [string, string, Date][] = [
    ["today", "Today", now], ["tomorrow", `Tomorrow (${weekday(add(1))})`, add(1)],
    ["2bd", `In 2 business days (${weekday(addBusinessDays(now, 2))})`, addBusinessDays(now, 2)], ["3bd", `In 3 business days (${weekday(addBusinessDays(now, 3))})`, addBusinessDays(now, 3)],
    ["1w", `In 1 week (${fmtShort(add(7))})`, add(7)], ["2w", `In 2 weeks (${fmtShort(add(14))})`, add(14)], ["1m", `In 1 month (${fmtShort(month(1))})`, month(1)], ["3m", `In 3 months (${fmtShort(month(3))})`, month(3)],
  ];
  return list;
}
const presetDate = (k: string) => duePresets().find((p) => p[0] === k)?.[2] ?? new Date();

function useRich() {
  const [text, setText] = useState("");
  const [el, setEl] = useState<HTMLTextAreaElement | null>(null);
  const wrap = (before: string, after = "") => {
    if (!el) { setText((t) => t + before + after); return; }
    const { selectionStart: s, selectionEnd: e } = el;
    setText((t) => t.slice(0, s) + before + t.slice(s, e) + after + t.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, e + before.length); });
  };
  return { text, setText, setEl, wrap };
}
function Editor({ r, placeholder, rows = 6, id }: { r: ReturnType<typeof useRich>; placeholder: string; rows?: number; id: string }) {
  return (
    <div className="rounded-lg border border-slate-200 focus-within:border-brand-500">
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <textarea id={id} ref={r.setEl} value={r.text} onChange={(e) => r.setText(e.target.value)} rows={rows} placeholder={placeholder} className="w-full resize-y rounded-t-lg border-0 px-3 py-2 text-sm focus:outline-none" />
      <div role="toolbar" aria-label="Formatting" className="flex gap-1 border-t border-slate-100 px-2 py-1 text-slate-600">
        <button type="button" onClick={() => r.wrap("**", "**")} className="rounded p-1 hover:bg-slate-100" aria-label="Bold"><Bold className="h-4 w-4" /></button>
        <button type="button" onClick={() => r.wrap("_", "_")} className="rounded p-1 hover:bg-slate-100" aria-label="Italic"><Italic className="h-4 w-4" /></button>
        <button type="button" onClick={() => r.wrap("<u>", "</u>")} className="rounded p-1 hover:bg-slate-100" aria-label="Underline"><Underline className="h-4 w-4" /></button>
        <button type="button" onClick={() => r.wrap("\n- ")} className="rounded p-1 hover:bg-slate-100" aria-label="Bullet list"><List className="h-4 w-4" /></button>
        <button type="button" onClick={() => { const url = prompt("Link address (https://…)"); if (url && /^https?:\/\//.test(url)) r.wrap("[", `](${url})`); }} className="rounded p-1 hover:bg-slate-100" aria-label="Insert link"><Link2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

type FU = { on: boolean; type: string; preset: string };
function FollowUp({ v, onChange }: { v: FU; onChange: (v: FU) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-sm">
      <input id="fu-on" type="checkbox" checked={v.on} onChange={(e) => onChange({ ...v, on: e.target.checked })} className="h-4 w-4" />
      <label htmlFor="fu-on">Create a</label>
      <select aria-label="Follow-up task type" value={v.type} onChange={(e) => onChange({ ...v, on: true, type: e.target.value })} className="rounded-md border-0 bg-transparent p-0 text-sm font-semibold text-brand-700">
        <option value="todo">To-do</option><option value="call">Call</option><option value="email">Email</option>
      </select>
      <span>task to follow up</span>
      <select aria-label="Follow-up due" value={v.preset} onChange={(e) => onChange({ ...v, on: true, preset: e.target.value })} className="rounded-md border-0 bg-transparent p-0 text-sm font-semibold text-brand-700">
        {duePresets().filter(([k]) => k !== "today").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  );
}
const fuFields = (f: FU, subject: string) => (f.on ? { followUpTitle: `${f.type === "call" ? "Call: " : f.type === "email" ? "Email: " : ""}Follow up: ${subject}`.slice(0, 280), followUpDue: `${key(presetDate(f.preset))}T09:00` } : {});

function Associated({ contact }: { contact: ComposerContact }) {
  const n = contact.companyName && contact.target !== "company" ? 2 : 1;
  return (
    <Menu label={`Associated with ${n} record${n === 1 ? "" : "s"}`}>
      {() => <div className="px-3 py-2 text-sm">
        <p className="text-xs font-semibold uppercase text-slate-500">{contact.target === "company" ? "Company" : "Contact"}</p><p className="mb-2">✓ {contact.name}</p>
        {contact.companyName && contact.target !== "company" && <><p className="text-xs font-semibold uppercase text-slate-500">Company</p><p>✓ {contact.companyName}</p></>}
        <p className="mt-2 text-xs text-slate-500">{contact.target === "company" ? "Tasks also appear on the Tasks page." : "It also shows on this contact's company timeline, and tasks appear on the Tasks page."}</p>
      </div>}
    </Menu>
  );
}

/** Floating composer for logging activity or creating a task on a contact. Minimise, expand, switch type; every submit reports back. */
export function ContactComposer({ kind, contact, users, ctx, onClose, onSwitch, onDone }: {
  kind: CKind; contact: ComposerContact; users: CUser[]; ctx: CCtx; onClose: () => void; onSwitch: (k: CKind) => void; onDone: () => void;
}) {
  const toast = useToast();
  const [min, setMin] = useState(false);
  const [max, setMax] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const meta = KIND_META[kind];
  const close = () => { if (dirty && !confirm("Discard this draft?")) return; onClose(); };
  const submit = (run: () => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string> }>) => start(async () => {
    const r = await run();
    if (r.ok) { toast({ tone: "success", text: r.message ?? "Saved." }); setDirty(false); onDone(); onClose(); }
    else toast({ tone: "error", text: r.message ?? "That didn't save.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean) });
  });
  const log = ({ contactId, ...v }: Parameters<typeof logContactActivityAction>[0]) =>
    submit(() => (contact.target === "company" ? logCompanyActivityAction({ ...v, companyId: contactId }) : logContactActivityAction({ ...v, contactId })));
  const now = toLocalInput(new Date(), ctx.tz);
  return (
    <div role="dialog" aria-label={`${meta.title} for ${contact.name}`} className={clsx("fixed z-50 flex flex-col overflow-hidden rounded-t-2xl border border-slate-300 bg-white shadow-2xl sm:rounded-2xl",
      max ? "inset-2 sm:inset-8" : "inset-x-0 bottom-0 max-h-[85vh] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[40rem]", min && "!top-auto h-auto")}>
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <button onClick={() => setMin(!min)} aria-label={min ? "Expand composer" : "Minimise composer"} className="rounded p-1 hover:bg-slate-200">{min ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        <h2 className="font-semibold text-ink-950">{meta.title}</h2>
        <div className="ml-auto flex items-center gap-0.5">
          <label htmlFor="kind-switch" className="sr-only">Switch type</label>
          <select id="kind-switch" value={kind} onChange={(e) => onSwitch(e.target.value as CKind)} className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs">
            {(Object.keys(KIND_META) as CKind[]).map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
          </select>
          <button onClick={() => setMax(!max)} aria-label={max ? "Restore size" : "Expand"} className="hidden rounded p-1 hover:bg-slate-200 sm:block">{max ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
          <button onClick={close} aria-label="Close composer" className="rounded p-1 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </div>
      </header>
      {!min && (
        <div className="flex-1 overflow-y-auto p-4" onChange={() => setDirty(true)}>
          {kind === "note" && <NoteForm contact={contact} pending={pending} onSubmit={(v) => log({ contactId: contact.id, type: "note", ...v })} />}
          {kind === "email" && <EmailForm contact={contact} now={now} pending={pending} onSubmit={(v) => log({ contactId: contact.id, type: "email", ...v })} />}
          {kind === "call" && <CallForm contact={contact} now={now} pending={pending} onSubmit={(v) => log({ contactId: contact.id, type: "call", ...v })} />}
          {(kind === "meeting" || kind === "schedule") && <MeetingForm key={kind} schedule={kind === "schedule"} contact={contact} now={now} pending={pending} onSubmit={(v) => log({ contactId: contact.id, type: "meeting", ...v })} />}
          {(kind === "whatsapp" || kind === "sms" || kind === "linkedin" || kind === "postal") && <MessageForm kind={kind} contact={contact} now={now} pending={pending} onSubmit={(v) => log({ contactId: contact.id, type: kind, ...v })} />}
          {kind === "task" && <TaskForm contact={contact} users={users} ctx={ctx} pending={pending} onSubmit={(v) => submit(() => (contact.target === "company" ? companyTaskAction({ companyId: contact.id, ...v }) : contactTaskAction({ contactId: contact.id, ...v })))} />}
        </div>
      )}
    </div>
  );
}

const For = ({ contact }: { contact: ComposerContact }) => <p className="mb-3 text-sm text-slate-600">For <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 font-medium text-slate-800">{contact.name}</span></p>;
const firstLine = (t: string, fallback: string) => t.trim().split("\n")[0].replace(/[*_#<>/u-]/g, "").trim().slice(0, 80) || fallback;

function Footer({ contact, fu, setFu, pending, disabled, label }: { contact: ComposerContact; fu?: FU; setFu?: (v: FU) => void; pending: boolean; disabled: boolean; label: string }) {
  return (
    <>
      <div className="border-t border-slate-100 pt-2"><Associated contact={contact} /></div>
      {fu && setFu && <FollowUp v={fu} onChange={setFu} />}
      <button disabled={pending || disabled} className={btn("primary")}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}</button>
    </>
  );
}

function NoteForm({ contact, pending, onSubmit }: { contact: ComposerContact; pending: boolean; onSubmit: (v: { subject: string; body: string; followUpTitle?: string; followUpDue?: string }) => void }) {
  const r = useRich();
  const [fu, setFu] = useState<FU>({ on: false, type: "todo", preset: "3bd" });
  const subject = firstLine(r.text, "Note");
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ subject, body: r.text.trim(), ...fuFields(fu, subject) }); }}>
      <For contact={contact} />
      <Editor r={r} id="cn-body" placeholder="Start typing to leave a note…" rows={7} />
      <Footer contact={contact} fu={fu} setFu={setFu} pending={pending} disabled={!r.text.trim()} label="Create note" />
    </form>
  );
}

function EmailForm({ contact, now, pending, onSubmit }: { contact: ComposerContact; now: string; pending: boolean; onSubmit: (v: { subject: string; body: string; at: string; outcome?: string; followUpTitle?: string; followUpDue?: string }) => void }) {
  const r = useRich();
  const [subject, setSubject] = useState("");
  const [at, setAt] = useState(now);
  const [fu, setFu] = useState<FU>({ on: false, type: "todo", preset: "3bd" });
  const [direction, setDirection] = useState("Sent");
  const mailto = contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(r.text)}` : null;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const s = subject.trim() || firstLine(r.text, "Email"); onSubmit({ subject: s, body: r.text.trim(), at, outcome: direction, ...fuFields(fu, s) }); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label>Contacted</Label><p className="text-sm font-semibold">{contact.name}</p><p className="truncate text-xs text-slate-500">{contact.email ?? "No email on file"}</p></div>
        <div><Label htmlFor="ce-dir">Direction</Label><select id="ce-dir" value={direction} onChange={(e) => setDirection(e.target.value)} className={field}><option>Sent</option><option>Received</option></select></div>
        <div><Label htmlFor="ce-at">Activity date</Label><input id="ce-at" type="datetime-local" value={at} max={now} onChange={(e) => setAt(e.target.value)} className={field} required /></div>
      </div>
      <div><Label htmlFor="ce-subj">Subject</Label><input id="ce-subj" value={subject} onChange={(e) => setSubject(e.target.value)} className={field} placeholder="What was it about?" /></div>
      <Editor r={r} id="ce-body" placeholder="Start typing to log an email…" />
      {mailto && <p className="text-xs text-slate-500">Need to write it first? <a href={mailto} className="font-medium text-brand-700 underline">Open in your mail app</a>, then log it here.</p>}
      <Footer contact={contact} fu={fu} setFu={setFu} pending={pending} disabled={!subject.trim() && !r.text.trim()} label="Log email" />
    </form>
  );
}

function CallForm({ contact, now, pending, onSubmit }: { contact: ComposerContact; now: string; pending: boolean; onSubmit: (v: { subject: string; body: string; at: string; outcome: string; durationMinutes?: number; followUpTitle?: string; followUpDue?: string }) => void }) {
  const r = useRich();
  const [outcome, setOutcome] = useState("");
  const [direction, setDirection] = useState("");
  const [at, setAt] = useState(now);
  const [mins, setMins] = useState("");
  const [fu, setFu] = useState<FU>({ on: false, type: "call", preset: "3bd" });
  const subject = `${direction || "Outbound"} call${outcome ? ` — ${outcome}` : ""}`;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ subject, body: r.text.trim(), at, outcome, durationMinutes: mins ? Number(mins) : undefined, ...fuFields(fu, contact.name) }); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label>Contacted</Label><p className="text-sm font-semibold">{contact.name}</p>{contact.phone ? <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="text-xs font-medium text-brand-700 underline">{contact.phone}</a> : <p className="text-xs text-slate-500">No phone on file</p>}</div>
        <div><Label htmlFor="cc-out">Call outcome</Label><select id="cc-out" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field} required><option value="">Select call outcome</option>{CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><Label htmlFor="cc-dir">Call direction</Label><select id="cc-dir" value={direction} onChange={(e) => setDirection(e.target.value)} className={field}><option value="">Select call direction</option><option>Inbound</option><option>Outbound</option></select></div>
        <div><Label htmlFor="cc-at">Activity date</Label><input id="cc-at" type="datetime-local" value={at} max={now} onChange={(e) => setAt(e.target.value)} className={field} required /></div>
        <div><Label htmlFor="cc-min">Duration (min)</Label><input id="cc-min" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value.replace(/\D/g, ""))} className={field} /></div>
      </div>
      <Editor r={r} id="cc-body" placeholder="Start typing to log a call…" rows={5} />
      <p className="text-xs text-slate-500">Logging a call updates an untouched contact&apos;s lead status (reached → Connected, otherwise Attempted to contact).</p>
      <Footer contact={contact} fu={fu} setFu={setFu} pending={pending} disabled={!outcome} label="Log call" />
    </form>
  );
}

function MeetingForm({ contact, now, pending, onSubmit, schedule }: { schedule?: boolean; contact: ComposerContact; now: string; pending: boolean; onSubmit: (v: { subject: string; body: string; at?: string; scheduledFor?: string; outcome?: string; durationMinutes: number; followUpTitle?: string; followUpDue?: string }) => void }) {
  const r = useRich();
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(schedule ? `${key(addBusinessDays(new Date(), 1))}T10:00` : now);
  const [mins, setMins] = useState(schedule ? "30" : "15");
  const [outcome, setOutcome] = useState(schedule ? "Scheduled" : "");
  const [fu, setFu] = useState<FU>({ on: false, type: "todo", preset: "1w" });
  const future = at > now;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const s = title.trim() || `Meeting with ${contact.name}`; onSubmit({ subject: s, body: r.text.trim(), ...(future ? { scheduledFor: at, outcome: "Scheduled" } : { at, outcome }), durationMinutes: Number(mins) || 30, ...fuFields(fu, s) }); }}>
      <For contact={contact} />
      <div><Label htmlFor="cm-t">Title</Label><input id="cm-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Meeting with ${contact.name}`} className={field} /></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="cm-at">Meeting start time</Label><input id="cm-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={field} required /></div>
        <div><Label htmlFor="cm-d">Duration</Label><select id="cm-d" value={mins} onChange={(e) => setMins(e.target.value)} className={field}>{["15", "30", "45", "60", "90", "120", "180"].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></div>
        <div><Label htmlFor="cm-o">Meeting outcome</Label><select id="cm-o" value={future ? "Scheduled" : outcome} disabled={future} onChange={(e) => setOutcome(e.target.value)} className={field} required>
          <option value="">Select meeting outcome</option>{["Scheduled", "Completed", "Rescheduled", "No show", "Canceled"].map((o) => <option key={o}>{o}</option>)}</select></div>
      </div>
      {future && <p className="rounded-lg bg-accent-50 p-2 text-xs text-accent-600">This date is in the future, so the meeting is scheduled and shows under Upcoming activities.</p>}
      <Editor r={r} id="cm-body" placeholder="Agenda or notes…" rows={4} />
      <Footer contact={contact} fu={fu} setFu={setFu} pending={pending} disabled={!future && !outcome} label={future ? "Schedule meeting" : "Log meeting"} />
    </form>
  );
}

function MessageForm({ kind, contact, now, pending, onSubmit }: { kind: "whatsapp" | "sms" | "linkedin" | "postal"; contact: ComposerContact; now: string; pending: boolean; onSubmit: (v: { subject: string; body: string; at: string; outcome: string; followUpTitle?: string; followUpDue?: string }) => void }) {
  const r = useRich();
  const [at, setAt] = useState(now);
  const [direction, setDirection] = useState("Outbound");
  const [fu, setFu] = useState<FU>({ on: false, type: "todo", preset: "3bd" });
  const label = KIND_META[kind].label;
  const num = (contact.whatsapp ?? contact.phone ?? "").replace(/\D/g, "");
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const s = `${label} ${direction.toLowerCase()} — ${contact.name}`; onSubmit({ subject: s, body: r.text.trim(), at, outcome: direction, ...fuFields(fu, s) }); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label>Contacted</Label><p className="text-sm font-semibold">{contact.name}</p></div>
        <div><Label htmlFor="cx-dir">Direction</Label><select id="cx-dir" value={direction} onChange={(e) => setDirection(e.target.value)} className={field}><option>Outbound</option><option>Inbound</option></select></div>
        <div><Label htmlFor="cx-at">Activity date</Label><input id="cx-at" type="datetime-local" value={at} max={now} onChange={(e) => setAt(e.target.value)} className={field} required /></div>
      </div>
      <Editor r={r} id="cx-body" placeholder={kind === "postal" ? "What was sent, and to which address?" : `Summarise the ${label} conversation…`} rows={5} />
      {kind === "whatsapp" && num && <a href={`https://wa.me/${num}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-700 underline">Open the WhatsApp chat on your device</a>}
      {kind === "sms" && num && <a href={`sms:+${num}`} className="text-xs font-medium text-brand-700 underline">Open your messages app</a>}
      <Footer contact={contact} fu={fu} setFu={setFu} pending={pending} disabled={!r.text.trim()} label={`Log ${label}`} />
    </form>
  );
}

function TaskForm({ contact, users, ctx, pending, onSubmit }: { contact: ComposerContact; users: CUser[]; ctx: CCtx; pending: boolean; onSubmit: (v: { title: string; type: string; dueAt: string; remindAt: string; priority: string; ownerId: string; description: string }) => void }) {
  const [title, setTitle] = useState("");
  const [preset, setPreset] = useState("3bd");
  const [custom, setCustom] = useState(ctx.today);
  const [time, setTime] = useState("08:00");
  const [reminder, setReminder] = useState("none");
  const [type, setType] = useState("todo");
  const [priority, setPriority] = useState("normal");
  const [owner, setOwner] = useState(ctx.me.id);
  const r = useRich();
  const day = preset === "custom" ? custom : key(presetDate(preset));
  const due = `${day}T${time}`;
  const remindAt = (() => {
    if (reminder === "none") return "";
    const base = new Date(`${day}T${time}:00`);
    const d = reminder === "at" ? base : reminder === "1h" ? new Date(base.getTime() - 3600000) : reminder === "1d" ? new Date(base.getTime() - 86400000) : new Date(`${day}T08:00:00`);
    return toLocalInput(d, ctx.tz);
  })();
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ title: title.trim(), type, dueAt: due, remindAt, priority, ownerId: owner, description: r.text.trim() }); }}>
      <label htmlFor="ct-title" className="sr-only">Task title</label>
      <input id="ct-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter a task title" className={clsx(field, "py-2 text-base")} required />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2"><Label htmlFor="ct-due">Due date</Label>
          <div className="flex gap-2">
            <select id="ct-due" value={preset} onChange={(e) => setPreset(e.target.value)} className={field}>{duePresets().map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="custom">Custom date…</option></select>
            <label htmlFor="ct-time" className="sr-only">Time</label><input id="ct-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-28 shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900" />
          </div>
          {preset === "custom" && <input type="date" aria-label="Custom due date" value={custom} min={ctx.today} onChange={(e) => setCustom(e.target.value)} className={clsx(field, "mt-2")} />}
        </div>
        <div><Label htmlFor="ct-rem">Reminder</Label><select id="ct-rem" value={reminder} onChange={(e) => setReminder(e.target.value)} className={field}><option value="none">No reminder</option><option value="at">At task due time</option><option value="1h">1 hour before</option><option value="1d">1 day before</option><option value="morning">Morning of (8:00)</option></select></div>
        <div><Label htmlFor="ct-type">Task type</Label><select id="ct-type" value={type} onChange={(e) => setType(e.target.value)} className={field}><option value="todo">To-do</option><option value="call">Call</option><option value="email">Email</option></select></div>
        <div><Label htmlFor="ct-pri">Priority</Label><select id="ct-pri" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}><option value="low">Low</option><option value="normal">None</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
        <div><Label htmlFor="ct-own">Assigned to</Label><select id="ct-own" value={owner} onChange={(e) => setOwner(e.target.value)} className={field} disabled={!ctx.perms.assign}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === ctx.me.id ? " (you)" : ""}</option>)}</select></div>
      </div>
      <Editor r={r} id="ct-notes" placeholder="Add notes…" rows={4} />
      <Footer contact={contact} pending={pending} disabled={!title.trim()} label="Create task" />
    </form>
  );
}
