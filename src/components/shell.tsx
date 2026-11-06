"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ToastProvider } from "./toast";
import { BackButton } from "./back-button";
import {
  LayoutDashboard, Target, Users, Building2, Handshake, ArrowRightLeft, Rocket, GraduationCap, LifeBuoy, BookOpen, CheckSquare,
  BarChart3, Settings, HeartHandshake, Menu, X,
  Package, Siren, Receipt,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: string; badge?: number };
const ICONS: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard, products: Package, escalations: Siren, billing: Receipt, leads: Target, contacts: Users, companies: Building2, deals: Handshake, handover: ArrowRightLeft, onboarding: Rocket,
  training: GraduationCap, tickets: LifeBuoy, success: HeartHandshake, kb: BookOpen, tasks: CheckSquare, reports: BarChart3, settings: Settings,
};

function Nav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((it) => {
        const Icon = ICONS[it.icon] ?? LayoutDashboard;
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        return (
          <li key={it.href}>
            <Link href={it.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition", active ? "bg-accent-500/25 text-white shadow-[inset_3px_0_0_var(--color-accent-400)]" : "text-brand-100 hover:bg-white/10 hover:text-white")}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">{it.label}</span>
              {!!it.badge && <span className="rounded-full bg-accent-500 px-1.5 text-xs font-semibold text-white">{it.badge}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-3 py-4">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-white p-1" aria-hidden><img src="/brand/afrilinq-icon.png" alt="" className="h-full w-full object-contain" /></span>
      <span className="leading-tight"><span className="block text-base font-semibold tracking-tight text-white">Afrilinq</span><span className="block text-[11px] font-medium uppercase tracking-wider text-accent-400">Customer Platform</span></span>
    </Link>
  );
}

export function Shell({ items, topbar, children }: { items: NavItem[]; topbar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto bg-brand-900 px-2 pb-4 lg:flex" aria-label="Main navigation">
        <Brand /><Nav items={items} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col overflow-y-auto bg-brand-900 px-2 pb-4">
            <div className="flex items-center justify-between"><Brand /><button className="mr-2 rounded p-2 text-white" onClick={() => setOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button></div>
            <Nav items={items} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4">
        <button className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
        <BackButton />
        {topbar}
      </header>
      <ToastProvider><main id="main" className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6">{children}</main></ToastProvider>
    </div>
  );
}
