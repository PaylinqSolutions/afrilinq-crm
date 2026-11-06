"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, X, Zap } from "lucide-react";
import clsx from "clsx";
import { DATE_PRESETS, describeDateFilter, type DateFilter } from "@/lib/date-presets";
import { btn, Dialog, field, Label } from "./kit";

/** Popover anchored under a chip button; closes on outside click / Escape. */
export function Popover({ chip, active, children, onClear, width = "w-80" }: { chip: ReactNode; active: boolean; children: (close: () => void) => ReactNode; onClear?: () => void; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className={clsx("inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold", active ? "bg-accent-50 text-accent-600" : "text-slate-700 hover:bg-slate-100")}>
        {chip}<ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {active && onClear && <button aria-label="Remove filter" onClick={onClear} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>}
      {open && <div className={clsx("absolute left-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white p-3 shadow-xl", width)}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function OwnerFilter({ users, value, onChange, meId, label = "Deal owner", unassigned = false }: { users: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void; meId: string; label?: string; unassigned?: boolean }) {
  const [q, setQ] = useState("");
  const list = users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Popover chip={<>{label}{value.length ? ` (${value.length})` : ""}</>} active={value.length > 0} onClear={() => onChange([])}>
      {() => <>
        <p className="mb-2 text-xs font-medium text-slate-500">is any of</p>
        <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search owners" aria-label="Search owners" className="w-full rounded-full border-2 border-brand-500 py-1.5 pl-8 pr-3 text-sm" /></div>
        <ul className="max-h-72 overflow-y-auto">
          {"me".includes(q.toLowerCase()) && (
            <li><label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
              <input type="checkbox" checked={value.includes("__me")} onChange={() => toggle("__me")} className="mt-1 h-4 w-4" />
              <span><span className="flex items-center gap-1 font-medium"><Zap className="h-3.5 w-3.5 text-accent-500" aria-hidden />Me</span><span className="block text-xs text-slate-500">Applied dynamically to whoever is viewing</span></span>
            </label></li>
          )}
          {unassigned && "unassigned".includes(q.toLowerCase()) && (
            <li><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <input type="checkbox" checked={value.includes("__none")} onChange={() => toggle("__none")} className="h-4 w-4" /><span className="italic text-slate-600">No owner</span>
            </label></li>
          )}
          {list.map((u) => (
            <li key={u.id}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <input type="checkbox" checked={value.includes(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4" />
              <span>{u.name}{u.id === meId && <span className="text-xs text-slate-500"> (you)</span>}</span>
            </label></li>
          ))}
          {list.length === 0 && <li className="px-2 py-3 text-sm text-slate-500">No owners match “{q}”.</li>}
        </ul>
      </>}
    </Popover>
  );
}

const OPS: { key: DateFilter["op"]; label: string }[] = [
  { key: "is", label: "is" }, { key: "before", label: "is before" }, { key: "after", label: "is after" }, { key: "between", label: "is between" },
  { key: "overdue", label: "is in the past" }, { key: "known", label: "is known" }, { key: "unknown", label: "is unknown" },
];

export function DateFilterChip({ label, value, onChange }: { label: string; value: DateFilter | null; onChange: (v: DateFilter | null) => void }) {
  const [op, setOp] = useState<DateFilter["op"]>(value?.op ?? "is");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(value?.from ?? "");
  const [to, setTo] = useState(value?.to ?? "");
  const presets = useMemo(() => DATE_PRESETS.filter((p) => `${p.label} ${p.hint}`.toLowerCase().includes(q.toLowerCase())), [q]);
  return (
    <Popover chip={<>{label}{value ? `: ${describeDateFilter(value)}` : ""}</>} active={!!value} onClear={() => onChange(null)}>
      {(close) => <>
        <label className="sr-only" htmlFor={`op-${label}`}>Operator</label>
        <select id={`op-${label}`} value={op} onChange={(e) => setOp(e.target.value as DateFilter["op"])} className="mb-2 rounded-md border-0 bg-transparent p-0 text-sm font-medium text-slate-700">
          {OPS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {op === "is" && <>
          <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ranges (e.g. quarter)" aria-label="Search date ranges" className="w-full rounded-full border-2 border-brand-500 py-1.5 pl-8 pr-3 text-sm" /></div>
          <ul className="max-h-72 overflow-y-auto">
            {presets.map((p) => (
              <li key={p.key}><button onClick={() => { onChange({ op: "is", preset: p.key }); close(); }} className={clsx("w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-50", value?.preset === p.key && "bg-accent-50")}>
                <span className="flex items-center gap-1 text-sm font-medium">{value?.preset === p.key && <Check className="h-3.5 w-3.5 text-accent-600" />}{p.label}</span><span className="block text-xs text-slate-500">{p.hint}</span>
              </button></li>
            ))}
            {presets.length === 0 && <li className="px-2 py-3 text-sm text-slate-500">No ranges match.</li>}
          </ul>
        </>}
        {(op === "before" || op === "after") && <div className="space-y-2"><input type="date" aria-label="Date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          <button disabled={!from} onClick={() => { onChange({ op, from }); close(); }} className={btn("primary", "sm")}>Apply</button></div>}
        {op === "between" && <div className="space-y-2"><div className="grid grid-cols-2 gap-2"><input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /><input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={field} /></div>
          <button disabled={!from || !to || to < from} onClick={() => { onChange({ op, from, to }); close(); }} className={btn("primary", "sm")}>Apply</button>{to && from && to < from && <p className="text-xs text-red-700">End date is before start date.</p>}</div>}
        {(op === "known" || op === "unknown" || op === "overdue") && <button onClick={() => { onChange({ op }); close(); }} className={btn("primary", "sm")}>Apply</button>}
      </>}
    </Popover>
  );
}

export type Advanced = { stages: string[]; minAmount: string; maxAmount: string; forecast: string; billing: string; overdueNext: boolean; noUpcoming: boolean; stale: boolean; discountPending: boolean };
export const NO_ADVANCED: Advanced = { stages: [], minAmount: "", maxAmount: "", forecast: "", billing: "", overdueNext: false, noUpcoming: false, stale: false, discountPending: false };
export const advancedCount = (a: Advanced) => [a.stages.length > 0, a.minAmount, a.maxAmount, a.forecast, a.billing, a.overdueNext, a.noUpcoming, a.stale, a.discountPending].filter(Boolean).length;

export function AdvancedFiltersDialog({ value, stages, onApply, onClose }: { value: Advanced; stages: { id: string; name: string }[]; onApply: (a: Advanced) => void; onClose: () => void }) {
  const [a, setA] = useState(value);
  const set = <K extends keyof Advanced>(k: K, v: Advanced[K]) => setA((x) => ({ ...x, [k]: v }));
  const invalid = a.minAmount && a.maxAmount && Number(a.minAmount) > Number(a.maxAmount);
  return (
    <Dialog title="Advanced filters" onClose={onClose} wide footer={<><button className={btn("ghost")} onClick={() => setA(NO_ADVANCED)}>Reset</button><button className={btn("outline")} onClick={onClose}>Cancel</button><button className={btn("primary")} disabled={!!invalid} onClick={() => onApply(a)}>Apply filters</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset><legend className="mb-1 text-xs font-medium text-slate-600">Deal stage is any of</legend>
          <div className="grid grid-cols-1 gap-1">{stages.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.stages.includes(s.id)} onChange={() => set("stages", a.stages.includes(s.id) ? a.stages.filter((x) => x !== s.id) : [...a.stages, s.id])} className="h-4 w-4" />{s.name}</label>)}</div>
        </fieldset>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="af-min">Amount ≥</Label><input id="af-min" inputMode="decimal" value={a.minAmount} onChange={(e) => set("minAmount", e.target.value.replace(/[^\d.]/g, ""))} className={field} /></div>
            <div><Label htmlFor="af-max">Amount ≤</Label><input id="af-max" inputMode="decimal" value={a.maxAmount} onChange={(e) => set("maxAmount", e.target.value.replace(/[^\d.]/g, ""))} className={field} /></div>
          </div>
          {invalid && <p className="text-xs text-red-700">Minimum is above maximum.</p>}
          <div><Label htmlFor="af-fc">Forecast category</Label><select id="af-fc" value={a.forecast} onChange={(e) => set("forecast", e.target.value)} className={field}><option value="">Any</option>{[["pipeline", "Pipeline"], ["best_case", "Best case"], ["commit", "Commit"], ["closed", "Closed"], ["omitted", "Omitted"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><Label htmlFor="af-bf">Billing frequency</Label><select id="af-bf" value={a.billing} onChange={(e) => set("billing", e.target.value)} className={field}><option value="">Any</option>{["One-off", "Monthly", "Quarterly", "Annually", "Multi-year"].map((b) => <option key={b}>{b}</option>)}</select></div>
          <fieldset className="space-y-1"><legend className="mb-1 text-xs font-medium text-slate-600">Health</legend>
            {([["overdueNext", "Next step is overdue"], ["noUpcoming", "No upcoming activity"], ["stale", "Stale (no activity past the stage threshold)"], ["discountPending", "Discount awaiting approval"]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a[k]} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4" />{l}</label>
            ))}
          </fieldset>
        </div>
      </div>
    </Dialog>
  );
}
