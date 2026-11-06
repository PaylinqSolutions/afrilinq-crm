"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import {
  AlertTriangle, ArrowUpDown, Building2, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Columns3, Copy, Download, ExternalLink, Filter, LayoutGrid,
  ListChecks, MoreVertical, Pencil, Play, Plus, RefreshCw, Rows3, Search, Settings2, SkipForward, SlidersHorizontal, Table2, UserRound, X, Zap,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, Dialog, field, Label, Menu, MenuItem } from "../deals/kit";
import { DateFilterChip, OwnerFilter, Popover } from "../deals/filters";
import { matchDate, type DateFilter } from "@/lib/date-presets";
import { toLocalInput } from "@/lib/format";
import { bulkTasksAction, deleteTaskViewAction, exportTasksAction, newTaskAction, patchTaskAction, saveTaskViewAction } from "@/app/actions/tasks";
import { ago, type CUser, dateTime, downloadCsv, Floating, PickList, TextEditor } from "../contacts/kit";
import { ColumnsPicker, pageNumbers, SaveViewDialog, SortHead } from "../contacts/workspace";
import { duePresets } from "../contacts/composer";

export type WTask = {
  id: string; title: string; description: string | null; dueAt: string | null; remindAt: string | null; priority: string; status: string; stage: string; taskType: string; queue: string | null;
  outcome: string | null; ownerId: string; ownerName: string; createdBy: string | null; createdByName: string | null; relatedType: string | null; relatedId: string | null; relatedName: string | null;
  contactId: string | null; contactName: string | null; companyId: string | null; companyName: string | null; lastContactedAt: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
};
export type TCtx = { me: CUser; today: string; tz: string; perms: { viewAll: boolean; assign: boolean; export: boolean; log: boolean } };
type LinkOpt = { value: string; label: string; hint?: string };

const STAGES: Record<string, string> = { not_started: "Not started", in_progress: "In progress", waiting: "Waiting", completed: "Completed", deferred: "Deferred" };
const TYPES: Record<string, string> = { todo: "To-do", call: "Call", email: "Email", meeting: "Meeting", whatsapp: "WhatsApp" };
const PRIORITIES: Record<string, string> = { low: "Low", normal: "None", high: "High", urgent: "Urgent" };
const PRIORITY_DOT: Record<string, string> = { low: "bg-slate-300", normal: "bg-slate-200", high: "bg-orange-500", urgent: "bg-red-600" };
const RELATED_HREF: Record<string, (id: string) => string> = {
  contact: (id) => `/contacts/${id}`, company: (id) => `/companies/${id}`, deal: (id) => `/deals?preview=${id}`, lead: (id) => `/leads/${id}`, ticket: (id) => `/tickets/${id}`,
  onboarding: (id) => `/onboarding/${id}`, handover: (id) => `/handovers/${id}`,
};
const COLUMNS = {
  stage: "Task stage", contact: "Task → Contact", company: "Task → Company", lastContacted: "Last contacted", type: "Task type", due: "Due date", priority: "Priority",
  owner: "Assigned to", queue: "Queue", related: "Related record", createdBy: "Created by", created: "Create date", completed: "Completed date",
} as const;
type Col = keyof typeof COLUMNS;
const DEFAULT_COLS: Col[] = ["stage", "contact", "company", "lastContacted", "type", "due", "priority", "owner"];
type SortKey = "title" | Col;
type Tab = "today" | "overdue" | "upcoming" | "open" | "completed" | `view:${string}`;
type Adv = { priorities: string[]; related: string[]; createdByMe: boolean; hasReminder: boolean; noDueDate: boolean };
const NO_ADV: Adv = { priorities: [], related: [], createdByMe: false, hasReminder: false, noDueDate: false };
const advCount = (a: Adv) => [a.priorities.length, a.related.length, a.createdByMe, a.hasReminder, a.noDueDate].filter(Boolean).length;
type Filters = { due: DateFilter | null; owners: string[]; types: string[]; stages: string[]; queues: string[]; adv: Adv };
const DEFAULT_FILTERS: Filters = { due: null, owners: ["__me"], types: [], stages: [], queues: [], adv: NO_ADV };
type SavedView = { id: string; name: string; query: string };

export function TasksWorkspace({ tasks, users, queues, links, views, ctx, initial }: {
  tasks: WTask[]; users: CUser[]; queues: string[]; links: LinkOpt[]; views: SavedView[]; ctx: TCtx; initial: { tab?: string; task?: string; q?: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(tasks);
  useEffect(() => setItems(tasks), [tasks]);
  const [qs, setQs] = useState(queues);
  const [tab, setTab] = useState<Tab>((["today", "overdue", "upcoming", "open", "completed"].includes(initial.tab ?? "") ? initial.tab : "today") as Tab);
  const [q, setQ] = useState(initial.q ?? "");
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [cols, setCols] = useState<Col[]>(DEFAULT_COLS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "due", dir: 1 });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [layout, setLayout] = useState<"table" | "board">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(initial.task ?? null);
  const [edit, setEdit] = useState<{ id: string; col: Col | "title"; el: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<"" | "create" | "columns" | "advanced" | "save" | "focus" | "bulkOwner" | "bulkStage" | "bulkDue">("");
  const [banner, setBanner] = useState(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nowMs = useMemo(() => Date.now(), [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      setBanner(localStorage.getItem("afq.tasks.calendarBanner") !== "hidden");
      const c = localStorage.getItem("afq.tasks.cols"); if (c) setCols(JSON.parse(c));
      const p = localStorage.getItem("afq.tasks.perPage"); if (p) setPerPage(Number(p));
    } catch {}
  }, []);
  const persist = (k: string, v: unknown) => { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch {} };
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "today" && !tab.startsWith("view:")) p.set("tab", tab); if (q) p.set("q", q); if (openId) p.set("task", openId);
    window.history.replaceState(null, "", `/tasks${p.toString() ? `?${p}` : ""}`);
  }, [tab, q, openId]);
  useEffect(() => setPage(1), [tab, q, f, perPage]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "n" && ctx.perms.log) setDialog("create");
      if (e.key === "Escape") { setOpenId(null); setSelected(new Set()); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ctx.perms.log]);

  const endOfToday = useMemo(() => Date.parse(`${ctx.today}T23:59:59`), [ctx.today]);
  const isOpen = (t: WTask) => t.status === "open";
  const isOverdue = (t: WTask) => isOpen(t) && !!t.dueAt && Date.parse(t.dueAt) < nowMs;
  const inTab = (t: WTask, k: Tab) => k === "today" ? isOpen(t) && !!t.dueAt && t.dueAt.slice(0, 10) <= ctx.today && Date.parse(t.dueAt) <= endOfToday
    : k === "overdue" ? isOverdue(t) : k === "upcoming" ? isOpen(t) && (!t.dueAt || Date.parse(t.dueAt) > endOfToday) : k === "completed" ? t.status !== "open" : isOpen(t) || k.startsWith("view:");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((t) => {
      if (!inTab(t, tab)) return false;
      if (term && ![t.title, t.description, t.contactName, t.companyName, t.relatedName, t.queue, t.ownerName].some((v) => v?.toLowerCase().includes(term))) return false;
      if (f.owners.length && !f.owners.some((o) => (o === "__me" ? t.ownerId === ctx.me.id : t.ownerId === o))) return false;
      if (!matchDate(t.dueAt, f.due, ctx.today)) return false;
      if (f.types.length && !f.types.includes(t.taskType)) return false;
      if (f.stages.length && !f.stages.some((s) => (s === "__closed" ? ["completed", "deferred"].includes(t.stage) : t.stage === s))) return false;
      if (f.queues.length && !f.queues.includes(t.queue ?? "__none")) return false;
      const a = f.adv;
      if (a.priorities.length && !a.priorities.includes(t.priority)) return false;
      if (a.related.length && !a.related.includes(t.relatedType ?? "__none")) return false;
      if (a.createdByMe && t.createdBy !== ctx.me.id) return false;
      if (a.hasReminder && !t.remindAt) return false;
      if (a.noDueDate && t.dueAt) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tab, q, f, ctx.me.id, ctx.today]);
  const sortVal = (t: WTask, k: SortKey): string => ({
    title: t.title.toLowerCase(), stage: String(Object.keys(STAGES).indexOf(t.stage)), contact: t.contactName ?? "", company: t.companyName ?? "", lastContacted: t.lastContactedAt ?? "",
    type: TYPES[t.taskType] ?? t.taskType, due: t.dueAt ?? "", priority: String(["urgent", "high", "normal", "low"].indexOf(t.priority)), owner: t.ownerName, queue: t.queue ?? "",
    related: t.relatedName ?? "", createdBy: t.createdByName ?? "", created: t.createdAt, completed: t.completedAt ?? "",
  })[k];
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    if (!x && y) return 1; if (x && !y) return -1;
    return x.localeCompare(y) * sort.dir;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filtered, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageRows = sorted.slice((page - 1) * perPage, page * perPage);
  const filterCount = (f.due ? 1 : 0) + (f.owners.length ? 1 : 0) + (f.types.length ? 1 : 0) + (f.stages.length ? 1 : 0) + (f.queues.length ? 1 : 0) + advCount(f.adv);
  const openInView = sorted.filter(isOpen);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown>; fieldErrors?: Record<string, string> }>, after?: (r: { ok: boolean; data?: Record<string, unknown> }) => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toast({ tone: "success", text: r.message ?? "Done." }); after?.(r); router.refresh(); }
    else { toast({ tone: "error", text: r.message ?? "That didn't work.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean), action: r.data?.stale ? { label: "Reload", run: () => router.refresh() } : undefined }); setItems(tasks); }
  });
  const patch = (t: WTask, p: Record<string, string | null>, optimistic: Partial<WTask>, after?: () => void) => {
    setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...optimistic } : x)));
    setEdit(null);
    run(() => patchTaskAction(t.id, p, t.updatedAt), (r) => { const u = r.data?.updatedAt as string | undefined; if (u) setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, updatedAt: u } : x))); after?.(); });
  };
  const complete = (t: WTask) => isOpen(t) ? patch(t, { stage: "completed" }, { stage: "completed", status: "done", completedAt: new Date().toISOString() }) : patch(t, { stage: "not_started" }, { stage: "not_started", status: "open", completedAt: null });
  const allOnPage = pageRows.length > 0 && pageRows.every((t) => selected.has(t.id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allOnPage) pageRows.forEach((t) => n.delete(t.id)); else pageRows.forEach((t) => n.add(t.id)); return n; });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sortBy = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: ["created", "completed", "lastContacted"].includes(k) ? -1 : 1 }));
  const exportRows = (ids: string[]) => ctx.perms.export ? run(() => exportTasksAction(ids), (r) => downloadCsv(String(r.data?.csv ?? ""), `tasks-${ctx.today}.csv`)) : toast({ tone: "error", text: "You don't have permission to export." });
  const applyView = (v: SavedView) => { try { const s = JSON.parse(v.query) as { f: Filters; q: string; cols?: Col[] }; setF({ ...DEFAULT_FILTERS, ...s.f, adv: { ...NO_ADV, ...s.f.adv } }); setQ(s.q ?? ""); if (s.cols) setCols(s.cols); setTab(`view:${v.id}`); toast({ tone: "info", text: `Showing “${v.name}”.` }); } catch { toast({ tone: "error", text: "This saved view is damaged." }); } };
  const open = items.find((t) => t.id === openId) ?? null;
  const userOpts = users.map((u) => ({ value: u.id, label: u.id === ctx.me.id ? `${u.name} (you)` : u.name }));
  const counts = { today: items.filter((t) => inTab(t, "today") && t.ownerId === ctx.me.id).length, overdue: items.filter((t) => isOverdue(t) && t.ownerId === ctx.me.id).length, upcoming: items.filter((t) => inTab(t, "upcoming") && t.ownerId === ctx.me.id).length };

  return (
    <div>
      {banner && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-accent-400 bg-accent-50 px-4 py-3 text-sm">
          <p className="flex-1"><span className="font-semibold">Want your tasks on your Google or Outlook calendar?</span> Calendar sync needs a calendar integration. <Link href="/settings/integrations" className="font-semibold text-accent-600 underline">Go to settings</Link></p>
          <button aria-label="Dismiss" onClick={() => { setBanner(false); persist("afq.tasks.calendarBanner", "hidden"); }} className="rounded p-1 hover:bg-white"><X className="h-4 w-4" /></button>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Menu label={<span className="text-2xl font-semibold text-ink-950">Tasks</span>} ariaLabel="Switch record type">
          {(close) => <>
            <MenuItem onClick={close} hint="current"><ListChecks className="h-4 w-4" />Tasks</MenuItem>
            <MenuItem onClick={() => { close(); router.push("/contacts"); }}>Contacts</MenuItem>
            <MenuItem onClick={() => { close(); router.push("/companies"); }}>Companies</MenuItem>
            <MenuItem onClick={() => { close(); router.push("/deals"); }}>Deals</MenuItem>
          </>}
        </Menu>
        <div className="ml-auto flex items-center gap-2">
          <Menu icon={<MoreVertical className="h-4 w-4" />} ariaLabel="More task actions" variant="outline" align="right">
            {(close) => <>
              <MenuItem onClick={() => { close(); exportRows(sorted.map((t) => t.id)); }}><Download className="h-4 w-4" />Export this view ({sorted.length})</MenuItem>
              <MenuItem onClick={() => { close(); setDialog("columns"); }}><Columns3 className="h-4 w-4" />Edit columns</MenuItem>
              <MenuItem onClick={() => { close(); setBanner(true); persist("afq.tasks.calendarBanner", "shown"); }}>Calendar sync tips</MenuItem>
            </>}
          </Menu>
          {ctx.perms.log && (
            <Menu label="Add tasks" variant="primary" align="right">
              {(close) => <>
                <MenuItem onClick={() => { close(); setDialog("create"); }} hint="N">Create new</MenuItem>
                <MenuItem onClick={() => { close(); toast({ tone: "info", text: "Importing tasks from a spreadsheet is coming later." }); }} hint="Coming later">Import</MenuItem>
              </>}
            </Menu>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Task views">
        {([["today", "Due today", counts.today], ["overdue", "Overdue", counts.overdue], ["upcoming", "Upcoming", counts.upcoming], ["open", "All open", null], ["completed", "Completed", null]] as const).map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSelected(new Set()); }}
            className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-brand-600 bg-slate-100 text-ink-950" : "border-transparent text-slate-600 hover:text-slate-900")}>
            <Table2 className="h-4 w-4" aria-hidden />{l}{n !== null && n > 0 && <span className={clsx("rounded-full px-1.5 text-xs ring-1", k === "overdue" ? "bg-red-50 text-red-700 ring-red-200" : "bg-white text-slate-500 ring-slate-200")}>{n}</span>}
          </button>
        ))}
        {views.map((v) => (
          <span key={v.id} className={clsx("inline-flex items-center rounded-t-lg border-b-2", tab === `view:${v.id}` ? "border-brand-600 bg-slate-100" : "border-transparent")}>
            <button role="tab" aria-selected={tab === `view:${v.id}`} onClick={() => applyView(v)} className="whitespace-nowrap px-3 py-2 text-sm font-medium text-slate-700">{v.name}</button>
            <button aria-label={`Delete view ${v.name}`} onClick={() => { if (confirm(`Delete the view “${v.name}”?`)) run(() => deleteTaskViewAction(v.id), () => setTab("today")); }} className="mr-1 rounded p-0.5 text-slate-400 hover:bg-slate-200"><X className="h-3.5 w-3.5" /></button>
          </span>
        ))}
        <button onClick={() => setDialog("save")} className="ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Save current filters as a view" title="Save current filters as a view"><Plus className="h-4 w-4" /></button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ( / )" aria-label="Search tasks by title, notes, contact or company" className="w-full rounded-full border border-slate-300 py-2 pl-9 pr-8 text-sm" />
          {q && <button aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-2 rounded-full p-0.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
        </div>
        <button onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium", filterCount ? "border-accent-400 bg-accent-50 text-accent-600" : "border-slate-300 text-slate-700 hover:bg-slate-50")}>
          <Filter className="h-4 w-4" aria-hidden />Filter{filterCount ? ` (${filterCount})` : ""}
        </button>
        <Menu label={<span className="inline-flex items-center gap-1.5"><ArrowUpDown className="h-4 w-4" aria-hidden />Sort by{sort.key !== "due" || sort.dir !== 1 ? `: ${sort.key === "title" ? "Task title" : COLUMNS[sort.key]}` : ""}</span>} variant="outline">
          {(close) => (["title", ...Object.keys(COLUMNS)] as SortKey[]).map((k) => <MenuItem key={k} onClick={() => { close(); sortBy(k); }} hint={sort.key === k ? (sort.dir === 1 ? "↑" : "↓") : undefined}>{k === "title" ? "Task title" : COLUMNS[k as Col]}</MenuItem>)}
        </Menu>
        <div className="ml-auto flex items-center gap-1">
          <button disabled={!openInView.length} onClick={() => setDialog("focus")} className={clsx(btn("outline"), "!rounded-full")} title="Work through the open tasks in this view one by one"><Play className="h-4 w-4" />Start {openInView.length} task{openInView.length === 1 ? "" : "s"}</button>
          <div className="flex rounded-full border border-slate-300 p-0.5" role="group" aria-label="Layout">
            <button aria-pressed={layout === "board"} onClick={() => setLayout("board")} className={clsx("rounded-full p-1.5", layout === "board" ? "bg-slate-200" : "hover:bg-slate-100")} aria-label="Board by stage" title="Board by stage"><LayoutGrid className="h-4 w-4" /></button>
            <button aria-pressed={layout === "table"} onClick={() => setLayout("table")} className={clsx("rounded-full p-1.5", layout === "table" ? "bg-slate-200" : "hover:bg-slate-100")} aria-label="Table" title="Table"><Rows3 className="h-4 w-4" /></button>
          </div>
          <button onClick={() => setDialog("columns")} className="rounded-full border border-slate-300 p-2 hover:bg-slate-50" aria-label="Edit columns" title="Edit columns"><Settings2 className="h-4 w-4" /></button>
          <button onClick={() => setFiltersOpen((o) => !o)} className="rounded-full border border-slate-300 p-2 hover:bg-slate-50" aria-label={filtersOpen ? "Hide filters" : "Show filters"} title={filtersOpen ? "Hide filters" : "Show filters"}>{filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2">
          <DateFilterChip label="Due date" value={f.due} onChange={(due) => setF({ ...f, due })} />
          <OwnerFilter label="Assigned to" users={users} value={f.owners} onChange={(owners) => setF({ ...f, owners })} meId={ctx.me.id} />
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <MultiFilter label="Task type" value={f.types} onChange={(types) => setF({ ...f, types })} options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))} />
          <MultiFilter label="Task stage" value={f.stages} onChange={(stages) => setF({ ...f, stages })} options={[{ value: "__closed", label: "All closed", special: true }, ...Object.entries(STAGES).map(([value, label]) => ({ value, label: `${label} (Task pipeline)` }))]} />
          <MultiFilter label="Queue" value={f.queues} onChange={(queues) => setF({ ...f, queues })} options={[{ value: "__none", label: "No queue", special: true }, ...qs.map((x) => ({ value: x, label: x }))]} />
          <button onClick={() => { setF({ ...DEFAULT_FILTERS, owners: [] }); setQ(""); toast({ tone: "info", text: "Filters cleared — showing everyone's tasks you can see." }); }} disabled={!filterCount && !q} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40">Clear all</button>
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <button onClick={() => setDialog("advanced")} className="rounded-full border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Add a filter" title="Add a filter"><Plus className="h-4 w-4" /></button>
          <button onClick={() => setDialog("advanced")} className="rounded-full border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Edit filters" title="Edit filters"><Pencil className="h-4 w-4" /></button>
          <span className={clsx("inline-flex items-center rounded-lg", advCount(f.adv) && "bg-accent-50")}>
            <button onClick={() => setDialog("advanced")} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><SlidersHorizontal className="h-4 w-4" aria-hidden />Advanced filters{advCount(f.adv) ? ` (${advCount(f.adv)})` : ""}</button>
            {advCount(f.adv) > 0 && <button aria-label="Remove advanced filters" onClick={() => setF({ ...f, adv: NO_ADV })} className="pr-2"><X className="h-3.5 w-3.5" /></button>}
          </span>
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-semibold">{selected.size} selected</span>
          <button className={btn("outline", "sm")} onClick={() => run(() => bulkTasksAction([...selected], { stage: "completed" }), () => setSelected(new Set()))}><Check className="h-3.5 w-3.5" />Complete</button>
          <button className={btn("outline", "sm")} onClick={() => setDialog("bulkDue")}>Reschedule</button>
          <button className={btn("outline", "sm")} onClick={() => setDialog("bulkStage")}>Set stage</button>
          {ctx.perms.assign && <button className={btn("outline", "sm")} onClick={() => setDialog("bulkOwner")}><UserRound className="h-3.5 w-3.5" />Reassign</button>}
          {ctx.perms.export && <button className={btn("outline", "sm")} onClick={() => exportRows([...selected])}><Download className="h-3.5 w-3.5" />Export</button>}
          <button className={clsx(btn("ghost", "sm"), "ml-auto")} onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {layout === "table" ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAll} className="h-4 w-4" /></th>
                <th className="px-2 py-2.5 font-medium"><SortHead label="Task title" k={"title" as SortKey} sort={sort} onSort={sortBy} /></th>
                {cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-medium"><SortHead label={c === "due" ? `Due date (${ctx.tz.split("/")[1] ?? ctx.tz})` : COLUMNS[c]} k={c as SortKey} sort={sort} onSort={sortBy} /></th>)}
                <th className="w-10 px-2"><button onClick={() => setDialog("columns")} aria-label="Add or remove columns" title="Add or remove columns" className="rounded p-1 hover:bg-slate-200"><Plus className="h-4 w-4" /></button></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => (
                <tr key={t.id} className={clsx("group border-t border-slate-100", selected.has(t.id) ? "bg-brand-50/60" : openId === t.id ? "bg-slate-50" : "hover:bg-slate-50")}>
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="h-4 w-4" /></td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setOpenId(openId === t.id ? null : t.id)} aria-label={`Open ${t.title}`} title="Open task" className="rounded p-0.5 text-slate-400 hover:bg-slate-200"><ChevronRight className={clsx("h-4 w-4 transition", openId === t.id && "rotate-90")} /></button>
                      <button onClick={() => complete(t)} aria-label={isOpen(t) ? `Mark ${t.title} complete` : `Reopen ${t.title}`} title={isOpen(t) ? "Mark complete" : "Reopen"} className="shrink-0 text-slate-400 hover:text-emerald-600">
                        {isOpen(t) ? <Circle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                      </button>
                      <button onClick={() => setOpenId(t.id)} className={clsx("max-w-[16rem] truncate text-left font-semibold text-accent-600 hover:underline", !isOpen(t) && "text-slate-500 line-through")} title={t.title}>{t.title}</button>
                      <button onClick={(e) => setEdit({ id: t.id, col: "title", el: e.currentTarget.parentElement! })} className="rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 group-hover:opacity-100 focus:opacity-100" aria-label={`Rename ${t.title}`}><Pencil className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                  {cols.map((col) => <Cell key={col} t={t} col={col} ctx={ctx} overdue={isOverdue(t)} onEdit={(el) => setEdit({ id: t.id, col, el })} editing={edit?.id === t.id && edit.col === col} />)}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {!pageRows.length && (
            <div className="grid place-items-center gap-2 px-4 py-14 text-center">
              <ListChecks className="h-10 w-10 text-slate-300" aria-hidden />
              <p className="font-semibold text-ink-950">{tab === "today" ? "Nothing due today. Nice work." : tab === "overdue" ? "No overdue tasks." : "No tasks match the current filters."}</p>
              <p className="text-sm text-slate-600">{filterCount ? "Filters are on, including “Assigned to: Me”. Clear them to see the whole team's tasks you can access." : "Create a task, or log a call or note with a follow-up on any contact."}</p>
              <div className="flex gap-2">
                {filterCount > 0 && <button className={btn("outline", "sm")} onClick={() => setF({ ...DEFAULT_FILTERS, owners: [] })}>Clear filters</button>}
                {tab !== "upcoming" && <button className={btn("outline", "sm")} onClick={() => setTab("upcoming")}>See upcoming</button>}
                {ctx.perms.log && <button className={btn("primary", "sm")} onClick={() => setDialog("create")}>Create task</button>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Tasks by stage">
          {Object.entries(STAGES).map(([key, label]) => {
            const list = sorted.filter((t) => t.stage === key);
            return (
              <section key={key} aria-label={`${label}, ${list.length} tasks`} onDragOver={(e) => { e.preventDefault(); setDropOn(key); }} onDragLeave={() => setDropOn(null)}
                onDrop={(e) => { e.preventDefault(); setDropOn(null); const t = sorted.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (t && t.stage !== key) patch(t, { stage: key }, { stage: key, status: key === "completed" ? "done" : key === "deferred" ? "cancelled" : "open" }); }}
                className={clsx("flex w-64 shrink-0 flex-col rounded-xl border bg-slate-50", dropOn === key ? "border-accent-500 ring-2 ring-accent-400" : "border-slate-200")}>
                <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm font-semibold"><span>{label}</span><span className="rounded-full bg-white px-2 text-xs text-slate-600 ring-1 ring-slate-200">{list.length}</span></header>
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
                  {list.slice(0, 100).map((t) => (
                    <li key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)} className="cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-sm">
                      <button onClick={() => setOpenId(t.id)} className="block w-full truncate text-left font-semibold text-accent-600 hover:underline">{t.title}</button>
                      <p className="mt-1 truncate text-xs text-slate-600">{[TYPES[t.taskType], t.contactName ?? t.relatedName].filter(Boolean).join(" · ")}</p>
                      <p className={clsx("mt-1 text-xs", isOverdue(t) ? "font-medium text-red-700" : "text-slate-500")}>{t.dueAt ? dateTime(t.dueAt, ctx.tz) : "No due date"} · {t.ownerName}</p>
                    </li>
                  ))}
                  {!list.length && <li className="px-1 py-4 text-center text-xs text-slate-400">Drag tasks here</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {layout === "table" && sorted.length > 0 && (
        <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-center gap-1 text-sm">
          <button disabled={page === 1} onClick={() => setPage(page - 1)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium disabled:opacity-40 enabled:hover:bg-slate-100"><ChevronLeft className="h-4 w-4" />Prev</button>
          {pageNumbers(page, pages).map((n, i) => n === 0 ? <span key={`g${i}`} className="px-1 text-slate-400">…</span> :
            <button key={n} aria-current={n === page ? "page" : undefined} onClick={() => setPage(n)} className={clsx("min-w-8 rounded-lg px-2 py-1 font-medium", n === page ? "border border-slate-400 bg-white" : "hover:bg-slate-100")}>{n}</button>)}
          <button disabled={page === pages} onClick={() => setPage(page + 1)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium disabled:opacity-40 enabled:hover:bg-slate-100">Next<ChevronRight className="h-4 w-4" /></button>
          <label htmlFor="t-per-page" className="sr-only">Rows per page</label>
          <select id="t-per-page" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); persist("afq.tasks.perPage", Number(e.target.value)); }} className="ml-2 rounded-lg border-0 bg-transparent font-semibold">{[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
        </nav>
      )}
      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold">{sorted.length} task{sorted.length === 1 ? "" : "s"}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { router.refresh(); toast({ tone: "info", text: "Tasks refreshed, including ones created on contact and company records." }); }} className={clsx(btn("outline"), "!rounded-full")} aria-label="Refresh" title="Refresh"><RefreshCw className={clsx("h-4 w-4", pending && "animate-spin")} /></button>
          <button onClick={() => exportRows(sorted.map((t) => t.id))} disabled={!sorted.length} className={clsx(btn("outline"), "!rounded-full")}><Download className="h-4 w-4" />Export</button>
          <button onClick={() => setDialog("save")} className={clsx(btn("outline"), "!rounded-full")} title="Save these filters and columns as a new view"><Copy className="h-4 w-4" />Clone</button>
        </div>
      </footer>

      {edit && (() => {
        const t = items.find((x) => x.id === edit.id);
        if (!t) return null;
        const close = () => setEdit(null);
        const F = (w: number, node: React.ReactNode) => <Floating anchor={edit.el} onClose={close} width={w}>{node}</Floating>;
        switch (edit.col) {
          case "title": return F(380, <TextEditor label="Task title" value={t.title} busy={pending} onCancel={close} onSave={(v) => v && patch(t, { title: v }, { title: v })} />);
          case "stage": return F(260, <PickList value={t.stage} options={Object.entries(STAGES).map(([value, label]) => ({ value, label }))} onPick={(v) => v && patch(t, { stage: v }, { stage: v, status: v === "completed" ? "done" : v === "deferred" ? "cancelled" : "open" })} />);
          case "type": return F(240, <PickList value={t.taskType} options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))} onPick={(v) => v && patch(t, { taskType: v }, { taskType: v })} />);
          case "priority": return F(240, <PickList value={t.priority} options={Object.entries(PRIORITIES).map(([value, label]) => ({ value, label }))} onPick={(v) => v && patch(t, { priority: v }, { priority: v })} />);
          case "owner": return ctx.perms.assign ? F(280, <PickList value={t.ownerId} options={userOpts} onPick={(v) => v && patch(t, { ownerId: v }, { ownerId: v, ownerName: users.find((u) => u.id === v)?.name ?? t.ownerName })} />) : F(260, <p className="p-4 text-sm text-slate-600">Only managers can reassign tasks.</p>);
          case "queue": return F(280, <PickList allowNew clearLabel="Remove from queue" placeholder="Search or add a queue" value={t.queue} options={qs.map((x) => ({ value: x, label: x }))} onPick={(v) => { if (v && !qs.includes(v)) setQs([...qs, v].sort()); patch(t, { queue: v }, { queue: v }); }} />);
          case "due": return F(320, <DueEditor value={t.dueAt} tz={ctx.tz} onCancel={close} onSave={(v) => patch(t, { dueAt: v }, { dueAt: v ? new Date(v).toISOString() : null })} />);
          default: return null;
        }
      })()}

      {open && <TaskPanel key={open.id} t={open} users={userOpts} queues={qs} ctx={ctx} pending={pending} onClose={() => setOpenId(null)} onPatch={(p, o) => patch(open, p, o)} />}
      {dialog === "create" && <CreateTaskDialog users={userOpts} queues={qs} links={links} ctx={ctx} pending={pending} onClose={() => setDialog("")} onCreate={(v) => run(() => newTaskAction(v), () => { setDialog(""); setTab(v.dueAt && v.dueAt.slice(0, 10) <= ctx.today ? "today" : "upcoming"); })} />}
      {dialog === "columns" && <ColumnsPicker columns={COLUMNS} defaults={DEFAULT_COLS} cols={cols} onClose={() => setDialog("")} onSave={(c) => { setCols(c); persist("afq.tasks.cols", c); setDialog(""); toast({ tone: "success", text: "Columns updated." }); }} />}
      {dialog === "advanced" && <AdvancedDialog value={f.adv} onClose={() => setDialog("")} onApply={(adv) => { setF({ ...f, adv }); setDialog(""); toast({ tone: "info", text: `Advanced filters applied (${advCount(adv)}).` }); }} />}
      {dialog === "save" && <SaveViewDialog pending={pending} onClose={() => setDialog("")} onSave={(name) => run(() => saveTaskViewAction(name, JSON.stringify({ f, q, cols })), (r) => { setDialog(""); if (r.data?.id) setTab(`view:${r.data.id}`); })} />}
      {dialog === "focus" && <FocusMode list={openInView} ctx={ctx} onClose={() => setDialog("")} onPatch={(t, p, o) => patch(t, p, o)} />}
      {(dialog === "bulkOwner" || dialog === "bulkStage") && (
        <Dialog title={dialog === "bulkOwner" ? `Reassign ${selected.size} task(s)` : `Set stage for ${selected.size} task(s)`} onClose={() => setDialog("")}>
          <PickList value={null} busy={pending} options={dialog === "bulkOwner" ? userOpts : Object.entries(STAGES).map(([value, label]) => ({ value, label }))}
            onPick={(v) => v && run(() => bulkTasksAction([...selected], dialog === "bulkOwner" ? { ownerId: v } : { stage: v }), () => { setDialog(""); setSelected(new Set()); })} />
        </Dialog>
      )}
      {dialog === "bulkDue" && (
        <Dialog title={`Reschedule ${selected.size} task(s)`} onClose={() => setDialog("")}>
          <DueEditor value={null} tz={ctx.tz} onCancel={() => setDialog("")} onSave={(v) => v && run(() => bulkTasksAction([...selected], { dueAt: v }), () => { setDialog(""); setSelected(new Set()); })} />
        </Dialog>
      )}
    </div>
  );
}

function MultiFilter({ label, value, onChange, options }: { label: string; value: string[]; onChange: (v: string[]) => void; options: { value: string; label: string; special?: boolean }[] }) {
  const [q, setQ] = useState("");
  const list = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover chip={<>{label}{value.length ? ` (${value.length})` : ""}</>} active={value.length > 0} onClear={() => onChange([])}>
      {() => <>
        <p className="mb-2 text-xs font-medium text-slate-500">is any of</p>
        <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label={`Search ${label.toLowerCase()}`} className="w-full rounded-full border-2 border-brand-500 py-1.5 pl-8 pr-3 text-sm" /></div>
        <ul className="max-h-64 overflow-y-auto">
          {list.map((o) => <li key={o.value}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50" title={o.label}>
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])} className="h-4 w-4" />
            {o.special && <Zap className="h-3.5 w-3.5 text-accent-500" aria-hidden />}<span className="truncate">{o.label}</span></label></li>)}
          {!list.length && <li className="px-2 py-3 text-sm text-slate-500">No matches.</li>}
        </ul>
      </>}
    </Popover>
  );
}

const Dash = () => <span className="text-slate-400">--</span>;
function Cell({ t, col, ctx, overdue, onEdit, editing }: { t: WTask; col: Col; ctx: TCtx; overdue: boolean; onEdit: (el: HTMLElement) => void; editing: boolean }) {
  const ref = useRef<HTMLTableCellElement>(null);
  const open = () => ref.current && onEdit(ref.current);
  const editable = ["stage", "type", "priority", "owner", "queue", "due"].includes(col);
  let body: React.ReactNode;
  switch (col) {
    case "stage": body = <span className={clsx(t.stage === "completed" && "text-emerald-700", t.stage === "waiting" && "text-amber-700")}>{STAGES[t.stage] ?? t.stage}</span>; break;
    case "contact": body = t.contactId ? <Link href={`/contacts/${t.contactId}`} className="inline-flex max-w-[12rem] items-center gap-1.5 font-semibold text-accent-600 hover:underline"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100"><UserRound className="h-3.5 w-3.5 text-slate-500" /></span><span className="truncate">{t.contactName}</span></Link> : <Dash />; break;
    case "company": body = t.companyId ? <Link href={`/companies/${t.companyId}`} className="inline-flex max-w-[12rem] items-center gap-1.5 font-semibold text-accent-600 hover:underline"><Building2 className="h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="truncate">{t.companyName}</span></Link> : <Dash />; break;
    case "lastContacted": body = t.lastContactedAt ? <span title={dateTime(t.lastContactedAt, ctx.tz) ?? ""}>{ago(t.lastContactedAt, ctx.today)}</span> : <Dash />; break;
    case "type": body = TYPES[t.taskType] ?? t.taskType; break;
    case "due": body = t.dueAt ? <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap", overdue && "font-medium text-red-700")}>{t.dueAt.slice(0, 10) === ctx.today ? `Today at ${new Intl.DateTimeFormat("en-US", { timeZone: ctx.tz, hour: "numeric", minute: "2-digit" }).format(new Date(t.dueAt))}` : dateTime(t.dueAt, ctx.tz)}{overdue && <AlertTriangle className="h-3.5 w-3.5" aria-label="Overdue" />}</span> : <Dash />; break;
    case "priority": body = <span className="inline-flex items-center gap-1.5"><span className={clsx("h-2 w-2 rounded-full", PRIORITY_DOT[t.priority])} aria-hidden />{PRIORITIES[t.priority]}</span>; break;
    case "owner": body = <span className="truncate">{t.ownerName}{t.ownerId === ctx.me.id && <span className="text-xs text-slate-500"> (you)</span>}</span>; break;
    case "queue": body = t.queue ?? <Dash />; break;
    case "related": body = t.relatedType && t.relatedId && RELATED_HREF[t.relatedType] ? <Link href={RELATED_HREF[t.relatedType](t.relatedId)} className="inline-flex max-w-[14rem] items-center gap-1 text-accent-600 hover:underline"><span className="text-xs capitalize text-slate-500">{t.relatedType}:</span><span className="truncate">{t.relatedName ?? "open"}</span></Link> : <Dash />; break;
    case "createdBy": body = t.createdByName ?? "Automation"; break;
    case "created": body = <span className="whitespace-nowrap">{dateTime(t.createdAt, ctx.tz)}</span>; break;
    case "completed": body = t.completedAt ? <span className="whitespace-nowrap">{dateTime(t.completedAt, ctx.tz)}</span> : <Dash />; break;
  }
  return (
    <td ref={ref} className={clsx("group/cell px-3 py-2", editing && "outline outline-2 -outline-offset-2 outline-slate-500", editable && "cursor-pointer")} onClick={(e) => { if (editable && !(e.target as HTMLElement).closest("a,button")) open(); }}>
      <div className="flex items-center">{body}{editable && <button onClick={open} className="ml-1 shrink-0 rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 focus:opacity-100 group-hover/cell:opacity-100" aria-label={`Edit ${COLUMNS[col]} for ${t.title}`}><Pencil className="h-3.5 w-3.5" /></button>}</div>
    </td>
  );
}

function DueEditor({ value, tz, onSave, onCancel }: { value: string | null; tz: string; onSave: (v: string | null) => void; onCancel: () => void }) {
  const [v, setV] = useState(value ? toLocalInput(new Date(value), tz) : "");
  const p2 = (n: number) => String(n).padStart(2, "0");
  const keyOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return (
    <div className="space-y-2 p-4">
      <p className="font-semibold">Due date</p>
      <div className="flex flex-wrap gap-1">{duePresets().slice(0, 6).map(([k, l, d]) => <button key={k} type="button" onClick={() => setV(`${keyOf(d)}T${v.slice(11) || "08:00"}`)} className="rounded-full border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50">{l.replace(/ \(.*\)/, "")}</button>)}</div>
      <label htmlFor="due-edit" className="sr-only">Due date and time</label>
      <input id="due-edit" type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} className={field} />
      <div className="flex gap-2"><button className={btn("primary", "sm")} onClick={() => onSave(v || null)}>Save</button>{value && <button className={btn("ghost", "sm")} onClick={() => onSave(null)}>Clear date</button>}<button className={btn("outline", "sm")} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function TaskPanel({ t, users, queues, ctx, pending, onClose, onPatch }: { t: WTask; users: { value: string; label: string }[]; queues: string[]; ctx: TCtx; pending: boolean; onClose: () => void; onPatch: (p: Record<string, string | null>, o: Partial<WTask>) => void }) {
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.description ?? "");
  const [due, setDue] = useState(t.dueAt ? toLocalInput(new Date(t.dueAt), ctx.tz) : "");
  const [remind, setRemind] = useState(t.remindAt ? toLocalInput(new Date(t.remindAt), ctx.tz) : "");
  const [outcome, setOutcome] = useState(t.outcome ?? "");
  const dirty = title !== t.title || notes !== (t.description ?? "") || due !== (t.dueAt ? toLocalInput(new Date(t.dueAt), ctx.tz) : "") || remind !== (t.remindAt ? toLocalInput(new Date(t.remindAt), ctx.tz) : "") || outcome !== (t.outcome ?? "");
  const sel = (label: string, value: string, opts: Record<string, string> | { value: string; label: string }[], k: string, o: (v: string) => Partial<WTask>, disabled = false) => (
    <div><Label htmlFor={`tp-${k}`}>{label}</Label><select id={`tp-${k}`} value={value} disabled={disabled || pending} onChange={(e) => onPatch({ [k]: e.target.value }, o(e.target.value))} className={field}>
      {(Array.isArray(opts) ? opts : Object.entries(opts).map(([value, label]) => ({ value, label }))).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></div>
  );
  const href = t.relatedType && t.relatedId ? RELATED_HREF[t.relatedType]?.(t.relatedId) : null;
  return (
    <aside aria-label={`Task: ${t.title}`} className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center gap-2 border-b border-slate-200 p-4">
        <button onClick={() => onPatch({ stage: t.status === "open" ? "completed" : "not_started" }, { stage: t.status === "open" ? "completed" : "not_started", status: t.status === "open" ? "done" : "open" })} className={btn(t.status === "open" ? "primary" : "outline", "sm")}>
          {t.status === "open" ? <><Check className="h-3.5 w-3.5" />Mark complete</> : "Reopen"}</button>
        <span className="text-xs text-slate-500">Created {dateTime(t.createdAt, ctx.tz)} by {t.createdByName ?? "Automation"}</span>
        <button onClick={onClose} aria-label="Close task" className="ml-auto rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div><Label htmlFor="tp-title">Title</Label><input id="tp-title" value={title} onChange={(e) => setTitle(e.target.value)} className={clsx(field, "text-base font-semibold")} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="tp-due">Due date</Label><input id="tp-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={field} /></div>
          <div><Label htmlFor="tp-rem">Reminder</Label><input id="tp-rem" type="datetime-local" value={remind} onChange={(e) => setRemind(e.target.value)} className={field} /></div>
          {sel("Task stage", t.stage, STAGES, "stage", (v) => ({ stage: v, status: v === "completed" ? "done" : v === "deferred" ? "cancelled" : "open" }))}
          {sel("Task type", t.taskType, TYPES, "taskType", (v) => ({ taskType: v }))}
          {sel("Priority", t.priority, PRIORITIES, "priority", (v) => ({ priority: v }))}
          {sel("Queue", t.queue ?? "", [{ value: "", label: "None" }, ...queues.map((x) => ({ value: x, label: x }))], "queue", (v) => ({ queue: v || null }))}
          {sel("Assigned to", t.ownerId, users, "ownerId", (v) => ({ ownerId: v, ownerName: users.find((u) => u.value === v)?.label ?? t.ownerName }), !ctx.perms.assign)}
        </div>
        <div><Label htmlFor="tp-notes">Notes</Label><textarea id="tp-notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} placeholder="Add notes…" /></div>
        <div><Label htmlFor="tp-out">Outcome</Label><input id="tp-out" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field} placeholder="What happened? (shown on the record)" /></div>
        {dirty && <div className="flex gap-2"><button disabled={pending || !title.trim()} className={btn("primary", "sm")} onClick={() => onPatch({ title, description: notes, dueAt: due || null, remindAt: remind || null, outcome }, { title, description: notes || null, dueAt: due ? new Date(due).toISOString() : null, outcome: outcome || null })}>Save changes</button>
          <button className={btn("outline", "sm")} onClick={() => { setTitle(t.title); setNotes(t.description ?? ""); setDue(t.dueAt ? toLocalInput(new Date(t.dueAt), ctx.tz) : ""); setRemind(t.remindAt ? toLocalInput(new Date(t.remindAt), ctx.tz) : ""); setOutcome(t.outcome ?? ""); }}>Discard</button></div>}
        <section className="rounded-xl border border-slate-200 p-3 text-sm">
          <h3 className="mb-2 font-semibold">Associated with</h3>
          {t.contactId && <p className="mb-1"><UserRound className="mr-1 inline h-3.5 w-3.5" /><Link href={`/contacts/${t.contactId}`} className="font-medium text-brand-700 hover:underline">{t.contactName}</Link><span className="text-slate-500"> · last contacted {ago(t.lastContactedAt, ctx.today) ?? "never"}</span></p>}
          {t.companyId && <p className="mb-1"><Building2 className="mr-1 inline h-3.5 w-3.5" /><Link href={`/companies/${t.companyId}`} className="font-medium text-brand-700 hover:underline">{t.companyName}</Link></p>}
          {href && !["contact", "company"].includes(t.relatedType!) && <p><ExternalLink className="mr-1 inline h-3.5 w-3.5" /><Link href={href} className="font-medium capitalize text-brand-700 hover:underline">{t.relatedType}: {t.relatedName ?? "open record"}</Link></p>}
          {!t.contactId && !t.companyId && !href && <p className="text-slate-500">Not linked to a record.</p>}
          <p className="mt-2 text-xs text-slate-500">This task also appears on the linked record&apos;s timeline. Changes here show there straight away, and the reverse.</p>
        </section>
      </div>
    </aside>
  );
}

function FocusMode({ list, ctx, onClose, onPatch }: { list: WTask[]; ctx: TCtx; onClose: () => void; onPatch: (t: WTask, p: Record<string, string | null>, o: Partial<WTask>) => void }) {
  const [ids] = useState(() => list.map((t) => t.id));
  const [i, setI] = useState(0);
  const [done, setDone] = useState(0);
  const t = list.find((x) => x.id === ids[i]) ?? null;
  const next = () => setI((n) => n + 1);
  if (!t || i >= ids.length) return (
    <Dialog title="All done" onClose={onClose} footer={<button className={btn("primary")} onClick={onClose}>Close</button>}>
      <p className="text-sm">You worked through {ids.length} task{ids.length === 1 ? "" : "s"} and completed {done}.</p>
    </Dialog>
  );
  const href = t.relatedType && t.relatedId ? RELATED_HREF[t.relatedType]?.(t.relatedId) : null;
  return (
    <Dialog title={`Task ${i + 1} of ${ids.length}`} onClose={onClose} wide footer={<>
      <button className={btn("ghost")} onClick={onClose}>Stop</button>
      <button className={btn("outline")} onClick={() => { const d = new Date(Date.now() + 86400000); onPatch(t, { dueAt: `${toLocalInput(d, ctx.tz).slice(0, 10)}T09:00` }, { dueAt: d.toISOString() }); next(); }}>Tomorrow</button>
      <button className={btn("outline")} onClick={next}><SkipForward className="h-4 w-4" />Skip</button>
      <button className={btn("primary")} onClick={() => { onPatch(t, { stage: "completed" }, { stage: "completed", status: "done" }); setDone((n) => n + 1); next(); }}><Check className="h-4 w-4" />Complete &amp; next</button></>}>
      <div className="space-y-3">
        <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-accent-500" style={{ width: `${(i / ids.length) * 100}%` }} /></div>
        <p className="text-lg font-semibold">{t.title}</p>
        <p className="text-sm text-slate-600">{TYPES[t.taskType]} · {PRIORITIES[t.priority]} priority · due {t.dueAt ? dateTime(t.dueAt, ctx.tz) : "any time"}</p>
        {t.description && <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{t.description}</p>}
        <div className="flex flex-wrap gap-2 text-sm">
          {t.contactId && <Link href={`/contacts/${t.contactId}`} target="_blank" className={btn("outline", "sm")}><UserRound className="h-3.5 w-3.5" />{t.contactName}<ExternalLink className="h-3 w-3" /></Link>}
          {t.companyId && <Link href={`/companies/${t.companyId}`} target="_blank" className={btn("outline", "sm")}><Building2 className="h-3.5 w-3.5" />{t.companyName}<ExternalLink className="h-3 w-3" /></Link>}
          {href && !["contact", "company"].includes(t.relatedType!) && <Link href={href} target="_blank" className={btn("outline", "sm")}>Open {t.relatedType}<ExternalLink className="h-3 w-3" /></Link>}
        </div>
        <p className="text-xs text-slate-500">Records open in a new tab, so you can log the call or email there, then come back and complete the task.</p>
      </div>
    </Dialog>
  );
}

function CreateTaskDialog({ users, queues, links, ctx, pending, onClose, onCreate }: { users: { value: string; label: string }[]; queues: string[]; links: LinkOpt[]; ctx: TCtx; pending: boolean; onClose: () => void; onCreate: (v: { title: string; taskType: string; dueAt: string; remindAt: string; priority: string; ownerId: string; description: string; queue: string; link: string }) => void }) {
  const [v, setV] = useState({ title: "", taskType: "todo", dueAt: `${duePresets()[3][2].toISOString().slice(0, 10)}T08:00`, remindAt: "", priority: "normal", ownerId: ctx.me.id, description: "", queue: "", link: "" });
  const [linkQ, setLinkQ] = useState("");
  const set = (k: string, x: string) => setV((s) => ({ ...s, [k]: x }));
  const linked = links.find((l) => l.value === v.link);
  const matches = linkQ.trim() ? links.filter((l) => `${l.label} ${l.hint ?? ""}`.toLowerCase().includes(linkQ.toLowerCase())).slice(0, 8) : [];
  return (
    <Dialog title="Create task" onClose={onClose} wide footer={<><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} disabled={pending || !v.title.trim()} onClick={() => onCreate(v)}>Create task</button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (v.title.trim()) onCreate(v); }}>
        <label htmlFor="nt-title" className="sr-only">Task title</label>
        <input id="nt-title" autoFocus value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Enter a task title" className={clsx(field, "py-2 text-base")} required />
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="nt-due">Due date</Label><input id="nt-due" type="datetime-local" value={v.dueAt} onChange={(e) => set("dueAt", e.target.value)} className={field} /></div>
          <div><Label htmlFor="nt-rem">Reminder</Label><input id="nt-rem" type="datetime-local" value={v.remindAt} onChange={(e) => set("remindAt", e.target.value)} className={field} /></div>
          <div><Label htmlFor="nt-type">Task type</Label><select id="nt-type" value={v.taskType} onChange={(e) => set("taskType", e.target.value)} className={field}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><Label htmlFor="nt-pri">Priority</Label><select id="nt-pri" value={v.priority} onChange={(e) => set("priority", e.target.value)} className={field}>{Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><Label htmlFor="nt-q">Queue</Label><select id="nt-q" value={v.queue} onChange={(e) => set("queue", e.target.value)} className={field}><option value="">None</option>{queues.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><Label htmlFor="nt-own">Assigned to</Label><select id="nt-own" value={v.ownerId} disabled={!ctx.perms.assign} onChange={(e) => set("ownerId", e.target.value)} className={field}>{users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select></div>
        </div>
        <div><Label htmlFor="nt-link">Associate with a contact, company or deal</Label>
          {linked ? <p className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"><span className="flex-1"><span className="font-medium">{linked.label}</span>{linked.hint && <span className="text-slate-500"> · {linked.hint}</span>}</span><button type="button" aria-label="Remove association" onClick={() => set("link", "")} className="rounded p-0.5 hover:bg-slate-100"><X className="h-4 w-4" /></button></p> : <>
            <input id="nt-link" value={linkQ} onChange={(e) => setLinkQ(e.target.value)} placeholder="Search by name" className={field} />
            {matches.length > 0 && <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200">{matches.map((m) => <li key={m.value}><button type="button" onClick={() => { set("link", m.value); setLinkQ(""); }} className="w-full px-2.5 py-1.5 text-left text-sm hover:bg-slate-50"><span className="font-medium">{m.label}</span>{m.hint && <span className="text-slate-500"> · {m.hint}</span>}</button></li>)}</ul>}</>}
          <p className="mt-1 text-xs text-slate-500">The task will also show on that record&apos;s timeline.</p></div>
        <div><Label htmlFor="nt-notes">Notes</Label><textarea id="nt-notes" rows={3} value={v.description} onChange={(e) => set("description", e.target.value)} className={field} placeholder="Add notes…" /></div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function AdvancedDialog({ value, onClose, onApply }: { value: Adv; onClose: () => void; onApply: (a: Adv) => void }) {
  const [a, setA] = useState(value);
  const tog = (k: "priorities" | "related", x: string) => setA({ ...a, [k]: a[k].includes(x) ? a[k].filter((y) => y !== x) : [...a[k], x] });
  return (
    <Dialog title="Advanced filters" onClose={onClose} wide footer={<><button className={btn("ghost")} onClick={() => setA(NO_ADV)}>Reset</button><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} onClick={() => onApply(a)}>Apply filters</button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">Priority is any of</legend>{Object.entries(PRIORITIES).map(([k, l]) => <label key={k} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={a.priorities.includes(k)} onChange={() => tog("priorities", k)} />{l}</label>)}</fieldset>
        <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">Associated with</legend>{[["contact", "Contact"], ["company", "Company"], ["deal", "Deal"], ["lead", "Lead"], ["ticket", "Ticket"], ["onboarding", "Onboarding"], ["__none", "Nothing"]].map(([k, l]) => <label key={k} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={a.related.includes(k)} onChange={() => tog("related", k)} />{l}</label>)}</fieldset>
        <fieldset className="space-y-1"><legend className="mb-1 text-xs font-medium text-slate-600">Other</legend>
          {([["createdByMe", "Created by me"], ["hasReminder", "Has a reminder"], ["noDueDate", "No due date"]] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={a[k]} onChange={(e) => setA({ ...a, [k]: e.target.checked })} />{l}</label>)}</fieldset>
      </div>
    </Dialog>
  );
}

