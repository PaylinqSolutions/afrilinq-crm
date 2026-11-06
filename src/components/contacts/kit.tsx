"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, CheckCircle2, Info, Loader2, Plus, Search, X } from "lucide-react";
import { normalisePhone } from "@/lib/rules/contacts";
import { btn, field } from "../deals/kit";

export type WContact = {
  id: string; firstName: string; lastName: string; email: string | null; phone: string | null; whatsapp: string | null; jobTitle: string | null;
  companyId: string | null; companyName: string | null; city: string | null; leadStatus: string | null; lifecycleStage: string; referralSource: string | null;
  ownerId: string | null; ownerName: string | null; contactRoles: string[]; marketingConsent: boolean; createdAt: string; updatedAt: string; lastActivityAt: string | null;
};
export type CUser = { id: string; name: string };
export type CCtx = {
  me: CUser; today: string; tz: string;
  perms: { edit: boolean; delete: boolean; export: boolean; log: boolean; assign: boolean; deals: boolean; dealsEdit: boolean; tickets: boolean };
};
export type Option = { value: string; label: string; hint?: string };

export const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

/** Fixed-position layer anchored to an element, so it isn't clipped by scrolling tables. Closes on outside click and Escape. */
export function Floating({ anchor, onClose, children, width = 320, align = "left" }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 300;
      const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, align === "right" ? r.right - width : r.left));
      setPos({ top: up ? r.top - h - 4 : r.bottom + 4, left, up });
    };
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, width, align]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [anchor, onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }} className="fixed z-[55] rounded-xl border border-slate-200 bg-white shadow-2xl">
      {children}
    </div>, document.body);
}

/** Searchable single-choice list (lead status, referral source, owner, company…). Optionally lets staff add a new value. */
export function PickList({ options, value, onPick, allowNew, placeholder = "Search", clearLabel, busy }: {
  options: Option[]; value: string | null; onPick: (v: string | null) => void; allowNew?: boolean; placeholder?: string; clearLabel?: string; busy?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const list = useMemo(() => options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [options, q]);
  const canAdd = allowNew && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  const total = list.length + (canAdd ? 1 : 0);
  return (
    <div className="p-2" onKeyDown={(e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(total - 1, h + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
      if (e.key === "Enter") { e.preventDefault(); if (hi < list.length) onPick(list[hi].value); else if (canAdd) onPick(q.trim()); }
    }}>
      <div className="relative mb-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
        <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} placeholder={placeholder} aria-label={placeholder} className="w-full rounded-full border-2 border-brand-500 py-1.5 pl-8 pr-3 text-sm" /></div>
      <ul role="listbox" className="max-h-64 overflow-y-auto">
        {clearLabel && value && !q && <li><button onClick={() => onPick(null)} className="w-full rounded-lg px-2 py-1.5 text-left text-sm italic text-slate-500 hover:bg-slate-50">{clearLabel}</button></li>}
        {list.map((o, i) => (
          <li key={o.value} role="option" aria-selected={o.value === value}>
            <button onMouseEnter={() => setHi(i)} onClick={() => onPick(o.value)} className={clsx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm", i === hi ? "bg-slate-100" : "hover:bg-slate-50")}>
              <span className={clsx("h-2 w-2 shrink-0 rounded-full", o.value === value ? "bg-accent-500" : "bg-slate-200")} aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}{o.hint && <span className="block truncate text-xs text-slate-500">{o.hint}</span>}</span>
              {o.value === value && <Check className="h-4 w-4 text-accent-600" aria-label="Current" />}
            </button>
          </li>
        ))}
        {canAdd && <li><button onMouseEnter={() => setHi(list.length)} onClick={() => onPick(q.trim())} className={clsx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-brand-700", hi === list.length ? "bg-slate-100" : "hover:bg-slate-50")}><Plus className="h-4 w-4" />Add “{q.trim()}”</button></li>}
        {!list.length && !canAdd && <li className="px-2 py-3 text-sm text-slate-500">No matches.</li>}
      </ul>
      {busy && <p className="flex items-center gap-1 px-2 pt-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Saving…</p>}
    </div>
  );
}

const COUNTRIES = [{ code: "234", flag: "🇳🇬", name: "Nigeria" }, { code: "233", flag: "🇬🇭", name: "Ghana" }, { code: "254", flag: "🇰🇪", name: "Kenya" }, { code: "27", flag: "🇿🇦", name: "South Africa" }, { code: "44", flag: "🇬🇧", name: "United Kingdom" }, { code: "1", flag: "🇺🇸", name: "United States" }];

/** Phone editor with country code, live validation and an option to keep the number exactly as typed. */
export function PhoneEditor({ label, value, onSave, onCancel, busy }: { label: string; value: string | null; onSave: (v: string | null) => void; onCancel: () => void; busy?: boolean }) {
  const guess = COUNTRIES.find((c) => value?.replace(/\D/g, "").startsWith(c.code))?.code ?? "234";
  const [cc, setCc] = useState(guess);
  const [raw, setRaw] = useState(value ?? "");
  const [ext, setExt] = useState("");
  const [plain, setPlain] = useState(false);
  const n = raw.trim() ? normalisePhone(raw, cc) : null;
  const out = !raw.trim() ? null : plain ? raw.trim() : `${n!.value}${ext ? ` ext. ${ext}` : ""}`;
  const changed = out !== (value ?? null);
  return (
    <form className="p-4" onSubmit={(e) => { e.preventDefault(); if (changed && (plain || !n || n.valid)) onSave(out); }}>
      <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-ink-950">Edit {label}</h3><button type="button" aria-label="Close" onClick={onCancel} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
      <div className="rounded-lg border border-slate-200 p-2">
        <div className="flex gap-1.5">
          <select aria-label="Country code" value={cc} onChange={(e) => setCc(e.target.value)} className="shrink-0 rounded-lg border border-slate-300 px-1.5 text-sm">
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} +{c.code}</option>)}
          </select>
          <input autoFocus onFocus={(e) => e.currentTarget.select()} aria-label={label} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="0803 481 9348" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900" />
          <input aria-label="Extension" value={ext} onChange={(e) => setExt(e.target.value.replace(/\D/g, ""))} placeholder="Ext." className="w-16 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900" />
        </div>
        <p aria-live="polite" className={clsx("mt-1 text-xs font-medium", !n ? "text-slate-500" : plain || n.valid ? "text-emerald-700" : "text-red-700")}>
          {!n ? "Leave empty to remove the number." : plain ? "Saved exactly as typed." : n.valid ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Validated · {n.value}</span> : "Not a valid number yet — use 10–15 digits."}
        </p>
      </div>
      <label className="mt-2 flex items-center gap-2 text-sm text-brand-700"><input type="checkbox" checked={plain} onChange={(e) => setPlain(e.target.checked)} className="h-4 w-4" />Remove number formatting
        <span title="Keep the number exactly as typed, e.g. for short codes or internal extensions."><Info className="h-3.5 w-3.5 text-slate-400" aria-label="About number formatting" /></span></label>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={!changed || busy || (!!n && !plain && !n.valid)} className={btn("primary", "sm")}>{busy && <Loader2 className="h-3 w-3 animate-spin" />}Save</button>
        <button type="button" onClick={onCancel} className={btn("outline", "sm")}>Cancel</button>
      </div>
    </form>
  );
}

/** Plain text/email editor used for inline edits. */
export function TextEditor({ label, value, type = "text", onSave, onCancel, busy, validate }: { label: string; value: string | null; type?: string; onSave: (v: string | null) => void; onCancel: () => void; busy?: boolean; validate?: (v: string) => string | null }) {
  const [v, setV] = useState(value ?? "");
  const err = v.trim() && validate ? validate(v.trim()) : null;
  const changed = (v.trim() || null) !== (value ?? null);
  return (
    <form className="p-4" onSubmit={(e) => { e.preventDefault(); if (changed && !err) onSave(v.trim() || null); }}>
      <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold text-ink-950">Edit {label}</h3><button type="button" aria-label="Close" onClick={onCancel} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
      <input autoFocus onFocus={(e) => e.currentTarget.select()} type={type} aria-label={label} value={v} onChange={(e) => setV(e.target.value)} className={field} />
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={!changed || !!err || busy} className={btn("primary", "sm")}>{busy && <Loader2 className="h-3 w-3 animate-spin" />}Save</button>
        <button type="button" onClick={onCancel} className={btn("outline", "sm")}>Cancel</button>
      </div>
    </form>
  );
}

export const validEmail = (v: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter a valid email address.");

export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const ini = name.split(/\s+/).filter((p) => p && !/^(dr|engr|mr|mrs|ms|prof)\.?$/i.test(p)).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
  return <span aria-hidden className={clsx("inline-grid shrink-0 place-items-center rounded-full bg-slate-100 font-semibold text-slate-600 ring-1 ring-slate-200", size === "lg" ? "h-12 w-12 text-base" : "h-7 w-7 text-[11px]")}>{ini}</span>;
}

/** "3 days ago" style text that is identical on server and client for the same `today`. */
export function ago(iso: string | null, today: string) {
  if (!iso) return null;
  const d = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(iso)) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : d < 365 ? `${Math.round(d / 30)} mo ago` : `${Math.round(d / 365)} yr ago`;
}

/** Deterministic "Nov 17, 2025 9:56 AM" in the org timezone (avoids hydration mismatches). */
export function dateTime(iso: string | null, tz: string, withTime = true) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(iso));
}

export function downloadCsv(csv: string, name: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
