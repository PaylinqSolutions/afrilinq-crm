import Link from "next/link";
import { ctx } from "@/server/page";
import { globalSearch } from "@/server/services/reports";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor, db } = await ctx();
  const { q = "" } = await searchParams;
  const results = await globalSearch(db, actor, q);
  return (
    <>
      <PageHeader title="Search" subtitle={q ? `Results for “${q}” — only records you have access to are shown.` : "Type at least 2 characters in the search bar."} />
      <Card pad={false}>
        {results.length === 0 ? <div className="p-4"><EmptyState title={q ? "No matching records" : "Start typing to search"} /></div> : (
          <ul className="divide-y divide-slate-100">
            {results.map((r) => <li key={`${r.type}-${r.id}`} className="flex items-center gap-3 px-4 py-2.5"><Badge tone="brand">{r.type}</Badge><Link href={r.href} className="text-sm font-medium hover:underline">{r.title}</Link><span className="truncate text-xs text-slate-500">{r.sub}</span></li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
