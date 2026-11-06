"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, Search, UserRound, X } from "lucide-react";
import { useFieldError } from "./forms";

type Co = { id: string; name: string };
type Ct = { id: string; name: string; companyId: string | null; companyName: string | null; email: string | null };

/** Tickets are raised on an existing customer: search companies and contacts, pick one, optionally narrow to a contact. */
export function TicketCustomerPicker({ companies, contacts, initialCompany, initialContact }: { companies: Co[]; contacts: Ct[]; initialCompany?: string; initialContact?: string }) {
  const start = contacts.find((c) => c.id === initialContact);
  const [companyId, setCompanyId] = useState<string | null>(start?.companyId ?? (companies.some((c) => c.id === initialCompany) ? initialCompany! : null));
  const [contactId, setContactId] = useState<string | null>(start?.id ?? null);
  const [q, setQ] = useState("");
  const companyErr = useFieldError("companyId");
  const contactErr = useFieldError("contactId");
  const err = companyErr ?? contactErr;
  const company = companies.find((c) => c.id === companyId) ?? null;
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return [
      ...companies.filter((c) => c.name.toLowerCase().includes(t)).slice(0, 6).map((c) => ({ kind: "company" as const, id: c.id, label: c.name, hint: "Company" })),
      ...contacts.filter((c) => `${c.name} ${c.email ?? ""}`.toLowerCase().includes(t)).slice(0, 8).map((c) => ({ kind: "contact" as const, id: c.id, label: c.name, hint: c.companyName ?? "Contact (no company)" })),
    ];
  }, [q, companies, contacts]);
  const companyContacts = companyId ? contacts.filter((c) => c.companyId === companyId) : [];
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 text-sm font-medium text-slate-700">Customer <span className="text-red-600">*</span></legend>
      <input type="hidden" name="companyId" value={companyId ?? ""} />
      <input type="hidden" name="contactId" value={contactId ?? ""} />
      {company || contact ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          {company && <span className="inline-flex items-center gap-1 font-medium"><Building2 className="h-4 w-4 text-slate-500" />{company.name}</span>}
          {contact && <span className="inline-flex items-center gap-1"><UserRound className="h-4 w-4 text-slate-500" />{contact.name}{contact.email && <span className="text-slate-500">· {contact.email}</span>}</span>}
          <button type="button" onClick={() => { setCompanyId(null); setContactId(null); }} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-white"><X className="h-3.5 w-3.5" />Change</button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an existing company or contact by name or email" aria-label="Search customers" aria-invalid={!!err} className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
          {results.length > 0 && (
            <ul role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
              {results.map((r) => (
                <li key={`${r.kind}${r.id}`}><button type="button" onClick={() => { if (r.kind === "company") { setCompanyId(r.id); setContactId(null); } else { const c = contacts.find((x) => x.id === r.id)!; setContactId(c.id); setCompanyId(c.companyId); } setQ(""); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                  {r.kind === "company" ? <Building2 className="h-4 w-4 text-slate-500" /> : <UserRound className="h-4 w-4 text-slate-500" />}<span className="font-medium">{r.label}</span><span className="text-xs text-slate-500">{r.hint}</span>
                </button></li>
              ))}
            </ul>
          )}
          {q.trim() && !results.length && <p className="mt-1 text-xs text-slate-600">No company or contact matches “{q}”. <Link href="/companies" className="font-medium text-brand-700 underline">Add the company</Link> or <Link href="/contacts" className="font-medium text-brand-700 underline">add the contact</Link> first.</p>}
        </div>
      )}
      {company && !contact && companyContacts.length > 0 && (
        <label className="mt-2 block text-sm">Contact at {company.name} <span className="text-slate-500">(optional)</span>
          <select value={contactId ?? ""} onChange={(e) => setContactId(e.target.value || null)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
            <option value="">No specific contact</option>{companyContacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}
          </select></label>
      )}
      {err ? <p className="mt-1 text-xs text-red-700">{err}</p> : <p className="mt-1 text-xs text-slate-500">Tickets are always raised on an existing company or contact, so they show on that customer&apos;s record and count towards their health.</p>}
    </fieldset>
  );
}
