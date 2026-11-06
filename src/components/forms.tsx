"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import clsx from "clsx";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; at?: number; data?: Record<string, unknown> };
type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

const ErrCtx = createContext<Record<string, string>>({});
/** The server's validation message for a field, for custom inputs inside an ActionForm. */
export const useFieldError = (name: string): string | undefined => useContext(ErrCtx)[name];
const PendingCtx = createContext(false);

export function ActionForm({
  action, children, className, resetOnSuccess = false, successRedirect, successPath, onSuccessRefresh = true, id,
}: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; successRedirect?: (r: ActionResult) => string | undefined; successPath?: string; onSuccessRefresh?: boolean; id?: string }) {
  const [state, formAction, isPending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    const to = successRedirect?.(state) ?? (successPath ? successPath.replace(/\{(\w+)\}/g, (_, k) => String(state.data?.[k] ?? "")) : undefined);
    if (to) router.push(to);
    else if (onSuccessRefresh) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <PendingCtx.Provider value={isPending}><ErrCtx.Provider value={state && !state.ok ? state.fieldErrors ?? {} : {}}>
      <form ref={ref} action={formAction} className={className} id={id} noValidate
        onSubmit={(e) => {
          // Submit via a transition so React does not auto-reset fields; inputs survive validation errors.
          e.preventDefault();
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null);
          startTransition(() => formAction(fd));
        }}>
        {state?.message && (
          <div role={state.ok ? "status" : "alert"} className={clsx("mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
            {state.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <div>
              <p>{state.message}</p>
              {!state.ok && state.data?.stale === true && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-800">Reload latest (discard my edits)</button>
                  <button type="button" onClick={() => window.open(window.location.href, "_blank", "noopener")} className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50">Open latest in a new tab to compare</button>
                </div>
              )}
              {!state.ok && state.fieldErrors && Object.keys(state.fieldErrors).length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs">{Object.entries(state.fieldErrors).filter(([, v]) => v).map(([k, v]) => <li key={k}>{v}</li>)}</ul>
              )}
            </div>
          </div>
        )}
        {children}
      </form>
    </ErrCtx.Provider></PendingCtx.Provider>
  );
}

const inputCls = (err?: string) => clsx("w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50", err ? "border-red-400" : "border-slate-300");

type FieldProps = { name: string; label: ReactNode; hint?: ReactNode; required?: boolean; className?: string };
function Wrap({ name, label, hint, required, className, children }: FieldProps & { children: ReactNode }) {
  const err = useContext(ErrCtx)[name];
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <label htmlFor={`f-${name}`} className="text-sm font-medium text-slate-700">{label}{required && <span className="text-red-600" aria-hidden> *</span>}</label>
      {children}
      {err ? <p id={`e-${name}`} className="text-xs text-red-700">{err}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Input({ name, label, hint, required, className, ...rest }: FieldProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const err = useContext(ErrCtx)[name];
  return <Wrap {...{ name, label, hint, required, className }}><input id={`f-${name}`} name={name} aria-invalid={!!err} aria-describedby={err ? `e-${name}` : undefined} aria-required={required} className={inputCls(err)} {...rest} /></Wrap>;
}

export function Textarea({ name, label, hint, required, className, rows = 3, ...rest }: FieldProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  const err = useContext(ErrCtx)[name];
  return <Wrap {...{ name, label, hint, required, className }}><textarea id={`f-${name}`} name={name} rows={rows} aria-invalid={!!err} aria-required={required} className={inputCls(err)} {...rest} /></Wrap>;
}

export function Select({ name, label, hint, required, className, options, placeholder, ...rest }: FieldProps & { options: { value: string; label: string }[]; placeholder?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name">) {
  const err = useContext(ErrCtx)[name];
  return (
    <Wrap {...{ name, label, hint, required, className }}>
      <select id={`f-${name}`} name={name} aria-invalid={!!err} aria-required={required} className={inputCls(err)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Wrap>
  );
}

export function Checkbox({ name, label, hint, defaultChecked, value }: { name: string; label: ReactNode; hint?: ReactNode; defaultChecked?: boolean; value?: string }) {
  const err = useContext(ErrCtx)[name];
  return (
    <div>
      <label className="inline-flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" name={name} value={value ?? "on"} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" />
        <span>{label}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
      </label>
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}

export function Submit({ children, variant = "primary", size = "md", name, value, className }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; name?: string; value?: string; className?: string }) {
  const fs = useFormStatus();
  const pending = useContext(PendingCtx) || fs.pending;
  const v = { primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm", secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50", danger: "bg-red-600 text-white hover:bg-red-700", ghost: "text-slate-700 hover:bg-slate-100" }[variant];
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending}
      className={clsx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-wait disabled:opacity-70", v, size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm", className)}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}

/** Collapsible inline panel used for secondary forms (log activity, escalate, etc.). */
export function Disclosure({ label, children, defaultOpen = false, variant = "secondary" }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean; variant?: "primary" | "secondary" | "ghost" }) {
  const [open, setOpen] = useState(defaultOpen);
  const v = { primary: "bg-brand-600 text-white hover:bg-brand-700", secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50", ghost: "text-slate-700 hover:bg-slate-100" }[variant];
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={clsx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", v)}>{label}</button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={clsx("grid grid-cols-1 gap-3", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3")}>{children}</div>;
}

/** A select that also updates a URL search param (e.g. to load dependent options server-side). */
export function NavSelect({ param, ...props }: { param: string } & React.ComponentProps<typeof Select>) {
  const router = useRouter();
  return <Select {...props} onChange={(e) => { const u = new URL(window.location.href); if (e.target.value) u.searchParams.set(param, e.target.value); else u.searchParams.delete(param); router.replace(u.pathname + u.search, { scroll: false }); }} />;
}
