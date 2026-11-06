"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import {
  ArrowRight, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Columns3, Copy, Download, Filter, Keyboard, LayoutGrid,
  ListChecks, Mail, MoreHorizontal, MoreVertical, Phone, Plus, RefreshCw, Rows3, Search, Settings2, SlidersHorizontal, StickyNote, Trash2, Undo2, UserRound, X,
} from "lucide-react";
import { useToast } from "../toast";
import { btn, Dialog, field, initials, Label, Menu, MenuItem, money, shortDate } from "./kit";
import { DealPreview } from "./preview";
import { AdvancedFiltersDialog, advancedCount, DateFilterChip, NO_ADVANCED, OwnerFilter, type Advanced } from "./filters";
import { matchDate, type DateFilter } from "@/lib/date-presets";
import { Composer, type ComposerKind } from "./composers";
import {
  bulkAssignAction, bulkDeleteAction, bulkMoveAction, createInStageAction, deleteDealViewAction, exportAction, moveOneAction, restoreAction, saveDealViewAction, taskAction,
} from "@/app/actions/deals";
import type { ActionResult } from "@/components/forms";

export type WDeal = {
  id: string; name: string; amount: number | null; currency: string; stageId: string; ownerId: string; ownerName: string; companyId: string; companyName: string;
  segment: string; expectedCloseDate: string | null; closedAt: string | null; createdAt: string; updatedAt: string; lastActivityAt: string | null;
  stageEnteredAt: string; billingFrequency: string | null; nextStep: string | null; nextStepDue: string | null; discountStatus: string;
  probabilityOverride: number | null; forecastCategory: string; primaryContactId: string | null; contactName: string | null; contactPhone: string | null;
  contactEmail: string | null; productIds: string[]; nextActivityAt: string | null;
};
export type WStage = { id: string; name: string; probability: number; isWon: boolean; isLost: boolean; staleAfterDays: number };
export type WUser = { id: string; name: string };
export type WCtx = {
  me: { id: string; name: string }; today: string; currency: string; lossReasons: string[];
  perms: { edit: boolean; reassign: boolean; delete: boolean; export: boolean; log: boolean; pipelines: boolean; ticket: boolean };
};

type Tab = "all" | "mine" | "attention" | `view:${string}`;
type Filters = { owners: string[]; created: DateFilter | null; activity: DateFilter | null; close: DateFilter | null; product: string; segment: string; metric: "" | "open" | "won" | "new"; adv: Advanced };
const NO_FILTERS: Filters = { owners: [], created: null, activity: null, close: null, product: "", segment: "", metric: "", adv: NO_ADVANCED };
export type SavedView = { id: string; name: string; query: string };
const SORTS = { close: "Close date (soonest)", amount: "Amount (largest)", created: "Create date (newest)", activity: "Last activity (oldest)", name: "Deal name (A–Z)" } as const;
type SortKey = keyof typeof SORTS;
const CARD_FIELDS = { amount: "Amount", close: "Close date", owner: "Deal owner", billing: "Billing frequency", next: "Next step", contact: "Primary contact", age: "Days in stage" } as const;
type CardField = keyof typeof CARD_FIELDS;
type Undo = { label: string; run: () => Promise<ActionResult> };
const METRICS = { total: "Total deal amount", weighted: "Weighted deal amount", open: "Open deal amount", won: "Closed deal amount", new: "New deal amount", age: "Average deal age" } as const;
type MetricKey = keyof typeof METRICS;

const DAY = 86400000;
const daysSince = (iso: string | null, now: number) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);
function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const d = Math.floor((now - Date.parse(iso)) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : d < 365 ? `${Math.round(d / 30)} months ago` : `${Math.round(d / 365)} years ago`;
}

export function DealsWorkspace({ deals, stages, users, products, ctx, initial, views }: {
  deals: WDeal[]; stages: WStage[]; users: WUser[]; products: { id: string; name: string }[]; ctx: WCtx; views: SavedView[];
  initial: { tab?: string; q?: string; layout?: string; owner?: string; preview?: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(deals);
  useEffect(() => setItems(deals), [deals]);
  const [tab, setTab] = useState<Tab>((["all", "mine", "attention"].includes(initial.tab ?? "") ? initial.tab : "all") as Tab);
  const [advOpen, setAdvOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [q, setQ] = useState(initial.q ?? "");
  const [layout, setLayout] = useState<"board" | "table">(initial.layout === "table" ? "table" : "board");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [f, setF] = useState<Filters>({ ...NO_FILTERS, owners: initial.owner ? [initial.owner] : [] });
  const [sort, setSort] = useState<SortKey>("close");
  const [metricsOpen, setMetricsOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(initial.preview ?? null);
  const [composer, setComposer] = useState<{ kind: ComposerKind; dealId: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cardFields, setCardFields] = useState<Set<CardField>>(new Set(["amount", "close", "owner", "billing", "contact", "age"]));
  const [undo, setUndo] = useState<Undo[]>([]);
  const [createIn, setCreateIn] = useState<string | null | undefined>(undefined); // undefined = closed
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lostFor, setLostFor] = useState<{ ids: string[]; stageId: string } | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useMemo(() => Date.parse(`${ctx.today}T12:00:00Z`), [ctx.today]);
  const stageOf = useCallback((id: string) => stages.find((s) => s.id === id)!, [stages]);
  const prob = (d: WDeal) => d.probabilityOverride ?? stageOf(d.stageId)?.probability ?? 0;

  // Card display preferences persist per browser.
  useEffect(() => { try { const v = localStorage.getItem("afq.deals.cardFields"); if (v) setCardFields(new Set(JSON.parse(v))); } catch {} }, []);
  const [shownMetrics, setShownMetrics] = useState<Set<MetricKey>>(new Set(Object.keys(METRICS) as MetricKey[]));
  useEffect(() => { try { const v = localStorage.getItem("afq.deals.metrics"); if (v) setShownMetrics(new Set(JSON.parse(v))); } catch {} }, []);
  const toggleMetric = (k: MetricKey) => setShownMetrics((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); try { localStorage.setItem("afq.deals.metrics", JSON.stringify([...n])); } catch {} return n; });
  const toggleField = (k: CardField) => setCardFields((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); try { localStorage.setItem("afq.deals.cardFields", JSON.stringify([...n])); } catch {} return n; });

  // Keep the URL shareable.
  useEffect(() => {
    const p = new URLSearchParams();
    if (tab !== "all" && !tab.startsWith("view:")) p.set("tab", tab); if (q) p.set("q", q); if (layout !== "board") p.set("layout", layout); if (previewId) p.set("preview", previewId);
    const s = p.toString();
    window.history.replaceState(null, "", `/deals${s ? `?${s}` : ""}`);
  }, [tab, q, layout, previewId]);

  // Shortcuts: "/" search, "n" new deal, "b"/"t" layout, "?" help, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "n" && ctx.perms.edit) setCreateIn(null);
      if (e.key === "b") setLayout("board");
      if (e.key === "t") setLayout("table");
      if (e.key === "?") setShortcuts(true);
      if (e.key === "Escape") { setPreviewId(null); setSelected(new Set()); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ctx.perms.edit]);

  const needsAttention = useCallback((d: WDeal) => {
    const s = stageOf(d.stageId);
    if (s.isWon || s.isLost) return false;
    const idle = daysSince(d.lastActivityAt, now);
    return !d.nextStep || !d.nextStepDue || d.nextStepDue < ctx.today || idle === null || idle >= s.staleAfterDays || d.discountStatus === "pending";
  }, [stageOf, now, ctx.today]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = items.filter((d) => {
      const s = stageOf(d.stageId);
      if (tab === "mine" && d.ownerId !== ctx.me.id) return false;
      if (tab === "attention" && !needsAttention(d)) return false;
      if (term && !`${d.name} ${d.companyName} ${d.contactName ?? ""} ${d.ownerName}`.toLowerCase().includes(term)) return false;
      if (f.owners.length && !f.owners.map((o) => (o === "__me" ? ctx.me.id : o)).includes(d.ownerId)) return false;
      if (!matchDate(d.createdAt, f.created, ctx.today)) return false;
      if (!matchDate(d.lastActivityAt, f.activity, ctx.today)) return false;
      if (!matchDate(s.isWon || s.isLost ? d.closedAt : d.expectedCloseDate, f.close, ctx.today)) return false;
      if (f.product && !d.productIds.includes(f.product)) return false;
      if (f.segment && d.segment !== f.segment) return false;
      if (f.metric === "open" && (s.isWon || s.isLost)) return false;
      if (f.metric === "won" && !s.isWon) return false;
      if (f.metric === "new" && d.createdAt.slice(0, 7) !== ctx.today.slice(0, 7)) return false;
      const a = f.adv;
      if (a.stages.length && !a.stages.includes(d.stageId)) return false;
      if (a.minAmount && (d.amount ?? 0) < Number(a.minAmount)) return false;
      if (a.maxAmount && (d.amount ?? 0) > Number(a.maxAmount)) return false;
      if (a.forecast && d.forecastCategory !== a.forecast) return false;
      if (a.billing && d.billingFrequency !== a.billing) return false;
      const open = !s.isWon && !s.isLost;
      if (a.overdueNext && !(open && d.nextStepDue && d.nextStepDue < ctx.today)) return false;
      if (a.noUpcoming && !(open && !d.nextActivityAt)) return false;
      if (a.stale && !(open && (daysSince(d.lastActivityAt, now) ?? 9999) >= s.staleAfterDays)) return false;
      if (a.discountPending && d.discountStatus !== "pending") return false;
      return true;
    });
    const cmp: Record<SortKey, (a: WDeal, b: WDeal) => number> = {
      close: (a, b) => (a.expectedCloseDate ?? "9999").localeCompare(b.expectedCloseDate ?? "9999"),
      amount: (a, b) => (b.amount ?? 0) - (a.amount ?? 0),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      activity: (a, b) => (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? ""),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return out.sort(cmp[sort]);
  }, [items, q, tab, f, sort, stageOf, needsAttention, ctx.me.id, ctx.today, now]);

  const metrics = useMemo(() => {
    const sum = (xs: WDeal[]) => xs.reduce((a, d) => a + (d.amount ?? 0), 0);
    const avg = (xs: WDeal[]) => (xs.length ? sum(xs) / xs.length : 0);
    const open = filtered.filter((d) => { const s = stageOf(d.stageId); return !s.isWon && !s.isLost; });
    const won = filtered.filter((d) => stageOf(d.stageId).isWon);
    const fresh = filtered.filter((d) => d.createdAt.slice(0, 7) === ctx.today.slice(0, 7));
    const weightedList = open.map((d) => ((d.amount ?? 0) * prob(d)) / 100);
    const ages = open.map((d) => (now - Date.parse(d.createdAt)) / DAY);
    const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
    return {
      total: sum(filtered), totalAvg: avg(filtered), weighted: weightedList.reduce((a, b) => a + b, 0), weightedAvg: weightedList.length ? weightedList.reduce((a, b) => a + b, 0) / weightedList.length : 0,
      open: sum(open), openAvg: avg(open), openN: open.length, won: sum(won), wonAvg: avg(won), wonN: won.length, fresh: sum(fresh), freshN: fresh.length,
      age: avgAge >= 60 ? `${Math.round(avgAge / 30)} months` : `${Math.round(avgAge)} days`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, stageOf, ctx.today, now]);

  const respond = (r: ActionResult, okText?: string, undoable?: Undo) => {
    if (r.ok) {
      toast({ tone: "success", text: okText ?? r.message ?? "Done.", action: undoable ? { label: "Undo", run: () => runUndo(undoable) } : undefined });
      if (undoable) setUndo((u) => [...u.slice(-9), undoable]);
      router.refresh(); setPreviewVersion((v) => v + 1);
    } else {
      toast({ tone: "error", text: r.message ?? "That didn't work.", detail: Object.values(r.fieldErrors ?? {}).filter(Boolean) });
      if (r.data?.stale) router.refresh();
    }
    return r.ok;
  };
  const runUndo = (u: Undo) => start(async () => { const r = await u.run(); setUndo((s) => s.filter((x) => x !== u)); respond(r, `Undone: ${u.label}`); });

  // ---------------------------------------------------------------- Actions
  const moveDeal = (id: string, stageId: string, lossReason?: string) => {
    const d = items.find((x) => x.id === id)!;
    const target = stageOf(stageId);
    if (d.stageId === stageId) return;
    if (target.isLost && !lossReason) { setLostFor({ ids: [id], stageId }); return; }
    const from = d.stageId;
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, stageId } : x)));
    start(async () => {
      const r = await moveOneAction(id, stageId, d.updatedAt, lossReason ?? null);
      if (!r.ok) setItems((xs) => xs.map((x) => (x.id === id ? { ...x, stageId: from } : x)));
      if (!r.ok && target.isWon && !r.data?.stale) {
        // Show what's missing right away: open the quick view (it has the Closed Won checklist) and offer a jump to the fields.
        setPreviewId(id); setPreviewVersion((v) => v + 1);
        toast({ tone: "error", text: `${d.name} isn't ready for Closed Won yet:`, detail: Object.values(r.fieldErrors ?? {}).filter(Boolean), action: { label: "Fix in deal", run: () => router.push(`/deals/${id}#deal-details`) } });
        return;
      }
      if (r.ok && target.isWon && r.data?.handoverId) {
        toast({ tone: "success", text: `${d.name} is Closed Won. Next: complete the handover so Onboarding can start.`, action: { label: "Open handover", run: () => router.push(`/handovers/${r.data!.handoverId}`) } });
        router.refresh(); setPreviewVersion((v) => v + 1);
        return;
      }
      const canUndo = !target.isWon;
      respond(r, r.ok ? `${d.name} → ${target.name}. ${r.message ?? ""}` : undefined, r.ok && canUndo ? { label: `move of ${d.name}`, run: () => moveOneAction(id, from, null, null) } : undefined);
    });
  };
  const bulkMove = (stageId: string, lossReason?: string) => {
    const ids = [...selected];
    const target = stageOf(stageId);
    if (target.isLost && !lossReason) { setLostFor({ ids, stageId }); return; }
    const before = new Map(items.filter((d) => selected.has(d.id)).map((d) => [d.id, d.stageId]));
    start(async () => {
      const r = await bulkMoveAction(ids, stageId, lossReason ?? null);
      const moved = ((r.data?.results as { id: string; ok: boolean }[]) ?? []).filter((x) => x.ok).map((x) => x.id);
      if (r.ok || moved.length) setSelected(new Set());
      respond({ ...r, ok: moved.length > 0 }, `${r.message} → ${target.name}`, moved.length && !target.isWon ? {
        label: `bulk move to ${target.name}`,
        run: async () => { const groups = new Map<string, string[]>(); for (const id of moved) { const s = before.get(id)!; groups.set(s, [...(groups.get(s) ?? []), id]); } let last: ActionResult = { ok: true }; for (const [s, g] of groups) last = await bulkMoveAction(g, s, null); return last; },
      } : undefined);
      if (!r.ok && moved.length) toast({ tone: "error", text: "Some deals couldn't move:", detail: Object.values(r.fieldErrors ?? {}) });
    });
  };
  const bulkAssign = (ownerId: string) => {
    const ids = [...selected];
    const prev = new Map(items.filter((d) => selected.has(d.id)).map((d) => [d.id, d.ownerId]));
    const name = users.find((u) => u.id === ownerId)?.name;
    start(async () => {
      const r = await bulkAssignAction(ids, ownerId);
      if (r.ok) setSelected(new Set());
      respond(r, undefined, r.ok ? { label: `assign to ${name}`, run: async () => { let last: ActionResult = { ok: true }; for (const [owner, g] of groupBy(prev)) last = await bulkAssignAction(g, owner); return last; } } : undefined);
    });
  };
  const bulkDelete = (reason: string) => {
    const ids = [...selected];
    start(async () => {
      const r = await bulkDeleteAction(ids, reason);
      if (r.ok) { setSelected(new Set()); setConfirmDelete(false); if (previewId && ids.includes(previewId)) setPreviewId(null); }
      respond(r, undefined, r.ok ? { label: `delete of ${ids.length} deal(s)`, run: () => restoreAction(ids) } : undefined);
    });
  };
  const exportIds = (ids: string[], label: string) => start(async () => {
    const r = await exportAction(ids);
    if (r.ok) {
      const blob = new Blob([String(r.data?.csv ?? "")], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `afrilinq-deals-${ctx.today}.csv`; a.click(); URL.revokeObjectURL(a.href);
    }
    respond(r, r.ok ? `${r.message} (${label}) — download started. Export is recorded in the audit log.` : undefined);
  });
  const followUps = () => {
    const ids = [...selected];
    const due = new Date(now + 2 * DAY).toISOString().slice(0, 10) + "T09:00";
    start(async () => {
      let ok = 0;
      for (const id of ids) { const d = items.find((x) => x.id === id)!; const r = await taskAction({ dealId: id, companyId: d.companyId, title: `Follow up: ${d.name}`, dueAt: due, priority: "normal", ownerId: d.ownerId, description: "", type: "todo" }); if (r.ok) ok++; }
      setSelected(new Set());
      respond({ ok: ok > 0, message: ok ? undefined : "No tasks were created." }, `Created ${ok} follow-up task(s), due in 2 days, for each deal's owner.`);
    });
  };
  const copyView = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast({ tone: "success", text: "Link to this view copied." }); }
    catch { toast({ tone: "info", text: `Copy this link: ${window.location.href}` }); }
  };
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openComposer = (kind: ComposerKind, dealId: string) => { setPreviewId(dealId); setComposer({ kind, dealId }); };
  const activeFilterCount = (f.owners.length ? 1 : 0) + [f.created, f.activity, f.close, f.product, f.segment, f.metric].filter(Boolean).length + advancedCount(f.adv);
  const applyView = (v: SavedView) => {
    try {
      const st = JSON.parse(v.query) as { f: Filters; q: string; sort: SortKey; layout: "board" | "table"; base: Tab };
      setF({ ...NO_FILTERS, ...st.f, adv: { ...NO_ADVANCED, ...st.f?.adv } }); setQ(st.q ?? ""); setSort(st.sort ?? "close"); setLayout(st.layout ?? "board");
      setTab(`view:${v.id}`); setSelected(new Set());
      toast({ tone: "info", text: `Showing saved view “${v.name}”.` });
    } catch { toast({ tone: "error", text: "This saved view couldn't be read." }); }
  };
  const saveView = (name: string) => start(async () => {
    const base = tab.startsWith("view:") ? "all" : tab;
    const r = await saveDealViewAction(name, JSON.stringify({ f: { ...f, owners: base === "mine" ? ["__me", ...f.owners] : f.owners }, q, sort, layout, base }));
    if (r.ok) { setSaveViewOpen(false); router.refresh(); }
    respond(r);
  });
  const deleteView = (v: SavedView) => start(async () => { const r = await deleteDealViewAction(v.id); if (r.ok) setTab("all"); respond(r, `View “${v.name}” deleted.`); });
  const clearAll = () => { setF(NO_FILTERS); setQ(""); toast({ tone: "info", text: "Filters cleared." }); };

  // ---------------------------------------------------------------- Render
  const metricTile = (id: MetricKey, label: string, value: string, sub: string | null, key?: Filters["metric"], hint?: string) => !shownMetrics.has(id) ? null : (
    <button type="button" title={hint} onClick={() => key !== undefined && (setF((x) => ({ ...x, metric: x.metric === key ? "" : key })), toast({ tone: "info", text: f.metric === key ? "Showing all deals." : `Showing ${label.toLowerCase()} only.` }))}
      className={clsx("rounded-xl px-3 py-3 text-center transition", key !== undefined ? "hover:bg-brand-50" : "cursor-default", key && f.metric === key && "bg-brand-50 ring-2 ring-accent-500")}>
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-accent-600">{value}</p>
      {sub && <><p className="mt-1 text-sm text-slate-700">Average per deal</p><p className="text-sm font-medium tabular-nums text-slate-800">{sub}</p></>}
    </button>
  );

  return (
    <div className={clsx("flex gap-4", previewId && "lg:pr-0")}>
      <div className="min-w-0 flex-1">
        {/* Header */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Menu label={<span className="text-2xl font-semibold text-ink-950">Deals</span>} ariaLabel="Switch object">
            {(close) => <>
              <MenuItem onClick={close}><Check className="h-4 w-4 text-accent-600" /> Deals</MenuItem>
              <Link href="/leads" className="block px-3 py-1.5 hover:bg-slate-50">Leads</Link>
              <Link href="/companies" className="block px-3 py-1.5 hover:bg-slate-50">Companies</Link>
              <Link href="/contacts" className="block px-3 py-1.5 hover:bg-slate-50">Contacts</Link>
              <Link href="/handovers" className="block px-3 py-1.5 hover:bg-slate-50">Handover queue</Link>
            </>}
          </Menu>
          <div className="ml-auto flex items-center gap-2">
            <Menu icon={<MoreVertical className="h-4 w-4" />} ariaLabel="More deal options" variant="outline" align="right">
              {(close) => <>
                {ctx.perms.export && <MenuItem onClick={() => { close(); exportIds(filtered.map((d) => d.id), "current view"); }}><Download className="h-4 w-4" /> Export this view (CSV)</MenuItem>}
                {ctx.perms.pipelines ? <Link href="/settings/pipelines" className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"><Settings2 className="h-4 w-4" /> Edit pipeline stages</Link>
                  : <MenuItem disabled hint="Admin only" onClick={() => toast({ tone: "info", text: "Pipeline stages are configured by an administrator." })}><Settings2 className="h-4 w-4" /> Edit pipeline stages</MenuItem>}
                <MenuItem onClick={() => { close(); copyView(); }}><Copy className="h-4 w-4" /> Copy link to this view</MenuItem>
                <MenuItem onClick={() => { close(); setShortcuts(true); }}><Keyboard className="h-4 w-4" /> Keyboard shortcuts</MenuItem>
              </>}
            </Menu>
            <Link href="/handovers" className={btn("outline")} title="Closed-won deals flow into the handover queue"><ArrowRight className="h-4 w-4" /> Handovers</Link>
            {ctx.perms.edit && (
              <Menu label="Add deal" variant="primary" align="right" icon={<Plus className="h-4 w-4" />}>
                {(close) => <>
                  <MenuItem onClick={() => { close(); setCreateIn(null); }} hint="N">Create deal</MenuItem>
                  <MenuItem onClick={() => { close(); router.push("/leads"); }}>Convert a lead…</MenuItem>
                  <MenuItem disabled hint="Coming later" onClick={() => toast({ tone: "info", text: "Bulk import from CSV is coming later. Create deals individually or convert leads for now." })}>Import deals</MenuItem>
                </>}
              </Menu>
            )}
          </div>
        </div>

        {/* View tabs */}
        <nav className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200" aria-label="Deal views">
          {([["all", "All deals", items.length], ["mine", "My deals", items.filter((d) => d.ownerId === ctx.me.id).length], ["attention", "Needs attention", items.filter(needsAttention).length]] as const).map(([k, l, n]) => (
            <button key={k} onClick={() => { setTab(k); setSelected(new Set()); }} aria-current={tab === k ? "page" : undefined}
              className={clsx("-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-accent-500 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}>
              {k === "attention" ? <Clock className="h-4 w-4" aria-hidden /> : k === "mine" ? <UserRound className="h-4 w-4" aria-hidden /> : <LayoutGrid className="h-4 w-4" aria-hidden />}{l}
              <span className={clsx("rounded-full px-1.5 text-xs", k === "attention" && n ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600")}>{n}</span>
            </button>
          ))}
          {views.map((v) => {
            const active = tab === `view:${v.id}`;
            return (
              <span key={v.id} className={clsx("-mb-px inline-flex items-center border-b-2", active ? "border-accent-500" : "border-transparent")}>
                <button onClick={() => applyView(v)} aria-current={active ? "page" : undefined} className={clsx("px-3 py-2 text-sm font-medium", active ? "text-brand-700" : "text-slate-600 hover:text-slate-900")}>{v.name}</button>
                {active && <button aria-label={`Delete view ${v.name}`} title="Delete this saved view" onClick={() => deleteView(v)} className="mr-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-red-700"><X className="h-3.5 w-3.5" /></button>}
              </span>
            );
          })}
          <button onClick={() => setSaveViewOpen(true)} title="Save the current filters as a view" className="ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"><Plus className="h-4 w-4" /><span className="sr-only">Save current view</span></button>
        </nav>

        {/* Toolbar */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <label htmlFor="deal-search" className="sr-only">Search deals</label>
            <input id="deal-search" ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals ( / )" className="w-full rounded-full border border-slate-300 bg-white py-2 pl-8 pr-8 text-sm" />
            {q && <button aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-2 rounded p-0.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
          </div>
          <button onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} className={clsx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium", activeFilterCount ? "border-accent-500 bg-accent-50 text-accent-600" : "border-slate-300 bg-white text-slate-700")}>
            <Filter className="h-4 w-4" aria-hidden /> Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
          <Menu label={<>Sort: {SORTS[sort].split(" (")[0]}</>} variant="outline" icon={<SlidersHorizontal className="h-4 w-4" />}>
            {(close) => (Object.keys(SORTS) as SortKey[]).map((k) => <MenuItem key={k} onClick={() => { setSort(k); close(); toast({ tone: "info", text: `Sorted by ${SORTS[k].toLowerCase()}.` }); }}>{sort === k ? <Check className="h-4 w-4 text-accent-600" /> : <span className="w-4" />}{SORTS[k]}</MenuItem>)}
          </Menu>
          <div className="ml-auto flex items-center gap-1.5">
            <Menu label="New business pipeline" variant="outline" align="right">
              {(close) => <><MenuItem onClick={close}><Check className="h-4 w-4 text-accent-600" /> New business</MenuItem><MenuItem disabled hint="Coming later" onClick={() => toast({ tone: "info", text: "Additional pipelines (e.g. renewals) are coming later; the data model already supports them." })}>Renewals pipeline</MenuItem></>}
            </Menu>
            <div className="inline-flex rounded-full border border-slate-300 bg-white p-0.5" role="group" aria-label="Layout">
              <button onClick={() => setLayout("board")} aria-pressed={layout === "board"} title="Board (B)" className={clsx("rounded-full p-1.5", layout === "board" ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}><Columns3 className="h-4 w-4" /><span className="sr-only">Board</span></button>
              <button onClick={() => setLayout("table")} aria-pressed={layout === "table"} title="Table (T)" className={clsx("rounded-full p-1.5", layout === "table" ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}><Rows3 className="h-4 w-4" /><span className="sr-only">Table</span></button>
            </div>
            <Menu icon={<Settings2 className="h-4 w-4" />} ariaLabel="Card display settings" variant="outline" align="right">
              {() => <><p className="px-3 py-1 text-xs font-semibold uppercase text-slate-500">Show on cards</p>{(Object.keys(CARD_FIELDS) as CardField[]).map((k) => <MenuItem key={k} onClick={() => toggleField(k)}>{cardFields.has(k) ? <Check className="h-4 w-4 text-accent-600" /> : <span className="w-4" />}{CARD_FIELDS[k]}</MenuItem>)}</>}
            </Menu>
            <button onClick={() => setMetricsOpen(!metricsOpen)} aria-expanded={metricsOpen} title={metricsOpen ? "Hide summary" : "Show summary"} className="rounded-full border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50">{metricsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}<span className="sr-only">Toggle summary</span></button>
          </div>
        </div>

        {/* Filter chips */}
        {filtersOpen && (
          <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
            <OwnerFilter users={users} value={f.owners} meId={ctx.me.id} onChange={(owners) => setF((x) => ({ ...x, owners }))} />
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <DateFilterChip label="Create date" value={f.created} onChange={(v) => setF((x) => ({ ...x, created: v }))} />
            <DateFilterChip label="Last activity date" value={f.activity} onChange={(v) => setF((x) => ({ ...x, activity: v }))} />
            <DateFilterChip label="Close date" value={f.close} onChange={(v) => setF((x) => ({ ...x, close: v }))} />
            <Menu label={<>Product{f.product ? `: ${products.find((p) => p.id === f.product)?.name.split(" —")[0]}` : ""}</>}>
              {(close) => <><MenuItem onClick={() => { setF((x) => ({ ...x, product: "" })); close(); }}>Any product</MenuItem>{products.map((p) => <MenuItem key={p.id} onClick={() => { setF((x) => ({ ...x, product: p.id })); close(); }}>{f.product === p.id ? <Check className="h-4 w-4 text-accent-600" /> : <span className="w-4" />}{p.name}</MenuItem>)}</>}
            </Menu>
            <Menu label={<>Segment{f.segment ? `: ${f.segment}` : ""}</>}>
              {(close) => <>{["", "SME", "Mid-Market", "Enterprise", "Public Sector"].map((sg) => <MenuItem key={sg} onClick={() => { setF((x) => ({ ...x, segment: sg })); close(); }}>{f.segment === sg ? <Check className="h-4 w-4 text-accent-600" /> : <span className="w-4" />}{sg || "Any segment"}</MenuItem>)}</>}
            </Menu>
            {(activeFilterCount > 0 || q) && <button onClick={clearAll} className="px-2 py-1 font-semibold text-brand-600 hover:underline">Clear all</button>}
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <button onClick={() => setAdvOpen(true)} className={clsx("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold", advancedCount(f.adv) ? "bg-accent-50 text-accent-600" : "text-slate-700 hover:bg-slate-100")}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden /> Advanced filters{advancedCount(f.adv) ? ` (${advancedCount(f.adv)})` : ""}
            </button>
          </div>
        )}

        {/* Summary metrics */}
        {metricsOpen && (
          <section aria-label="Deal summary" className="relative mb-3 rounded-2xl border border-slate-200 bg-white p-3 pr-10 shadow-sm">
            <div className="absolute right-2 top-2">
              <Menu icon={<Settings2 className="h-4 w-4" />} ariaLabel="Choose summary metrics" align="right">
                {() => <><p className="px-3 py-1 text-xs font-semibold uppercase text-slate-500">Show metrics</p>{(Object.keys(METRICS) as MetricKey[]).map((k) => <MenuItem key={k} onClick={() => toggleMetric(k)}>{shownMetrics.has(k) ? <Check className="h-4 w-4 text-accent-600" /> : <span className="w-4" />}{METRICS[k]}</MenuItem>)}</>}
              </Menu>
            </div>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
              {metricTile("total", "Total deal amount", money(metrics.total, ctx.currency), money(metrics.totalAvg, ctx.currency), undefined, `Sum of all ${filtered.length} deals in this view`)}
              {metricTile("weighted", "Weighted deal amount", money(metrics.weighted, ctx.currency), money(metrics.weightedAvg, ctx.currency), undefined, "Open deals × stage probability (or the deal's override)")}
              {metricTile("open", "Open deal amount", money(metrics.open, ctx.currency), money(metrics.openAvg, ctx.currency), "open", `${metrics.openN} open deals — click to show only these`)}
              {metricTile("won", "Closed deal amount", money(metrics.won, ctx.currency), money(metrics.wonAvg, ctx.currency), "won", `${metrics.wonN} won deals — click to show only these`)}
              {metricTile("new", "New deal amount", money(metrics.fresh, ctx.currency), metrics.freshN ? money(metrics.fresh / metrics.freshN, ctx.currency) : money(0, ctx.currency), "new", `${metrics.freshN} deals created this month — click to filter`)}
              {metricTile("age", "Average deal age", metrics.age, null, undefined, "Average time since creation for open deals")}
            </div>
            {shownMetrics.size === 0 && <p className="py-2 text-center text-sm text-slate-500">All metrics hidden — use the gear to choose some.</p>}
          </section>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm shadow-md" role="toolbar" aria-label="Bulk actions">
            <span className="mr-2 font-semibold">{selected.size} deal{selected.size === 1 ? "" : "s"} selected</span>
            {selected.size < filtered.length && <button onClick={() => setSelected(new Set(filtered.map((d) => d.id)))} className={btn("ghost", "sm")}>Select all {filtered.length}</button>}
            {ctx.perms.reassign ? (
              <Menu label="Assign" icon={<ArrowRight className="h-4 w-4" />}>
                {(close) => users.map((u) => <MenuItem key={u.id} onClick={() => { close(); bulkAssign(u.id); }}>{u.name}</MenuItem>)}
              </Menu>
            ) : <button onClick={() => toast({ tone: "info", text: "Only sales managers can reassign deals." })} className={btn("ghost", "sm")}><ArrowRight className="h-4 w-4" /> Assign</button>}
            {ctx.perms.edit && <Menu label="Move to stage">{(close) => stages.map((s) => <MenuItem key={s.id} onClick={() => { close(); bulkMove(s.id); }} hint={`${s.probability}%`}>{s.name}</MenuItem>)}</Menu>}
            {ctx.perms.export && <button onClick={() => exportIds([...selected], "selection")} className={btn("ghost", "sm")}><Download className="h-4 w-4" /> Export</button>}
            {ctx.perms.delete ? <button onClick={() => setConfirmDelete(true)} className={clsx(btn("ghost", "sm"), "text-red-700")}><Trash2 className="h-4 w-4" /> Delete</button>
              : <button onClick={() => toast({ tone: "info", text: "Deleting deals requires the data.delete permission." })} className={clsx(btn("ghost", "sm"), "text-slate-400")}><Trash2 className="h-4 w-4" /> Delete</button>}
            <Menu label="More">
              {(close) => <>
                {ctx.perms.log && <MenuItem onClick={() => { close(); followUps(); }}><ListChecks className="h-4 w-4" /> Create follow-up tasks</MenuItem>}
                <MenuItem onClick={async () => { close(); const names = items.filter((d) => selected.has(d.id)).map((d) => d.name).join("\n"); try { await navigator.clipboard.writeText(names); toast({ tone: "success", text: "Deal names copied." }); } catch { toast({ tone: "error", text: "Clipboard not available in this browser." }); } }}><Copy className="h-4 w-4" /> Copy deal names</MenuItem>
              </>}
            </Menu>
            <button aria-label="Clear selection" onClick={() => setSelected(new Set())} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
        )}

        {/* Board */}
        {layout === "board" ? (
          <div className="-mx-4 overflow-x-auto px-4 pb-2" aria-busy={pending}>
            <div className="flex gap-3">
              {stages.map((s) => {
                const col = filtered.filter((d) => d.stageId === s.id);
                const total = col.reduce((a, d) => a + (d.amount ?? 0), 0);
                const weightedTotal = col.reduce((a, d) => a + ((d.amount ?? 0) * prob(d)) / 100, 0);
                const isCollapsed = collapsed.has(s.id);
                if (isCollapsed) return (
                  <button key={s.id} onClick={() => setCollapsed((c) => { const n = new Set(c); n.delete(s.id); return n; })} title={`Expand ${s.name}`}
                    className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                    <ChevronRight className="h-4 w-4" /><span className="[writing-mode:vertical-rl]">{s.name} · {col.length}</span>
                  </button>
                );
                return (
                  <section key={s.id} aria-label={`${s.name}, ${col.length} deals`}
                    onDragOver={(e) => { e.preventDefault(); setDropOn(s.id); }} onDragLeave={() => setDropOn((x) => (x === s.id ? null : x))}
                    onDrop={() => { if (drag) moveDeal(drag, s.id); setDrag(null); setDropOn(null); }}
                    className={clsx("flex w-72 shrink-0 flex-col rounded-xl border bg-slate-100/80 transition", dropOn === s.id ? "border-accent-500 ring-2 ring-accent-400" : "border-slate-200")}>
                    <header className="flex items-center gap-1 px-3 pb-1 pt-2.5">
                      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800" title={`${s.name} — ${s.probability}% probability`}>{s.name} <span className="font-normal text-slate-500">{col.length}</span></h3>
                      <Menu icon={<MoreVertical className="h-4 w-4" />} ariaLabel={`${s.name} column options`} align="right">
                        {(close) => <>
                          {ctx.perms.edit && <MenuItem onClick={() => { close(); setCreateIn(s.id); }}><Plus className="h-4 w-4" /> Add deal to this stage</MenuItem>}
                          <MenuItem onClick={() => { close(); setSelected((x) => new Set([...x, ...col.map((d) => d.id)])); toast({ tone: "info", text: `Selected ${col.length} deal(s) in ${s.name}.` }); }}><Check className="h-4 w-4" /> Select all in column</MenuItem>
                          <MenuItem onClick={() => { close(); setCollapsed((c) => new Set([...c, s.id])); }}><ChevronLeft className="h-4 w-4" /> Collapse column</MenuItem>
                        </>}
                      </Menu>
                    </header>
                    <ul className="flex max-h-[62vh] min-h-28 flex-col gap-2 overflow-y-auto px-2 pb-2">
                      {col.map((d) => <DealCard key={d.id} d={d} stage={s} stages={stages} ctx={ctx} now={now} fields={cardFields} selected={selected.has(d.id)} active={previewId === d.id}
                        onSelect={() => toggleSel(d.id)} onOpen={() => setPreviewId(d.id)} onDragStart={() => setDrag(d.id)} onMove={(sid) => moveDeal(d.id, sid)} onQuick={(k) => openComposer(k, d.id)} />)}
                      {col.length === 0 && ctx.perms.edit && <li><button onClick={() => setCreateIn(s.id)} className="w-full rounded-full border border-dashed border-slate-300 bg-white py-2 text-sm font-medium text-slate-600 hover:border-accent-500 hover:text-accent-600">+ Deal</button></li>}
                    </ul>
                    <footer className="mt-auto border-t border-slate-200 px-3 py-2 text-xs text-slate-700">
                      <p><strong className="tabular-nums">{money(total, ctx.currency)}</strong> | Total amount</p>
                      <p title="Sum of amount × probability">{s.isWon ? "Won (100%)" : s.isLost ? "Lost (0%)" : <><strong className="tabular-nums">{money(weightedTotal, ctx.currency)}</strong> ({s.probability}%) | Weighted</>}</p>
                    </footer>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <DealTable rows={filtered} stages={stages} ctx={ctx} selected={selected} setSelected={setSelected} onOpen={(id) => setPreviewId(id)} onMove={moveDeal} sort={sort} setSort={setSort} />
        )}

        {/* Footer */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-medium text-slate-800">{filtered.length} deal{filtered.length === 1 ? "" : "s"}{filtered.length !== items.length && ` of ${items.length}`}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => start(() => { router.refresh(); toast({ tone: "success", text: "Board refreshed with the latest data." }); })} className={btn("outline")} title="Refresh"><RefreshCw className={clsx("h-4 w-4", pending && "animate-spin")} /><span className="sr-only sm:not-sr-only">Refresh</span></button>
            {ctx.perms.export && <button onClick={() => exportIds(filtered.map((d) => d.id), "current view")} className={btn("outline")}><Download className="h-4 w-4" /> Export</button>}
            <button onClick={() => (undo.length ? runUndo(undo[undo.length - 1]) : toast({ tone: "info", text: "Nothing to undo yet." }))} className={btn("outline")} title={undo.length ? `Undo ${undo[undo.length - 1].label}` : "Nothing to undo"}><Undo2 className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Undo{undo.length ? ` (${undo.length})` : ""}</span></button>
            <button onClick={copyView} className={btn("outline")} title="Copy link to this view"><Copy className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {previewId && (
        <DealPreview key={`${previewId}-${previewVersion}`} id={previewId} stages={stages} users={users} ctx={ctx} onClose={() => setPreviewId(null)}
          onCompose={(k) => setComposer({ kind: k, dealId: previewId })} onChanged={() => router.refresh()} lossReasons={ctx.lossReasons} />
      )}
      {composer && (
        <Composer kind={composer.kind} dealId={composer.dealId} deal={items.find((d) => d.id === composer.dealId)} users={users} ctx={ctx}
          onClose={() => setComposer(null)} onSwitch={(k) => setComposer({ ...composer, kind: k })} onDone={() => { setPreviewVersion((v) => v + 1); router.refresh(); }} />
      )}
      {createIn !== undefined && <CreateDealDialog stageId={createIn} stages={stages} users={users} products={products} ctx={ctx} onClose={() => setCreateIn(undefined)} onCreated={(id) => { setCreateIn(undefined); router.refresh(); setPreviewId(id); }} />}
      {lostFor && (
        <Dialog title="Why was this deal lost?" onClose={() => setLostFor(null)} footer={<><button className={btn("outline")} onClick={() => setLostFor(null)}>Cancel</button><button form="lost-form" className={btn("danger")}>Mark Closed Lost</button></>}>
          <form id="lost-form" onSubmit={(e) => { e.preventDefault(); const r = String(new FormData(e.currentTarget).get("reason")); const t = lostFor; setLostFor(null); if (t.ids.length === 1 && !selected.size) moveDeal(t.ids[0], t.stageId, r); else bulkMove(t.stageId, r); }}>
            <Label htmlFor="loss-reason">Loss reason (required)</Label>
            <select id="loss-reason" name="reason" className={field} required>{ctx.lossReasons.map((r) => <option key={r}>{r}</option>)}</select>
            <p className="mt-2 text-xs text-slate-500">Loss reasons feed the win/loss report.</p>
          </form>
        </Dialog>
      )}
      {confirmDelete && <DeleteDialog count={selected.size} onClose={() => setConfirmDelete(false)} onConfirm={bulkDelete} />}
      {advOpen && <AdvancedFiltersDialog value={f.adv} stages={stages} onClose={() => setAdvOpen(false)} onApply={(adv) => { setF((x) => ({ ...x, adv })); setAdvOpen(false); toast({ tone: "info", text: advancedCount(adv) ? `${advancedCount(adv)} advanced filter(s) applied.` : "Advanced filters cleared." }); }} />}
      {saveViewOpen && (
        <Dialog title="Save this view" onClose={() => setSaveViewOpen(false)} footer={<><button className={btn("outline")} onClick={() => setSaveViewOpen(false)}>Cancel</button><button form="save-view" className={btn("primary")} disabled={pending}>Save view</button></>}>
          <form id="save-view" onSubmit={(e) => { e.preventDefault(); saveView(String(new FormData(e.currentTarget).get("name") ?? "")); }}>
            <Label htmlFor="view-name">View name</Label><input id="view-name" name="name" required maxLength={40} autoFocus className={field} placeholder="e.g. My Q4 commits" />
            <p className="mt-2 text-xs text-slate-500">Saves the current tab, search, filters, sort and layout as a tab only you can see. “Me” filters stay dynamic.</p>
          </form>
        </Dialog>
      )}
      {shortcuts && (
        <Dialog title="Keyboard shortcuts" onClose={() => setShortcuts(false)}>
          <ul className="space-y-2 text-sm">{[["/", "Search deals"], ["N", "Create a deal"], ["B / T", "Board or table layout"], ["Esc", "Close preview and clear selection"], ["?", "This help"]].map(([k, v]) => <li key={k} className="flex justify-between"><span>{v}</span><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 text-xs">{k}</kbd></li>)}</ul>
        </Dialog>
      )}
    </div>
  );
}

function groupBy(m: Map<string, string>) {
  const g = new Map<string, string[]>();
  for (const [id, v] of m) g.set(v, [...(g.get(v) ?? []), id]);
  return g;
}

function DealCard({ d, stage, stages, ctx, now, fields, selected, active, onSelect, onOpen, onDragStart, onMove, onQuick }: {
  d: WDeal; stage: WStage; stages: WStage[]; ctx: WCtx; now: number; fields: Set<CardField>; selected: boolean; active: boolean;
  onSelect: () => void; onOpen: () => void; onDragStart: () => void; onMove: (stageId: string) => void; onQuick: (k: ComposerKind) => void;
}) {
  const inStage = Math.max(0, Math.floor((now - Date.parse(d.stageEnteredAt)) / DAY));
  const idle = daysSince(d.lastActivityAt, now);
  const open = !stage.isWon && !stage.isLost;
  const stale = open && (idle === null || idle >= stage.staleAfterDays);
  const overdue = open && !!d.nextStepDue && d.nextStepDue < ctx.today;
  return (
    <li draggable={ctx.perms.edit && !stage.isWon} onDragStart={onDragStart}
      className={clsx("group rounded-lg border bg-white p-3 shadow-sm transition", active ? "border-accent-500 ring-2 ring-accent-400" : selected ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300 hover:shadow")}>
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${d.name}`} className={clsx("mt-1 h-4 w-4 rounded border-slate-300 text-brand-600", !selected && "opacity-40 group-hover:opacity-100 focus:opacity-100")} />
        <button onClick={onOpen} className="min-w-0 flex-1 text-left text-sm font-semibold leading-snug text-brand-600 hover:underline">{d.name}</button>
        <Menu icon={<MoreHorizontal className="h-4 w-4" />} ariaLabel={`Actions for ${d.name}`} align="right">
          {(close) => <>
            <MenuItem onClick={() => { close(); onOpen(); }}>Preview</MenuItem>
            <Link href={`/deals/${d.id}`} className="block px-3 py-1.5 hover:bg-slate-50">Open full record</Link>
            {ctx.perms.edit && !stage.isWon && <><div className="my-1 border-t border-slate-100" /><p className="px-3 py-1 text-xs font-semibold uppercase text-slate-500">Move to</p>
              {stages.filter((s) => s.id !== d.stageId).map((s) => <MenuItem key={s.id} onClick={() => { close(); onMove(s.id); }} hint={`${s.probability}%`}>{s.name}</MenuItem>)}</>}
          </>}
        </Menu>
      </div>
      <dl className="mt-2 space-y-0.5 pl-6 text-[13px] text-slate-700">
        {fields.has("amount") && <div><dt className="inline text-slate-500">Amount: </dt><dd className="inline font-medium">{money(d.amount, d.currency, false)}</dd></div>}
        {fields.has("close") && <div><dt className="inline text-slate-500">Close date: </dt><dd className={clsx("inline", open && d.expectedCloseDate && d.expectedCloseDate < ctx.today && "font-medium text-red-700")}>{shortDate(stage.isWon || stage.isLost ? d.closedAt : d.expectedCloseDate)}</dd></div>}
        {fields.has("billing") && d.billingFrequency && <div><dt className="inline text-slate-500">Billing: </dt><dd className="inline">{d.billingFrequency}</dd></div>}
        {fields.has("owner") && <div><dt className="inline text-slate-500">Owner: </dt><dd className="inline">{d.ownerName}</dd></div>}
        {fields.has("next") && open && <div><dt className="inline text-slate-500">Next: </dt><dd className={clsx("inline", overdue && "text-red-700")}>{d.nextStep ?? "—"}</dd></div>}
      </dl>
      {(stale || overdue || d.discountStatus === "pending" || fields.has("age")) && (
        <div className="mt-2 flex flex-wrap gap-1 pl-6 text-[11px]">
          {fields.has("age") && <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600"><Clock className="h-3 w-3" aria-hidden />{inStage}d in stage</span>}
          {stale && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900" title={`No activity for ${idle ?? "∞"} days`}>Stale</span>}
          {overdue && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800">Next step overdue</span>}
          {d.discountStatus === "pending" && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-800">Discount pending</span>}
        </div>
      )}
      {open && (
        <div className="mt-2 flex flex-wrap gap-1 pl-6 text-[11px]">
          {d.nextActivityAt
            ? <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-900" title="Next open task or scheduled meeting"><Calendar className="h-3 w-3" aria-hidden />Next {shortDate(d.nextActivityAt)}</span>
            : <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-900" title="No open task or scheduled meeting"><span aria-hidden>—</span> No upcoming</span>}
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-slate-600" title="Last logged activity"><Clock className="h-3 w-3" aria-hidden />{ago(d.lastActivityAt, now)}</span>
        </div>
      )}
      {fields.has("contact") && d.contactName && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pl-6 pt-2 text-[13px]">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700" aria-hidden>{initials(d.contactName)}</span>
          <span className="truncate text-slate-800">{d.contactName}</span>
        </div>
      )}
      {ctx.perms.log && (
        <div className="mt-2 flex justify-end gap-0.5 opacity-60 transition group-hover:opacity-100">
          {([["note", StickyNote, "Note"], ["email", Mail, "Email"], ["call", Phone, "Call"], ["task", ListChecks, "Task"], ["meeting", Calendar, "Meeting"]] as const).map(([k, Icon, label]) => (
            <button key={k} onClick={() => onQuick(k)} title={label} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-600"><Icon className="h-4 w-4" aria-hidden /><span className="sr-only">{label} for {d.name}</span></button>
          ))}
        </div>
      )}
    </li>
  );
}

function DealTable({ rows, stages, ctx, selected, setSelected, onOpen, onMove, sort, setSort }: {
  rows: WDeal[]; stages: WStage[]; ctx: WCtx; selected: Set<string>; setSelected: (s: Set<string>) => void; onOpen: (id: string) => void; onMove: (id: string, stageId: string) => void;
  sort: SortKey; setSort: (s: SortKey) => void;
}) {
  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const th = (label: string, key?: SortKey) => (
    <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {key ? <button onClick={() => setSort(key)} className={clsx("inline-flex items-center gap-1 hover:text-slate-900", sort === key && "text-brand-700")}>{label}{sort === key && <ChevronDown className="h-3 w-3" />}</button> : label}
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50"><tr>
          <th className="w-8 px-3"><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} className="h-4 w-4" /></th>
          {th("Deal", "name")}{th("Stage")}{th("Amount", "amount")}{th("Close date", "close")}{th("Owner")}{th("Last activity", "activity")}{th("Next step")}{th("Created", "created")}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((d) => {
            const s = stages.find((x) => x.id === d.stageId)!;
            return (
              <tr key={d.id} className={clsx(selected.has(d.id) ? "bg-brand-50" : "hover:bg-slate-50")}>
                <td className="px-3"><input type="checkbox" aria-label={`Select ${d.name}`} checked={selected.has(d.id)} onChange={() => { const n = new Set(selected); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); setSelected(n); }} className="h-4 w-4" /></td>
                <td className="px-3 py-2"><button onClick={() => onOpen(d.id)} className="font-semibold text-brand-600 hover:underline">{d.name}</button><div className="text-xs text-slate-500">{d.companyName}</div></td>
                <td className="px-3 py-2">{ctx.perms.edit && !s.isWon ? (
                  <select aria-label={`Stage for ${d.name}`} value={d.stageId} onChange={(e) => onMove(d.id, e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs">{stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                ) : <span className="text-xs">{s.name}</span>}</td>
                <td className="px-3 py-2 tabular-nums">{money(d.amount, d.currency, false)}</td>
                <td className="px-3 py-2">{shortDate(s.isWon || s.isLost ? d.closedAt : d.expectedCloseDate)}</td>
                <td className="px-3 py-2">{d.ownerName}</td>
                <td className="px-3 py-2 text-xs">{shortDate(d.lastActivityAt)}</td>
                <td className={clsx("max-w-[14rem] truncate px-3 py-2 text-xs", d.nextStepDue && d.nextStepDue < ctx.today && !s.isWon && !s.isLost && "text-red-700")}>{d.nextStep ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{shortDate(d.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No deals match this view.</p>}
    </div>
  );
}

function CreateDealDialog({ stageId, stages, users, products, ctx, onClose, onCreated }: {
  stageId: string | null; stages: WStage[]; users: WUser[]; products: { id: string; name: string }[]; ctx: WCtx; onClose: () => void; onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => { fetch("/api/pickers/companies").then((r) => r.json()).then(setCompanies).catch(() => setCompanies([])); }, []);
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    start(async () => {
      const r = await createInStageAction({ ...fd, forecastCategory: "pipeline" }, fd.stageId || null);
      if (r.ok) { toast({ tone: r.data?.warning ? "info" : "success", text: r.message ?? "Deal created." }); onCreated(String(r.data?.id)); }
      else { setErrors(r.fieldErrors ?? {}); toast({ tone: "error", text: r.message ?? "Couldn't create the deal." }); }
    });
  };
  const err = (k: string) => errors[k] && <p className="mt-1 text-xs text-red-700">{errors[k]}</p>;
  const in7 = new Date(Date.parse(`${ctx.today}T12:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
  return (
    <Dialog title="Create deal" onClose={onClose} footer={<><button className={btn("outline")} onClick={onClose}>Cancel</button><button form="create-deal" disabled={pending} className={btn("primary")}>{pending ? "Creating…" : "Create deal"}</button></>}>
      <form id="create-deal" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2"><Label htmlFor="cd-name">Deal name *</Label><input id="cd-name" name="name" required className={field} autoFocus />{err("name")}</div>
        <div className="sm:col-span-2"><Label htmlFor="cd-co">Company *</Label>
          <select id="cd-co" name="companyId" required className={field} defaultValue=""><option value="">{companies === null ? "Loading…" : "Choose a company…"}</option>{companies?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{err("companyId")}
          <p className="mt-1 text-xs text-slate-500">Not listed? <Link className="text-brand-600 underline" href="/companies/new">Create the company</Link> first.</p></div>
        <div><Label htmlFor="cd-stage">Stage</Label><select id="cd-stage" name="stageId" defaultValue={stageId ?? stages[0].id} className={field}>{stages.filter((s) => !s.isLost).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><Label htmlFor="cd-amt">Amount ({ctx.currency})</Label><input id="cd-amt" name="amount" inputMode="decimal" className={field} />{err("amount")}</div>
        <input type="hidden" name="currency" value={ctx.currency} />
        <div><Label htmlFor="cd-close">Expected close date</Label><input id="cd-close" name="expectedCloseDate" type="date" className={field} />{err("expectedCloseDate")}</div>
        <div><Label htmlFor="cd-prod">Product / service</Label><select id="cd-prod" name="productId" className={field} defaultValue=""><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><Label htmlFor="cd-next">Next step *</Label><input id="cd-next" name="nextStep" required className={field} placeholder="e.g. Discovery call" />{err("nextStep")}</div>
        <div><Label htmlFor="cd-due">Next step due *</Label><input id="cd-due" name="nextStepDue" type="date" required defaultValue={in7} className={field} />{err("nextStepDue")}</div>
        {ctx.perms.reassign && <div className="sm:col-span-2"><Label htmlFor="cd-owner">Owner</Label><select id="cd-owner" name="ownerId" className={field} defaultValue={ctx.me.id}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
        {stageId && stages.find((s) => s.id === stageId)?.isWon && <p className="text-xs text-amber-800 sm:col-span-2">Closed Won needs contract reference, billing frequency and start date — the deal will be created in the first stage if those aren't set yet.</p>}
      </form>
    </Dialog>
  );
}

function DeleteDialog({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog title={`Delete ${count} deal${count === 1 ? "" : "s"}?`} onClose={onClose}
      footer={<><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("danger")} disabled={!reason.trim()} onClick={() => onConfirm(reason)}>Delete</button></>}>
      <p className="text-sm text-slate-700">Deleted deals disappear from boards and reports but are kept in the database (soft delete) and can be restored with Undo. The reason is recorded in the audit log.</p>
      <div className="mt-3"><Label htmlFor="del-reason">Reason *</Label><input id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={field} placeholder="e.g. Duplicate of another deal" autoFocus /></div>
    </Dialog>
  );
}
