import Link from "next/link";
import { ctx } from "@/server/page";
import { can } from "@/server/actor";
import { listArticles, KB_CATEGORIES } from "@/server/services/kb";
import { fmtDate } from "@/lib/format";
import { Badge, Card, EmptyState, FilterBar, FInput, FSelect, LinkButton, PageHeader, StatusBadge } from "@/components/ui";

export const metadata = { title: "Knowledge base" };

export default async function KbPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; status?: string; audience?: string; sop?: string }> }) {
  const { actor, db, tz } = await ctx();
  const f = await searchParams;
  const rows = await listArticles(db, actor, f);
  return (
    <>
      <PageHeader title={f.sop ? "Playbooks & SOPs" : "Knowledge base"} subtitle="Internal runbooks are never shown on the customer help centre. Customer-visible articles are published at /portal/help."
        actions={<><LinkButton variant="secondary" href="/portal/help">Customer help centre</LinkButton>{can(actor, "kb.edit") && <LinkButton href="/kb/new">New article</LinkButton>}</>} />
      <FilterBar action="/kb">
        <FInput name="q" label="Search" value={f.q} placeholder="Title, body or tag" />
        <FSelect name="category" label="Category" value={f.category} options={KB_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <FSelect name="audience" label="Audience" value={f.audience} options={[{ value: "internal", label: "Internal" }, { value: "customer", label: "Customer" }]} />
        {can(actor, "kb.edit") && <FSelect name="status" label="Status" value={f.status} all="Not archived" options={["draft", "in_review", "published", "archived"].map((s) => ({ value: s, label: s.replace("_", " ") }))} />}
        <FSelect name="sop" label="Type" value={f.sop} all="All" options={[{ value: "1", label: "SOPs / playbooks" }]} />
      </FilterBar>
      {rows.length === 0 ? <EmptyState title="No articles match" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center gap-1.5">{a.isSop && <Badge tone="violet">SOP</Badge>}{a.audience === "internal" ? <Badge tone="amber">Internal</Badge> : <Badge tone="green">Customer</Badge>}<StatusBadge status={a.status} /><Badge>{a.category}</Badge></div>
              <Link href={`/kb/${a.id}`} className="mt-2 block font-medium text-ink-950 hover:underline">{a.title}</Link>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{a.summary}</p>
              <p className="mt-2 text-xs text-slate-500">v{a.version} · updated {fmtDate(a.updatedAt, tz)} · owner {a.owner ?? "—"} · 👍 {a.helpful} 👎 {a.notHelpful}</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
