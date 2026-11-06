"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import clsx from "clsx";

type Toast = { id: number; tone: "success" | "error" | "info"; text: string; detail?: string[]; action?: { label: string; run: () => void } };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

/** App-wide toasts so every action gives visible feedback (aria-live for screen readers). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 9000 : 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={clsx("pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-lg",
            t.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : t.tone === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-brand-200 bg-white text-slate-800")}>
            {t.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : t.tone === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p>{t.text}</p>
              {t.detail && t.detail.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs">{t.detail.slice(0, 6).map((d) => <li key={d}>{d}</li>)}</ul>}
            </div>
            {t.action && <button className="shrink-0 rounded-md border border-current px-2 py-0.5 text-xs font-semibold" onClick={() => { t.action!.run(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
            <button aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
