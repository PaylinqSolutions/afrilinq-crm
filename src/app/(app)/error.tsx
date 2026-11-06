"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-ink-950">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-600">The error was logged. Try again, and contact an administrator if it keeps happening.</p>
      <button onClick={reset} className="mt-4 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white">Try again</button>
    </div>
  );
}
