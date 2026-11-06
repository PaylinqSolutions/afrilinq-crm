import type { clientDocuments, documentPayments } from "@/db/schema";
import type { BillingDetails } from "@/server/settings";
import { fmtMoney } from "@/lib/format";
import { docStatus, PAYMENT_METHODS } from "@/server/services/documents";

type Doc = typeof clientDocuments.$inferSelect;
type Pay = typeof documentPayments.$inferSelect;
const TITLES: Record<string, string> = { sla: "Service Level Agreement", quote: "Quotation", invoice: "Invoice" };
const longDate = (d: string | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) : "—");
const longDateTime = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }).format(d) : "");

/** The client-facing document, laid out as an A4 page. The same markup prints cleanly to PDF. */
export function DocumentView({ d, company, contact, payments, billing, today }: {
  d: Doc; company: { name: string; address: string | null; city: string | null; region: string | null; phone: string | null };
  contact: { firstName: string; lastName: string; email: string | null; jobTitle: string | null } | null; payments: Pay[]; billing: BillingDetails; today: string;
}) {
  const st = docStatus(d, today);
  const money = (n: number) => fmtMoney(n, d.currency);
  const stamp = d.status === "paid" ? "PAID" : d.status === "accepted" ? (d.type === "sla" ? "SIGNED" : "ACCEPTED") : d.status === "void" ? "VOID" : st.key === "overdue" ? "OVERDUE" : null;
  const balance = Math.round((d.total - d.amountPaid) * 100) / 100;
  return (
    <article className="doc-page relative mx-auto bg-white text-[13px] leading-relaxed text-slate-800 shadow-sm print:shadow-none" style={{ maxWidth: "210mm", padding: "16mm 16mm 14mm" }}>
      {stamp && <div aria-hidden className="pointer-events-none absolute right-10 top-36 rotate-[-12deg] rounded-lg border-4 px-4 py-1 text-2xl font-black tracking-widest opacity-25" style={{ borderColor: stamp === "VOID" || stamp === "OVERDUE" ? "#b91c1c" : "#008080", color: stamp === "VOID" || stamp === "OVERDUE" ? "#b91c1c" : "#008080" }}>{stamp}</div>}
      <header className="flex items-start justify-between gap-6 border-b-2 pb-4" style={{ borderColor: "#002366" }}>
        <div>
          <img src="/brand/afrilinq-logo.png" alt="Afrilinq Technologies" className="h-12 w-auto" />
          <h1 className="mt-3 text-2xl font-bold" style={{ color: "#002366" }}>{TITLES[d.type]}</h1>
          <p className="font-semibold">{d.number}</p>
        </div>
        <div className="text-right text-xs text-slate-600">
          <p className="font-semibold text-slate-800">{billing.legalName}</p>
          <p className="whitespace-pre-line">{billing.address}</p>
          <p>{billing.phone} · {billing.email}</p>
          <p>{billing.rcNumber} · TIN {billing.tin}</p>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{d.type === "invoice" ? "Bill to" : d.type === "quote" ? "Prepared for" : "Customer"}</p>
          <p className="font-semibold text-slate-900">{company.name}</p>
          {(company.address || company.city) && <p className="text-xs text-slate-600">{[company.address, company.city, company.region].filter(Boolean).join(", ")}</p>}
          {contact && <p className="mt-1 text-xs">Attn: {contact.firstName} {contact.lastName}{contact.jobTitle ? `, ${contact.jobTitle}` : ""}{contact.email ? ` · ${contact.email}` : ""}</p>}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 self-start text-xs">
          <dt className="text-slate-500">{d.type === "sla" ? "Date" : "Issue date"}</dt><dd className="font-medium">{longDate(d.issueDate)}</dd>
          {d.type === "quote" && <><dt className="text-slate-500">Valid until</dt><dd className="font-medium">{longDate(d.dueDate)}</dd></>}
          {d.type === "invoice" && <><dt className="text-slate-500">Due date</dt><dd className="font-medium">{longDate(d.dueDate)}</dd></>}
          {d.type === "sla" && <><dt className="text-slate-500">Effective from</dt><dd className="font-medium">{longDate(d.dueDate)}</dd><dt className="text-slate-500">Term</dt><dd className="font-medium">{d.termMonths} months</dd></>}
          {d.type === "invoice" && <><dt className="text-slate-500">Amount due</dt><dd className="font-bold" style={{ color: "#002366" }}>{money(Math.max(0, balance))}</dd></>}
          <dt className="text-slate-500">Status</dt><dd className="font-medium">{st.label}</dd>
        </dl>
      </section>

      {d.title && <h2 className="mt-5 text-base font-semibold text-slate-900">{d.title}</h2>}

      {d.type !== "sla" && (
        <section className="mt-3">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="text-left text-white" style={{ background: "#002366" }}><th className="px-2 py-1.5">Description</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Unit price</th><th className="px-2 py-1.5 text-right">Discount</th><th className="px-2 py-1.5 text-right">Amount</th></tr></thead>
            <tbody>
              {d.lines.map((l, i) => {
                const gross = l.quantity * l.unitPrice;
                return <tr key={i} className="border-b border-slate-200"><td className="px-2 py-1.5">{l.description}</td><td className="px-2 py-1.5 text-right tabular-nums">{l.quantity}</td><td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td><td className="px-2 py-1.5 text-right tabular-nums">{l.discountPct ? `${l.discountPct}%` : "—"}</td><td className="px-2 py-1.5 text-right tabular-nums">{money(gross - (gross * (l.discountPct || 0)) / 100)}</td></tr>;
              })}
              {!d.lines.length && <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-400">No items yet</td></tr>}
            </tbody>
          </table>
          <dl className="ml-auto mt-2 grid w-64 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
            <dt className="text-slate-500">Subtotal</dt><dd className="text-right tabular-nums">{money(d.subtotal)}</dd>
            {d.discountTotal > 0 && <><dt className="text-slate-500">Includes discounts of</dt><dd className="text-right tabular-nums">{money(d.discountTotal)}</dd></>}
            <dt className="text-slate-500">VAT ({d.taxRate}%)</dt><dd className="text-right tabular-nums">{money(d.tax)}</dd>
            <dt className="border-t border-slate-300 pt-1 font-semibold">Total</dt><dd className="border-t border-slate-300 pt-1 text-right font-semibold tabular-nums">{money(d.total)}</dd>
            {d.type === "invoice" && d.amountPaid > 0 && <><dt className="text-slate-500">Paid</dt><dd className="text-right tabular-nums">−{money(d.amountPaid)}</dd><dt className="font-semibold">Balance due</dt><dd className="text-right font-semibold tabular-nums">{money(Math.max(0, balance))}</dd></>}
          </dl>
        </section>
      )}

      {d.type === "sla" && d.sla && (
        <section className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-xs">
            <div><p className="text-slate-500">Support tier</p><p className="font-semibold">{d.sla.tier}</p></div>
            <div><p className="text-slate-500">Business hours</p><p className="font-semibold">{d.sla.hours}, {d.sla.workdays}</p></div>
            <div><p className="text-slate-500">Time zone</p><p className="font-semibold">{d.sla.timezone}</p></div>
          </div>
          <table className="w-full border-collapse text-xs">
            <caption className="mb-1 text-left text-xs font-semibold text-slate-700">Response and resolution targets</caption>
            <thead><tr className="text-left text-white" style={{ background: "#002366" }}><th className="px-2 py-1.5">Priority</th><th className="px-2 py-1.5">First response</th><th className="px-2 py-1.5">Resolution</th><th className="px-2 py-1.5">Status updates</th><th className="px-2 py-1.5">Coverage</th></tr></thead>
            <tbody>{d.sla.targets.map((t) => <tr key={t.priority} className="border-b border-slate-200"><td className="px-2 py-1.5 font-semibold">{t.priority}</td><td className="px-2 py-1.5">{t.firstResponse}</td><td className="px-2 py-1.5">{t.resolution}</td><td className="px-2 py-1.5">every {t.updates}</td><td className="px-2 py-1.5">{t.coverage}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {d.sections.length > 0 && (
        <section className="mt-5 space-y-3">
          {d.type !== "sla" && <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Terms</h3>}
          {d.sections.map((s, i) => <div key={i} className="break-inside-avoid"><h4 className="font-semibold text-slate-900">{s.heading}</h4><p className="whitespace-pre-line text-slate-700">{s.body}</p></div>)}
        </section>
      )}

      {d.notes && <section className="mt-4 rounded-lg bg-slate-50 p-3 text-xs"><p className="font-semibold">Notes</p><p className="whitespace-pre-line">{d.notes}</p></section>}

      {d.type === "invoice" && (
        <section className="mt-5 break-inside-avoid rounded-lg border-2 p-3 text-xs" style={{ borderColor: "#008080" }}>
          <p className="font-semibold" style={{ color: "#006b6b" }}>How to pay</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4">
            <dt className="text-slate-500">Bank</dt><dd className="font-medium">{billing.bankName}</dd>
            <dt className="text-slate-500">Account name</dt><dd className="font-medium">{billing.accountName}</dd>
            <dt className="text-slate-500">Account number</dt><dd className="font-medium tabular-nums">{billing.accountNumber}</dd>
            <dt className="text-slate-500">Reference</dt><dd className="font-medium">{d.number}</dd>
          </dl>
          {payments.length > 0 && <div className="mt-2 border-t border-slate-200 pt-2"><p className="font-semibold">Payments received</p>
            <ul>{payments.map((p) => <li key={p.id}>{longDate(p.paidOn)} — {money(p.amount)} by {PAYMENT_METHODS[p.method] ?? p.method}{p.reference ? ` (ref ${p.reference})` : ""}</li>)}</ul></div>}
        </section>
      )}

      {d.type !== "invoice" && (
        <section className="mt-8 grid break-inside-avoid grid-cols-2 gap-8 text-xs">
          <div>
            <p className="font-semibold">For {billing.legalName}</p>
            <div className="mt-8 border-b border-slate-400" />
            <p className="mt-1">{billing.signatoryName}</p><p className="text-slate-500">{billing.signatoryTitle}</p>
          </div>
          <div>
            <p className="font-semibold">{d.type === "quote" ? "Accepted by" : "For"} {company.name}</p>
            {d.status === "accepted" && d.signedByName ? (
              <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2">
                <p className="font-semibold text-emerald-900">{d.signatureMethod === "online" ? "Signed electronically" : "Signed copy on file"}</p>
                <p>{d.signedByName}{d.signedByTitle ? `, ${d.signedByTitle}` : ""}</p>
                <p className="text-slate-600">{longDateTime(d.decidedAt)}{d.signatureMethod === "online" && d.signatureIp ? ` · IP ${d.signatureIp}` : ""}</p>
              </div>
            ) : (
              <>
                <div className="mt-8 border-b border-slate-400" />
                <div className="mt-1 grid grid-cols-2 gap-2 text-slate-500"><span>Name</span><span>Title</span></div>
                <div className="mt-6 grid grid-cols-2 gap-2"><div className="border-b border-slate-400" /><div className="border-b border-slate-400" /></div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-slate-500"><span>Signature</span><span>Date</span></div>
              </>
            )}
          </div>
        </section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-2 text-center text-[10px] text-slate-500">
        {billing.footer} · {billing.legalName} · {billing.website}
      </footer>
    </article>
  );
}
