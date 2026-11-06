"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Copy, Loader2, Mail, Plus, Send, Trash2 } from "lucide-react";
import { useToast } from "../toast";
import { duplicateDocumentAction, saveDocumentAction, sendDocumentAction } from "@/app/actions/documents";
import type { DocLine, DocSection } from "@/db/schema";

const field = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm";
const btn = (v: "primary" | "outline" | "ghost" = "outline") => `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${v === "primary" ? "bg-brand-600 text-white hover:bg-brand-700" : v === "outline" ? "border border-slate-300 bg-white hover:bg-slate-50" : "hover:bg-slate-100"}`;
const fmt = (n: number, c: string) => `${c === "NGN" ? "₦" : `${c} `}${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function totals(lines: DocLine[], taxRate: number) {
  const gross = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const disc = lines.reduce((a, l) => a + (l.quantity * l.unitPrice * (l.discountPct || 0)) / 100, 0);
  const sub = gross - disc;
  const tax = Math.round(sub * taxRate) / 100;
  return { sub, disc, tax, total: sub + tax };
}

export type EditorDoc = {
  id: string; type: "sla" | "quote" | "invoice"; title: string; contactId: string | null; currency: string; lines: DocLine[]; taxRate: number; issueDate: string; dueDate: string | null;
  termMonths: number | null; sections: DocSection[]; notes: string | null; version: string; editable: boolean;
};

/** Edit a draft (or sent) document. Totals update as you type; Save stores it with conflict detection. */
export function DocumentEditor({ doc, contacts, products }: { doc: EditorDoc; contacts: { id: string; name: string; email: string | null }[]; products: { id: string; name: string; listPrice: number | null }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [d, setD] = useState(doc);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof EditorDoc>(k: K, v: EditorDoc[K]) => { setD((x) => ({ ...x, [k]: v })); setDirty(true); };
  const t = useMemo(() => totals(d.lines, d.taxRate), [d.lines, d.taxRate]);
  const ro = !d.editable;
  const setLine = (i: number, patch: Partial<DocLine>) => set("lines", d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setSection = (i: number, patch: Partial<DocSection>) => set("sections", d.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) => { const s = [...d.sections]; const j = i + by; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; set("sections", s); };
  const save = () => start(async () => {
    const r = await saveDocumentAction(d.id, { title: d.title, contactId: d.contactId, lines: d.lines, taxRate: d.taxRate, issueDate: d.issueDate, dueDate: d.dueDate, termMonths: d.termMonths, sections: d.sections, notes: d.notes }, d.version);
    if (r.ok) { setD((x) => ({ ...x, version: String(r.data?.version) })); setDirty(false); toast({ tone: "success", text: "Saved." }); router.refresh(); }
    else toast({ tone: "error", text: r.message ?? "Couldn't save.", detail: Object.values(r.fieldErrors ?? {}), action: r.data?.stale ? { label: "Reload", run: () => router.refresh() } : undefined });
  });
  const dateLabel = d.type === "quote" ? "Valid until" : d.type === "invoice" ? "Due date" : "Effective from";
  return (
    <div className="space-y-4">
      {ro && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">This document is finalised and can&apos;t be edited. Use <strong>Duplicate</strong> to make a revised version.</p>}
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Title<input disabled={ro} value={d.title} onChange={(e) => set("title", e.target.value)} className={`${field} mt-1`} /></label>
        <label className="text-sm">Recipient (contact)
          <select disabled={ro} value={d.contactId ?? ""} onChange={(e) => set("contactId", e.target.value || null)} className={`${field} mt-1`}>
            <option value="">Choose a contact…</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}
          </select>
          {!contacts.length && <span className="mt-1 block text-xs text-amber-700">This company has no contacts yet. Add one to send the document.</span>}
        </label>
        <label className="text-sm">{d.type === "sla" ? "Date" : "Issue date"}<input disabled={ro} type="date" value={d.issueDate} onChange={(e) => set("issueDate", e.target.value)} className={`${field} mt-1`} /></label>
        <label className="text-sm">{dateLabel}<input disabled={ro} type="date" value={d.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} className={`${field} mt-1`} /></label>
        {d.type === "sla" ? <label className="text-sm">Term (months)<input disabled={ro} type="number" min={1} max={60} value={d.termMonths ?? 12} onChange={(e) => set("termMonths", Number(e.target.value) || 12)} className={`${field} mt-1`} /></label>
          : <label className="text-sm">VAT rate (%)<input disabled={ro} type="number" min={0} max={50} step="0.5" value={d.taxRate} onChange={(e) => set("taxRate", Number(e.target.value))} className={`${field} mt-1`} /></label>}
      </section>

      {d.type !== "sla" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Items</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="pb-1">Product / description</th><th className="w-20 pb-1">Qty</th><th className="w-36 pb-1">Unit price</th><th className="w-20 pb-1">Disc. %</th><th className="w-32 pb-1 text-right">Amount</th><th className="w-8" /></tr></thead>
              <tbody>
                {d.lines.map((l, i) => {
                  const amt = l.quantity * l.unitPrice * (1 - (l.discountPct || 0) / 100);
                  return (
                    <tr key={i} className="align-top">
                      <td className="py-1 pr-2">
                        <select disabled={ro} aria-label={`Product for line ${i + 1}`} value={l.productId ?? ""} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); setLine(i, p ? { productId: p.id, description: p.name, unitPrice: p.listPrice ?? l.unitPrice } : { productId: null }); }} className={`${field} mb-1`}>
                          <option value="">Custom item</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <input disabled={ro} aria-label={`Description for line ${i + 1}`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={field} placeholder="Description" />
                      </td>
                      <td className="py-1 pr-2"><input disabled={ro} aria-label="Quantity" type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} className={field} /></td>
                      <td className="py-1 pr-2"><input disabled={ro} aria-label="Unit price" type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} className={field} /></td>
                      <td className="py-1 pr-2"><input disabled={ro} aria-label="Discount percent" type="number" min={0} max={100} value={l.discountPct} onChange={(e) => setLine(i, { discountPct: Number(e.target.value) })} className={field} /></td>
                      <td className="py-1 text-right tabular-nums">{fmt(amt, d.currency)}</td>
                      <td className="py-1 pl-1">{!ro && <button aria-label={`Remove line ${i + 1}`} onClick={() => set("lines", d.lines.filter((_, j) => j !== i))} className="rounded p-1 text-slate-500 hover:bg-slate-100"><Trash2 className="h-4 w-4" /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!ro && <button onClick={() => set("lines", [...d.lines, { productId: null, description: "", quantity: 1, unitPrice: 0, discountPct: 0 }])} className={`${btn("ghost")} mt-2`}><Plus className="h-4 w-4" />Add line</button>}
          <dl className="ml-auto mt-3 grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
            <dt className="text-slate-500">Subtotal</dt><dd className="text-right tabular-nums">{fmt(t.sub, d.currency)}</dd>
            {t.disc > 0 && <><dt className="text-slate-500">Discounts</dt><dd className="text-right tabular-nums">−{fmt(t.disc, d.currency)}</dd></>}
            <dt className="text-slate-500">VAT ({d.taxRate}%)</dt><dd className="text-right tabular-nums">{fmt(t.tax, d.currency)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{fmt(t.total, d.currency)}</dd>
          </dl>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold">{d.type === "sla" ? "Agreement clauses" : "Terms"}</h2>
        {d.type === "sla" && <p className="mb-3 text-xs text-slate-500">Prefilled from the customer&apos;s SLA policy and our standard wording. The targets table comes from their tier&apos;s policy and is frozen when the document is created. Edit any clause before sending.</p>}
        <ol className="space-y-3">
          {d.sections.map((s, i) => (
            <li key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-1">
                <input disabled={ro} aria-label={`Clause ${i + 1} heading`} value={s.heading} onChange={(e) => setSection(i, { heading: e.target.value })} className={`${field} font-semibold`} />
                {!ro && <>
                  <button aria-label="Move up" onClick={() => move(i, -1)} className="rounded p-1 hover:bg-slate-100"><ArrowUp className="h-4 w-4" /></button>
                  <button aria-label="Move down" onClick={() => move(i, 1)} className="rounded p-1 hover:bg-slate-100"><ArrowDown className="h-4 w-4" /></button>
                  <button aria-label={`Remove clause ${i + 1}`} onClick={() => set("sections", d.sections.filter((_, j) => j !== i))} className="rounded p-1 text-slate-500 hover:bg-slate-100"><Trash2 className="h-4 w-4" /></button>
                </>}
              </div>
              <textarea disabled={ro} aria-label={`Clause ${i + 1} text`} rows={Math.min(10, Math.max(3, Math.ceil(s.body.length / 110)))} value={s.body} onChange={(e) => setSection(i, { body: e.target.value })} className={`${field} mt-2`} />
            </li>
          ))}
        </ol>
        {!ro && <button onClick={() => set("sections", [...d.sections, { heading: `${d.sections.length + 1}. New clause`, body: "" }])} className={`${btn("ghost")} mt-2`}><Plus className="h-4 w-4" />Add {d.type === "sla" ? "clause" : "term"}</button>}
        <label className="mt-3 block text-sm">Notes for the client (optional)<textarea disabled={ro} rows={2} value={d.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} className={`${field} mt-1`} /></label>
      </section>

      {!ro && (
        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <button onClick={save} disabled={pending || !dirty} className={btn("primary")}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</button>
          <span className="text-xs text-slate-500">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
        </div>
      )}
    </div>
  );
}

/** Mark as sent, then copy the client link or open an email to the recipient. */
export function SendPanel({ id, number, type, status, shareUrl, recipient, companyName, canManage }: { id: string; number: string; type: string; status: string; shareUrl: string; recipient: { name: string; email: string | null } | null; companyName: string; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const sent = status !== "draft";
  const label = type === "sla" ? "service level agreement" : type === "quote" ? "quotation" : "invoice";
  const ask = type === "invoice" ? "Payment details are on the invoice." : type === "sla" ? "You can review and sign it online, or download it as a PDF, sign and return it to us." : "You can review and accept it online, or download it as a PDF.";
  const mailto = recipient?.email ? `mailto:${recipient.email}?subject=${encodeURIComponent(`${number} — your ${label} from Afrilinq`)}&body=${encodeURIComponent(`Dear ${recipient.name},\n\nPlease find your ${label} (${number}) for ${companyName} here:\n${shareUrl}\n\n${ask}\n\nKind regards,`)}` : null;
  const copy = () => navigator.clipboard?.writeText(shareUrl).then(() => toast({ tone: "success", text: "Client link copied." }), () => toast({ tone: "error", text: "Couldn't copy — select the link and copy it manually." }));
  const send = () => start(async () => {
    const r = await sendDocumentAction(id);
    if (r.ok) { await navigator.clipboard?.writeText(shareUrl).catch(() => {}); toast({ tone: "success", text: r.message ?? "Sent." }); router.refresh(); }
    else toast({ tone: "error", text: r.message ?? "Couldn't send.", detail: Object.values(r.fieldErrors ?? {}) });
  });
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">Send to the client</h2>
      {!sent ? (
        <>
          <p className="mb-2 text-sm text-slate-600">Sending gives the client a private link to view it, download a PDF{type !== "invoice" ? ", and accept or sign online" : ""}.</p>
          {canManage && <button onClick={send} disabled={pending} className={btn("primary")}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Mark as sent and get link</button>}
        </>
      ) : (
        <>
          <label className="text-xs text-slate-500" htmlFor={`link-${id}`}>Client link</label>
          <div className="mt-1 flex gap-1"><input id={`link-${id}`} readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className={`${field} text-xs`} /><button onClick={copy} className={btn()} aria-label="Copy client link"><Copy className="h-4 w-4" /></button></div>
          <div className="mt-2 flex flex-wrap gap-2">
            {mailto ? <a href={mailto} className={btn()}><Mail className="h-4 w-4" />Email to {recipient!.name}</a> : <p className="text-xs text-amber-700">The recipient has no email on file — copy the link and send it another way.</p>}
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className={btn("ghost")}>View as client</a>
          </div>
          <p className="mt-2 text-xs text-slate-500">Email sending isn&apos;t connected to the CRM, so “Email” opens your own mail app with the message ready.</p>
        </>
      )}
    </section>
  );
}

export function DuplicateButton({ id, asType, label }: { id: string; asType: string | null; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(async () => { const r = await duplicateDocumentAction(id, asType); if (r.ok) { toast({ tone: "success", text: r.message ?? "Created." }); router.push(`/documents/${r.data?.id}`); } else toast({ tone: "error", text: r.message ?? "Couldn't create it." }); })}
      className={btn()}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}</button>
  );
}
