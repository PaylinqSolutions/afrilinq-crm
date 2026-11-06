import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { listPrograms, schedulableCompanies } from "@/server/services/training";
import { usersInRoles } from "@/server/services/admin";
import { onboardingProjects, contacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Grid, Input, NavSelect, Select, Submit, Textarea } from "@/components/forms";
import { scheduleSessionAction } from "@/app/actions/training";

export const metadata = { title: "Schedule training" };

export default async function NewSession({ searchParams }: { searchParams: Promise<{ company?: string; project?: string }> }) {
  const { actor, db } = await ctx();
  requirePerm(actor, "training.manage");
  const { company, project } = await searchParams;
  const cos = await schedulableCompanies(db, actor);
  const progs = await listPrograms(db, actor);
  const trainers = await usersInRoles(db, ["trainer"]);
  const allowed = company && cos.some((c) => c.id === company);
  const people = allowed ? await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle }).from(contacts).where(eq(contacts.companyId, company!)) : [];
  const projects = allowed ? await db.select({ id: onboardingProjects.id, name: onboardingProjects.name }).from(onboardingProjects).where(eq(onboardingProjects.companyId, company!)) : [];
  return (
    <>
      <PageHeader title="Schedule a training session" crumbs={[{ href: "/training", label: "Training" }]} />
      {!can(actor, "training.view_all") && <Notice tone="blue">You can schedule sessions for customers you're already assigned to. Onboarding managers schedule first sessions for new customers.</Notice>}
      <Card className="mt-3">
        {cos.length === 0 ? <p className="text-sm text-slate-600">No customers available to you yet.</p> : (
          <ActionForm action={scheduleSessionAction} successPath="/training/sessions/{id}" className="space-y-4">
            <Grid>
              <NavSelect param="company" name="companyId" label="Customer" required defaultValue={company ?? ""} placeholder="Choose…" options={cos.map((c) => ({ value: c.id, label: c.name }))} />
              <Select name="onboardingProjectId" label="Onboarding project" defaultValue={project ?? ""} placeholder="—" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              <Select name="programId" label="Program" required placeholder="Choose…" options={progs.map(({ p }) => ({ value: p.id, label: p.name }))} />
              <Input name="title" label="Session title" required />
              <Input name="startsAt" label="Date & time" type="datetime-local" required />
              <Input name="durationMinutes" label="Duration (minutes)" type="number" placeholder="Program default" />
              <Select name="channel" label="Channel" options={[{ value: "virtual", label: "Virtual" }, { value: "onsite", label: "On-site" }, { value: "hybrid", label: "Hybrid" }]} />
              <Input name="meetingLink" label="Meeting link" type="url" />
              <Input name="location" label="Location (on-site/hybrid)" />
              {can(actor, "training.view_all") ? <Select name="facilitatorId" label="Facilitator" placeholder="Me" options={trainers.map((u) => ({ value: u.id, label: u.name }))} /> : <span />}
            </Grid>
            <Textarea name="agenda" label="Agenda" rows={3} />
            <Checkbox name="isRefresher" label="Post-launch refresher session" />
            {allowed && <fieldset><legend className="mb-1 text-sm font-medium text-slate-700">Participants</legend>
              {people.length === 0 ? <p className="text-sm text-slate-500">No contacts on this account.</p> : <div className="grid gap-1 sm:grid-cols-2">{people.map((p) => <Checkbox key={p.id} name="contactIds" value={p.id} label={`${p.firstName} ${p.lastName}`} hint={p.jobTitle ?? undefined} />)}</div>}
            </fieldset>}
            <Submit>Schedule session</Submit>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
