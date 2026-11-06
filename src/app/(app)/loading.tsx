export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded bg-slate-200" />
      <div className="grid gap-3 sm:grid-cols-3"><div className="h-24 rounded-xl bg-slate-200" /><div className="h-24 rounded-xl bg-slate-200" /><div className="h-24 rounded-xl bg-slate-200" /></div>
      <div className="h-64 rounded-xl bg-slate-200" />
    </div>
  );
}
