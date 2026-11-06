import { appUrl } from "@/lib/app-url";
import Link from "next/link";
import { ExternalLink, FileText, Paperclip } from "lucide-react";
import { ctx, load } from "@/server/page";
import { DOC_TYPES, docStatus, getDocument, PAYMENT_METHODS, type DocType } from "@/server/services/documents";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { Badge, Card, KV, Notice, PageHeader } from "@/components/ui";
import { ActionForm, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { DocumentEditor, DuplicateButton, SendPanel } from "@/components/documents/editor";
import { attachSignedAction, recordPaymentAction, voidDocumentAction } from "@/app/actions/documents";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db } = await ctx();
  try { const d = await getDocument(db, actor, id); return { title: `${d.d.number} · ${d.company.name}` }; } catch { return { title: "Document" }; }
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const x = await load(() => getDocument(db, actor, id));
  const { d } = x;
  const st = docStatus(d, x.today);
  const type = DOC_TYPES[d.type as DocType];
  const shareUrl = `${appUrl()}/d/${d.shareToken}`;
  const balance = Math.round((d.total - d.amountPaid) * 100) / 100;
  const editable = x.canManage && ["draft", "sent", "viewed"].includes(d.status);
  return (
    <>
      <PageHeader title={<>{d.number} · {d.title}</>} crumbs={[{ href: "/billing", label: "Billing & agreements" }, { href: `/billing?tab=${d.type}`, label: type.plural }]}
        subtitle={<><Link href={`/companies/${x.company.id}`} className="hover:underline">{x.company.name}</Link>{x.deal && <> · deal <Link href={`/deals/${x.deal.id}`} className="hover:underline">{x.deal.name}</Link></>} · created by {x.createdByName ?? "—"}</>}
        actions={<><Badge tone={st.tone === "violet" ? "violet" : st.tone}>{st.label}</Badge><Link href={`/print/documents/${d.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"><FileText className="h-4 w-4" />Preview / download PDF</Link></>} />
      {d.status === "declined" && <div className="mb-4"><Notice tone="red" title="Declined by the client">{d.declineReason}</Notice></div>}
      {d.status === "accepted" && <div className="mb-4"><Notice tone="green" title={d.type === "sla" ? "Signed" : "Accepted"}>{d.signedByName}{d.signedByTitle ? `, ${d.signedByTitle}` : ""} · {fmtDateTime(d.decidedAt, tz)} · {d.signatureMethod === "online" ? "signed online" : "signed copy uploaded"}{x.signedFile && <> · <a href={`/api/files/file/${x.signedFile.id}`} className="font-medium underline">{x.signedFile.filename}</a></>}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DocumentEditor doc={{ id: d.id, type: d.type as "sla" | "quote" | "invoice", title: d.title, contactId: d.contactId, currency: d.currency, lines: d.lines, taxRate: d.taxRate, issueDate: d.issueDate, dueDate: d.dueDate, termMonths: d.termMonths, sections: d.sections, notes: d.notes, version: d.updatedAt.toISOString(), editable }}
            contacts={x.contactsAtCompany.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email }))} products={x.products} />
        </div>
        <div className="space-y-4">
          {d.status !== "void" && <SendPanel id={d.id} number={d.number} type={d.type} status={d.status} shareUrl={shareUrl} recipient={x.contact ? { name: `${x.contact.firstName} ${x.contact.lastName}`, email: x.contact.email } : null} companyName={x.company.name} canManage={x.canManage} />}
          <Card title="Summary">
            <KV items={[
              ["Total", d.type === "sla" ? "—" : fmtMoney(d.total, d.currency)],
              ...(d.type === "invoice" ? [["Paid", fmtMoney(d.amountPaid, d.currency)], ["Balance", fmtMoney(Math.max(0, balance), d.currency)]] as [string, string][] : []),
              ["Issued", fmtDate(d.issueDate, tz)], [d.type === "quote" ? "Valid until" : d.type === "invoice" ? "Due" : "Effective", fmtDate(d.dueDate, tz)],
              ["Sent", d.sentAt ? fmtDateTime(d.sentAt, tz) : "Not yet"], ["Opened by client", d.viewedAt ? fmtDateTime(d.viewedAt, tz) : "Not yet"],
            ]} />
          </Card>
          {d.type !== "invoice" && x.canManage && !["accepted", "void", "declined"].includes(d.status) && (
            <Card title="Signed copy returned?">
              <p className="mb-2 text-sm text-slate-600">If the client signed on paper or by PDF, upload it here. It&apos;s attached to {x.company.name}&apos;s record and this {type.noun} is marked {d.type === "sla" ? "signed" : "accepted"}.</p>
              <ActionForm action={attachSignedAction.bind(null, d.id)} className="space-y-2">
                <Input name="signedByName" label="Signed by" required defaultValue={x.contact ? `${x.contact.firstName} ${x.contact.lastName}` : ""} />
                <Input name="signedByTitle" label="Their title" defaultValue={x.contact?.jobTitle ?? ""} />
                <Input name="file" label="Signed document (PDF or image, max 10 MB)" type="file" accept=".pdf,.png,.jpg,.jpeg" required />
                <Submit size="sm">Attach signed copy</Submit>
              </ActionForm>
            </Card>
          )}
          {d.type === "invoice" && x.canPay && !["draft", "void", "paid"].includes(d.status) && (
            <Card title="Record a payment">
              <ActionForm action={recordPaymentAction.bind(null, d.id)} resetOnSuccess className="space-y-2">
                <Grid><Input name="amount" label="Amount received" inputMode="decimal" required defaultValue={String(Math.max(0, balance))} /><Input name="paidOn" label="Date received" type="date" required defaultValue={x.today} /></Grid>
                <Select name="method" label="Method" required defaultValue="bank_transfer" options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))} />
                <Input name="reference" label="Bank / transaction reference" />
                <Textarea name="notes" label="Notes" rows={2} />
                <Submit size="sm">Record payment</Submit>
              </ActionForm>
            </Card>
          )}
          {x.payments.length > 0 && <Card title={`Payments (${x.payments.length})`}><ul className="space-y-1 text-sm">{x.payments.map((p) => <li key={p.id} className="flex justify-between gap-2"><span>{fmtDate(p.paidOn, tz)} · {PAYMENT_METHODS[p.method]}{p.reference ? ` · ${p.reference}` : ""}</span><span className="font-medium tabular-nums">{fmtMoney(p.amount, d.currency)}</span></li>)}</ul></Card>}
          <Card title="Linked records">
            <ul className="space-y-1 text-sm">
              <li><Link href={`/companies/${x.company.id}`} className="font-medium text-brand-700 hover:underline">{x.company.name}</Link> <span className="text-xs text-slate-500">company</span></li>
              {x.contact && <li><Link href={`/contacts/${x.contact.id}`} className="font-medium text-brand-700 hover:underline">{x.contact.firstName} {x.contact.lastName}</Link> <span className="text-xs text-slate-500">recipient</span></li>}
              {x.deal && <li><Link href={`/deals/${x.deal.id}`} className="font-medium text-brand-700 hover:underline">{x.deal.name}</Link> <span className="text-xs text-slate-500">deal</span></li>}
              {x.source && <li><Link href={`/documents/${x.source.id}`} className="font-medium text-brand-700 hover:underline">{x.source.number}</Link> <span className="text-xs text-slate-500">created from</span></li>}
              {x.derived.map((r) => <li key={r.id}><Link href={`/documents/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.number}</Link> <span className="text-xs text-slate-500">{r.type}, {r.status}</span></li>)}
              {x.signedFile && <li><Paperclip className="mr-1 inline h-3.5 w-3.5" /><a href={`/api/files/file/${x.signedFile.id}`} className="font-medium text-brand-700 hover:underline">{x.signedFile.filename}</a></li>}
              <li><a href={shareUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:underline">Client view<ExternalLink className="h-3 w-3" /></a></li>
            </ul>
          </Card>
          {x.canManage && (
            <Card title="More actions">
              <div className="flex flex-wrap gap-2">
                {d.type === "quote" && d.status === "accepted" && x.canPay && !x.derived.some((r) => r.type === "invoice" && r.status !== "void") && <DuplicateButton id={d.id} asType="invoice" label="Create invoice from quote" />}
                <DuplicateButton id={d.id} asType={null} label="Duplicate as new draft" />
              </div>
              {d.status !== "void" && d.amountPaid === 0 && <div className="mt-3"><Disclosure label="Void" variant="ghost"><ActionForm action={voidDocumentAction.bind(null, d.id)} className="mt-2 space-y-2"><Input name="reason" label="Why void it?" required /><Submit size="sm" variant="danger">Void {type.noun}</Submit></ActionForm></Disclosure></div>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
