import { eq } from "drizzle-orm";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { allContactsPicker, customerPicker } from "@/server/services/tickets";
import { TicketCustomerPicker } from "@/components/ticket-customer";
import { products } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { TriageFields } from "@/components/triage-fields";
import { createTicketAction } from "@/app/actions/tickets";
import { simpleUsers, listTeams } from "@/server/services/admin";

export const metadata = { title: "New ticket" };

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ company?: string; contact?: string; deal?: string; project?: string; product?: string }> }) {
  const { actor, db } = await ctx();
  requirePerm(actor, "tickets.create");
  const { company, contact, deal, project } = await searchParams;
  const companies = await customerPicker(db, actor);
  const contacts = await allContactsPicker(db, actor);
  const ps = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.active, true));
  return (
    <>
      <PageHeader title="New ticket" crumbs={[{ href: "/tickets", label: "Tickets" }]} subtitle="Routing assigns a team queue by category/tier and the least-loaded agent. Possible duplicates for the same customer and product are flagged." />
      <Card>
        <ActionForm action={createTicketAction} successPath="/tickets/{id}" className="space-y-4">
          <Grid>
            <Input name="subject" label="Subject" required className="sm:col-span-2" />
            <Textarea name="description" label="Description" required rows={4} className="sm:col-span-2" hint="Steps, error messages, when it started." />
            <TicketCustomerPicker companies={companies} contacts={contacts} initialCompany={company} initialContact={contact} />
            {deal && <input type="hidden" name="dealId" value={deal} />}
            {project && <input type="hidden" name="onboardingProjectId" value={project} />}
            <Select name="channel" label="Received via" defaultValue="manual" options={[["manual", "Manual entry"], ["email", "Shared inbox / email"], ["phone", "Phone"], ["whatsapp", "WhatsApp"], ["portal", "Customer portal"]].map(([value, label]) => ({ value, label }))} />
            {can(actor, "tickets.reassign") && <Select name="teamId" label="Team queue" placeholder="Route automatically" options={(await listTeams(db)).filter((t) => t.kind === "support").map((t) => ({ value: t.id, label: t.name }))} />}
            {can(actor, "tickets.reassign") && <Select name="ownerId" label="Assign to" placeholder="Route automatically" options={(await simpleUsers(db)).map((u) => ({ value: u.id, label: u.name }))} />}
          </Grid>
          <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold text-slate-700">Triage</legend><TriageFields products={ps} /></fieldset>
          <Checkbox name="ignoreDuplicates" label="Not a duplicate — create anyway" hint="Only tick this after reviewing any duplicate warning." />
          <Submit>Create ticket</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
