"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import clsx from "clsx";

/** Accessible dropdown: closes on outside click, Escape, or after choosing an item. */
export function Menu({ label, children, align = "left", variant = "ghost", icon, ariaLabel, disabled }: {
  label?: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; variant?: "ghost" | "outline" | "primary"; icon?: ReactNode; ariaLabel?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const v = { ghost: "text-slate-700 hover:bg-slate-100", outline: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50", primary: "bg-brand-600 text-white hover:bg-brand-700" }[variant];
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(!open)}
        className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium disabled:opacity-50", v)}>
        {icon}{label}{label !== undefined && <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />}
      </button>
      {open && (
        <div role="menu" className={clsx("absolute z-40 mt-1 max-h-80 min-w-48 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl", align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, disabled, hint, danger }: { children: ReactNode; onClick?: () => void; disabled?: boolean; hint?: ReactNode; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} aria-disabled={disabled}
      className={clsx("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-slate-50", disabled && "cursor-not-allowed text-slate-400", danger && "text-red-700")}>
      <span className="flex items-center gap-2">{children}</span>{hint && <span className="text-xs text-slate-400">{hint}</span>}
    </button>
  );
}

export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx("flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 className="font-semibold text-ink-950">{title}</h2><button aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export const btn = (variant: "primary" | "outline" | "ghost" | "danger" = "outline", size: "sm" | "md" = "md") => clsx(
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
  size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
  { primary: "bg-brand-600 text-white hover:bg-brand-700", outline: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50", ghost: "text-slate-700 hover:bg-slate-100", danger: "bg-red-600 text-white hover:bg-red-700" }[variant],
);
export const field = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900";
export const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-600">{children}</label>;

/** Compact, deterministic money format (identical on server and client). */
const SYM: Record<string, string> = { NGN: "₦", USD: "$", GHS: "GH₵", KES: "KSh " };
export function money(n: number | null | undefined, c = "NGN", compact = true) {
  if (n === null || n === undefined) return "—";
  if (!compact) return `${SYM[c] ?? `${c} `}${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  const [d, u] = Math.abs(n) >= 1e9 ? [1e9, "B"] : Math.abs(n) >= 1e6 ? [1e6, "M"] : Math.abs(n) >= 1e3 ? [1e3, "K"] : [1, ""];
  const num = (n / d).toFixed(d === 1 ? 0 : 2);
  return `${SYM[c] ?? `${c} `}${num.includes(".") ? num.replace(/0+$/, "").replace(/\.$/, "") : num}${u}`;
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
export function shortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
