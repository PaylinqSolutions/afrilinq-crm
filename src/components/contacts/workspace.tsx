"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import {
  ArrowDown, ArrowUp, ArrowUpDown, Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, Copy, Download, ExternalLink, Filter, GitMerge, LayoutGrid,
  ListChecks, Mail, MoreVertical, PanelRightOpen, Pencil, Phone, Plus, RefreshCw, Rows3, Search, Settings2, SlidersHorizontal, StickyNote, Table2, Trash2, UserRound, X,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, Dialog, field, Label, Menu, MenuItem } from "../deals/kit";
import { DateFilterChip, OwnerFilter, Popover } from "../deals/filters";
import { matchDate, type DateFilter } from "@/lib/date-presets";
import { CONTACT_LEAD_STATUSES, LIFECYCLE_STAGES, leadStatusLabel, lifecycleLabel } from "@/lib/rules/contacts";
import {
  bulkContactsAction, deleteContactsAction, deleteContactViewAction, duplicatesAction, exportContactsAction, patchContactAction, quickCreateContactAction,
  restoreContactsAction, saveContactViewAction,
} from "@/app/actions/contacts";
import { ago, Avatar, type CCtx, type CUser, dateTime, downloadCsv, Floating, fullName, PhoneEditor, PickList, TextEditor, validEmail, type WContact } from "./kit";
import { ContactComposer, type CKind } from "./composer";
import { ContactPreview } from "./preview";

type SavedView = { id: string; name: string; query: string };
type Tab = "mine" | "unassigned" | "all" | `view:${string}`;
type Adv = { lifecycle: string[]; sources: string[]; company: "" | "yes" | "no"; email: "" | "yes" | "no"; phone: "" | "yes" | "no"; city: string };
const NO_ADV: Adv = { lifecycle: [], sources: [], company: "", email: "", phone: "", city: "" };
type Filters = { owners: string[]; created: DateFilter | null; activity: DateFilter | null; statuses: string[]; adv: Adv; metric: MetricKey | "" };
const NO_FILTERS: Filters = { owners: [], created: null, activity: null, statuses: [], adv: NO_ADV, metric: "" };
const advCount = (a: Adv) => [a.lifecycle.length, a.sources.length, a.company, a.email, a.phone, a.city].filter(Boolean).length;

const COLUMNS = {
  phone: "Phone number", email: "Email", company: "Company name", leadStatus: "Lead status", referral: "Referral source", lifecycle: "Lifecycle stage",
  owner: "Contact owner", created: "Create date", activity: "Last activity date", city: "City", jobTitle: "Job title", whatsapp: "WhatsApp",
} as const;
type Col = keyof typeof COLUMNS;
const DEFAULT_COLS: Col[] = ["phone", "referral", "company", "leadStatus", "email", "created", "city", "owner"];
type SortKey = "name" | Col;

const METRICS = { noOwner: "Contacts missing owner", noEmail: "Contacts missing email", noStatus: "Contacts missing lead status", noRecent: "Contacts with no recent activity", noPhone: "Contacts missing phone", newMonth: "Created in the last 30 days" } as const;
type MetricKey = keyof typeof METRICS;
const DAY = 86400000;

export function ContactsWorkspace({ contacts, users, companies, sources, views, ctx, initial }: {
  contacts: WContact[]; users: CUser[]; companies: { id: string; name: string }[]; sources: string[]; views: SavedView[]; ctx: CCtx;
  initial: { tab?: string; q?: string; preview?: string; status?: string; owner?: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(contacts);
  useEffect(() => setItems(contacts), [contacts]);
  const [srcs, setSrcs] = useState(sources);
  const [tab, setTab] = useState<Tab>((["mine", "unassigned", "all"].includes(initial.tab ?? "") ? initial.tab : "mine") as Tab);
  const [q, setQ] = useState(initial.q ?? "");
  const [f, setF] = useState<Filters>({ ...NO_FILTERS, statuses: initial.status ? [initial.status] : [], owners: initial.owner ? [initial.owner] : [] });
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [shownMetrics, setShownMetrics] = useState<MetricKey[]>(["noOwner", "noEmail", "noStatus", "noRecent"]);
  const [cols, setCols] = useState<Col[]>(DEFAULT_COLS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [layout, setLayout] = useState<"table" | "board">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(initial.preview ?? null);
  const [composer, setComposer] = useState<{ kind: CKind; id: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; col: Col; el: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<"" | "create" | "columns" | "advanced" | "save" | "delete" | "duplicates" | "metrics" | "bulkOwner" | "bulkStatus" | "bulkLifecycle">("");
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useMemo(() => Date.parse(`${ctx.today}T12:00:00Z`), [ctx.today]);

  // Per-browser preferences.
  useEffect(() => {
    try {
      const c = localStorage.getItem("afq.contacts.cols"); if (c) setCols(JSON.parse(c));
      const m = localStorage.getItem("afq.contacts.metrics"); if (m) setShownMetrics(JSON.parse(m));
      const p = localStorage.getItem("afq.contacts.perPage"); if (p) setPerPage(Number(p));
    } catch {}
  }, []);
  const persist = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "mine" && !tab.startsWith("view:")) p.set("tab", tab); if (q) p.set("q", q); if (previewId) p.set("preview", previewId);
    window.history.replaceState(null, "", `/contacts${p.toString() ? `?${p}` : ""}`);
  }, [tab, q, previewId]);
  useEffect(() => setPage(1), [tab, q, f, perPage]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "n" && ctx.perms.edit) setDialog("create");
      if (e.key === "Escape") { setPreviewId(null); setSelected(new Set()); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ctx.perms.edit]);

  const recent = (c: WContact) => !!c.lastActivityAt && now - Date.parse(c.lastActivityAt) < 30 * DAY;
  const metricMatch = (c: WContact, m: MetricKey) => ({
    noOwner: !c.ownerId, noEmail: !c.email, noStatus: !c.leadStatus, noRecent: !recent(c), noPhone: !c.phone, newMonth: now - Date.parse(c.createdAt) < 30 * DAY,
  })[m];

  const tabbed = useMemo(() => items.filter((c) => tab === "mine" ? c.ownerId === ctx.me.id : tab === "unassigned" ? !c.ownerId : true), [items, tab, ctx.me.id]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return tabbed.filter((c) => {
      if (term && ![fullName(c), c.email, c.companyName, c.city, c.jobTitle, c.referralSource].some((v) => v?.toLowerCase().includes(term)) && !(digits.length >= 4 && c.phone?.replace(/\D/g, "").includes(digits))) return false;
      if (f.owners.length && !f.owners.some((o) => (o === "__me" ? c.ownerId === ctx.me.id : o === "__none" ? !c.ownerId : c.ownerId === o))) return false;
      if (!matchDate(c.createdAt, f.created, ctx.today)) return false;
      if (!matchDate(c.lastActivityAt, f.activity, ctx.today)) return false;
      if (f.statuses.length && !f.statuses.includes(c.leadStatus ?? "__none")) return false;
      const a = f.adv;
      if (a.lifecycle.length && !a.lifecycle.includes(c.lifecycleStage)) return false;
      if (a.sources.length && !a.sources.includes(c.referralSource ?? "__none")) return false;
      if (a.company && (a.company === "yes") !== !!c.companyId) return false;
      if (a.email && (a.email === "yes") !== !!c.email) return false;
      if (a.phone && (a.phone === "yes") !== !!c.phone) return false;
      if (a.city && !c.city?.toLowerCase().includes(a.city.toLowerCase())) return false;
      if (f.metric && !metricMatch(c, f.metric)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabbed, q, f, ctx.me.id, ctx.today]);
  const sortVal = (c: WContact, k: SortKey): string => ({
    name: fullName(c).replace(/^(dr|engr|mr|mrs)\.?\s+/i, ""), phone: c.phone ?? "", email: c.email ?? "", company: c.companyName ?? "", leadStatus: leadStatusLabel(c.leadStatus) ?? "",
    referral: c.referralSource ?? "", lifecycle: String(LIFECYCLE_STAGES.findIndex((s) => s.key === c.lifecycleStage)).padStart(2, "0"), owner: c.ownerName ?? "", created: c.createdAt,
    activity: c.lastActivityAt ?? "", city: c.city ?? "", jobTitle: c.jobTitle ?? "", whatsapp: c.whatsapp ?? "",
  })[k].toLowerCase();
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    if (!x && y) return 1; if (x && !y) return -1; // blanks last either way
    return x.localeCompare(y) * sort.dir;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filtered, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageRows = sorted.slice((page - 1) * perPage, page * perPage);
  const filterCount = f.owners.length + (f.created ? 1 : 0) + (f.activity ? 1 : 0) + (f.statuses.length ? 1 : 0) + advCount(f.adv) + (f.metric ? 1 : 0);

  const refresh = (msg?: string) => { router.refresh(); setLastRefresh(new Date().toISOString()); if (msg) toast({ tone: "info", text: msg }); };
  const run = (fn: () => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown>; fieldErrors?: Record<string, string> }>, after?: (r: { ok: boolean; data?: Record<string, unknown> }) => void, undo?: () => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toast({ tone: "success", text: r.message ?? "Done.", action: undo ? { label: "Undo", run: undo } : undefined }); after?.(r); router.refresh(); }
    else {
      const stale = r.data?.stale;
      toast({ tone: "error", text: r.message ?? "That didn't work.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean), action: stale ? { label: "Reload", run: () => router.refresh() } : undefined });
      setItems(contacts);
    }
  });

  /** Optimistic single-field edit with conflict detection. */
  const patch = (c: WContact, p: Record<string, string | null>, optimistic: Partial<WContact>) => {
    setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, ...optimistic } : x)));
    setEdit(null);
    run(() => patchContactAction(c.id, p, c.updatedAt), (r) => {
      const d = r.data as { updatedAt: string; row: Partial<WContact> } | undefined;
      if (d) setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, ...d.row, updatedAt: d.updatedAt } : x)));
    });
  };

  const allOnPage = pageRows.length > 0 && pageRows.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allOnPage) pageRows.forEach((c) => n.delete(c.id)); else pageRows.forEach((c) => n.add(c.id)); return n; });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const applyView = (v: SavedView) => {
    try {
      const s = JSON.parse(v.query) as { f: Filters; q: string; cols?: Col[]; sort?: typeof sort; base?: Tab };
      setF({ ...NO_FILTERS, ...s.f, adv: { ...NO_ADV, ...s.f.adv } }); setQ(s.q ?? ""); if (s.cols) setCols(s.cols); if (s.sort) setSort(s.sort);
      setTab(`view:${v.id}`); toast({ tone: "info", text: `Showing “${v.name}”.` });
    } catch { toast({ tone: "error", text: "This saved view is damaged and can't be opened." }); }
  };
  const viewTabs = views.map((v) => ({ ...v, active: tab === `view:${v.id}` }));
  const exportRows = (ids: string[]) => run(() => exportContactsAction(ids), (r) => downloadCsv(String(r.data?.csv ?? ""), `contacts-${ctx.today}.csv`));
  const sortBy = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === "created" || k === "activity" ? -1 : 1 }));
  const selIds = [...selected];
  const previewContact = items.find((c) => c.id === previewId) ?? null;
  const composerContact = composer ? items.find((c) => c.id === composer.id) : null;

  const metricCounts = useMemo(() => Object.fromEntries((Object.keys(METRICS) as MetricKey[]).map((m) => [m, tabbed.filter((c) => metricMatch(c, m)).length])) as Record<MetricKey, number>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabbed, now]);

  return (
    <div>
      <div>
        {/* Header */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Menu label={<span className="text-2xl font-semibold text-ink-950">Contacts</span>} ariaLabel="Switch record type">
            {(close) => <>
              <MenuItem onClick={close} hint="current"><UserRound className="h-4 w-4" />Contacts</MenuItem>
              <MenuItem onClick={() => { close(); router.push("/companies"); }}>Companies</MenuItem>
              <MenuItem onClick={() => { close(); router.push("/leads"); }}>Leads</MenuItem>
              <MenuItem onClick={() => { close(); router.push("/deals"); }}>Deals</MenuItem>
            </>}
          </Menu>
          <div className="ml-auto flex items-center gap-2">
            <Menu icon={<MoreVertical className="h-4 w-4" />} ariaLabel="More contact actions" variant="outline" align="right">
              {(close) => <>
                <MenuItem disabled={!ctx.perms.export} onClick={() => { close(); if (ctx.perms.export) exportRows(sorted.map((c) => c.id)); else toast({ tone: "error", text: "You don't have permission to export." }); }}><Download className="h-4 w-4" />Export this view ({sorted.length})</MenuItem>
                <MenuItem onClick={() => { close(); setDialog("columns"); }}><Columns3 className="h-4 w-4" />Edit columns</MenuItem>
                <MenuItem onClick={() => { close(); setDialog("duplicates"); }}><GitMerge className="h-4 w-4" />Find duplicates</MenuItem>
                <MenuItem onClick={() => { close(); toast({ tone: "info", text: "Importing from a spreadsheet is coming later. For now, add contacts one at a time or ask an admin." }); }} hint="Coming later">Import</MenuItem>
              </>}
            </Menu>
            <button onClick={() => setDialog("duplicates")} className={clsx(btn("outline"), "!rounded-full !p-2")} aria-label="Find duplicate contacts" title="Find duplicate contacts"><GitMerge className="h-4 w-4" /></button>
            {ctx.perms.edit && (
              <Menu label="Add contacts" variant="primary" align="right">
                {(close) => <>
                  <MenuItem onClick={() => { close(); setDialog("create"); }} hint="N">Create contact</MenuItem>
                  <MenuItem onClick={() => { close(); router.push("/contacts/new"); }}>Create with all fields</MenuItem>
                  <MenuItem onClick={() => { close(); toast({ tone: "info", text: "Spreadsheet import is coming later." }); }} hint="Coming later">Import</MenuItem>
                </>}
              </Menu>
            )}
          </div>
        </div>

        {/* View tabs */}
        <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Contact views">
          {([["mine", "My contacts"], ["unassigned", "Unassigned contacts"], ["all", "All contacts"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSelected(new Set()); }}
              className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-brand-600 bg-slate-100 text-ink-950" : "border-transparent text-slate-600 hover:text-slate-900")}>
              <Table2 className="h-4 w-4" aria-hidden />{l}<span className="rounded-full bg-white px-1.5 text-xs text-slate-500 ring-1 ring-slate-200">{items.filter((c) => k === "mine" ? c.ownerId === ctx.me.id : k === "unassigned" ? !c.ownerId : true).length}</span>
            </button>
          ))}
          {viewTabs.map((v) => (
            <span key={v.id} className={clsx("inline-flex items-center rounded-t-lg border-b-2", v.active ? "border-brand-600 bg-slate-100" : "border-transparent")}>
              <button role="tab" aria-selected={v.active} onClick={() => applyView(v)} className="whitespace-nowrap px-3 py-2 text-sm font-medium text-slate-700">{v.name}</button>
              <button aria-label={`Delete view ${v.name}`} onClick={() => { if (confirm(`Delete the view “${v.name}”?`)) run(() => deleteContactViewAction(v.id), () => setTab("mine")); }} className="mr-1 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          <button onClick={() => setDialog("save")} className="ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Save current filters as a view" title="Save current filters as a view"><Plus className="h-4 w-4" /></button>
        </div>

        {/* Toolbar */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ( / )" aria-label="Search contacts by name, email, phone, company or city" className="w-full rounded-full border border-slate-300 py-2 pl-9 pr-8 text-sm" />
            {q && <button aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-2 rounded-full p-0.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
          </div>
          <button onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium", filterCount ? "border-accent-400 bg-accent-50 text-accent-600" : "border-slate-300 text-slate-700 hover:bg-slate-50")}>
            <Filter className="h-4 w-4" aria-hidden />Filter{filterCount ? ` (${filterCount})` : ""}
          </button>
          <Menu label={<span className="inline-flex items-center gap-1.5"><ArrowUpDown className="h-4 w-4" aria-hidden />Sort by{sort.key !== "created" || sort.dir !== -1 ? `: ${sort.key === "name" ? "Name" : COLUMNS[sort.key]}` : ""}</span>} variant="outline">
            {(close) => <>
              {(["name", ...Object.keys(COLUMNS)] as SortKey[]).map((k) => (
                <MenuItem key={k} onClick={() => { close(); sortBy(k); }} hint={sort.key === k ? (sort.dir === 1 ? "A→Z ↑" : "Z→A ↓") : undefined}>{k === "name" ? "Name" : COLUMNS[k as Col]}</MenuItem>
              ))}
            </>}
          </Menu>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-full border border-slate-300 p-0.5" role="group" aria-label="Layout">
              <button aria-pressed={layout === "board"} onClick={() => setLayout("board")} className={clsx("rounded-full p-1.5", layout === "board" ? "bg-slate-200" : "hover:bg-slate-100")} aria-label="Board by lead status" title="Board by lead status"><LayoutGrid className="h-4 w-4" /></button>
              <button aria-pressed={layout === "table"} onClick={() => setLayout("table")} className={clsx("rounded-full p-1.5", layout === "table" ? "bg-slate-200" : "hover:bg-slate-100")} aria-label="Table" title="Table"><Rows3 className="h-4 w-4" /></button>
            </div>
            <button onClick={() => setDialog("columns")} className="rounded-full border border-slate-300 p-2 hover:bg-slate-50" aria-label="Edit columns" title="Edit columns"><Settings2 className="h-4 w-4" /></button>
            <button onClick={() => setMetricsOpen((o) => !o)} aria-expanded={metricsOpen} className="rounded-full border border-slate-300 p-2 hover:bg-slate-50" aria-label={metricsOpen ? "Hide summary" : "Show summary"} title={metricsOpen ? "Hide summary" : "Show summary"}>{metricsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
          </div>
        </div>

        {filtersOpen && (
          <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2">
            <OwnerFilter label="Contact owner" users={users} value={f.owners} onChange={(owners) => setF({ ...f, owners })} meId={ctx.me.id} unassigned />
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <DateFilterChip label="Create date" value={f.created} onChange={(created) => setF({ ...f, created })} />
            <DateFilterChip label="Last activity date" value={f.activity} onChange={(activity) => setF({ ...f, activity })} />
            <StatusFilter value={f.statuses} onChange={(statuses) => setF({ ...f, statuses })} />
            {f.metric && <span className="inline-flex items-center gap-1 rounded-lg bg-accent-50 px-2.5 py-1.5 text-sm font-semibold text-accent-600">{METRICS[f.metric]}<button aria-label="Remove summary filter" onClick={() => setF({ ...f, metric: "" })}><X className="h-3.5 w-3.5" /></button></span>}
            {advCount(f.adv) > 0 && <span className="inline-flex items-center gap-1 rounded-lg bg-accent-50 px-2.5 py-1.5 text-sm font-semibold text-accent-600">Advanced ({advCount(f.adv)})<button aria-label="Remove advanced filters" onClick={() => setF({ ...f, adv: NO_ADV })}><X className="h-3.5 w-3.5" /></button></span>}
            <button onClick={() => { setF(NO_FILTERS); setQ(""); toast({ tone: "info", text: "Filters cleared." }); }} disabled={!filterCount && !q} className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40">Clear all</button>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <button onClick={() => setDialog("advanced")} className="rounded-full border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Add a filter" title="Add a filter"><Plus className="h-4 w-4" /></button>
            <button onClick={() => setDialog("advanced")} className="rounded-full border border-slate-300 p-1.5 hover:bg-slate-50" aria-label="Edit filters" title="Edit filters"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => setDialog("advanced")} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><SlidersHorizontal className="h-4 w-4" aria-hidden />Advanced filters</button>
          </div>
        )}

        {/* Data-quality summary */}
        {metricsOpen && (
          <section aria-label="Contact data quality" className="relative mb-4 rounded-xl border border-slate-200 p-4">
            <button onClick={() => setDialog("metrics")} className="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Choose summary cards" title="Choose summary cards"><Settings2 className="h-4 w-4" /></button>
            <div className={clsx("grid gap-3", shownMetrics.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : shownMetrics.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
              {shownMetrics.map((m) => (
                <button key={m} onClick={() => { setF({ ...f, metric: f.metric === m ? "" : m }); toast({ tone: "info", text: f.metric === m ? "Summary filter removed." : `Showing ${METRICS[m].toLowerCase()}.` }); }}
                  aria-pressed={f.metric === m} title={`Click to ${f.metric === m ? "remove this filter" : "show only these contacts"}`}
                  className={clsx("rounded-lg px-2 py-2 text-center transition hover:bg-slate-50", f.metric === m && "bg-accent-50 ring-2 ring-accent-400")}>
                  <span className="block truncate text-xs font-semibold uppercase tracking-wide text-slate-700">{METRICS[m]}</span>
                  <span className="mt-1 block text-3xl font-bold text-accent-600">{metricCounts[m].toLocaleString("en-US")}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
            <span className="font-semibold">{selected.size} selected</span>
            {ctx.perms.edit && <button className={btn("outline", "sm")} onClick={() => setDialog("bulkOwner")}><UserRound className="h-3.5 w-3.5" />Assign owner</button>}
            {ctx.perms.edit && <button className={btn("outline", "sm")} onClick={() => setDialog("bulkStatus")}>Set lead status</button>}
            {ctx.perms.edit && <button className={btn("outline", "sm")} onClick={() => setDialog("bulkLifecycle")}>Set lifecycle stage</button>}
            {ctx.perms.export && <button className={btn("outline", "sm")} onClick={() => exportRows(selIds)}><Download className="h-3.5 w-3.5" />Export</button>}
            {ctx.perms.delete && <button className={btn("outline", "sm")} onClick={() => setDialog("delete")}><Trash2 className="h-3.5 w-3.5" />Delete</button>}
            <button className={clsx(btn("ghost", "sm"), "ml-auto")} onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}

        {layout === "table" ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAll} className="h-4 w-4" /></th>
                  <th className="px-2 py-2.5 font-medium"><SortHead label="Name" k="name" sort={sort} onSort={sortBy} /></th>
                  {cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-medium"><SortHead label={COLUMNS[c]} k={c} sort={sort} onSort={sortBy} /></th>)}
                  <th className="w-10 px-2"><button onClick={() => setDialog("columns")} aria-label="Add or remove columns" title="Add or remove columns" className="rounded p-1 hover:bg-slate-200"><Plus className="h-4 w-4" /></button></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => (
                  <tr key={c.id} className={clsx("group border-t border-slate-100", selected.has(c.id) ? "bg-brand-50/60" : previewId === c.id ? "bg-slate-50" : "hover:bg-slate-50")}>
                    <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${fullName(c)}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4" /></td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPreviewId(previewId === c.id ? null : c.id)} aria-label={`Quick view ${fullName(c)}`} title="Quick view" className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><ChevronRight className={clsx("h-4 w-4 transition", previewId === c.id && "rotate-90")} /></button>
                        <Avatar name={fullName(c)} />
                        <Link href={`/contacts/${c.id}`} className="max-w-[12rem] truncate font-semibold text-accent-600 hover:underline" title={`Open ${fullName(c)}`}>{fullName(c)}</Link>
                        <button onClick={() => setPreviewId(c.id)} className="rounded-full border border-slate-300 p-1 text-slate-500 opacity-0 transition hover:bg-white group-hover:opacity-100 focus:opacity-100" aria-label={`Preview ${fullName(c)}`} title="Preview"><PanelRightOpen className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                    {cols.map((col) => <Cell key={col} c={c} col={col} ctx={ctx} today={ctx.today} onEdit={(el) => setEdit({ id: c.id, col, el })} editing={edit?.id === c.id && edit.col === col} />)}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
            {!pageRows.length && (
              <div className="grid place-items-center gap-2 px-4 py-14 text-center">
                <Search className="h-10 w-10 text-slate-300" aria-hidden />
                <p className="font-semibold text-ink-950">{tab === "mine" && !tabbed.length ? "You don't own any contacts yet." : "No contacts match the current filters."}</p>
                <p className="text-sm text-slate-600">{tab === "mine" && !tabbed.length ? "Switch to All contacts, or add one." : "Change filters to broaden your search."}</p>
                <div className="flex gap-2">
                  {(filterCount > 0 || q) && <button className={btn("outline", "sm")} onClick={() => { setF(NO_FILTERS); setQ(""); }}>Clear filters</button>}
                  {tab !== "all" && <button className={btn("outline", "sm")} onClick={() => setTab("all")}>Show all contacts</button>}
                  {ctx.perms.edit && <button className={btn("primary", "sm")} onClick={() => setDialog("create")}>Create contact</button>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Board rows={sorted} ctx={ctx} dropOn={dropOn} setDropOn={setDropOn} onOpen={setPreviewId}
            onMove={(c, status) => { if ((c.leadStatus ?? null) === status) return; patch(c, { leadStatus: status }, { leadStatus: status }); }} />
        )}

        {/* Pagination + footer */}
        {layout === "table" && sorted.length > 0 && (
          <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-center gap-1 text-sm">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium disabled:opacity-40 enabled:hover:bg-slate-100"><ChevronLeft className="h-4 w-4" />Prev</button>
            {pageNumbers(page, pages).map((n, i) => n === 0 ? <span key={`gap${i}`} className="px-1 text-slate-400">…</span> :
              <button key={n} aria-current={n === page ? "page" : undefined} onClick={() => setPage(n)} className={clsx("min-w-8 rounded-lg px-2 py-1 font-medium", n === page ? "border border-slate-400 bg-white" : "hover:bg-slate-100")}>{n}</button>)}
            <button disabled={page === pages} onClick={() => setPage(page + 1)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium disabled:opacity-40 enabled:hover:bg-slate-100">Next<ChevronRight className="h-4 w-4" /></button>
            <label htmlFor="per-page" className="sr-only">Rows per page</label>
            <select id="per-page" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); persist("afq.contacts.perPage", Number(e.target.value)); }} className="ml-2 rounded-lg border-0 bg-transparent font-semibold">
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
            </select>
          </nav>
        )}
        <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold">{sorted.length.toLocaleString("en-US")} contact{sorted.length === 1 ? "" : "s"}{sorted.length !== tabbed.length && <span className="font-normal text-slate-500"> of {tabbed.length}</span>}</span>
          {lastRefresh && <span className="text-xs text-slate-500">Refreshed</span>}
          <div className="ml-auto flex gap-2">
            <button onClick={() => refresh("Contacts refreshed with the latest changes.")} className={clsx(btn("outline"), "!rounded-full")} aria-label="Refresh" title="Refresh"><RefreshCw className={clsx("h-4 w-4", pending && "animate-spin")} /></button>
            <button onClick={() => ctx.perms.export ? exportRows(sorted.map((c) => c.id)) : toast({ tone: "error", text: "You don't have permission to export. Ask an admin for the export permission." })} disabled={!sorted.length} className={clsx(btn("outline"), "!rounded-full")}><Download className="h-4 w-4" />Export</button>
            <button onClick={() => setDialog("save")} className={clsx(btn("outline"), "!rounded-full")} title="Save these filters and columns as a new view"><Copy className="h-4 w-4" />Clone</button>
          </div>
        </footer>
      </div>

      {/* Inline editors */}
      {edit && (() => {
        const c = items.find((x) => x.id === edit.id);
        if (!c) return null;
        const close = () => setEdit(null);
        if (!ctx.perms.edit) return <Floating anchor={edit.el} onClose={close} width={260}><p className="p-4 text-sm text-slate-600">You can view but not edit contacts. Ask a manager for edit access.</p></Floating>;
        if (edit.col === "phone" || edit.col === "whatsapp") return <Floating anchor={edit.el} onClose={close} width={460}><PhoneEditor label={COLUMNS[edit.col]} value={c[edit.col]} busy={pending} onCancel={close} onSave={(v) => patch(c, { [edit.col]: v }, { [edit.col]: v })} /></Floating>;
        if (edit.col === "email") return <Floating anchor={edit.el} onClose={close} width={360}><TextEditor label="Email" type="email" value={c.email} validate={validEmail} busy={pending} onCancel={close} onSave={(v) => patch(c, { email: v }, { email: v })} /></Floating>;
        if (edit.col === "city" || edit.col === "jobTitle") return <Floating anchor={edit.el} onClose={close} width={320}><TextEditor label={COLUMNS[edit.col]} value={c[edit.col]} busy={pending} onCancel={close} onSave={(v) => patch(c, { [edit.col]: v }, { [edit.col]: v })} /></Floating>;
        if (edit.col === "referral") return <Floating anchor={edit.el} onClose={close} width={300}><PickList allowNew placeholder="Search or add a source" clearLabel="Clear referral source" value={c.referralSource} options={srcs.map((s) => ({ value: s, label: s }))}
          onPick={(v) => { if (v && !srcs.includes(v)) { setSrcs([...srcs, v].sort()); } patch(c, { referralSource: v }, { referralSource: v }); }} /></Floating>;
        if (edit.col === "leadStatus") return <Floating anchor={edit.el} onClose={close} width={280}><PickList clearLabel="Clear lead status" value={c.leadStatus} options={CONTACT_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label }))} onPick={(v) => patch(c, { leadStatus: v }, { leadStatus: v })} /></Floating>;
        if (edit.col === "lifecycle") return <Floating anchor={edit.el} onClose={close} width={280}><PickList value={c.lifecycleStage} options={LIFECYCLE_STAGES.map((s) => ({ value: s.key, label: s.label }))} onPick={(v) => v && patch(c, { lifecycleStage: v }, { lifecycleStage: v })} /></Floating>;
        if (edit.col === "owner") return <Floating anchor={edit.el} onClose={close} width={280}><PickList clearLabel="Unassign" value={c.ownerId} options={users.map((u) => ({ value: u.id, label: u.id === ctx.me.id ? `${u.name} (you)` : u.name }))} onPick={(v) => patch(c, { ownerId: v }, { ownerId: v, ownerName: users.find((u) => u.id === v)?.name ?? null })} /></Floating>;
        if (edit.col === "company") return <Floating anchor={edit.el} onClose={close} width={320}><PickList placeholder="Search companies" clearLabel="Remove company" value={c.companyId} options={companies.map((x) => ({ value: x.id, label: x.name }))} onPick={(v) => patch(c, { companyId: v }, { companyId: v, companyName: companies.find((x) => x.id === v)?.name ?? null })} /></Floating>;
        return null;
      })()}

      {previewContact && <ContactPreview key={previewContact.id} contact={previewContact} users={users} ctx={ctx} onClose={() => setPreviewId(null)} onCompose={(kind) => setComposer({ kind, id: previewContact.id })}
        onPatch={(p, o) => patch(previewContact, p, o)} sources={srcs} companies={companies} />}
      {composer && composerContact && <ContactComposer kind={composer.kind} users={users} ctx={ctx} onClose={() => setComposer(null)} onSwitch={(kind) => setComposer({ ...composer, kind })} onDone={() => router.refresh()}
        contact={{ id: composerContact.id, name: fullName(composerContact), email: composerContact.email, phone: composerContact.phone, whatsapp: composerContact.whatsapp, companyName: composerContact.companyName }} />}

      {dialog === "create" && <CreateDialog users={users} companies={companies} sources={srcs} ctx={ctx} pending={pending} onClose={() => setDialog("")}
        onCreate={(v, open) => run(() => quickCreateContactAction(v), (r) => { setDialog(""); setTab("all"); if (open && r.data?.id) router.push(`/contacts/${r.data.id}`); })} />}
      {dialog === "columns" && <ColumnsDialog cols={cols} onClose={() => setDialog("")} onSave={(c) => { setCols(c); persist("afq.contacts.cols", c); setDialog(""); toast({ tone: "success", text: "Columns updated." }); }} />}
      {dialog === "metrics" && (
        <Dialog title="Summary cards" onClose={() => setDialog("")} footer={<button className={btn("primary")} onClick={() => setDialog("")}>Done</button>}>
          <p className="mb-2 text-sm text-slate-600">Pick up to four. Click a card on the page to filter the list.</p>
          {(Object.keys(METRICS) as MetricKey[]).map((m) => (
            <label key={m} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" className="h-4 w-4" checked={shownMetrics.includes(m)} disabled={!shownMetrics.includes(m) && shownMetrics.length >= 4}
              onChange={() => { const n = shownMetrics.includes(m) ? shownMetrics.filter((x) => x !== m) : [...shownMetrics, m]; if (!n.length) return; setShownMetrics(n); persist("afq.contacts.metrics", n); }} />{METRICS[m]}</label>
          ))}
        </Dialog>
      )}
      {dialog === "advanced" && <AdvancedDialog value={f.adv} sources={srcs} onClose={() => setDialog("")} onApply={(adv) => { setF({ ...f, adv }); setDialog(""); toast({ tone: "info", text: `Advanced filters applied (${advCount(adv)}).` }); }} />}
      {dialog === "save" && <SaveViewDialog pending={pending} onClose={() => setDialog("")} onSave={(name) => run(() => saveContactViewAction(name, JSON.stringify({ f, q, cols, sort })), (r) => { setDialog(""); if (r.data?.id) setTab(`view:${r.data.id}`); })} />}
      {dialog === "delete" && <DeleteDialog count={selected.size} pending={pending} onClose={() => setDialog("")} onConfirm={(reason) => {
        const ids = selIds;
        setItems((xs) => xs.filter((x) => !ids.includes(x.id)));
        run(() => deleteContactsAction(ids, reason), () => { setSelected(new Set()); setDialog(""); }, () => run(() => restoreContactsAction(ids)));
      }} />}
      {(dialog === "bulkOwner" || dialog === "bulkStatus" || dialog === "bulkLifecycle") && (
        <Dialog title={dialog === "bulkOwner" ? `Assign ${selected.size} contact(s)` : dialog === "bulkStatus" ? `Set lead status for ${selected.size} contact(s)` : `Set lifecycle stage for ${selected.size} contact(s)`} onClose={() => setDialog("")}>
          <PickList clearLabel={dialog === "bulkOwner" ? "Unassign" : dialog === "bulkStatus" ? "Clear lead status" : undefined} value={null}
            options={dialog === "bulkOwner" ? users.map((u) => ({ value: u.id, label: u.name })) : dialog === "bulkStatus" ? CONTACT_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label })) : LIFECYCLE_STAGES.map((s) => ({ value: s.key, label: s.label }))}
            onPick={(v) => {
              const p = dialog === "bulkOwner" ? { ownerId: v } : dialog === "bulkStatus" ? { leadStatus: v } : { lifecycleStage: v ?? "lead" };
              run(() => bulkContactsAction(selIds, p), () => { setDialog(""); setSelected(new Set()); });
            }} busy={pending} />
        </Dialog>
      )}
      {dialog === "duplicates" && <DuplicatesDialog onClose={() => setDialog("")} onOpen={(id) => { setDialog(""); setPreviewId(id); }} />}
    </div>
  );
}

export function pageNumbers(page: number, pages: number) {
  if (pages <= 8) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page - 1, page, page + 1, ...(page <= 4 ? [2, 3, 4, 5] : []), ...(page >= pages - 3 ? [pages - 4, pages - 3, pages - 2, pages - 1] : [])].filter((n) => n >= 1 && n <= pages));
  const list = [...set].sort((a, b) => a - b);
  return list.flatMap((n, i) => (i && n - list[i - 1] > 1 ? [0, n] : [n]));
}

export function SortHead<K extends string>({ label, k, sort, onSort }: { label: string; k: K; sort: { key: K; dir: 1 | -1 }; onSort: (k: K) => void }) {
  const on = sort.key === k;
  return (
    <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-200" aria-label={`Sort by ${label}${on ? (sort.dir === 1 ? ", currently ascending" : ", currently descending") : ""}`}>
      {label}{on ? (sort.dir === 1 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40" />}
    </button>
  );
}

const Dash = () => <span className="text-slate-400">--</span>;
function Cell({ c, col, ctx, today, onEdit, editing }: { c: WContact; col: Col; ctx: CCtx; today: string; onEdit: (el: HTMLElement) => void; editing: boolean }) {
  const ref = useRef<HTMLTableCellElement>(null);
  const open = () => ref.current && onEdit(ref.current);
  const editable = !["created", "activity"].includes(col);
  const editBtn = editable ? <button onClick={open} className="ml-1 shrink-0 rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 focus:opacity-100 group-hover/cell:opacity-100" aria-label={`Edit ${COLUMNS[col]} for ${fullName(c)}`}><Pencil className="h-3.5 w-3.5" /></button> : null;
  let body: React.ReactNode;
  switch (col) {
    case "phone": case "whatsapp": {
      const v = c[col];
      body = v ? <a href={col === "phone" ? `tel:${v.replace(/[^\d+]/g, "")}` : `https://wa.me/${v.replace(/\D/g, "")}`} target={col === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer" className="whitespace-nowrap font-semibold text-accent-600 hover:underline" title={col === "phone" ? `Call ${v}` : `Open WhatsApp chat with ${v}`}>{v}</a> : <Dash />;
      break;
    }
    case "email": body = c.email ? <a href={`mailto:${c.email}`} className="inline-flex max-w-[14rem] items-center gap-1 font-semibold text-accent-600 hover:underline" title={`Email ${c.email}`}><span className="truncate">{c.email}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden /></a> : <Dash />; break;
    case "company": body = c.companyId ? <Link href={`/companies/${c.companyId}`} className="block max-w-[14rem] truncate hover:underline" title={c.companyName ?? ""}>{c.companyName}</Link> : <Dash />; break;
    case "leadStatus": body = c.leadStatus ? <span className="max-w-[10rem] truncate" title={leadStatusLabel(c.leadStatus) ?? ""}>{leadStatusLabel(c.leadStatus)}</span> : <Dash />; break;
    case "referral": body = c.referralSource ? <span className="inline-flex max-w-[14rem] items-center gap-1.5" title={c.referralSource}><span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden /><span className="truncate">{c.referralSource}</span></span> : <Dash />; break;
    case "lifecycle": body = lifecycleLabel(c.lifecycleStage); break;
    case "owner": body = c.ownerName ? <span className="truncate">{c.ownerName}{c.ownerId === ctx.me.id && <span className="text-xs text-slate-500"> (you)</span>}</span> : <span className="italic text-slate-400">No owner</span>; break;
    case "created": body = <span className="whitespace-nowrap" title={dateTime(c.createdAt, ctx.tz) ?? ""}>{dateTime(c.createdAt, ctx.tz)}</span>; break;
    case "activity": body = c.lastActivityAt ? <span className="whitespace-nowrap" title={dateTime(c.lastActivityAt, ctx.tz) ?? ""}>{ago(c.lastActivityAt, today)}</span> : <Dash />; break;
    case "city": body = c.city ?? <Dash />; break;
    case "jobTitle": body = c.jobTitle ? <span className="block max-w-[12rem] truncate" title={c.jobTitle}>{c.jobTitle}</span> : <Dash />; break;
  }
  // Clicking the empty part of an editable cell opens its editor; links inside keep working.
  return (
    <td ref={ref} className={clsx("group/cell px-3 py-2", editing && "outline outline-2 -outline-offset-2 outline-slate-500", editable && "cursor-pointer")}
      onClick={(e) => { if (editable && !(e.target as HTMLElement).closest("a,button")) open(); }}>
      <div className="flex items-center">{body}{editBtn}</div>
    </td>
  );
}

export function StatusFilter({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const [op, setOp] = useState<"any" | "none">("any");
  const opts = [{ key: "__none", label: "No lead status" }, ...CONTACT_LEAD_STATUSES].filter((s) => s.label.toLowerCase().includes(q.toLowerCase()));
  const all = CONTACT_LEAD_STATUSES.every((s) => value.includes(s.key));
  const set = (v: string[]) => onChange(op === "none" ? ["__none", ...CONTACT_LEAD_STATUSES.map((s) => s.key)].filter((k) => !v.includes(k)) : v);
  return (
    <Popover chip={<>Lead status{value.length ? ` (${value.length})` : ""}</>} active={value.length > 0} onClear={() => onChange([])} width="w-80">
      {() => <>
        <label htmlFor="ls-op" className="sr-only">Operator</label>
        <select id="ls-op" value={op} onChange={(e) => setOp(e.target.value as "any" | "none")} className="mb-2 rounded-md border-0 bg-transparent p-0 text-sm font-medium text-slate-700"><option value="any">is any of</option><option value="none">is none of</option></select>
        <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search lead statuses" className="w-full rounded-full border-2 border-brand-500 py-1.5 pl-8 pr-3 text-sm" /></div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 font-semibold hover:bg-slate-50"><input type="checkbox" checked={all} onChange={() => onChange(all ? [] : CONTACT_LEAD_STATUSES.map((s) => s.key))} className="h-4 w-4" />Select all</label>
        <ul className="max-h-64 overflow-y-auto pl-4">
          {opts.map((s) => <li key={s.key}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50" title={s.label}>
            <input type="checkbox" checked={value.includes(s.key)} onChange={() => set(value.includes(s.key) ? value.filter((x) => x !== s.key) : [...value, s.key])} className="h-4 w-4" />
            <span className={clsx(s.key === "__none" && "italic text-slate-600")}>{s.label}</span></label></li>)}
          {!opts.length && <li className="px-2 py-3 text-sm text-slate-500">No statuses match.</li>}
        </ul>
      </>}
    </Popover>
  );
}

function Board({ rows, ctx, dropOn, setDropOn, onMove, onOpen }: { rows: WContact[]; ctx: CCtx; dropOn: string | null; setDropOn: (s: string | null) => void; onMove: (c: WContact, s: string | null) => void; onOpen: (id: string) => void }) {
  const cols = [{ key: "__none", label: "No lead status" }, ...CONTACT_LEAD_STATUSES];
  return (
    <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Contacts by lead status">
      {cols.map((s) => {
        const list = rows.filter((c) => (c.leadStatus ?? "__none") === s.key);
        return (
          <section key={s.key} aria-label={`${s.label}, ${list.length} contacts`} onDragOver={(e) => { if (ctx.perms.edit) { e.preventDefault(); setDropOn(s.key); } }} onDragLeave={() => setDropOn(null)}
            onDrop={(e) => { e.preventDefault(); setDropOn(null); const c = rows.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (c) onMove(c, s.key === "__none" ? null : s.key); }}
            className={clsx("flex w-64 shrink-0 flex-col rounded-xl border bg-slate-50", dropOn === s.key ? "border-accent-500 ring-2 ring-accent-400" : "border-slate-200")}>
            <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm font-semibold"><span className="truncate">{s.label}</span><span className="rounded-full bg-white px-2 text-xs text-slate-600 ring-1 ring-slate-200">{list.length}</span></header>
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
              {list.slice(0, 100).map((c) => (
                <li key={c.id} draggable={ctx.perms.edit} onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)} className="cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-sm hover:border-slate-300">
                  <div className="flex items-center gap-2"><Avatar name={fullName(c)} /><Link href={`/contacts/${c.id}`} className="truncate font-semibold text-accent-600 hover:underline">{fullName(c)}</Link></div>
                  <p className="mt-1 truncate text-xs text-slate-600">{c.companyName ?? "No company"}{c.city ? ` · ${c.city}` : ""}</p>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500"><span>{c.ownerName ?? "No owner"}</span><button onClick={() => onOpen(c.id)} className="rounded px-1 hover:bg-slate-100">Preview</button></div>
                </li>
              ))}
              {list.length > 100 && <li className="px-1 text-xs text-slate-500">+{list.length - 100} more — use filters or the table to narrow down.</li>}
              {!list.length && <li className="px-1 py-4 text-center text-xs text-slate-400">{ctx.perms.edit ? "Drag contacts here" : "None"}</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CreateDialog({ users, companies, sources, ctx, pending, onClose, onCreate }: { users: CUser[]; companies: { id: string; name: string }[]; sources: string[]; ctx: CCtx; pending: boolean; onClose: () => void; onCreate: (v: Record<string, string | boolean>, open: boolean) => void }) {
  const [v, setV] = useState<Record<string, string>>({ firstName: "", lastName: "", email: "", phone: "", jobTitle: "", companyId: "", ownerId: ctx.me.id, leadStatus: "new", lifecycleStage: "lead", referralSource: "", city: "" });
  const [open, setOpen] = useState(false);
  const set = (k: string, x: string) => setV((s) => ({ ...s, [k]: x }));
  const emailErr = v.email && validEmail(v.email);
  return (
    <Dialog title="Create contact" onClose={onClose} wide footer={<>
      <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="h-4 w-4" />Open the record after creating</label>
      <button className={btn("outline")} onClick={onClose}>Cancel</button>
      <button className={btn("primary")} disabled={pending || !v.firstName.trim() || !v.lastName.trim() || !!emailErr} onClick={() => onCreate(v, open)}>Create</button></>}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onCreate(v, open); }}>
        <div><Label htmlFor="nc-f">First name *</Label><input id="nc-f" autoFocus value={v.firstName} onChange={(e) => set("firstName", e.target.value)} className={field} required /></div>
        <div><Label htmlFor="nc-l">Last name *</Label><input id="nc-l" value={v.lastName} onChange={(e) => set("lastName", e.target.value)} className={field} required /></div>
        <div><Label htmlFor="nc-e">Email</Label><input id="nc-e" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} className={field} />{emailErr && <p className="mt-1 text-xs text-red-700">{emailErr}</p>}</div>
        <div><Label htmlFor="nc-p">Phone number</Label><input id="nc-p" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0803 481 9348" className={field} /></div>
        <div><Label htmlFor="nc-j">Job title</Label><input id="nc-j" value={v.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} className={field} /></div>
        <div><Label htmlFor="nc-c">Company</Label><select id="nc-c" value={v.companyId} onChange={(e) => set("companyId", e.target.value)} className={field}><option value="">— None yet —</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><Label htmlFor="nc-o">Contact owner</Label><select id="nc-o" value={v.ownerId} onChange={(e) => set("ownerId", e.target.value)} className={field}><option value="">No owner</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><Label htmlFor="nc-s">Lead status</Label><select id="nc-s" value={v.leadStatus} onChange={(e) => set("leadStatus", e.target.value)} className={field}><option value="">—</option>{CONTACT_LEAD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
        <div><Label htmlFor="nc-lc">Lifecycle stage</Label><select id="nc-lc" value={v.lifecycleStage} onChange={(e) => set("lifecycleStage", e.target.value)} className={field}>{LIFECYCLE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
        <div><Label htmlFor="nc-r">Referral source</Label><input id="nc-r" list="nc-sources" value={v.referralSource} onChange={(e) => set("referralSource", e.target.value)} className={field} placeholder="Pick or type a new one" /><datalist id="nc-sources">{sources.map((s) => <option key={s} value={s} />)}</datalist></div>
        <div><Label htmlFor="nc-city">City</Label><input id="nc-city" value={v.city} onChange={(e) => set("city", e.target.value)} className={field} /></div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function ColumnsDialog({ cols, onClose, onSave }: { cols: Col[]; onClose: () => void; onSave: (c: Col[]) => void }) {
  return <ColumnsPicker columns={COLUMNS} defaults={DEFAULT_COLS} cols={cols} onClose={onClose} onSave={onSave} />;
}
export function ColumnsPicker<C extends string>({ columns, defaults, cols, onClose, onSave }: { columns: Record<C, string>; defaults: C[]; cols: C[]; onClose: () => void; onSave: (c: C[]) => void }) {
  const COLUMNS = columns; const DEFAULT_COLS = defaults; type Col = C;
  const [c, setC] = useState(cols);
  const move = (i: number, d: -1 | 1) => setC((xs) => { const n = [...xs]; const j = i + d; if (j < 0 || j >= n.length) return xs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <Dialog title="Edit columns" onClose={onClose} wide footer={<><button className={btn("ghost")} onClick={() => setC(DEFAULT_COLS)}>Reset to default</button><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} onClick={() => onSave(c)}>Apply</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset><legend className="mb-2 text-xs font-semibold uppercase text-slate-500">Available</legend>
          {(Object.keys(COLUMNS) as Col[]).map((k) => <label key={k} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" className="h-4 w-4" checked={c.includes(k)} onChange={() => setC(c.includes(k) ? c.filter((x) => x !== k) : [...c, k])} />{COLUMNS[k]}</label>)}
        </fieldset>
        <div><p className="mb-2 text-xs font-semibold uppercase text-slate-500">Selected ({c.length + 1}) — order</p>
          <ol className="space-y-1 text-sm"><li className="rounded-lg bg-slate-100 px-2 py-1.5 text-slate-500">Name (always first)</li>
            {c.map((k, i) => <li key={k} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1"><span className="flex-1">{COLUMNS[k]}</span>
              <button aria-label={`Move ${COLUMNS[k]} up`} onClick={() => move(i, -1)} className="rounded p-0.5 hover:bg-slate-100"><ChevronUp className="h-4 w-4" /></button>
              <button aria-label={`Move ${COLUMNS[k]} down`} onClick={() => move(i, 1)} className="rounded p-0.5 hover:bg-slate-100"><ChevronDown className="h-4 w-4" /></button>
              <button aria-label={`Remove ${COLUMNS[k]}`} onClick={() => setC(c.filter((x) => x !== k))} className="rounded p-0.5 hover:bg-slate-100"><X className="h-4 w-4" /></button></li>)}
          </ol></div>
      </div>
    </Dialog>
  );
}

function AdvancedDialog({ value, sources, onClose, onApply }: { value: Adv; sources: string[]; onClose: () => void; onApply: (a: Adv) => void }) {
  const [a, setA] = useState(value);
  const tri = (k: "company" | "email" | "phone", label: string) => (
    <div><Label htmlFor={`adv-${k}`}>{label}</Label><select id={`adv-${k}`} value={a[k]} onChange={(e) => setA({ ...a, [k]: e.target.value })} className={field}><option value="">Any</option><option value="yes">is known</option><option value="no">is unknown</option></select></div>
  );
  return (
    <Dialog title="Advanced filters" onClose={onClose} wide footer={<><button className={btn("ghost")} onClick={() => setA(NO_ADV)}>Reset</button><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} onClick={() => onApply(a)}>Apply filters</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">Lifecycle stage is any of</legend>
          {LIFECYCLE_STAGES.map((s) => <label key={s.key} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={a.lifecycle.includes(s.key)} onChange={() => setA({ ...a, lifecycle: a.lifecycle.includes(s.key) ? a.lifecycle.filter((x) => x !== s.key) : [...a.lifecycle, s.key] })} />{s.label}</label>)}
        </fieldset>
        <div className="space-y-3">
          <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">Referral source is any of</legend>
            <div className="max-h-40 overflow-y-auto">{["__none", ...sources].map((s) => <label key={s} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={a.sources.includes(s)} onChange={() => setA({ ...a, sources: a.sources.includes(s) ? a.sources.filter((x) => x !== s) : [...a.sources, s] })} />{s === "__none" ? <span className="italic">No source</span> : s}</label>)}</div>
          </fieldset>
          <div className="grid grid-cols-3 gap-2">{tri("company", "Company")}{tri("email", "Email")}{tri("phone", "Phone")}</div>
          <div><Label htmlFor="adv-city">City contains</Label><input id="adv-city" value={a.city} onChange={(e) => setA({ ...a, city: e.target.value })} className={field} /></div>
        </div>
      </div>
    </Dialog>
  );
}

export function SaveViewDialog({ pending, onClose, onSave }: { pending: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Dialog title="Save as a view" onClose={onClose} footer={<><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} disabled={pending || !name.trim()} onClick={() => onSave(name)}>Save view</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name); }}>
        <Label htmlFor="view-name">View name</Label><input id="view-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Lagos prospects to call" className={field} />
        <p className="mt-2 text-xs text-slate-500">Saves the current search, filters, columns and sort. Only you see your views.</p>
      </form>
    </Dialog>
  );
}

export function DeleteDialog({ noun = "contact", count, pending, onClose, onConfirm }: { noun?: string; count: number; pending: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog title={`Delete ${count} ${noun}${count === 1 ? "" : "s"}?`} onClose={onClose} footer={<><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("danger")} disabled={pending || !reason.trim()} onClick={() => onConfirm(reason)}>Delete</button></>}>
      <p className="mb-3 text-sm text-slate-600">Deleted records disappear from lists but their history is kept, and you can undo straight after. The reason is recorded in the audit log.</p>
      <Label htmlFor="del-reason">Reason *</Label><textarea id="del-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={field} placeholder="e.g. Duplicate of another record" />
    </Dialog>
  );
}

function DuplicatesDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  return <DuplicatesFinder load={duplicatesAction} base="/contacts" onClose={onClose} onOpen={onOpen} />;
}
export function DuplicatesFinder({ load, base, onClose, onOpen }: { load: () => Promise<{ ok: boolean; data?: Record<string, unknown> }>; base: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [groups, setGroups] = useState<{ key: string; ids: { id: string; name: string; company: string | null }[] }[] | null>(null);
  useEffect(() => { load().then((r) => setGroups(r.ok ? (r.data?.groups as typeof groups) ?? [] : [])); }, [load]);
  return (
    <Dialog title="Possible duplicates" onClose={onClose} wide footer={<button className={btn("primary")} onClick={onClose}>Done</button>}>
      {groups === null ? <p className="text-sm text-slate-500">Checking emails and phone numbers…</p> : !groups.length ? <p className="text-sm text-slate-600">No likely duplicates found among the records you can see.</p> : (
        <ul className="space-y-3">{groups.map((g) => (
          <li key={g.key} className="rounded-lg border border-slate-200 p-3"><p className="mb-1 text-xs font-semibold uppercase text-slate-500">Same {g.key.split(":")[0]}: {g.key.split(":")[1]}</p>
            <ul className="space-y-1 text-sm">{g.ids.map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><span>{x.name}{x.company && <span className="text-slate-500"> · {x.company}</span>}</span>
              <span className="flex gap-1"><button className={btn("outline", "sm")} onClick={() => onOpen(x.id)}>Preview</button><Link href={`${base}/${x.id}`} className={btn("ghost", "sm")}>Open</Link></span></li>)}</ul>
          </li>))}
          <li className="text-xs text-slate-500">Merging records automatically is coming later. Update or delete the extra record for now (history is kept).</li>
        </ul>
      )}
    </Dialog>
  );
}

