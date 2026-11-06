import { customerJourney, relatedFor } from "@/server/services/journey";
import { JourneyTracker, RelatedPanel } from "@/components/related";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ctx, load } from "@/server/page";
import { can } from "@/server/actor";
import { findMatchingContact, getLead } from "@/server/services/sales";
import { activitiesFor, tasksForRecord } from "@/server/services/activities";
import { usersInRoles, simpleUsers } from "@/server/services/admin";
import { activities, products, users } from "@/db/schema";
import { fmtDateTime } from "@/lib/format";
import { Card, KV, Notice, PageHeader, StatusBadge, VersionField } from "@/components/ui";
import { ActionForm, Checkbox, Input, Select, Submit, Disclosure } from "@/components/forms";
import { listCompanies } from "@/server/services/accounts";
import { LeadFields } from "@/components/lead-form";
import { ActivityForm, NewTaskForm, TaskList, Timeline } from "@/components/records";
import { convertLeadAction, updateLeadAction } from "@/app/actions/crm";

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const related = await relatedFor(db, actor, "lead", id);
  const journey = related.companyId ? await customerJourney(db, related.companyId) : [];
  const lead = await load(() => getLead(db, actor, id));
  const [owner] = lead.ownerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, lead.ownerId)) : [];
  const acts = await activitiesFor(db, eq(activities.leadId, id));
  const ts = await tasksForRecord(db, "lead", id);
  const reps = await usersInRoles(db, ["sales_executive", "sales_manager"]);
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  const editable = can(actor, "leads.edit") && lead.status !== "Converted";
  const match = editable ? await findMatchingContact(db, lead.email, lead.phone, lead.contactName, lead.organization) : null;
  const cos = editable ? (await listCompanies(db, actor, {}, true)).rows : [];
  const companyMatch = lead.organization ? cos.find((c) => c.name.trim().toLowerCase() === lead.organization!.trim().toLowerCase()) : undefined;
  return (
    <>
      <PageHeader title={lead.name} subtitle={<>{lead.organization ?? "Individual"} · {lead.contactName}</>} crumbs={[{ href: "/leads", label: "Leads" }]}
        actions={<StatusBadge status={lead.status} />} />
      {lead.status === "Converted" && (
        <Notice tone="green" title="Converted">
          On {fmtDateTime(lead.convertedAt, tz)} this lead became <Link className="underline" href={`/contacts/${lead.convertedContactId}`}>a contact</Link>
          {lead.convertedCompanyId && <> at <Link className="underline" href={`/companies/${lead.convertedCompanyId}`}>a company</Link></>}
          {lead.convertedDealId && <>, with <Link className="underline" href={`/deals/${lead.convertedDealId}`}>a deal</Link></>}. It is now read-only; keep working on the contact.
        </Notice>
      )}
      {journey.length > 0 && <div className="mb-4"><JourneyTracker steps={journey} /></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {editable ? (
            <Card title="Lead details"><ActionForm action={updateLeadAction.bind(null, id)}><VersionField at={lead.updatedAt} /><LeadFields lead={lead} users={reps} products={ps} canAssign={can(actor, "leads.assign")} /></ActionForm></Card>
          ) : (
            <Card title="Lead details"><KV items={[["Source", lead.source], ["Email", lead.email], ["Phone", lead.phone], ["Owner", owner?.name], ["Next action", lead.nextAction], ["Need", lead.qualification.need], ["Pain points", lead.qualification.painPoints]]} /></Card>
          )}
          <Card title="Activity" actions={can(actor, "activities.log") && lead.status !== "Converted" ? <ActivityForm link={{ leadId: id }} /> : undefined}>
            <Timeline tz={tz} items={acts.map((a) => ({ at: a.occurredAt, kind: a.type, title: a.subject, detail: [a.outcome, a.body].filter(Boolean).join(" — "), by: a.by, simulated: a.simulated }))} />
          </Card>
        </div>
        <div className="space-y-4">
          <RelatedPanel groups={related.groups} />
          <Card title="Summary"><KV items={[["Owner", owner?.name ?? "Unassigned"], ["Created", fmtDateTime(lead.createdAt, tz)], ["Last activity", fmtDateTime(lead.lastActivityAt, tz)], ["Next action due", fmtDateTime(lead.nextActionDue, tz)]]} /></Card>
          {editable && can(actor, "accounts.edit") && lead.status !== "Disqualified" && (
            <Card title="Convert lead" id="convert">
              <ActionForm action={convertLeadAction.bind(null, id)} successPath="{next}" className="space-y-3">
                <p className="text-sm text-slate-600">Turns this lead into a <span className="font-semibold">contact</span>, carrying over their details and activity. An existing contact or company is reused instead of duplicated.</p>
                <Select name="companyId" label="Company" defaultValue={match?.companyId ?? companyMatch?.id ?? ""} placeholder={lead.organization ? `Create “${lead.organization}”` : "No company (individual)"}
                  options={cos.map((c) => ({ value: c.id, label: c.name }))} hint={companyMatch && !match?.companyId ? `“${lead.organization}” already exists, so it's preselected.` : "Optional. Leave it to create the organisation, or none for an individual."} />
                {can(actor, "deals.edit") && <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <Checkbox name="createDeal" label="Also open a deal" defaultChecked={!!lead.organization || !!match?.companyId} hint="A deal needs a company. Untick to create just the contact." />
                  <Input name="dealName" label="Deal name (if opening a deal)" defaultValue={`${lead.organization || lead.contactName} — ${lead.name}`} />
                  <Input name="amount" label="Estimated value (NGN)" inputMode="numeric" />
                </fieldset>}
                {match ? (
                  <div className="rounded-lg border border-accent-400/50 bg-accent-50 p-3 text-sm">
                    <p><span className="font-semibold">Already a contact:</span> <Link href={`/contacts/${match.id}`} className="font-medium text-brand-700 underline">{match.firstName} {match.lastName}</Link>{match.companyName && <> at {match.companyName}</>} has the same {match.matchedBy}. The lead will be linked to them instead of creating a duplicate{match.companyName ? `, under ${match.companyName}` : ""}.</p>
                    <div className="mt-2"><Checkbox name="newContact" label="Create a separate contact instead" hint="Only if this is a different person who happens to share these details." /></div>
                  </div>
                ) : <p className="text-xs text-slate-500">No existing contact has this email or phone, so a new contact “{lead.contactName}” will be created.</p>}
                <Submit>Convert to contact</Submit>
              </ActionForm>
            </Card>
          )}
          <Card title="Tasks"><TaskList tasks={ts} tz={tz} compact />{editable && <div className="mt-3"><Disclosure label="Add task"><NewTaskForm users={await simpleUsers(db)} link={{ relatedType: "lead", relatedId: id }} /></Disclosure></div>}</Card>
        </div>
      </div>
    </>
  );
}
