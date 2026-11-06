import Link from "next/link";
import { eq } from "drizzle-orm";
import { ctx, load } from "@/server/page";
import { getSettings } from "@/server/settings";
import { productDetail } from "@/server/services/products";
import { users } from "@/db/schema";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge, Card, EmptyState, KV, Notice, PageHeader, PriorityBadge, RiskBadge, Stat, StatusBadge, Table, Tabs, Td, VersionField } from "@/components/ui";
import { ActionForm, Disclosure, Submit, Textarea } from "@/components/forms";
import { ProductFields } from "@/components/product-form";
import { setProductActiveAction, updateProductAction } from "@/app/actions/products";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await ctx();
  try { const { getProduct } = await import("@/server/services/products"); return { title: (await getProduct(db, id)).name }; } catch { return { title: "Product" }; }
}

const TABS = ["overview", "deals", "customers", "support", "delivery"] as const;

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: t } = await searchParams;
  const tab = (TABS as readonly string[]).includes(t ?? "") ? t! : "overview";
  const { actor, db, tz } = await ctx();
  const d = await load(() => productDetail(db, actor, id));
  const { p, stats } = d;
  const settings = d.canManage ? await getSettings(db) : null;
  const us = d.canManage ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(users.name) : [];
  const href = (k: string) => `/products/${id}${k === "overview" ? "" : `?tab=${k}`}`;
  return (
    <>
      <PageHeader title={p.name} crumbs={[{ href: "/products", label: "Products" }]}
        subtitle={<span className="flex flex-wrap items-center gap-1.5"><span className="font-mono">{p.code}</span><Badge tone={p.kind === "product" ? "brand" : "violet"}>{p.kind === "product" ? "Product" : "Service"}</Badge>{p.category && <Badge>{p.category}</Badge>}{p.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Retired</Badge>}</span>} />
      {!p.active && <div className="mb-4"><Notice tone="amber" title="Retired">This product can't be added to new deals. History stays available below.</Notice></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Open deals" value={stats.openDeals} href={href("deals")} />
        <Stat label="Open pipeline" value={fmtMoney(stats.openValue, p.currency, true)} href={href("deals")} />
        <Stat label="Won revenue" value={fmtMoney(stats.wonValue, p.currency, true)} href={href("deals")} />
        <Stat label="Customers" value={stats.customers} href={href("customers")} />
        <Stat label="Open tickets" value={stats.openTickets ?? "—"} href={href("support")} tone={stats.openTickets ? "amber" : undefined} />
      </div>
      <Tabs current={tab} tabs={[
        { key: "overview", label: "Overview", href: href("overview") },
        { key: "deals", label: "Deals", href: href("deals"), count: d.deals.length },
        { key: "customers", label: "Customers", href: href("customers"), count: d.customers.length },
        { key: "support", label: "Support", href: href("support"), count: d.tickets?.length },
        { key: "delivery", label: "Onboarding & training", href: href("delivery"), count: d.projects.length + d.programs.length },
      ]} />
      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="About">{p.description ? <p className="whitespace-pre-line text-sm text-slate-700">{p.description}</p> : <EmptyState title="No description yet">{d.canManage ? "Add one below so staff know how to pitch it." : "Ask a sales manager to add one."}</EmptyState>}</Card>
            {d.canManage && settings && <Card title="Edit product"><ActionForm action={updateProductAction.bind(null, id)}><VersionField at={p.updatedAt} /><ProductFields p={p} users={us} currencies={settings.currencies} /></ActionForm></Card>}
          </div>
          <div className="space-y-4">
            <Card title="Pricing"><KV items={[["List price", p.listPrice != null ? fmtMoney(p.listPrice, p.currency) : null], ["Unit", p.unit], ["Billing", p.billingFrequency], ["Currency", p.currency]]} /></Card>
            <Card title="Ownership"><KV items={[["Product manager", d.manager?.name ?? null], ["Added", fmtDate(p.createdAt, tz)], ["Last changed", fmtDate(p.updatedAt, tz)]]} /></Card>
            {d.canManage && <Card title={p.active ? "Retire product" : "Reactivate product"}>
              {p.active ? <Disclosure label="Retire…" variant="ghost">
                <ActionForm action={setProductActiveAction.bind(null, id, false)} className="space-y-2"><Textarea name="reason" label="Reason" required rows={2} hint="Recorded in the audit log." /><Submit variant="danger" size="sm">Retire product</Submit></ActionForm>
              </Disclosure> : <ActionForm action={setProductActiveAction.bind(null, id, true)}><Submit size="sm">Reactivate</Submit></ActionForm>}
            </Card>}
          </div>
        </div>
      )}
      {tab === "deals" && <Card pad={false}><Table head={["Deal", "Company", "Stage", "Qty × price", "Line value", "Owner", "Close date"]} empty={<EmptyState title="No deals include this product yet" />}>
        {d.deals.map((x) => <tr key={x.id} className="hover:bg-slate-50">
          <Td><Link className="font-medium text-brand-700 hover:underline" href={`/deals/${x.id}`}>{x.name}</Link></Td>
          <Td><Link className="hover:underline" href={`/companies/${x.companyId}`}>{x.company}</Link></Td>
          <Td>{x.isWon ? <Badge tone="green">{x.stage}</Badge> : x.isLost ? <Badge tone="red">{x.stage}</Badge> : x.stage}</Td>
          <Td className="whitespace-nowrap">{x.quantity} × {fmtMoney(x.unitPrice, x.currency)}</Td><Td className="whitespace-nowrap">{fmtMoney(x.quantity * x.unitPrice, x.currency)}</Td>
          <Td>{x.owner}</Td><Td>{fmtDate(x.close, tz)}</Td></tr>)}
      </Table></Card>}
      {tab === "customers" && <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Customers using it" pad={false}><Table head={["Company", "Segment", "City"]} empty={<EmptyState title="No closed-won customers yet" />}>
          {d.customers.map((c) => <tr key={c.id}><Td><Link className="font-medium text-brand-700 hover:underline" href={`/companies/${c.id}`}>{c.name}</Link></Td><Td>{c.segment ?? "—"}</Td><Td>{c.city ?? "—"}</Td></tr>)}
        </Table></Card>
        <Card title="Renewals" pad={false}><Table head={["Company", "Renewal date", "Amount", "Status"]} empty={<EmptyState title="No renewals scheduled" />}>
          {d.renewals.map((r) => <tr key={r.id}><Td><Link className="hover:underline" href={`/companies/${r.companyId}`}>{r.company}</Link></Td><Td>{fmtDate(r.date, tz)}</Td><Td>{fmtMoney(r.amount, p.currency)}</Td><Td><StatusBadge status={r.status} /></Td></tr>)}
        </Table></Card>
      </div>}
      {tab === "support" && (d.tickets === null ? <Notice>You don&apos;t have access to support tickets.</Notice> :
        <Card pad={false}><Table head={["Ticket", "Subject", "Company", "Priority", "Status"]} empty={<EmptyState title="No tickets for this product" />}>
          {d.tickets.map((x) => <tr key={x.id} className="hover:bg-slate-50"><Td><Link className="font-mono text-brand-700 hover:underline" href={`/tickets/${x.id}`}>#{x.number}</Link></Td><Td>{x.subject}</Td><Td>{x.company ?? "—"}</Td><Td><PriorityBadge p={x.priority} /></Td><Td><StatusBadge status={x.status} /></Td></tr>)}
        </Table></Card>)}
      {tab === "delivery" && <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Onboarding projects">{d.projects.length ? <ul className="space-y-2">{d.projects.map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><Link className="text-sm font-medium hover:underline" href={`/onboarding/${x.id}`}>{x.name}</Link><RiskBadge level={x.riskLevel} /></li>)}</ul> : <EmptyState title="No onboarding projects" />}</Card>
        <Card title="Onboarding templates">{d.templates.length ? <ul className="space-y-1 text-sm">{d.templates.map((x) => <li key={x.id}>{x.name} <span className="text-xs text-slate-500">· {x.durationDays} days</span></li>)}</ul> : <EmptyState title="No product-specific template">The generic template is used.</EmptyState>}</Card>
        <Card title="Training programs">{d.programs.length ? <ul className="space-y-1 text-sm">{d.programs.map((x) => <li key={x.id} className="flex items-center justify-between gap-2"><Link className="hover:underline" href={`/training/programs/${x.id}`}>{x.name}</Link>{x.required && <Badge tone="amber">Go-live required</Badge>}</li>)}</ul> : <EmptyState title="No training programs" />}</Card>
      </div>}
    </>
  );
}
