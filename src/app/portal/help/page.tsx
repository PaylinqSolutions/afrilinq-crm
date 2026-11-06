import { getDb } from "@/db";
import { publicArticles } from "@/server/services/kb";
import { Markdown } from "@/components/ui";

export const metadata = { title: "Help centre" };

export default async function HelpCentre({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const rows = await publicArticles(await getDb(), q);
  const cats = [...new Set(rows.map((r) => r.category))];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-950">Help centre</h1>
      <form method="get" role="search"><label htmlFor="hq" className="sr-only">Search help</label><input id="hq" name="q" defaultValue={q} placeholder="Search articles…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></form>
      {rows.length === 0 && <p className="text-sm text-slate-600">No published articles match.</p>}
      {cats.map((c) => (
        <section key={c}><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-brand-700">{c}</h2>
          <div className="space-y-2">{rows.filter((r) => r.category === c).map((r) => (
            <details key={r.id} className="rounded-xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer font-medium">{r.title}</summary><div className="mt-2"><Markdown text={r.body} /></div></details>
          ))}</div>
        </section>
      ))}
    </div>
  );
}
