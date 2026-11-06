import Link from "next/link";
import clsx from "clsx";
import { AlertTriangle, FileText, Building2, CheckCircle2, Circle, CircleDot, GraduationCap, Handshake, LifeBuoy, MinusCircle, Package, Plus, Rocket, ArrowRightLeft, UserRound } from "lucide-react";
import type { JourneyStep, RelatedGroup } from "@/server/services/journey";

const ICONS: Record<string, typeof Building2> = { documents: FileText, company: Building2, contacts: UserRound, deals: Handshake, products: Package, handover: ArrowRightLeft, onboarding: Rocket, training: GraduationCap, tickets: LifeBuoy };

/** One consistent "everything connected to this record" panel, used on every detail page. */
export function RelatedPanel({ groups, title = "Related records" }: { groups: RelatedGroup[]; title?: string }) {
  if (!groups.length) return null;
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-ink-950">{title}</h2></header>
      <div className="divide-y divide-slate-100">
        {groups.map((g) => {
          const Icon = ICONS[g.key] ?? Circle;
          return (
            <div key={g.key} className="px-4 py-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600"><Icon className="h-3.5 w-3.5" aria-hidden />{g.title} ({g.items.length})</h3>
                <span className="flex items-center gap-2 text-xs">
                  {g.more && <Link href={g.more.href} className="font-medium text-brand-700 hover:underline">{g.more.label}</Link>}
                  {g.add && <Link href={g.add.href} className="inline-flex items-center gap-0.5 font-semibold text-accent-600 hover:underline"><Plus className="h-3.5 w-3.5" />{g.add.label}</Link>}
                </span>
              </div>
              {g.items.length ? (
                <ul className="space-y-1">{g.items.map((i) => (
                  <li key={i.href} className="text-sm"><Link href={i.href} className="font-medium text-brand-700 hover:underline">{i.label}</Link>{i.sub && <span className="block truncate text-xs text-slate-500">{i.sub}</span>}</li>
                ))}</ul>
              ) : <p className="text-xs text-slate-500">None yet.</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const STEP_STYLE: Record<JourneyStep["status"], { icon: typeof Circle; dot: string; text: string; label: string }> = {
  done: { icon: CheckCircle2, dot: "text-emerald-600", text: "text-slate-800", label: "Done" },
  current: { icon: CircleDot, dot: "text-accent-600", text: "text-ink-950", label: "In progress" },
  attention: { icon: AlertTriangle, dot: "text-amber-600", text: "text-ink-950", label: "Needs attention" },
  todo: { icon: Circle, dot: "text-slate-300", text: "text-slate-500", label: "Not started" },
  skipped: { icon: MinusCircle, dot: "text-slate-300", text: "text-slate-500", label: "Skipped" },
};

/** Lead → Opportunity → Won → Handover → Onboarding → Training → Live → Customer success, with each step linked. */
export function JourneyTracker({ steps, title = "Customer journey" }: { steps: JourneyStep[]; title?: string }) {
  if (!steps.length) return null;
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-ink-950">{title}</h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        {steps.map((s, i) => {
          const st = STEP_STYLE[s.status];
          const body = (
            <>
              <span className="flex items-center gap-1.5"><st.icon className={clsx("h-4 w-4 shrink-0", st.dot)} aria-label={st.label} /><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{i + 1}. {s.label}</span></span>
              <span className={clsx("mt-1 block text-xs leading-snug", st.text)}>{s.detail}</span>
            </>
          );
          return (
            <li key={s.key} className={clsx("rounded-lg border p-2.5", s.status === "current" ? "border-accent-400 bg-accent-50/60" : s.status === "attention" ? "border-amber-300 bg-amber-50/60" : "border-slate-200")}>
              {s.href ? <Link href={s.href} className="block hover:underline">{body}</Link> : body}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
