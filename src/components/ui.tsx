import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import {
  AlertOctagon, AlertTriangle, ArrowDown, Circle, CheckCircle2, Clock, Flame, PauseCircle, XCircle, ShieldAlert, Inbox,
  HeartPulse, Activity, TrendingDown,
} from "lucide-react";

export const cx = clsx;

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 text-xs text-slate-500">
            {crumbs.map((c, i) => (<span key={c.href}>{i > 0 && " / "}<Link className="hover:underline" href={c.href}>{c.label}</Link></span>))}
          </nav>
        )}
        <h1 className="truncate text-xl font-semibold text-ink-950 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-950">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const btn = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-slate-700 hover:bg-slate-100",
};
export const buttonClass = (variant: keyof typeof btn = "primary", size: "sm" | "md" = "md") =>
  cx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60", btn[variant], size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm");

export function LinkButton({ href, children, variant = "primary", size = "md" }: { href: string; children: ReactNode; variant?: keyof typeof btn; size?: "sm" | "md" }) {
  return <Link href={href} className={buttonClass(variant, size)}>{children}</Link>;
}

const tones = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200", green: "bg-emerald-50 text-emerald-800 ring-emerald-200", blue: "bg-sky-50 text-sky-800 ring-sky-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200", red: "bg-red-50 text-red-800 ring-red-200", orange: "bg-orange-50 text-orange-900 ring-orange-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200", brand: "bg-brand-50 text-brand-800 ring-brand-200",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "gray", children, icon, title }: { tone?: Tone; children: ReactNode; icon?: ReactNode; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>{icon}{children}</span>;
}

const ic = "h-3.5 w-3.5";
export function PriorityBadge({ p }: { p: string }) {
  const m: Record<string, [Tone, ReactNode, string]> = {
    P1: ["red", <AlertOctagon key="i" className={ic} aria-hidden />, "P1 Critical"], P2: ["orange", <AlertTriangle key="i" className={ic} aria-hidden />, "P2 High"],
    P3: ["blue", <Circle key="i" className={ic} aria-hidden />, "P3 Normal"], P4: ["gray", <ArrowDown key="i" className={ic} aria-hidden />, "P4 Low"],
  };
  const [tone, icon, label] = m[p] ?? ["gray", null, p];
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
}

export function SlaBadge({ state, label }: { state: string; label: string }) {
  const m: Record<string, [Tone, ReactNode]> = {
    ok: ["green", <Clock key="i" className={ic} aria-hidden />], warning: ["amber", <AlertTriangle key="i" className={ic} aria-hidden />],
    escalate: ["orange", <Flame key="i" className={ic} aria-hidden />], breached: ["red", <XCircle key="i" className={ic} aria-hidden />],
    paused: ["gray", <PauseCircle key="i" className={ic} aria-hidden />], met: ["green", <CheckCircle2 key="i" className={ic} aria-hidden />],
  };
  const [tone, icon] = m[state] ?? ["gray", null];
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
}

export function RiskBadge({ level }: { level: string }) {
  if (level === "high") return <Badge tone="red" icon={<ShieldAlert className={ic} aria-hidden />}>High risk</Badge>;
  if (level === "medium") return <Badge tone="amber" icon={<AlertTriangle className={ic} aria-hidden />}>Medium risk</Badge>;
  return <Badge tone="green" icon={<CheckCircle2 className={ic} aria-hidden />}>Low risk</Badge>;
}

export function HealthBadge({ status, score }: { status: string | null | undefined; score?: number }) {
  if (!status) return <Badge tone="gray">Not scored</Badge>;
  const s = score !== undefined ? ` · ${score}` : "";
  if (status === "at_risk") return <Badge tone="red" icon={<TrendingDown className={ic} aria-hidden />}>At Risk{s}</Badge>;
  if (status === "watch") return <Badge tone="amber" icon={<Activity className={ic} aria-hidden />}>Watch{s}</Badge>;
  return <Badge tone="green" icon={<HeartPulse className={ic} aria-hidden />}>Healthy{s}</Badge>;
}

export function StatusBadge({ status, map }: { status: string; map?: Record<string, Tone> }) {
  const defaults: Record<string, Tone> = {
    New: "blue", Qualified: "green", Converted: "brand", Disqualified: "gray", Nurturing: "violet",
    "Pending Sales Submission": "amber", "Submitted for Review": "blue", "Changes Requested": "orange", "Accepted by Onboarding": "green", "In Onboarding": "brand", Complete: "gray", Draft: "gray",
    new: "blue", triaged: "violet", assigned: "blue", in_progress: "brand", waiting_on_customer: "amber", waiting_on_engineering: "orange", waiting_on_third_party: "amber",
    resolved: "green", closed: "gray", reopened: "red", scheduled: "blue", rescheduled: "amber", completed: "green", cancelled: "gray",
    draft: "gray", in_review: "amber", published: "green", archived: "gray", active: "brand", on_hold: "amber",
    open: "blue", done: "green", todo: "gray", blocked: "red", pending_approval: "amber", approved: "brand", rejected: "gray",
    attended: "green", absent: "red", pending: "gray", upcoming: "blue", renewed: "green", churned: "red",
  };
  const label = status.replace(/_/g, " ");
  return <Badge tone={(map ?? defaults)[status] ?? defaults[status] ?? "gray"}>{label.charAt(0).toUpperCase() + label.slice(1)}</Badge>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <Inbox className="h-6 w-6 text-slate-400" aria-hidden />
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {children && <div className="max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: "red" | "amber" | "green" }) {
  const inner = (
    <div className={cx("h-full rounded-xl border bg-white p-4 shadow-sm transition", href && "hover:border-brand-500 hover:shadow", tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : "border-slate-200")}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold", tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-ink-950")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-brand-600" style={{ width: `${v}%` }} /></div>
      <span className="w-9 text-right text-xs tabular-nums text-slate-600">{v}%</span>
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-2 text-sm">
      {items.map(([k, v], i) => (<div key={i} className="contents"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 break-words text-slate-900">{v ?? "—"}</dd></div>))}
    </dl>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50"><tr>{head.map((h, i) => <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>
      </table>
      {!hasRows && empty && <div className="p-4">{empty}</div>}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx("px-3 py-2 align-top", className)}>{children}</td>;

export function Tabs({ tabs, current }: { tabs: { key: string; label: ReactNode; href: string; count?: number }[]; current: string }) {
  return (
    <nav className="-mx-4 mb-4 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0" aria-label="Tabs">
      <ul className="flex gap-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link href={t.href} aria-current={t.key === current ? "page" : undefined}
              className={cx("inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === current ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}>
              {t.label}{t.count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Pagination({ total, page, pageSize = 25, base }: { total: number; page: number; pageSize?: number; base: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `${base}${base.includes("?") ? "&" : "?"}page=${p}`;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
      <span>{total} record{total === 1 ? "" : "s"}</span>
      <div className="flex items-center gap-2">
        {page > 1 ? <Link className="rounded px-2 py-1 hover:bg-slate-100" href={href(page - 1)}>← Prev</Link> : <span className="px-2 py-1 opacity-40">← Prev</span>}
        <span>Page {page} of {pages}</span>
        {page < pages ? <Link className="rounded px-2 py-1 hover:bg-slate-100" href={href(page + 1)}>Next →</Link> : <span className="px-2 py-1 opacity-40">Next →</span>}
      </div>
    </div>
  );
}

export function Notice({ tone = "blue", children, title }: { tone?: "blue" | "amber" | "red" | "green"; children: ReactNode; title?: string }) {
  const c = { blue: "border-sky-200 bg-sky-50 text-sky-900", amber: "border-amber-200 bg-amber-50 text-amber-900", red: "border-red-200 bg-red-50 text-red-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-lg border px-3 py-2 text-sm", c)}>{title && <p className="font-semibold">{title}</p>}{children}</div>;
}

export function FilterBar({ children, action }: { children: ReactNode; action: string }) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      {children}
      <button className={buttonClass("secondary", "sm")} type="submit">Apply</button>
      <Link href={action} className={buttonClass("ghost", "sm")}>Reset</Link>
    </form>
  );
}

export function FSelect({ name, label, value, options, all = "All" }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; all?: string | null }) {
  return (
    <label className="flex min-w-[8rem] flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      <select name={name} defaultValue={value ?? ""} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900">
        {all !== null && <option value="">{all}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function FInput({ name, label, value, type = "text", placeholder }: { name: string; label: string; value?: string; type?: string; placeholder?: string }) {
  return (
    <label className="flex min-w-[8rem] flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900" />
    </label>
  );
}

/** Minimal safe markdown: escapes HTML, then supports ## headings, lists, bold and http(s) links. */
export function Markdown({ text }: { text: string }) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="text-brand-700 underline" rel="noopener noreferrer" target="_blank" href="$2">$1</a>');
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const ul = /^\s*[-*]\s+(.*)/.exec(line); const ol = /^\s*\d+\.\s+(.*)/.exec(line);
    const want = ul ? "ul" : ol ? "ol" : null;
    if (list && want !== list) { out.push(`</${list}>`); list = null; }
    if (want && !list) { out.push(`<${want}>`); list = want; }
    if (ul || ol) out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    else if (/^##\s+/.test(line)) out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return <div className="prose-afq text-sm leading-relaxed text-slate-800" dangerouslySetInnerHTML={{ __html: out.join("") }} />;
}

/** Hidden optimistic-concurrency token: the record version this form was rendered from. */
export function VersionField({ at }: { at: Date | null | undefined }) {
  return <input type="hidden" name="_version" value={at ? at.toISOString() : ""} />;
}
