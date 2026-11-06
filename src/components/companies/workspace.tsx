"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import {
  ArrowUpDown, Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, Copy, Download, ExternalLink, Filter, GitMerge, LayoutGrid, Loader2,
  MoreVertical, PanelRightOpen, Pencil, Plus, RefreshCw, Rows3, Search, Settings2, SlidersHorizontal, Table2, Trash2, UserRound, X,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, Dialog, field, Label, Menu, MenuItem, money } from "../deals/kit";
import { DateFilterChip, OwnerFilter } from "../deals/filters";
import { matchDate, type DateFilter } from "@/lib/date-presets";
import { CONTACT_LEAD_STATUSES, leadStatusLabel } from "@/lib/rules/contacts";
import { REGIONS, SEGMENTS, TIERS } from "@/lib/rules/sales";
import {
  bulkCompaniesAction, companyDuplicatesAction, companyPreviewAction, deleteCompaniesAction, deleteCompanyViewAction, exportCompaniesAction, patchCompanyAction,
  quickCreateCompanyAction, restoreCompaniesAction, saveCompanyViewAction,
} from "@/app/actions/companies";
import { ago, type CCtx, type CUser, dateTime, downloadCsv, Floating, PhoneEditor, PickList, TextEditor } from "../contacts/kit";
import { ColumnsPicker, DeleteDialog, DuplicatesFinder, pageNumbers, SaveViewDialog, SortHead, StatusFilter } from "../contacts/workspace";
import { ContactComposer, KIND_META, type CKind } from "../contacts/composer";

export type WCompany = {
  id: string; name: string; industry: string | null; segment: string; tier: string; lifecycle: string; region: string | null; city: string | null; website: string | null;
  phone: string | null; ownerId: string | null; ownerName: string | null; leadStatus: string | null; employees: number | null; annualRevenue: number | null;
  createdAt: string; updatedAt: string; lastActivityAt: string | null; contactCount: number; openDeals: number; openTickets: number;
};
type SavedView = { id: string; name: string; query: string };
type Tab = "all" | "mine" | "customers" | `view:${string}`;
type Adv = { lifecycle: string[]; segments: string[]; tiers: string[]; regions: string[]; industry: string; city: string; hasContacts: "" | "yes" | "no"; hasDeals: "" | "yes" | "no" };
const NO_ADV: Adv = { lifecycle: [], segments: [], tiers: [], regions: [], industry: "", city: "", hasContacts: "", hasDeals: "" };
const advCount = (a: Adv) => [a.lifecycle.length, a.segments.length, a.tiers.length, a.regions.length, a.industry, a.city, a.hasContacts, a.hasDeals].filter(Boolean).length;
type Filters = { owners: string[]; created: DateFilter | null; activity: DateFilter | null; statuses: string[]; adv: Adv; metric: MetricKey | "" };
const NO_FILTERS: Filters = { owners: [], created: null, activity: null, statuses: [], adv: NO_ADV, metric: "" };
const LIFECYCLE: Record<string, string> = { prospect: "Prospect", customer: "Customer", churned: "Churned" };

const COLUMNS = {
  owner: "Company owner", created: "Create date", phone: "Phone number", activity: "Last activity date", city: "City", region: "State/Region", industry: "Industry",
  lifecycle: "Lifecycle stage", leadStatus: "Lead status", segment: "Segment", tier: "Tier", website: "Company domain", contacts: "Contacts", openDeals: "Open deals",
  openTickets: "Open tickets", employees: "Number of employees", revenue: "Annual revenue",
} as const;
type Col = keyof typeof COLUMNS;
const DEFAULT_COLS: Col[] = ["owner", "created", "phone", "activity", "city", "lifecycle", "contacts", "openDeals"];
type SortKey = "name" | Col;
const METRICS = { noOwner: "Companies missing owner", noPhone: "Companies missing phone", noContacts: "Companies with no contacts", noRecent: "No recent activity", withDeals: "With open deals", newMonth: "Created in the last 30 days" } as const;
type MetricKey = keyof typeof METRICS;
const DAY = 86400000;

export function CompaniesWorkspace({ companies, users, views, ctx, initial }: { companies: WCompany[]; users: CUser[]; views: SavedView[]; ctx: CCtx; initial: { tab?: string; q?: string; preview?: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(companies);
  useEffect(() => setItems(companies), [companies]);
  const [tab, setTab] = useState<Tab>((["all", "mine", "customers"].includes(initial.tab ?? "") ? initial.tab : "all") as Tab);
  const [q, setQ] = useState(initial.q ?? "");
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [shownMetrics, setShownMetrics] = useState<MetricKey[]>(["noOwner", "noPhone", "noContacts", "noRecent"]);
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
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useMemo(() => Date.parse(`${ctx.today}T12:00:00Z`), [ctx.today]);

  useEffect(() => {
    try {
      const c = localStorage.getItem("afq.companies.cols"); if (c) setCols(JSON.parse(c));
      const m = localStorage.getItem("afq.companies.metrics"); if (m) setShownMetrics(JSON.parse(m));
      const p = localStorage.getItem("afq.companies.perPage"); if (p) setPerPage(Number(p));
    } catch {}
  }, []);
  const persist = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "all" && !tab.startsWith("view:")) p.set("tab", tab); if (q) p.set("q", q); if (previewId) p.set("preview", previewId);
    window.history.replaceState(null, "", `/companies${p.toString() ? `?${p}` : ""}`);
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

  const recent = (c: WCompany) => !!c.lastActivityAt && now - Date.parse(c.lastActivityAt) < 30 * DAY;
  const metricMatch = (c: WCompany, m: MetricKey) => ({ noOwner: !c.ownerId, noPhone: !c.phone, noContacts: !c.contactCount, noRecent: !recent(c), withDeals: c.openDeals > 0, newMonth: now - Date.parse(c.createdAt) < 30 * DAY })[m];
  const tabbed = useMemo(() => items.filter((c) => (tab === "mine" ? c.ownerId === ctx.me.id : tab === "customers" ? c.lifecycle === "customer" : true)), [items, tab, ctx.me.id]);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tabbed.filter((c) => {
      if (term && ![c.name, c.industry, c.city, c.region, c.website, c.ownerName, c.phone].some((v) => v?.toLowerCase().includes(term))) return false;
      if (f.owners.length && !f.owners.some((o) => (o === "__me" ? c.ownerId === ctx.me.id : o === "__none" ? !c.ownerId : c.ownerId === o))) return false;
      if (!matchDate(c.createdAt, f.created, ctx.today) || !matchDate(c.lastActivityAt, f.activity, ctx.today)) return false;
      if (f.statuses.length && !f.statuses.includes(c.leadStatus ?? "__none")) return false;
      const a = f.adv;
      if (a.lifecycle.length && !a.lifecycle.includes(c.lifecycle)) return false;
      if (a.segments.length && !a.segments.includes(c.segment)) return false;
      if (a.tiers.length && !a.tiers.includes(c.tier)) return false;
      if (a.regions.length && !a.regions.includes(c.region ?? "")) return false;
      if (a.industry && !c.industry?.toLowerCase().includes(a.industry.toLowerCase())) return false;
      if (a.city && !c.city?.toLowerCase().includes(a.city.toLowerCase())) return false;
      if (a.hasContacts && (a.hasContacts === "yes") !== c.contactCount > 0) return false;
      if (a.hasDeals && (a.hasDeals === "yes") !== c.openDeals > 0) return false;
      if (f.metric && !metricMatch(c, f.metric)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabbed, q, f, ctx.me.id, ctx.today]);
  const sortVal = (c: WCompany, k: SortKey): string | number => ({
    name: c.name.toLowerCase(), owner: c.ownerName ?? "", created: c.createdAt, phone: c.phone ?? "", activity: c.lastActivityAt ?? "", city: c.city ?? "", region: c.region ?? "",
    industry: c.industry ?? "", lifecycle: c.lifecycle, leadStatus: leadStatusLabel(c.leadStatus) ?? "", segment: c.segment, tier: c.tier, website: c.website ?? "",
    contacts: c.contactCount, openDeals: c.openDeals, openTickets: c.openTickets, employees: c.employees ?? -1, revenue: c.annualRevenue ?? -1,
  })[k];
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
    if (!x && y) return 1; if (x && !y) return -1;
    return String(x).localeCompare(String(y)) * sort.dir;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filtered, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageRows = sorted.slice((page - 1) * perPage, page * perPage);
  const filterCount = f.owners.length + (f.created ? 1 : 0) + (f.activity ? 1 : 0) + (f.statuses.length ? 1 : 0) + advCount(f.adv) + (f.metric ? 1 : 0);
  const metricCounts = useMemo(() => Object.fromEntries((Object.keys(METRICS) as MetricKey[]).map((m) => [m, tabbed.filter((c) => metricMatch(c, m)).length])) as Record<MetricKey, number>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabbed, now]);

  const run = (fn: () => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown>; fieldErrors?: Record<string, string> }>, after?: (r: { ok: boolean; data?: Record<string, unknown> }) => void, undo?: () => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toast({ tone: "success", text: r.message ?? "Done.", action: undo ? { label: "Undo", run: undo } : undefined }); after?.(r); router.refresh(); }
    else { toast({ tone: "error", text: r.message ?? "That didn't work.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean), action: r.data?.stale ? { label: "Reload", run: () => router.refresh() } : undefined }); setItems(companies); }
  });
  const patch = (c: WCompany, p: Record<string, string | null>, optimistic: Partial<WCompany>) => {
    setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, ...optimistic } : x)));
    setEdit(null);
    run(() => patchCompanyAction(c.id, p, c.updatedAt), (r) => {
      const d = r.data as { updatedAt: string; row: Partial<WCompany> } | undefined;
      if (d) setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, ...d.row, updatedAt: d.updatedAt } : x)));
    });
  };
  const allOnPage = pageRows.length > 0 && pageRows.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allOnPage) pageRows.forEach((c) => n.delete(c.id)); else pageRows.forEach((c) => n.add(c.id)); return n; });
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sortBy = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: ["created", "activity", "contacts", "openDeals", "openTickets", "employees", "revenue"].includes(k) ? -1 : 1 }));
  const exportRows = (ids: string[]) => ctx.perms.export ? run(() => exportCompaniesAction(ids), (r) => downloadCsv(String(r.data?.csv ?? ""), `companies-${ctx.today}.csv`)) : toast({ tone: "error", text: "You don't have permission to export. Ask an admin." });
  const applyView = (v: SavedView) => {
    try {
      const s = JSON.parse(v.query) as { f: Filters; q: string; cols?: Col[]; sort?: typeof sort };
      setF({ ...NO_FILTERS, ...s.f, adv: { ...NO_ADV, ...s.f.adv } }); setQ(s.q ?? ""); if (s.cols) setCols(s.cols); if (s.sort) setSort(s.sort);
      setTab(`view:${v.id}`); toast({ tone: "info", text: `Showing “${v.name}”.` });
    } catch { toast({ tone: "error", text: "This saved view is damaged and can't be opened." }); }
  };
  const selIds = [...selected];
  const previewCo = items.find((c) => c.id === previewId) ?? null;
  const composerCo = composer ? items.find((c) => c.id === composer.id) : null;
  const userOpts = users.map((u) => ({ value: u.id, label: u.id === ctx.me.id ? `${u.name} (you)` : u.name }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Menu label={<span className="text-2xl font-semibold text-ink-950">Companies</span>} ariaLabel="Switch record type">
          {(close) => <>
            <MenuItem onClick={() => { close(); router.push("/contacts"); }}>Contacts</MenuItem>
            <MenuItem onClick={close} hint="current"><Building2 className="h-4 w-4" />Companies</MenuItem>
            <MenuItem onClick={() => { close(); router.push("/deals"); }}>Deals</MenuItem>
            <MenuItem onClick={() => { close(); router.push("/tasks"); }}>Tasks</MenuItem>
          </>}
        </Menu>
        <div className="ml-auto flex items-center gap-2">
          <Menu icon={<MoreVertical className="h-4 w-4" />} ariaLabel="More company actions" variant="outline" align="right">
            {(close) => <>
              <MenuItem onClick={() => { close(); exportRows(sorted.map((c) => c.id)); }}><Download className="h-4 w-4" />Export this view ({sorted.length})</MenuItem>
              <MenuItem onClick={() => { close(); setDialog("columns"); }}><Columns3 className="h-4 w-4" />Edit columns</MenuItem>
              <MenuItem onClick={() => { close(); setDialog("duplicates"); }}><GitMerge className="h-4 w-4" />Find duplicates</MenuItem>
              <MenuItem onClick={() => { close(); toast({ tone: "info", text: "Importing companies from a spreadsheet is coming later." }); }} hint="Coming later">Import</MenuItem>
            </>}
          </Menu>
          <button onClick={() => setDialog("duplicates")} className={clsx(btn("outline"), "!rounded-full !p-2")} aria-label="Find duplicate companies" title="Find duplicate companies"><GitMerge className="h-4 w-4" /></button>
          {ctx.perms.edit && (
            <Menu label="Add companies" variant="primary" align="right">
              {(close) => <>
                <MenuItem onClick={() => { close(); setDialog("create"); }} hint="N">Create company</MenuItem>
                <MenuItem onClick={() => { close(); router.push("/companies/new"); }}>Create with all fields</MenuItem>
                <MenuItem onClick={() => { close(); toast({ tone: "info", text: "Spreadsheet import is coming later." }); }} hint="Coming later">Import</MenuItem>
              </>}
            </Menu>
          )}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Company views">
        {([["all", "All companies"], ["mine", "My companies"], ["customers", "Customers"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSelected(new Set()); }}
            className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-brand-600 bg-slate-100 text-ink-950" : "border-transparent text-slate-600 hover:text-slate-900")}>
            <Table2 className="h-4 w-4" aria-hidden />{l}<span className="rounded-full bg-white px-1.5 text-xs text-slate-500 ring-1 ring-slate-200">{items.filter((c) => (k === "mine" ? c.ownerId === ctx.me.id : k === "customers" ? c.lifecycle === "customer" : true)).length}</span>
          </button>
        ))}
        {views.map((v) => (
          <span key={v.id} className={clsx("inline-flex items-center rounded-t-lg border-b-2", tab === `view:${v.id}` ? "border-brand-600 bg-slate-100" : "border-transparent")}>
            <button role="tab" aria-selected={tab === `view:${v.id}`} onClick={() => applyView(v)} className="whitespace-nowrap px-3 py-2 text-sm font-medium text-slate-700">{v.name}</button>
            <button aria-label={`Delete view ${v.name}`} onClick={() => { if (confirm(`Delete the view “${v.name}”?`)) run(() => deleteCompanyViewAction(v.id), () => setTab("all")); }} className="mr-1 rounded p-0.5 text-slate-400 hover:bg-slate-200"><X className="h-3.5 w-3.5" /></button>
          </span>
        ))}
        <button onClick={() => setDialog("save")} className="ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Save current filters as a view" title="Save current filters as a view"><Plus className="h-4 w-4" /></button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ( / )" aria-label="Search companies by name, industry, city, domain or phone" className="w-full rounded-full border border-slate-300 py-2 pl-9 pr-8 text-sm" />
          {q && <button aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-2 rounded-full p-0.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
        </div>
        <button onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium", filterCount ? "border-accent-400 bg-accent-50 text-accent-600" : "border-slate-300 text-slate-700 hover:bg-slate-50")}>
          <Filter className="h-4 w-4" aria-hidden />Filter{filterCount ? ` (${filterCount})` : ""}
        </button>
        <Menu label={<span className="inline-flex items-center gap-1.5"><ArrowUpDown className="h-4 w-4" aria-hidden />Sort by{sort.key !== "created" || sort.dir !== -1 ? `: ${sort.key === "name" ? "Company name" : COLUMNS[sort.key]}` : ""}</span>} variant="outline">
          {(close) => (["name", ...Object.keys(COLUMNS)] as SortKey[]).map((k) => <MenuItem key={k} onClick={() => { close(); sortBy(k); }} hint={sort.key === k ? (sort.dir === 1 ? "↑" : "↓") : undefined}>{k === "name" ? "Company name" : COLUMNS[k as Col]}</MenuItem>)}
        </Menu>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-full border border-slate-300 p-0.5" role="group" aria-label="Layout">
            <button aria-pressed={layout === "board"} onClick={() => setLayout("board")} className={clsx("rounded-full p-1.5", layout === "board" ? "bg-slate-200" : "hover:bg-slate-100")} aria-label="Board by lifecycle stage" title="Board by lifecycle stage"><LayoutGrid className="h-4 w-4" /></button>
            <button aria-pressed={layout === "table"} onClick={() => setLayout("table")} className={clsx("rounded-full p-1.5", layout === "table" ? "bg-slate-200" : "hover:bg-slate-100")} aria-label="Table" title="Table"><Rows3 className="h-4 w-4" /></button>
          </div>
          <button onClick={() => setDialog("columns")} className="rounded-full border border-slate-300 p-2 hover:bg-slate-50" aria-label="Edit columns" title="Edit columns"><Settings2 className="h-4 w-4" /></button>
          <button onClick={() => setMetricsOpen((o) => !o)} aria-expanded={metricsOpen} className="rounded-full border border-slate-300 p-2 hover:bg-slate-50" aria-label={metricsOpen ? "Hide summary" : "Show summary"} title={metricsOpen ? "Hide summary" : "Show summary"}>{metricsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2">
          <OwnerFilter label="Company owner" users={users} value={f.owners} onChange={(owners) => setF({ ...f, owners })} meId={ctx.me.id} unassigned />
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

      {metricsOpen && (
        <section aria-label="Company data quality" className="relative mb-4 rounded-xl border border-slate-200 p-4">
          <button onClick={() => setDialog("metrics")} className="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Choose summary cards" title="Choose summary cards"><Settings2 className="h-4 w-4" /></button>
          <div className={clsx("grid gap-3", shownMetrics.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : shownMetrics.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
            {shownMetrics.map((m) => (
              <button key={m} onClick={() => { setF({ ...f, metric: f.metric === m ? "" : m }); toast({ tone: "info", text: f.metric === m ? "Summary filter removed." : `Showing ${METRICS[m].toLowerCase()}.` }); }}
                aria-pressed={f.metric === m} className={clsx("rounded-lg px-2 py-2 text-center transition hover:bg-slate-50", f.metric === m && "bg-accent-50 ring-2 ring-accent-400")}>
                <span className="block truncate text-xs font-semibold uppercase tracking-wide text-slate-700">{METRICS[m]}</span>
                <span className="mt-1 block text-3xl font-bold text-accent-600">{metricCounts[m].toLocaleString("en-US")}</span>
              </button>
            ))}
          </div>
        </section>
      )}

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
                <th className="px-2 py-2.5 font-medium"><SortHead label="Company name" k={"name" as SortKey} sort={sort} onSort={sortBy} /></th>
                {cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2.5 font-medium"><SortHead label={COLUMNS[c]} k={c as SortKey} sort={sort} onSort={sortBy} /></th>)}
                <th className="w-10 px-2"><button onClick={() => setDialog("columns")} aria-label="Add or remove columns" title="Add or remove columns" className="rounded p-1 hover:bg-slate-200"><Plus className="h-4 w-4" /></button></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id} className={clsx("group border-t border-slate-100", selected.has(c.id) ? "bg-brand-50/60" : previewId === c.id ? "bg-slate-50" : "hover:bg-slate-50")}>
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4" /></td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPreviewId(previewId === c.id ? null : c.id)} aria-label={`Quick view ${c.name}`} title="Quick view" className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><ChevronRight className={clsx("h-4 w-4 transition", previewId === c.id && "rotate-90")} /></button>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200" aria-hidden><Building2 className="h-3.5 w-3.5" /></span>
                      <Link href={`/companies/${c.id}`} className="max-w-[14rem] truncate font-semibold text-accent-600 hover:underline" title={`Open ${c.name}`}>{c.name}</Link>
                      <button onClick={() => setPreviewId(c.id)} className="rounded-full border border-slate-300 p-1 text-slate-500 opacity-0 transition hover:bg-white group-hover:opacity-100 focus:opacity-100" aria-label={`Preview ${c.name}`} title="Preview"><PanelRightOpen className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                  {cols.map((col) => <Cell key={col} c={c} col={col} ctx={ctx} onEdit={(el) => setEdit({ id: c.id, col, el })} editing={edit?.id === c.id && edit.col === col} />)}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {!pageRows.length && (
            <div className="grid place-items-center gap-2 px-4 py-14 text-center">
              <Search className="h-10 w-10 text-slate-300" aria-hidden />
              <p className="font-semibold text-ink-950">{tab === "mine" && !tabbed.length ? "You don't own any companies yet." : "No companies match the current filters."}</p>
              <p className="text-sm text-slate-600">Change filters to broaden your search.</p>
              <div className="flex gap-2">
                {(filterCount > 0 || q) && <button className={btn("outline", "sm")} onClick={() => { setF(NO_FILTERS); setQ(""); }}>Clear filters</button>}
                {tab !== "all" && <button className={btn("outline", "sm")} onClick={() => setTab("all")}>Show all companies</button>}
                {ctx.perms.edit && <button className={btn("primary", "sm")} onClick={() => setDialog("create")}>Create company</button>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Companies by lifecycle stage">
          {Object.entries(LIFECYCLE).map(([key, label]) => {
            const list = sorted.filter((c) => c.lifecycle === key);
            return (
              <section key={key} aria-label={`${label}, ${list.length} companies`} onDragOver={(e) => { if (ctx.perms.edit) { e.preventDefault(); setDropOn(key); } }} onDragLeave={() => setDropOn(null)}
                onDrop={(e) => { e.preventDefault(); setDropOn(null); const c = sorted.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (c && c.lifecycle !== key) patch(c, { lifecycle: key }, { lifecycle: key }); }}
                className={clsx("flex w-72 shrink-0 flex-col rounded-xl border bg-slate-50", dropOn === key ? "border-accent-500 ring-2 ring-accent-400" : "border-slate-200")}>
                <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-sm font-semibold"><span>{label}</span><span className="rounded-full bg-white px-2 text-xs text-slate-600 ring-1 ring-slate-200">{list.length}</span></header>
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto p-2">
                  {list.slice(0, 100).map((c) => (
                    <li key={c.id} draggable={ctx.perms.edit} onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)} className="cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-sm">
                      <Link href={`/companies/${c.id}`} className="block truncate font-semibold text-accent-600 hover:underline">{c.name}</Link>
                      <p className="mt-1 truncate text-xs text-slate-600">{[c.industry, c.city].filter(Boolean).join(" · ") || "No details"}</p>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500"><span>{c.contactCount} contacts · {c.openDeals} open deals</span><button onClick={() => setPreviewId(c.id)} className="rounded px-1 hover:bg-slate-100">Preview</button></div>
                    </li>
                  ))}
                  {!list.length && <li className="px-1 py-4 text-center text-xs text-slate-400">{ctx.perms.edit ? "Drag companies here" : "None"}</li>}
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
          <label htmlFor="co-per-page" className="sr-only">Rows per page</label>
          <select id="co-per-page" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); persist("afq.companies.perPage", Number(e.target.value)); }} className="ml-2 rounded-lg border-0 bg-transparent font-semibold">
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </nav>
      )}
      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold">{sorted.length.toLocaleString("en-US")} compan{sorted.length === 1 ? "y" : "ies"}{sorted.length !== tabbed.length && <span className="font-normal text-slate-500"> of {tabbed.length}</span>}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { router.refresh(); toast({ tone: "info", text: "Companies refreshed with the latest changes." }); }} className={clsx(btn("outline"), "!rounded-full")} aria-label="Refresh" title="Refresh"><RefreshCw className={clsx("h-4 w-4", pending && "animate-spin")} /></button>
          <button onClick={() => exportRows(sorted.map((c) => c.id))} disabled={!sorted.length} className={clsx(btn("outline"), "!rounded-full")}><Download className="h-4 w-4" />Export</button>
          <button onClick={() => setDialog("save")} className={clsx(btn("outline"), "!rounded-full")} title="Save these filters and columns as a new view"><Copy className="h-4 w-4" />Clone</button>
        </div>
      </footer>

      {edit && (() => {
        const c = items.find((x) => x.id === edit.id);
        if (!c) return null;
        const close = () => setEdit(null);
        const F = (w: number, node: React.ReactNode) => <Floating anchor={edit.el} onClose={close} width={w}>{node}</Floating>;
        if (!ctx.perms.edit) return F(260, <p className="p-4 text-sm text-slate-600">You can view but not edit companies. Ask a manager for edit access.</p>);
        switch (edit.col) {
          case "phone": return F(460, <PhoneEditor label="Phone number" value={c.phone} busy={pending} onCancel={close} onSave={(v) => patch(c, { phone: v }, { phone: v })} />);
          case "city": case "industry": case "website": return F(340, <TextEditor label={COLUMNS[edit.col]} value={c[edit.col]} busy={pending} onCancel={close} onSave={(v) => patch(c, { [edit.col]: v }, { [edit.col]: v })} />);
          case "employees": return F(300, <TextEditor label="Number of employees" type="number" value={c.employees?.toString() ?? null} busy={pending} onCancel={close} validate={(v) => (/^\d+$/.test(v) ? null : "Whole numbers only.")} onSave={(v) => patch(c, { employees: v }, { employees: v ? Number(v) : null })} />);
          case "revenue": return F(300, <TextEditor label="Annual revenue (NGN)" value={c.annualRevenue?.toString() ?? null} busy={pending} onCancel={close} validate={(v) => (/^[\d,.]+$/.test(v) ? null : "Numbers only.")} onSave={(v) => patch(c, { annualRevenue: v }, { annualRevenue: v ? Number(v.replace(/,/g, "")) : null })} />);
          case "owner": return F(280, <PickList clearLabel="Unassign" value={c.ownerId} options={userOpts} onPick={(v) => patch(c, { ownerId: v }, { ownerId: v, ownerName: users.find((u) => u.id === v)?.name ?? null })} />);
          case "lifecycle": return F(260, <PickList value={c.lifecycle} options={Object.entries(LIFECYCLE).map(([value, label]) => ({ value, label }))} onPick={(v) => v && patch(c, { lifecycle: v }, { lifecycle: v })} />);
          case "leadStatus": return F(280, <PickList clearLabel="Clear lead status" value={c.leadStatus} options={CONTACT_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label }))} onPick={(v) => patch(c, { leadStatus: v }, { leadStatus: v })} />);
          case "segment": return F(260, <PickList value={c.segment} options={SEGMENTS.map((s) => ({ value: s, label: s }))} onPick={(v) => v && patch(c, { segment: v }, { segment: v })} />);
          case "tier": return F(260, <PickList value={c.tier} options={TIERS.map((s) => ({ value: s, label: s }))} onPick={(v) => v && patch(c, { tier: v }, { tier: v })} />);
          case "region": return F(280, <PickList clearLabel="Clear region" value={c.region} options={REGIONS.map((s) => ({ value: s, label: s }))} onPick={(v) => patch(c, { region: v }, { region: v })} />);
          default: return null;
        }
      })()}

      {previewCo && <CompanyPreview key={previewCo.id} c={previewCo} ctx={ctx} onClose={() => setPreviewId(null)} onCompose={(kind) => setComposer({ kind, id: previewCo.id })} />}
      {composer && composerCo && <ContactComposer kind={composer.kind} users={users} ctx={ctx} onClose={() => setComposer(null)} onSwitch={(kind) => setComposer({ ...composer, kind })} onDone={() => router.refresh()}
        contact={{ target: "company", id: composerCo.id, name: composerCo.name, email: null, phone: composerCo.phone, whatsapp: composerCo.phone, companyName: null }} />}

      {dialog === "create" && <CreateCompanyDialog users={users} ctx={ctx} pending={pending} onClose={() => setDialog("")} onCreate={(v, open) => run(() => quickCreateCompanyAction(v), (r) => { setDialog(""); setTab("all"); if (open && r.data?.id) router.push(`/companies/${r.data.id}`); })} />}
      {dialog === "columns" && <ColumnsPicker columns={COLUMNS} defaults={DEFAULT_COLS} cols={cols} onClose={() => setDialog("")} onSave={(c) => { setCols(c); persist("afq.companies.cols", c); setDialog(""); toast({ tone: "success", text: "Columns updated." }); }} />}
      {dialog === "metrics" && (
        <Dialog title="Summary cards" onClose={() => setDialog("")} footer={<button className={btn("primary")} onClick={() => setDialog("")}>Done</button>}>
          <p className="mb-2 text-sm text-slate-600">Pick up to four. Click a card on the page to filter the list.</p>
          {(Object.keys(METRICS) as MetricKey[]).map((m) => (
            <label key={m} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" className="h-4 w-4" checked={shownMetrics.includes(m)} disabled={!shownMetrics.includes(m) && shownMetrics.length >= 4}
              onChange={() => { const n = shownMetrics.includes(m) ? shownMetrics.filter((x) => x !== m) : [...shownMetrics, m]; if (!n.length) return; setShownMetrics(n); persist("afq.companies.metrics", n); }} />{METRICS[m]}</label>
          ))}
        </Dialog>
      )}
      {dialog === "advanced" && <AdvancedDialog value={f.adv} onClose={() => setDialog("")} onApply={(adv) => { setF({ ...f, adv }); setDialog(""); toast({ tone: "info", text: `Advanced filters applied (${advCount(adv)}).` }); }} />}
      {dialog === "save" && <SaveViewDialog pending={pending} onClose={() => setDialog("")} onSave={(name) => run(() => saveCompanyViewAction(name, JSON.stringify({ f, q, cols, sort })), (r) => { setDialog(""); if (r.data?.id) setTab(`view:${r.data.id}`); })} />}
      {dialog === "delete" && <DeleteDialog noun="company" count={selected.size} pending={pending} onClose={() => setDialog("")} onConfirm={(reason) => {
        const ids = selIds;
        setItems((xs) => xs.filter((x) => !ids.includes(x.id)));
        run(() => deleteCompaniesAction(ids, reason), () => { setSelected(new Set()); setDialog(""); }, () => run(() => restoreCompaniesAction(ids)));
      }} />}
      {(dialog === "bulkOwner" || dialog === "bulkStatus" || dialog === "bulkLifecycle") && (
        <Dialog title={dialog === "bulkOwner" ? `Assign ${selected.size} compan${selected.size === 1 ? "y" : "ies"}` : dialog === "bulkStatus" ? "Set lead status" : "Set lifecycle stage"} onClose={() => setDialog("")}>
          <PickList clearLabel={dialog === "bulkOwner" ? "Unassign" : dialog === "bulkStatus" ? "Clear lead status" : undefined} value={null} busy={pending}
            options={dialog === "bulkOwner" ? userOpts : dialog === "bulkStatus" ? CONTACT_LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label })) : Object.entries(LIFECYCLE).map(([value, label]) => ({ value, label }))}
            onPick={(v) => run(() => bulkCompaniesAction(selIds, dialog === "bulkOwner" ? { ownerId: v } : dialog === "bulkStatus" ? { leadStatus: v } : { lifecycle: v ?? "prospect" }), () => { setDialog(""); setSelected(new Set()); })} />
        </Dialog>
      )}
      {dialog === "duplicates" && <DuplicatesFinder load={companyDuplicatesAction} base="/companies" onClose={() => setDialog("")} onOpen={(id) => { setDialog(""); setPreviewId(id); }} />}
    </div>
  );
}

const Dash = () => <span className="text-slate-400">--</span>;
function Cell({ c, col, ctx, onEdit, editing }: { c: WCompany; col: Col; ctx: CCtx; onEdit: (el: HTMLElement) => void; editing: boolean }) {
  const ref = useRef<HTMLTableCellElement>(null);
  const open = () => ref.current && onEdit(ref.current);
  const editable = !["created", "activity", "contacts", "openDeals", "openTickets"].includes(col);
  const editBtn = editable ? <button onClick={open} className="ml-1 shrink-0 rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 focus:opacity-100 group-hover/cell:opacity-100" aria-label={`Edit ${COLUMNS[col]} for ${c.name}`}><Pencil className="h-3.5 w-3.5" /></button> : null;
  const link = (href: string, n: number, title: string) => <Link href={href} className="font-semibold text-accent-600 hover:underline" title={title}>{n}</Link>;
  let body: React.ReactNode;
  switch (col) {
    case "owner": body = c.ownerName ? <span className="inline-flex max-w-[14rem] items-center gap-1.5 truncate"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{c.ownerName.split(" ").map((p) => p[0]).slice(0, 2).join("")}</span>{c.ownerName}{c.ownerId === ctx.me.id && <span className="text-xs text-slate-500"> (you)</span>}</span> : <span className="italic text-slate-400">No owner</span>; break;
    case "created": body = <span className="whitespace-nowrap">{dateTime(c.createdAt, ctx.tz)}</span>; break;
    case "phone": body = c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="whitespace-nowrap font-semibold text-accent-600 hover:underline" title={`Call ${c.phone}`}>{c.phone}</a> : <Dash />; break;
    case "activity": body = c.lastActivityAt ? <span className="whitespace-nowrap" title={dateTime(c.lastActivityAt, ctx.tz) ?? ""}>{ago(c.lastActivityAt, ctx.today)}</span> : <Dash />; break;
    case "website": body = c.website ? <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[14rem] items-center gap-1 font-semibold text-accent-600 hover:underline"><span className="truncate">{c.website.replace(/^https?:\/\//, "")}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" /></a> : <Dash />; break;
    case "lifecycle": body = LIFECYCLE[c.lifecycle] ?? c.lifecycle; break;
    case "leadStatus": body = leadStatusLabel(c.leadStatus) ?? <Dash />; break;
    case "contacts": body = link(`/companies/${c.id}#contacts`, c.contactCount, "View contacts"); break;
    case "openDeals": body = link(`/companies/${c.id}#deals`, c.openDeals, "View deals"); break;
    case "openTickets": body = link(`/companies/${c.id}/360?tab=tickets`, c.openTickets, "View tickets"); break;
    case "employees": body = c.employees?.toLocaleString("en-US") ?? <Dash />; break;
    case "revenue": body = c.annualRevenue != null ? money(c.annualRevenue, "NGN") : <Dash />; break;
    default: body = c[col] ?? <Dash />;
  }
  return (
    <td ref={ref} className={clsx("group/cell px-3 py-2", editing && "outline outline-2 -outline-offset-2 outline-slate-500", editable && "cursor-pointer")}
      onClick={(e) => { if (editable && !(e.target as HTMLElement).closest("a,button")) open(); }}>
      <div className="flex items-center">{body}{editBtn}</div>
    </td>
  );
}

type Preview = { contacts: { id: string; name: string; jobTitle: string | null }[]; deals: { id: string; name: string; stage: string; amount: number | null; currency: string }[]; activities: { id: string; type: string; subject: string; at: string; by: string | null }[]; summary: { lines: string[]; next: string; missing: string[] } };
function CompanyPreview({ c, ctx, onClose, onCompose }: { c: WCompany; ctx: CCtx; onClose: () => void; onCompose: (k: CKind) => void }) {
  const [d, setD] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let live = true; companyPreviewAction(c.id).then((r) => { if (!live) return; if (r.ok) setD(r.data as Preview); else setErr(r.message ?? "Couldn't load."); }); return () => { live = false; }; }, [c.id, c.updatedAt]);
  return (
    <aside aria-label={`Quick view: ${c.name}`} className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
      <header className="flex items-start gap-3 border-b border-slate-200 p-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 ring-1 ring-slate-200"><Building2 className="h-5 w-5 text-slate-500" /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{c.name}</h2><p className="truncate text-sm text-slate-600">{[c.industry, c.city, LIFECYCLE[c.lifecycle]].filter(Boolean).join(" · ")}</p>
          <Link href={`/companies/${c.id}`} className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Open full record<ExternalLink className="h-3.5 w-3.5" /></Link></div>
        <button onClick={onClose} aria-label="Close quick view" className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {ctx.perms.log && <div className="grid grid-cols-5 gap-1 text-center text-xs">{(["note", "email", "call", "task", "meeting"] as CKind[]).map((k) => { const M = KIND_META[k]; return (
          <button key={k} onClick={() => onCompose(k)} className="flex flex-col items-center gap-1 rounded-lg py-1.5 hover:bg-slate-50"><span className="grid h-9 w-9 place-items-center rounded-full border border-slate-300"><M.Icon className="h-4 w-4" /></span>{M.label}</button>); })}</div>}
        <dl className="grid grid-cols-2 gap-2">
          {[["Owner", c.ownerName ?? "No owner"], ["Phone", c.phone ?? "--"], ["Segment / tier", `${c.segment} · ${c.tier}`], ["Lead status", leadStatusLabel(c.leadStatus) ?? "--"], ["Created", dateTime(c.createdAt, ctx.tz, false)], ["Last activity", ago(c.lastActivityAt, ctx.today) ?? "none"]].map(([l, v]) => <div key={l as string}><dt className="text-xs text-slate-500">{l}</dt><dd>{v}</dd></div>)}
        </dl>
        {err && <p role="alert" className="rounded-lg bg-red-50 p-2 text-red-800">{err}</p>}
        {!d && !err && <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>}
        {d && <>
          <section className="rounded-xl border border-accent-400/40 bg-accent-50/50 p-3"><h3 className="mb-1 font-semibold">Summary</h3><ul className="space-y-1 text-slate-700">{d.summary.lines.map((l) => <li key={l}>{l}</li>)}</ul><p className="mt-2"><span className="font-semibold">Next: </span>{d.summary.next}</p></section>
          <section><h3 className="mb-1 font-semibold">Contacts ({c.contactCount})</h3>{d.contacts.length ? <ul className="space-y-1">{d.contacts.map((x) => <li key={x.id}><Link href={`/contacts/${x.id}`} className="text-brand-700 hover:underline">{x.name}</Link>{x.jobTitle && <span className="text-xs text-slate-500"> · {x.jobTitle}</span>}</li>)}</ul> : <p className="text-slate-500">No contacts yet.</p>}</section>
          <section><h3 className="mb-1 font-semibold">Deals</h3>{d.deals.length ? <ul className="space-y-1">{d.deals.map((x) => <li key={x.id} className="flex justify-between gap-2"><Link href={`/deals?preview=${x.id}`} className="truncate text-brand-700 hover:underline">{x.name}</Link><span className="shrink-0 text-xs text-slate-500">{x.stage} · {money(x.amount, x.currency)}</span></li>)}</ul> : <p className="text-slate-500">No deals yet.</p>}</section>
          <section><h3 className="mb-1 font-semibold">Recent activity</h3>{d.activities.length ? <ol className="space-y-2 border-l-2 border-slate-200 pl-3">{d.activities.map((a) => <li key={a.id}><p className="font-medium">{a.subject}</p><p className="text-xs text-slate-500">{a.type} · {dateTime(a.at, ctx.tz)}{a.by ? ` · ${a.by}` : ""}</p></li>)}</ol> : <p className="text-slate-500">Nothing logged yet.</p>}</section>
        </>}
      </div>
    </aside>
  );
}

function CreateCompanyDialog({ users, ctx, pending, onClose, onCreate }: { users: CUser[]; ctx: CCtx; pending: boolean; onClose: () => void; onCreate: (v: Record<string, string>, open: boolean) => void }) {
  const [v, setV] = useState<Record<string, string>>({ name: "", website: "", industry: "", phone: "", city: "", region: "", ownerId: ctx.me.id, segment: "SME", tier: "Standard", lifecycle: "prospect" });
  const [open, setOpen] = useState(true);
  const set = (k: string, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <Dialog title="Create company" onClose={onClose} wide footer={<>
      <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="h-4 w-4" />Open the record after creating</label>
      <button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} disabled={pending || v.name.trim().length < 2} onClick={() => onCreate(v, open)}>Create</button></>}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onCreate(v, open); }}>
        <div className="sm:col-span-2"><Label htmlFor="nco-n">Company name *</Label><input id="nco-n" autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} className={field} required /></div>
        <div><Label htmlFor="nco-w">Company domain</Label><input id="nco-w" value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="example.com" className={field} /></div>
        <div><Label htmlFor="nco-i">Industry</Label><input id="nco-i" value={v.industry} onChange={(e) => set("industry", e.target.value)} placeholder="e.g. Healthcare" className={field} /></div>
        <div><Label htmlFor="nco-p">Phone number</Label><input id="nco-p" value={v.phone} onChange={(e) => set("phone", e.target.value)} className={field} /></div>
        <div><Label htmlFor="nco-c">City</Label><input id="nco-c" value={v.city} onChange={(e) => set("city", e.target.value)} className={field} /></div>
        <div><Label htmlFor="nco-r">State/Region</Label><select id="nco-r" value={v.region} onChange={(e) => set("region", e.target.value)} className={field}><option value="">—</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div><Label htmlFor="nco-o">Company owner</Label><select id="nco-o" value={v.ownerId} onChange={(e) => set("ownerId", e.target.value)} className={field}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><Label htmlFor="nco-s">Segment</Label><select id="nco-s" value={v.segment} onChange={(e) => set("segment", e.target.value)} className={field}>{SEGMENTS.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><Label htmlFor="nco-t">Tier</Label><select id="nco-t" value={v.tier} onChange={(e) => set("tier", e.target.value)} className={field}>{TIERS.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><Label htmlFor="nco-l">Lifecycle stage</Label><select id="nco-l" value={v.lifecycle} onChange={(e) => set("lifecycle", e.target.value)} className={field}>{Object.entries(LIFECYCLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function AdvancedDialog({ value, onClose, onApply }: { value: Adv; onClose: () => void; onApply: (a: Adv) => void }) {
  const [a, setA] = useState(value);
  const multi = (k: "lifecycle" | "segments" | "tiers" | "regions", label: string, opts: [string, string][]) => (
    <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">{label}</legend>
      {opts.map(([key, l]) => <label key={key} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={a[k].includes(key)} onChange={() => setA({ ...a, [k]: a[k].includes(key) ? a[k].filter((x) => x !== key) : [...a[k], key] })} />{l}</label>)}
    </fieldset>
  );
  const tri = (k: "hasContacts" | "hasDeals", label: string) => <div><Label htmlFor={`cadv-${k}`}>{label}</Label><select id={`cadv-${k}`} value={a[k]} onChange={(e) => setA({ ...a, [k]: e.target.value })} className={field}><option value="">Any</option><option value="yes">Yes</option><option value="no">No</option></select></div>;
  return (
    <Dialog title="Advanced filters" onClose={onClose} wide footer={<><button className={btn("ghost")} onClick={() => setA(NO_ADV)}>Reset</button><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} onClick={() => onApply(a)}>Apply filters</button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        {multi("lifecycle", "Lifecycle stage is any of", Object.entries(LIFECYCLE))}
        {multi("segments", "Segment is any of", SEGMENTS.map((s) => [s, s]))}
        {multi("tiers", "Tier is any of", TIERS.map((s) => [s, s]))}
        {multi("regions", "State/Region is any of", REGIONS.map((s) => [s, s]))}
        <div className="space-y-3 sm:col-span-2">
          <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="cadv-ind">Industry contains</Label><input id="cadv-ind" value={a.industry} onChange={(e) => setA({ ...a, industry: e.target.value })} className={field} /></div>
            <div><Label htmlFor="cadv-city">City contains</Label><input id="cadv-city" value={a.city} onChange={(e) => setA({ ...a, city: e.target.value })} className={field} /></div></div>
          <div className="grid grid-cols-2 gap-2">{tri("hasContacts", "Has contacts")}{tri("hasDeals", "Has open deals")}</div>
        </div>
      </div>
    </Dialog>
  );
}
