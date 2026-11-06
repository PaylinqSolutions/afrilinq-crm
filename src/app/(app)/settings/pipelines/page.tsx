import { ctx, requirePerm } from "@/server/page";
import { getStages } from "@/server/services/sales";
import { DEAL_REQUIRABLE_FIELDS, CLOSED_WON_REQUIRED } from "@/lib/rules/sales";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Disclosure, Grid, Input, Submit, Textarea } from "@/components/forms";
import { updateStageAction } from "@/app/actions/admin";

export const metadata = { title: "Pipelines" };

export default async function PipelinesPage() {
  const { actor, db } = await ctx();
  requirePerm(actor, "admin.pipelines");
  const stages = await getStages(db);
  return (
    <>
      <PageHeader title="Pipeline: New business" subtitle={`Configure stage probabilities, entry/exit criteria and required fields. Always enforced: Closed Won needs ${CLOSED_WON_REQUIRED.map((f) => DEAL_REQUIRABLE_FIELDS[f]).join(", ")} and no unapproved discount; Closed Lost needs a loss reason; open stages need a next step and due date.`} />
      <div className="space-y-3">
        {stages.map((s) => (
          <Card key={s.id} title={`${s.position}. ${s.name}`} actions={<><Badge>{s.probability}%</Badge>{s.isWon && <Badge tone="green">Won</Badge>}{s.isLost && <Badge>Lost</Badge>}</>}>
            <p className="text-xs text-slate-600">Entry: {s.entryCriteria ?? "—"} · Exit: {s.exitCriteria ?? "—"} · Required: {s.requiredFields.map((f) => DEAL_REQUIRABLE_FIELDS[f]).join(", ") || "none"} · Stale after {s.staleAfterDays}d</p>
            <div className="mt-2"><Disclosure label="Edit stage">
              <ActionForm action={updateStageAction.bind(null, s.id)} className="space-y-2">
                <Grid cols={3}><Input name="name" label="Name" defaultValue={s.name} required /><Input name="probability" label="Probability %" type="number" defaultValue={s.probability} /><Input name="staleAfterDays" label="Stale after (days)" type="number" defaultValue={s.staleAfterDays} /></Grid>
                <Grid><Textarea name="entryCriteria" label="Entry criteria" defaultValue={s.entryCriteria ?? ""} rows={2} /><Textarea name="exitCriteria" label="Exit criteria" defaultValue={s.exitCriteria ?? ""} rows={2} /></Grid>
                <fieldset><legend className="text-sm font-medium text-slate-700">Required to enter this stage</legend><div className="grid gap-1 sm:grid-cols-3">{Object.entries(DEAL_REQUIRABLE_FIELDS).map(([k, l]) => <Checkbox key={k} name="requiredFields" value={k} label={l} defaultChecked={s.requiredFields.includes(k)} />)}</div></fieldset>
                <Submit size="sm">Save stage</Submit>
              </ActionForm>
            </Disclosure></div>
          </Card>
        ))}
      </div>
    </>
  );
}
