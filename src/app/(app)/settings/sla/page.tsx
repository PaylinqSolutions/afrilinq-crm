import { ctx, requirePerm } from "@/server/page";
import { listSlaPolicies } from "@/server/services/admin";
import { TICKET_STATUSES } from "@/lib/rules/tickets";
import { Badge, Card, Notice, PageHeader, VersionField } from "@/components/ui";
import { ActionForm, Checkbox, Grid, Input, Submit, Textarea } from "@/components/forms";
import { updateSlaAction } from "@/app/actions/admin";

export const metadata = { title: "SLA policies" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SlaPage() {
  const { actor, db } = await ctx();
  requirePerm(actor, "admin.sla");
  const policies = await listSlaPolicies(db);
  return (
    <>
      <PageHeader title="SLA policies" subtitle="Targets are in minutes. Business-hours targets count only working time in the policy's time zone; others run 24×7. Changes apply to new tickets and on priority recalculation." />
      <Notice tone="amber" title="Example policy — confirm internally before production use">The seeded targets are suggestions only. Agree response/resolution targets, business hours, holidays and pause rules before promising them to customers.</Notice>
      <div className="mt-4 space-y-4">
        {policies.map((p) => (
          <Card key={p.id} title={p.name} actions={<>{p.isDefault && <Badge tone="brand">Default</Badge>}{p.customerTier && <Badge tone="violet">Tier: {p.customerTier}</Badge>}</>}>
            <ActionForm action={updateSlaAction.bind(null, p.id)} className="space-y-4"><VersionField at={p.updatedAt} />
              <Grid><Input name="name" label="Name" defaultValue={p.name} required /><Textarea name="description" label="Description" defaultValue={p.description ?? ""} rows={2} /></Grid>
              <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold">Business calendar</legend>
                <Grid cols={3}><Input name="timezone" label="Time zone" defaultValue={p.calendar.timezone} /><Input name="start" label="Opens" type="time" defaultValue={p.calendar.start} /><Input name="end" label="Closes" type="time" defaultValue={p.calendar.end} /></Grid>
                <div className="mt-2 flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} name="workdays" value={String(i)} label={d} defaultChecked={p.calendar.workdays.includes(i)} />)}</div>
                <Textarea name="holidays" label="Public holidays (YYYY-MM-DD, comma or newline separated)" defaultValue={p.calendar.holidays.join(", ")} rows={2} />
              </fieldset>
              <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1 pr-2">Priority</th><th className="pr-2">First response</th><th className="pr-2">Resolution</th><th className="pr-2">Update every</th><th className="pr-2">Warn %</th><th className="pr-2">Escalate %</th><th>Business hours</th></tr></thead>
                <tbody>{["P1", "P2", "P3", "P4"].map((k) => { const t = p.targets[k]; return (
                  <tr key={k}><td className="py-1 pr-2 font-medium">{k}</td>
                    {(["fr", "res", "upd", "warn", "esc"] as const).map((f) => <td key={f} className="pr-2"><label className="sr-only" htmlFor={`${p.id}-${k}-${f}`}>{k} {f}</label><input id={`${p.id}-${k}-${f}`} name={`${k}_${f}`} type="number" className="w-24 rounded border border-slate-300 px-2 py-1" defaultValue={{ fr: t.firstResponseMins, res: t.resolutionMins, upd: t.updateMins, warn: t.warnAtPct, esc: t.escalateAtPct }[f]} /></td>)}
                    <td><input type="checkbox" aria-label={`${k} business hours`} name={`${k}_bh`} defaultChecked={t.businessHours} /></td></tr>); })}</tbody></table></div>
              <fieldset><legend className="text-sm font-medium">Statuses that pause the SLA clock</legend><div className="mt-1 flex flex-wrap gap-3">{TICKET_STATUSES.filter((s) => s.key.startsWith("waiting")).map((s) => <Checkbox key={s.key} name="pauseStatuses" value={s.key} label={s.label} defaultChecked={p.pauseStatuses.includes(s.key)} />)}</div>
                <p className="text-xs text-slate-500">Every pause and resume is recorded with who and why. Waiting statuses not ticked keep the clock running (and say so on the ticket).</p></fieldset>
              <Checkbox name="automatedAck" label="Count the automated acknowledgement as the first response (not recommended)" defaultChecked={p.automatedAckCountsAsResponse} />
              <Checkbox name="active" label="Active" defaultChecked={p.active} />
              <Submit size="sm">Save policy</Submit>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
