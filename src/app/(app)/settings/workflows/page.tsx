import { ctx, requirePerm } from "@/server/page";
import { listRules } from "@/server/services/admin";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { ActionForm, Checkbox, Disclosure, Input, Submit, Textarea } from "@/components/forms";
import { retryRunAction, runSweepAction, updateRuleAction } from "@/app/actions/admin";

export const metadata = { title: "Workflow rules" };

export default async function WorkflowsPage() {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "admin.workflows");
  const { rules, runs, triggers, actionTypes } = await listRules(db);
  return (
    <>
      <PageHeader title="Workflow rules" subtitle="Rules add configurable notifications, tasks and assignment. Core controls (handover creation, onboarding project creation, SLA calculation) always run and cannot be disabled."
        actions={<ActionForm action={runSweepAction}><Submit variant="secondary">Run scheduled checks now</Submit></ActionForm>} />
      <Card title="Reference" className="mb-4">
        <p className="text-xs text-slate-600"><strong>Conditions</strong> JSON: <code>[&#123;&quot;field&quot;:&quot;priority&quot;,&quot;op&quot;:&quot;in&quot;,&quot;value&quot;:[&quot;P1&quot;,&quot;P2&quot;]&#125;]</code> — ops: eq, neq, in, gte, lte, exists. <strong>Actions</strong>: {Object.entries(actionTypes).map(([k, v]) => `${k} (${v})`).join("; ")}. Templates use <code>&#123;&#123;field&#125;&#125;</code>. Each rule runs at most once per event key; failures are kept and can be retried (max 3 attempts).</p>
      </Card>
      <div className="space-y-3">
        {rules.map((r) => (
          <Card key={r.id} title={r.name} actions={<><Badge>{triggers[r.trigger] ?? r.trigger}</Badge>{r.enabled ? <Badge tone="green">Enabled</Badge> : <Badge>Disabled</Badge>}</>}>
            {r.description && <p className="mb-2 text-xs text-slate-600">{r.description}</p>}
            <Disclosure label="Edit">
              <ActionForm action={updateRuleAction.bind(null, r.id)} className="space-y-2">
                <Input name="name" label="Name" defaultValue={r.name} />
                <Textarea name="conditions" label="Conditions (JSON)" defaultValue={JSON.stringify(r.conditions, null, 2)} rows={3} className="font-mono" />
                <Textarea name="actions" label="Actions (JSON)" defaultValue={JSON.stringify(r.actions, null, 2)} rows={6} className="font-mono" />
                <Checkbox name="enabled" label="Enabled" defaultChecked={r.enabled} />
                <Submit size="sm">Save rule</Submit>
              </ActionForm>
            </Disclosure>
          </Card>
        ))}
      </div>
      <Card title="Recent runs" pad={false} className="mt-4">
        <Table head={["When", "Rule", "Trigger", "Status", "Log / error", ""]}>
          {runs.map((x) => (
            <tr key={x.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(x.startedAt, tz)}</Td><Td className="text-xs">{rules.find((r) => r.id === x.ruleId)?.name}</Td><Td className="text-xs">{x.trigger}</Td>
              <Td><StatusBadge status={x.status} map={{ success: "green", failed: "red", running: "amber" }} /> <span className="text-xs text-slate-500">×{x.attempts}</span></Td>
              <Td className="text-xs">{x.error ? <span className="text-red-700">{x.error}</span> : x.log.join("; ")}</Td>
              <Td>{x.status === "failed" && <ActionForm action={retryRunAction.bind(null, x.id)}><Submit size="sm" variant="secondary">Retry</Submit></ActionForm>}</Td></tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
