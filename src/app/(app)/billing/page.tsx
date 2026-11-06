import Link from "next/link";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { canManageType, DOC_TYPES, listDocuments, listPayments, PAYMENT_METHODS, type DocType } from "@/server/services/documents";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge, Card, EmptyState, FilterBar, FInput, FSelect, LinkButton, PageHeader, Stat, Table, Tabs, Td } from "@/components/ui";

export const metadata = { title: "Billing & agreements" };
type Tab = DocType | "payments";

const STATUS_OPTIONS: Record<DocType, { value: string; label: string }[]> = {
  sla: [{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "viewed", label: "Viewed" }, { value: "accepted", label: "Signed" }, { value: "declined", label: "Declined" }, { value: "void", label: "Void" }],
  quote: [{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "viewed", label: "Viewed" }, { value: "accepted", label: "Accepted" }, { value: "declined", label: "Declined" }, { value: "expired", label: "Expired" }, { value: "void", label: "Void" }],
  invoice: [{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "viewed", label: "Viewed" }, { value: "overdue", label: "Overdue" }, { value: "part_paid", label: "Part paid" }, { value: "paid", label: "Paid" }, { value: "void", label: "Void" }],
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; status?: string }> }) {
  const { actor, db, tz, settings } = await ctx();
  requirePerm(actor, "accounts.view_all", "accounts.view_own", "billing.manage", "finance.view");
  const f = await searchParams;
  const tab = (["sla", "quote", "invoice", "payments"].includes(f.tab ?? "") ? f.tab : "invoice") as Tab;
  const all = await listDocuments(db, actor, {});
  const invoices = all.filter((d) => d.type === "invoice" && d.status !== "void");
  const outstanding = invoices.filter((d) => !["draft", "paid"].includes(d.status)).reduce((a, d) => a + d.total - d.amountPaid, 0);
  const overdue = invoices.filter((d) => d.view.key === "overdue");
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const payments = await listPayments(db, actor);
  const paidThisMonth = payments.filter((p) => p.paidOn >= monthStart).reduce((a, p) => a + p.amount, 0);
  const awaitingQuotes = all.filter((d) => d.type === "quote" && ["sent", "viewed"].includes(d.view.key));
  const awaitingSla = all.filter((d) => d.type === "sla" && ["sent", "viewed"].includes(d.view.key));
  const rows = tab === "payments" ? [] : await listDocuments(db, actor, { type: tab, status: f.status, q: f.q });
  const counts = (t: DocType) => all.filter((d) => d.type === t).length;
  const cur = settings.currency;
  return (
    <>
      <PageHeader title="Billing & agreements" subtitle="Quotes, invoices, payments and SLA agreements sent to customers. Each one gets a private client link to view, download as PDF, and accept or sign. Signed copies are attached to the customer's record."
        actions={<>{(["sla", "quote", "invoice"] as DocType[]).filter((t) => canManageType(actor, t)).map((t) => <LinkButton key={t} href={`/documents/new?type=${t}`} variant={t === tab ? "primary" : "secondary"}>New {DOC_TYPES[t].noun}</LinkButton>)}</>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Outstanding" value={fmtMoney(outstanding, cur, true)} sub={`${invoices.filter((d) => !["draft", "paid"].includes(d.status)).length} unpaid invoices`} href="/billing?tab=invoice" />
        <Stat label="Overdue" value={fmtMoney(overdue.reduce((a, d) => a + d.total - d.amountPaid, 0), cur, true)} sub={`${overdue.length} invoice(s)`} tone={overdue.length ? "red" : undefined} href="/billing?tab=invoice&status=overdue" />
        <Stat label="Received this month" value={fmtMoney(paidThisMonth, cur, true)} href="/billing?tab=payments" />
        <Stat label="Quotes awaiting reply" value={awaitingQuotes.length} sub={fmtMoney(awaitingQuotes.reduce((a, d) => a + d.total, 0), cur, true)} href="/billing?tab=quote&status=sent" />
        <Stat label="SLAs awaiting signature" value={awaitingSla.length} href="/billing?tab=sla&status=sent" tone={awaitingSla.length ? "amber" : undefined} />
      </div>
      <Tabs current={tab} tabs={[
        { key: "invoice", label: "Invoices", href: "/billing?tab=invoice", count: counts("invoice") },
        { key: "quote", label: "Quotes", href: "/billing?tab=quote", count: counts("quote") },
        { key: "payments", label: "Payments", href: "/billing?tab=payments", count: payments.length },
        { key: "sla", label: "SLA agreements", href: "/billing?tab=sla", count: counts("sla") },
      ]} />
      {tab === "payments" ? (
        <Card pad={false}>
          <Table head={["Date", "Customer", "Invoice", "Method", "Reference", "Amount", "Recorded by"]} empty={<EmptyState title="No payments recorded yet">Open an invoice and use “Record a payment” when money arrives.</EmptyState>}>
            {payments.map((p) => <tr key={p.id} className="hover:bg-slate-50"><Td>{fmtDate(p.paidOn, tz)}</Td><Td><Link href={`/companies/${p.companyId}`} className="hover:underline">{p.companyName}</Link></Td>
              <Td><Link href={`/documents/${p.documentId}`} className="font-medium text-brand-700 hover:underline">{p.number}</Link></Td><Td>{PAYMENT_METHODS[p.method]}</Td><Td className="text-xs">{p.reference ?? "—"}</Td>
              <Td className="font-medium tabular-nums">{fmtMoney(p.amount, p.currency)}</Td><Td className="text-xs">{p.recordedBy ?? "—"}</Td></tr>)}
          </Table>
        </Card>
      ) : (
        <>
          <FilterBar action="/billing">
            <input type="hidden" name="tab" value={tab} />
            <FInput name="q" label="Search" value={f.q} placeholder="Number, title or customer" />
            <FSelect name="status" label="Status" value={f.status} options={STATUS_OPTIONS[tab]} />
          </FilterBar>
          <Card pad={false}>
            <Table head={["Number", "Customer", "Title", tab === "sla" ? "Effective" : tab === "quote" ? "Valid until" : "Due", tab === "sla" ? "Signed by" : "Total", tab === "invoice" ? "Balance" : "Sent", "Status"]}
              empty={<EmptyState title={`No ${DOC_TYPES[tab].nouns} yet`} action={canManageType(actor, tab) ? <LinkButton href={`/documents/new?type=${tab}`}>New {DOC_TYPES[tab].noun}</LinkButton> : undefined} />}>
              {rows.map((d) => (
                <tr key={d.id} className={d.view.key === "overdue" ? "bg-red-50/40" : "hover:bg-slate-50"}>
                  <Td><Link href={`/documents/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.number}</Link></Td>
                  <Td><Link href={`/companies/${d.companyId}`} className="hover:underline">{d.companyName}</Link></Td>
                  <Td className="max-w-xs truncate">{d.title}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(d.dueDate, tz)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{tab === "sla" ? d.signedByName ?? "—" : fmtMoney(d.total, d.currency)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{tab === "invoice" ? fmtMoney(Math.max(0, d.total - d.amountPaid), d.currency) : d.sentAt ? fmtDate(d.sentAt, tz) : "—"}</Td>
                  <Td><Badge tone={d.view.tone === "violet" ? "violet" : d.view.tone}>{d.view.label}</Badge></Td>
                </tr>
              ))}
            </Table>
          </Card>
          {!can(actor, "billing.manage") && tab === "invoice" && <p className="mt-2 text-xs text-slate-500">Creating invoices and recording payments needs the billing permission (Finance, Sales Manager).</p>}
        </>
      )}
    </>
  );
}
