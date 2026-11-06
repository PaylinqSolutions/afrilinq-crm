"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { Bold, Calendar, ChevronDown, ChevronUp, Italic, List, ListChecks, Loader2, Mail, Maximize2, MessageCircle, Minimize2, Phone, StickyNote, X } from "lucide-react";
import { useToast } from "../toast";
import { btn, field, Label } from "./kit";
import type { WCtx, WDeal, WUser } from "./workspace";
import { logAction, myScheduleAction, previewAction, taskAction } from "@/app/actions/deals";

export type ComposerKind = "note" | "email" | "call" | "task" | "meeting" | "whatsapp";
type Contact = { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; whatsapp?: string | null };

const KINDS: { k: ComposerKind; label: string; Icon: typeof Phone }[] = [
  { k: "note", label: "Note", Icon: StickyNote }, { k: "email", label: "Email", Icon: Mail }, { k: "call", label: "Call", Icon: Phone },
  { k: "task", label: "Task", Icon: ListChecks }, { k: "meeting", label: "Meeting", Icon: Calendar }, { k: "whatsapp", label: "WhatsApp", Icon: MessageCircle },
];
const p2 = (n: number) => String(n).padStart(2, "0");
const localKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
function addBusinessDays(from: Date, n: number) { const d = new Date(from); let left = n; while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; } return d; }
function dueFromPreset(p: string, time: string) {
  const now = new Date();
  const d = p === "today" ? now : p === "tomorrow" ? new Date(now.getTime() + 86400000) : p === "2bd" ? addBusinessDays(now, 2) : p === "3bd" ? addBusinessDays(now, 3) : p === "1w" ? new Date(now.getTime() + 7 * 86400000) : p === "2w" ? new Date(now.getTime() + 14 * 86400000) : now;
  return `${localKey(d)}T${time}`;
}
const PRESETS: [string, string][] = [["today", "Today"], ["tomorrow", "Tomorrow"], ["2bd", "In 2 business days"], ["3bd", `In 3 business days (${new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(addBusinessDays(new Date(), 3))})`], ["1w", "In 1 week"], ["2w", "In 2 weeks"], ["custom", "Custom date…"]];

/** Floating composer, like a mail draft: switch type, minimise, expand, close. Every submit reports back. */
export function Composer({ kind, dealId, deal, users, ctx, onClose, onSwitch, onDone }: {
  kind: ComposerKind; dealId: string; deal?: WDeal; users: WUser[]; ctx: WCtx; onClose: () => void; onSwitch: (k: ComposerKind) => void; onDone: () => void;
}) {
  const toast = useToast();
  const [min, setMin] = useState(false);
  const [max, setMax] = useState(false);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [companyId, setCompanyId] = useState(deal?.companyId ?? "");
  const [dealName, setDealName] = useState(deal?.name ?? "");
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    previewAction(dealId).then((r) => {
      if (!r.ok) { setContacts([]); return; }
      const p = r.data?.preview as { contacts: Contact[]; companyContacts: Contact[]; deal: { companyId: string; name: string } };
      const seen = new Set<string>();
      setContacts([...p.contacts, ...p.companyContacts].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))));
      setCompanyId(p.deal.companyId); setDealName(p.deal.name);
    });
  }, [dealId]);

  const close = () => { if (dirty && !confirm("Discard this draft?")) return; onClose(); };
  const submit = (run: () => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string> }>) => start(async () => {
    const r = await run();
    if (r.ok) { toast({ tone: r.message?.includes("SIMULATED") ? "info" : "success", text: r.message ?? "Saved." }); setDirty(false); onDone(); onClose(); }
    else toast({ tone: "error", text: r.message ?? "That didn't save.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean) });
  });
  const meta = KINDS.find((x) => x.k === kind)!;

  return (
    <div role="dialog" aria-label={`${meta.label} for ${dealName}`} className={clsx("fixed z-50 flex flex-col overflow-hidden rounded-t-2xl border border-slate-300 bg-white shadow-2xl sm:rounded-2xl",
      max ? "inset-2 sm:inset-8" : "inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[36rem]", min && "!top-auto h-auto")}>
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <button onClick={() => setMin(!min)} aria-label={min ? "Expand composer" : "Minimise composer"} className="rounded p-1 hover:bg-slate-200">{min ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" role="tablist">
          {KINDS.map(({ k, label, Icon }) => (
            <button key={k} role="tab" aria-selected={k === kind} onClick={() => { setMin(false); onSwitch(k); }} className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold", k === kind ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:bg-slate-200")}>
              <Icon className="h-3.5 w-3.5" aria-hidden />{label}
            </button>
          ))}
        </div>
        <button onClick={() => setMax(!max)} aria-label={max ? "Restore size" : "Expand"} className="hidden rounded p-1 hover:bg-slate-200 sm:block">{max ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
        <button onClick={close} aria-label="Close composer" className="rounded p-1 hover:bg-slate-200"><X className="h-4 w-4" /></button>
      </header>
      {!min && (
        <div className="flex-1 overflow-y-auto p-4" onChange={() => setDirty(true)}>
          <p className="mb-3 text-sm text-slate-600">For <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-800">{dealName || "…"}</span></p>
          {contacts === null ? <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div> : (
            <>
              {kind === "note" && <NoteForm pending={pending} onSubmit={(v) => submit(() => logAction({ dealId, type: "note", ...v }))} />}
              {kind === "email" && <EmailForm contacts={contacts} pending={pending} onSubmit={(v) => submit(() => logAction({ dealId, type: "email", ...v }))} />}
              {kind === "whatsapp" && <WhatsAppForm contacts={contacts} pending={pending} onSubmit={(v) => submit(() => logAction({ dealId, type: "whatsapp", ...v }))} />}
              {kind === "call" && <CallForm contacts={contacts} pending={pending} onDial={(n) => toast({ tone: "info", text: `Opening your phone app to call ${n}. Log the outcome here when you're done.` })} onSubmit={(v) => submit(() => logAction({ dealId, type: "call", ...v }))} />}
              {kind === "task" && <TaskForm users={users} ctx={ctx} dealName={dealName} pending={pending} onSubmit={(v) => submit(() => taskAction({ dealId, companyId, ...v }))} />}
              {kind === "meeting" && <MeetingForm contacts={contacts} dealName={dealName} pending={pending} onSubmit={(v) => submit(() => logAction({ dealId, type: "meeting", ...v }))} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Toolbar({ onInsert }: { onInsert: (before: string, after?: string) => void }) {
  return (
    <div className="mb-1 flex gap-1 text-slate-600" role="toolbar" aria-label="Formatting">
      <button type="button" onClick={() => onInsert("**", "**")} className="rounded p-1 hover:bg-slate-100" aria-label="Bold"><Bold className="h-4 w-4" /></button>
      <button type="button" onClick={() => onInsert("_", "_")} className="rounded p-1 hover:bg-slate-100" aria-label="Italic"><Italic className="h-4 w-4" /></button>
      <button type="button" onClick={() => onInsert("\n- ")} className="rounded p-1 hover:bg-slate-100" aria-label="Bullet list"><List className="h-4 w-4" /></button>
    </div>
  );
}
function useRich(initial = "") {
  const [text, setText] = useState(initial);
  const [ref, setRef] = useState<HTMLTextAreaElement | null>(null);
  const insert = (before: string, after = "") => {
    if (!ref) { setText((t) => t + before + after); return; }
    const { selectionStart: s, selectionEnd: e } = ref;
    setText((t) => t.slice(0, s) + before + t.slice(s, e) + after + t.slice(e));
    requestAnimationFrame(() => { ref.focus(); ref.setSelectionRange(s + before.length, e + before.length); });
  };
  return { text, setText, setRef, insert };
}

function FollowUp({ value, onChange }: { value: { on: boolean; preset: string }; onChange: (v: { on: boolean; preset: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
      <label className="inline-flex items-center gap-2"><input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} className="h-4 w-4" />Create a to-do to follow up</label>
      <select aria-label="Follow-up due" value={value.preset} onChange={(e) => onChange({ on: true, preset: e.target.value })} className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-sm">
        {PRESETS.filter(([k]) => k !== "custom" && k !== "today").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  );
}
const followUpFields = (f: { on: boolean; preset: string }, subject: string) => (f.on ? { followUpTitle: `Follow up: ${subject}`.slice(0, 280), followUpDue: dueFromPreset(f.preset, "09:00") } : {});

function NoteForm({ pending, onSubmit }: { pending: boolean; onSubmit: (v: { subject: string; body: string; followUpTitle?: string; followUpDue?: string }) => void }) {
  const r = useRich();
  const [fu, setFu] = useState({ on: false, preset: "3bd" });
  const subject = r.text.trim().split("\n")[0].replace(/[*_#-]/g, "").trim().slice(0, 80) || "Note";
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ subject, body: r.text.trim(), ...followUpFields(fu, subject) }); }}>
      <Toolbar onInsert={r.insert} />
      <label htmlFor="c-note" className="sr-only">Note</label>
      <textarea id="c-note" ref={r.setRef} value={r.text} onChange={(e) => r.setText(e.target.value)} rows={7} autoFocus placeholder="Start typing to leave a note…" className={field} />
      <FollowUp value={fu} onChange={setFu} />
      <button disabled={pending || !r.text.trim()} className={btn("primary")}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Create note</button>
    </form>
  );
}

function ContactSelect({ contacts, id, label, value, onChange, need }: { contacts: Contact[]; id: string; label: string; value: string; onChange: (v: string) => void; need: "email" | "phone" | "whatsapp" }) {
  const ok = contacts.filter((c) => (need === "email" ? c.email : need === "whatsapp" ? c.whatsapp ?? c.phone : c.phone));
  return (
    <div><Label htmlFor={id}>{label}</Label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={field}>
        <option value="">{ok.length ? "Choose a contact…" : `No contacts with a ${need === "email" ? "email address" : "phone number"}`}</option>
        {ok.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName} — {need === "email" ? c.email : need === "whatsapp" ? c.whatsapp ?? c.phone : c.phone}</option>)}
      </select></div>
  );
}

function EmailForm({ contacts, pending, onSubmit }: { contacts: Contact[]; pending: boolean; onSubmit: (v: { subject: string; body: string; contactId: string; send?: boolean; confirmSimulated?: boolean; followUpTitle?: string; followUpDue?: string }) => void }) {
  const [to, setTo] = useState(contacts.find((c) => c.email)?.id ?? "");
  const [subject, setSubject] = useState("");
  const r = useRich();
  const [sim, setSim] = useState(false);
  const [fu, setFu] = useState({ on: false, preset: "3bd" });
  const go = (send: boolean) => onSubmit({ subject: subject || "Email", body: r.text, contactId: to, send, confirmSimulated: sim, ...followUpFields(fu, subject || "email") });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); go(false); }}>
      <ContactSelect contacts={contacts} id="c-to" label="To" value={to} onChange={setTo} need="email" />
      <div><Label htmlFor="c-subj">Subject</Label><input id="c-subj" value={subject} onChange={(e) => setSubject(e.target.value)} className={field} required /></div>
      <Toolbar onInsert={r.insert} />
      <label htmlFor="c-body" className="sr-only">Body</label>
      <textarea id="c-body" ref={r.setRef} value={r.text} onChange={(e) => r.setText(e.target.value)} rows={7} className={field} placeholder="Write your email…" />
      <FollowUp value={fu} onChange={setFu} />
      <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Email sending isn't configured, so “Send” can only record a clearly-labelled simulated message.
        <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={sim} onChange={(e) => setSim(e.target.checked)} className="h-4 w-4" />Simulate send (nothing is delivered)</label></p>
      <div className="flex flex-wrap gap-2">
        <button disabled={pending || !subject.trim()} className={btn("primary")}>Log email I already sent</button>
        <button type="button" disabled={pending || !subject.trim() || !to} onClick={() => go(true)} className={btn("outline")}>Send email</button>
      </div>
    </form>
  );
}

function WhatsAppForm({ contacts, pending, onSubmit }: { contacts: Contact[]; pending: boolean; onSubmit: (v: { subject: string; body: string; contactId: string; outcome?: string }) => void }) {
  const [to, setTo] = useState(contacts.find((c) => c.whatsapp || c.phone)?.id ?? "");
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState("Outbound");
  const c = contacts.find((x) => x.id === to);
  const num = (c?.whatsapp ?? c?.phone ?? "").replace(/[^\d]/g, "");
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ subject: `WhatsApp ${direction.toLowerCase()} — ${c ? `${c.firstName} ${c.lastName}` : "contact"}`, body, contactId: to, outcome: direction }); }}>
      <ContactSelect contacts={contacts} id="c-wa" label="Contact" value={to} onChange={setTo} need="whatsapp" />
      <div><Label htmlFor="c-wad">Direction</Label><select id="c-wad" value={direction} onChange={(e) => setDirection(e.target.value)} className={field}><option>Outbound</option><option>Inbound</option></select></div>
      <div><Label htmlFor="c-wab">Conversation summary</Label><textarea id="c-wab" value={body} onChange={(e) => setBody(e.target.value)} rows={5} className={field} required /></div>
      <div className="flex flex-wrap gap-2">
        <button disabled={pending || !body.trim()} className={btn("primary")}>Log WhatsApp</button>
        {num && <a href={`https://wa.me/${num}`} target="_blank" rel="noopener noreferrer" className={btn("outline")}>Open WhatsApp chat</a>}
      </div>
      <p className="text-xs text-slate-500">WhatsApp Business isn't connected; open the chat on your device, then log the conversation here.</p>
    </form>
  );
}

function CallForm({ contacts, pending, onSubmit, onDial }: { contacts: Contact[]; pending: boolean; onDial: (n: string) => void; onSubmit: (v: { subject: string; body: string; contactId: string; outcome: string; durationMinutes?: number; followUpTitle?: string; followUpDue?: string }) => void }) {
  const [who, setWho] = useState(contacts.find((c) => c.phone)?.id ?? "");
  const [outcome, setOutcome] = useState("Connected");
  const [mins, setMins] = useState("");
  const [notes, setNotes] = useState("");
  const [fu, setFu] = useState({ on: false, preset: "2bd" });
  const c = contacts.find((x) => x.id === who);
  const name = c ? `${c.firstName} ${c.lastName}` : "contact";
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ subject: `Call — ${outcome} (${name})`, body: notes, contactId: who, outcome, durationMinutes: mins ? Number(mins) : undefined, ...followUpFields(fu, `call with ${name}`) }); }}>
      <ContactSelect contacts={contacts} id="c-call" label="Who" value={who} onChange={setWho} need="phone" />
      {c?.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} onClick={() => onDial(c.phone!)} className={clsx(btn("primary"), "w-full")}><Phone className="h-4 w-4" /> Call {c.phone}</a>}
      <div className="grid grid-cols-2 gap-2">
        <div><Label htmlFor="c-out">Outcome</Label><select id="c-out" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field}>{["Connected", "Left voicemail", "No answer", "Busy", "Wrong number", "Call back later"].map((o) => <option key={o}>{o}</option>)}</select></div>
        <div><Label htmlFor="c-min">Duration (min)</Label><input id="c-min" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value.replace(/\D/g, ""))} className={field} /></div>
      </div>
      <div><Label htmlFor="c-notes">Call notes</Label><textarea id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={field} placeholder="What was discussed? Agreed next steps?" /></div>
      <FollowUp value={fu} onChange={setFu} />
      <button disabled={pending} className={btn("primary")}>Log call</button>
    </form>
  );
}

function TaskForm({ users, ctx, dealName, pending, onSubmit }: { users: WUser[]; ctx: WCtx; dealName: string; pending: boolean; onSubmit: (v: { title: string; dueAt: string; priority: string; ownerId: string; description: string; type: string }) => void }) {
  const [title, setTitle] = useState("");
  const [preset, setPreset] = useState("3bd");
  const [time, setTime] = useState("08:00");
  const [custom, setCustom] = useState("");
  const [type, setType] = useState("todo");
  const [priority, setPriority] = useState("normal");
  const [owner, setOwner] = useState(ctx.me.id);
  const [notes, setNotes] = useState("");
  const due = preset === "custom" ? (custom ? `${custom}T${time}` : "") : dueFromPreset(preset, time);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ title: title.trim(), dueAt: due, priority, ownerId: owner, description: notes, type }); }}>
      <label htmlFor="c-title" className="sr-only">Task title</label>
      <input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={`Enter a task title (e.g. Send revised quote to ${dealName.split(" —")[0]})`} className={clsx(field, "py-2.5 text-base")} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem]">
        <div><Label htmlFor="c-due">Due date</Label><select id="c-due" value={preset} onChange={(e) => setPreset(e.target.value)} className={field}>{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><Label htmlFor="c-time">Time</Label><input id="c-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} /></div>
      </div>
      {preset === "custom" && <div><Label htmlFor="c-cdate">Date</Label><input id="c-cdate" type="date" min={ctx.today} value={custom} onChange={(e) => setCustom(e.target.value)} className={field} /></div>}
      <div className="grid grid-cols-3 gap-2">
        <div><Label htmlFor="c-type">Task type</Label><select id="c-type" value={type} onChange={(e) => setType(e.target.value)} className={field}><option value="todo">To-do</option><option value="call">Call</option><option value="email">Email</option></select></div>
        <div><Label htmlFor="c-pri">Priority</Label><select id="c-pri" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>{["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></div>
        <div><Label htmlFor="c-own">Assigned to</Label><select id="c-own" value={owner} onChange={(e) => setOwner(e.target.value)} className={field}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === ctx.me.id ? " (me)" : ""}</option>)}</select></div>
      </div>
      <div><Label htmlFor="c-tnotes">Notes</Label><textarea id="c-tnotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={field} placeholder="Add notes…" /></div>
      <p className="text-xs text-slate-500">Associated with 1 record: {dealName}. {due && `Due ${due.replace("T", " at ")}.`} Reminders appear in-app.</p>
      <button disabled={pending || !title.trim() || !due} className={btn("primary")}>Create task</button>
    </form>
  );
}

function MeetingForm({ contacts, dealName, pending, onSubmit }: { contacts: Contact[]; dealName: string; pending: boolean; onSubmit: (v: { subject: string; body: string; contactId?: string; scheduledFor: string; at: string; durationMinutes: number }) => void }) {
  const now = new Date();
  const rounded = new Date(now.getTime() + (30 - (now.getMinutes() % 30)) * 60000);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(localKey(rounded));
  const [startT, setStartT] = useState(`${p2(rounded.getHours())}:${p2(rounded.getMinutes())}`);
  const [endT, setEndT] = useState(() => { const e = new Date(rounded.getTime() + 30 * 60000); return `${p2(e.getHours())}:${p2(e.getMinutes())}`; });
  const [attendees, setAttendees] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [events, setEvents] = useState<{ subject: string; at: string; mins: number }[] | null>(null);
  useEffect(() => {
    setEvents(null);
    const from = new Date(`${date}T00:00`), to = new Date(`${date}T23:59`);
    myScheduleAction(from.toISOString(), to.toISOString()).then((r) => setEvents(r.ok ? (r.data?.events as typeof events) ?? [] : []));
  }, [date]);
  const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const duration = mins(endT) - mins(startT);
  const clash = useMemo(() => (events ?? []).find((e) => { const d = new Date(e.at); const s = d.getHours() * 60 + d.getMinutes(); return s < mins(endT) && s + e.mins > mins(startT); }), [events, startT, endT]);
  const names = contacts.filter((c) => attendees.includes(c.id)).map((c) => `${c.firstName} ${c.lastName}`);
  return (
    <form className="grid gap-4 sm:grid-cols-[1fr_12rem]" onSubmit={(e) => { e.preventDefault(); onSubmit({ subject: title.trim(), contactId: attendees[0], scheduledFor: `${date}T${startT}`, at: `${date}T${startT}`, durationMinutes: duration, body: [names.length ? `Attendees: ${names.join(", ")}` : "", location ? `Location: ${location}` : "", notes].filter(Boolean).join("\n") }); }}>
      <div className="space-y-3">
        <div><Label htmlFor="m-title">Title</Label><input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={`e.g. ${dealName.split(" —")[0]} — onboarding kickoff`} className={field} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label htmlFor="m-date">Date</Label><input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></div>
          <div><Label htmlFor="m-start">Start</Label><input id="m-start" type="time" step={900} value={startT} onChange={(e) => setStartT(e.target.value)} className={field} /></div>
          <div><Label htmlFor="m-end">End</Label><input id="m-end" type="time" step={900} value={endT} onChange={(e) => setEndT(e.target.value)} className={field} /></div>
        </div>
        {duration <= 0 && <p className="text-xs text-red-700">End time must be after the start time.</p>}
        {clash && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Overlaps “{clash.subject}” in your schedule.</p>}
        <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">Attendees</legend>
          {contacts.length === 0 ? <p className="text-sm text-slate-500">No contacts on this account yet.</p> : <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{contacts.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attendees.includes(c.id)} onChange={() => setAttendees((a) => (a.includes(c.id) ? a.filter((x) => x !== c.id) : [...a, c.id]))} className="h-4 w-4" />{c.firstName} {c.lastName}</label>)}</div>}
        </fieldset>
        <div><Label htmlFor="m-loc">Location or video link</Label><input id="m-loc" value={location} onChange={(e) => setLocation(e.target.value)} className={field} placeholder="Office address or https://meet…" /></div>
        <div><Label htmlFor="m-notes">Agenda / notes</Label><textarea id="m-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={field} /></div>
        <p className="text-xs text-slate-500">Calendar isn't connected, so no invitation is emailed — the meeting is scheduled in the CRM and shows on your dashboard.</p>
        <button disabled={pending || !title.trim() || duration <= 0} className={btn("primary")}>Schedule meeting</button>
      </div>
      <aside aria-label="Your schedule that day" className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Your day · {date}</p>
        {events === null ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Loading schedule" /> : events.length === 0 ? <p className="text-sm text-slate-500">Nothing scheduled — you're free.</p> : (
          <ul className="space-y-1.5 text-xs">{events.sort((a, b) => a.at.localeCompare(b.at)).map((e, i) => { const d = new Date(e.at); return <li key={i} className="rounded bg-white p-1.5 shadow-sm"><span className="font-semibold tabular-nums">{p2(d.getHours())}:{p2(d.getMinutes())}</span> · {e.subject} <span className="text-slate-500">({e.mins}m)</span></li>; })}</ul>
        )}
      </aside>
    </form>
  );
}
