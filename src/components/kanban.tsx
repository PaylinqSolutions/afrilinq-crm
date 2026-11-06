"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import clsx from "clsx";
import { moveStageDirect } from "@/app/actions/crm";

export type KCard = { id: string; name: string; companyName: string; amount: number | null; currency: string; ownerName: string; stageId: string; expectedCloseDate: string | null; daysInStage: number; stale: boolean; nextStepOverdue: boolean; discountPending: boolean; version: string };
export type KStage = { id: string; name: string; probability: number; isWon: boolean; isLost: boolean };

// Deterministic (no Intl) so server and browser render identical text.
const SYM: Record<string, string> = { NGN: "₦", USD: "$", GHS: "GH₵", KES: "KSh " };
const money = (n: number | null, c: string) => {
  if (n === null) return "—";
  const [d, u] = n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${SYM[c] ?? `${c} `}${(n / d).toFixed(1).replace(/\.0$/, "")}${u}`;
};

export function DealKanban({ stages, cards, lossReasons }: { stages: KStage[]; cards: KCard[]; lossReasons: string[] }) {
  const [items, setItems] = useState(cards);
  useEffect(() => setItems(cards), [cards]); // adopt fresh server data (new versions) after each refresh
  const [drag, setDrag] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: string[]; dealId?: string } | null>(null);
  const [pendingLost, setPendingLost] = useState<{ id: string; stageId: string } | null>(null);
  const [isPending, start] = useTransition();
  const router = useRouter();

  const move = (id: string, stageId: string, lossReason?: string) => {
    const target = stages.find((s) => s.id === stageId)!;
    if (target.isLost && !lossReason) { setPendingLost({ id, stageId }); return; }
    const before = items;
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, stageId } : x)));
    start(async () => {
      const r = await moveStageDirect(id, stageId, lossReason, before.find((x) => x.id === id)?.version);
      if (!r.ok) {
        setItems(before);
        setMsg({ ok: false, text: r.message ?? "Move rejected", errors: Object.values(r.fieldErrors ?? {}).filter(Boolean), dealId: id });
        if (r.data?.stale) router.refresh();
      } else {
        setMsg({ ok: true, text: r.message ?? "Moved" });
        router.refresh();
      }
    });
  };

  return (
    <div>
      {msg && (
        <div role={msg.ok ? "status" : "alert"} className={clsx("mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
          {msg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4" aria-hidden />}
          <div className="flex-1"><p>{msg.text}</p>{msg.errors && msg.errors.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs">{msg.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
            {!msg.ok && msg.dealId && <Link className="mt-1 inline-block text-xs font-medium underline" href={`/deals/${msg.dealId}`}>Open the deal to complete the required fields</Link>}</div>
          <button className="text-xs underline" onClick={() => setMsg(null)}>Dismiss</button>
        </div>
      )}
      {pendingLost && (
        <form className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" onSubmit={(e) => { e.preventDefault(); const r = new FormData(e.currentTarget).get("reason") as string; move(pendingLost.id, pendingLost.stageId, r); setPendingLost(null); }}>
          <label className="flex flex-col gap-1 font-medium">Loss reason (required)
            <select name="reason" required className="rounded border border-slate-300 bg-white px-2 py-1.5 font-normal">{lossReasons.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <button className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white">Mark Closed Lost</button>
          <button type="button" className="rounded-lg px-3 py-1.5" onClick={() => setPendingLost(null)}>Cancel</button>
        </form>
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-2" aria-busy={isPending}>
        <div className="flex gap-3" style={{ minWidth: `${stages.length * 236}px` }}>
          {stages.map((s) => {
            const col = items.filter((c) => c.stageId === s.id);
            const total = col.reduce((a, c) => a + (c.amount ?? 0), 0);
            return (
              <section key={s.id} aria-label={s.name}
                onDragOver={(e) => { e.preventDefault(); }} onDrop={() => { if (drag) move(drag, s.id); setDrag(null); }}
                className={clsx("flex w-56 shrink-0 flex-col rounded-xl border bg-slate-100/80", s.isWon ? "border-emerald-200" : s.isLost ? "border-slate-200" : "border-slate-200")}>
                <header className="border-b border-slate-200 px-3 py-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{s.name}</h3>
                  <p className="text-xs text-slate-500">{col.length} · {money(total, "NGN")} · {s.probability}%</p>
                </header>
                <ul className="flex min-h-24 flex-col gap-2 p-2">
                  {col.map((c) => (
                    <li key={c.id} draggable onDragStart={() => setDrag(c.id)} className="cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm active:cursor-grabbing">
                      <Link href={`/deals/${c.id}`} className="block text-sm font-medium leading-snug text-slate-900 hover:underline">{c.name}</Link>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{c.companyName}</p>
                      <div className="mt-1.5 flex items-center justify-between text-xs"><span className="font-semibold tabular-nums">{money(c.amount, c.currency)}</span><span className="text-slate-500">{c.ownerName.split(" ")[0]}</span></div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                        <span className="inline-flex items-center gap-0.5 text-slate-500"><Clock className="h-3 w-3" aria-hidden />{c.daysInStage}d in stage</span>
                        {c.stale && <span className="rounded bg-amber-100 px-1 text-amber-900">Stale</span>}
                        {c.nextStepOverdue && <span className="rounded bg-red-100 px-1 text-red-800">Next step overdue</span>}
                        {c.discountPending && <span className="rounded bg-violet-100 px-1 text-violet-800">Discount pending</span>}
                      </div>
                      {!s.isWon && (
                        <label className="mt-2 block text-[11px] text-slate-500">
                          <span className="sr-only">Move {c.name} to</span>
                          <select value="" onChange={(e) => e.target.value && move(c.id, e.target.value)} className="w-full rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[11px]">
                            <option value="">Move to…</option>
                            {stages.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
