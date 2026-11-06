import { and, desc, eq, isNull } from "drizzle-orm";
import { ctx } from "@/server/page";
import { forbidden } from "next/navigation";
import { canManageType, DOC_TYPES, type DocType } from "@/server/services/documents";
import { listCompanies } from "@/server/services/accounts";
import { contacts, deals } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, NavSelect, Select, Submit } from "@/components/forms";
import { createDocumentAction } from "@/app/actions/documents";

export const metadata = { title: "New document" };

const INTRO: Record<DocType, string> = {
  sla: "Creates a draft Service Level Agreement from the customer's support tier and SLA policy, with standard clauses you can edit before sending.",
  quote: "Creates a draft quote. Pick a deal to copy its products and prices.",
  invoice: "Creates a draft invoice. Pick a deal to copy its products and prices, or create it from an accepted quote.",
};

export default async function NewDocument({ searchParams }: { searchParams: Promise<{ type?: string; company?: string; deal?: string; contact?: string; source?: string }> }) {
  const { actor, db } = await ctx();
  const sp = await searchParams;
  const type = (["sla", "quote", "invoice"].includes(sp.type ?? "") ? sp.type : "quote") as DocType;
  if (!canManageType(actor, type)) forbidden();
  const { rows: cos } = await listCompanies(db, actor, {}, true);
  const company = cos.find((c) => c.id === sp.company)?.id;
  const cs = company ? await db.select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName }).from(contacts).where(and(eq(contacts.companyId, company), isNull(contacts.deletedAt))) : [];
  const ds = company ? await db.select({ id: deals.id, name: deals.name }).from(deals).where(and(eq(deals.companyId, company), isNull(deals.deletedAt))).orderBy(desc(deals.updatedAt)) : [];
  return (
    <>
      <PageHeader title={`New ${DOC_TYPES[type].noun}`} crumbs={[{ href: "/billing", label: "Billing & agreements" }]} subtitle={INTRO[type]} />
      <Card>
        <ActionForm action={createDocumentAction} successPath="/documents/{id}" className="max-w-xl space-y-3">
          <NavSelect param="type" name="type" label="Document" defaultValue={type} options={(Object.keys(DOC_TYPES) as DocType[]).filter((t) => canManageType(actor, t)).map((t) => ({ value: t, label: DOC_TYPES[t].label }))} />
          <NavSelect param="company" name="companyId" label="Customer (company)" required defaultValue={company ?? ""} placeholder="Choose a company…" options={cos.map((c) => ({ value: c.id, label: c.name }))} />
          {company && <>
            <Select name="contactId" label="Recipient (who reviews and signs)" defaultValue={sp.contact ?? ""} placeholder={cs.length ? "Choose later" : "No contacts at this company yet"} options={cs.map((c) => ({ value: c.id, label: `${c.first} ${c.last}` }))} />
            {type !== "sla" && <Select name="dealId" label="Copy items from deal" defaultValue={sp.deal ?? ""} placeholder="Don't copy — start empty" options={ds.map((d) => ({ value: d.id, label: d.name }))} />}
            {sp.source && <input type="hidden" name="sourceId" value={sp.source} />}
          </>}
          <Submit>Create draft</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
