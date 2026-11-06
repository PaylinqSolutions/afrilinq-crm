import Link from "next/link";
import { ctx } from "@/server/page";
import { can } from "@/server/actor";
import { listProducts, PRODUCT_CATEGORIES } from "@/server/services/products";
import { fmtMoney } from "@/lib/format";
import { Badge, Card, EmptyState, FilterBar, FInput, FSelect, LinkButton, PageHeader, Stat, Table, Td } from "@/components/ui";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; status?: string; category?: string }> }) {
  const { actor, db } = await ctx();
  const f = await searchParams;
  const rows = await listProducts(db, actor, f);
  const all = f.q || f.kind || f.category || f.status ? await listProducts(db, actor, { status: "all" }) : rows;
  const live = all.filter((p) => p.active);
  return (
    <>
      <PageHeader title="Products & services" subtitle="Everything Afrilinq sells. Pick these on deals, tickets, onboarding and training."
        actions={can(actor, "products.manage") ? <LinkButton href="/products/new">Add product</LinkButton> : <span className="text-xs text-slate-500">Ask a sales manager to add or change products.</span>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active products" value={live.filter((p) => p.kind === "product").length} href="/products?kind=product" />
        <Stat label="Active services" value={live.filter((p) => p.kind === "service").length} href="/products?kind=service" />
        <Stat label="Open pipeline" value={fmtMoney(live.reduce((a, p) => a + p.openValue, 0), "NGN", true)} sub={`${live.reduce((a, p) => a + p.openDeals, 0)} open deal lines`} href="/deals" />
        <Stat label="Won revenue" value={fmtMoney(live.reduce((a, p) => a + p.wonValue, 0), "NGN", true)} sub="Across all closed-won deals" />
      </div>
      <FilterBar action="/products">
        <FInput name="q" label="Search" value={f.q} placeholder="Name, code or description" />
        <FSelect name="kind" label="Type" value={f.kind} options={[{ value: "product", label: "Products" }, { value: "service", label: "Services" }]} />
        <FSelect name="category" label="Category" value={f.category} options={PRODUCT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <FSelect name="status" label="Status" value={f.status} all="Active" options={[{ value: "retired", label: "Retired" }, { value: "all", label: "All" }]} />
      </FilterBar>
      <Card pad={false}>
        <Table head={["Product", "Category", "List price", "Open pipeline", "Won", "Customers", "Open tickets", "Manager"]}
          empty={<EmptyState title="No products match" action={can(actor, "products.manage") ? <LinkButton href="/products/new">Add product</LinkButton> : undefined}>Try clearing the filters.</EmptyState>}>
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <Td><Link href={`/products/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500"><span className="font-mono">{p.code}</span><Badge tone={p.kind === "product" ? "brand" : "violet"}>{p.kind === "product" ? "Product" : "Service"}</Badge>{!p.active && <Badge tone="red">Retired</Badge>}</div></Td>
              <Td>{p.category ?? "—"}</Td>
              <Td className="whitespace-nowrap">{p.listPrice != null ? fmtMoney(p.listPrice, p.currency) : "—"}<div className="text-xs text-slate-500">{[p.unit, p.billingFrequency].filter(Boolean).join(" · ")}</div></Td>
              <Td className="whitespace-nowrap">{fmtMoney(p.openValue, p.currency, true)}<div className="text-xs text-slate-500">{p.openDeals} deal{p.openDeals === 1 ? "" : "s"}</div></Td>
              <Td className="whitespace-nowrap">{fmtMoney(p.wonValue, p.currency, true)}</Td>
              <Td>{p.customers}</Td>
              <Td>{p.openTickets ?? "—"}</Td>
              <Td>{p.manager ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
