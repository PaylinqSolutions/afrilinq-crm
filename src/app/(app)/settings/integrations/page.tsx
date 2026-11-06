import { ctx, requirePerm } from "@/server/page";
import { listIntegrations } from "@/server/services/integrations";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { testIntegrationAction } from "@/app/actions/admin";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "admin.integrations");
  const list = await listIntegrations(db);
  return (
    <>
      <PageHeader title="Integrations" subtitle="Optional adapters. Credentials live only in server environment variables — never in the database or browser." />
      <Notice tone="blue">An integration shows <strong>Connected</strong> only after a provider adapter exists and a test succeeds. Until then, in-app notifications work and any send is clearly labelled as simulated.</Notice>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {list.map((i) => (
          <Card key={i.kind} title={i.label} actions={i.status === "connected" ? <Badge tone="green">Connected</Badge> : i.status === "configured" ? <Badge tone="amber">Configured — not tested</Badge> : i.status === "error" ? <Badge tone="red">Error</Badge> : <Badge>Not configured</Badge>}>
            <p className="text-sm text-slate-600">{i.use}</p>
            <p className="mt-2 text-xs text-slate-500">Environment: {i.missingEnv.length ? <>missing <code>{i.missingEnv.join(", ")}</code></> : <>provider <code>{i.provider}</code>{i.hasAdapter ? "" : " (no adapter implemented)"}</>}</p>
            {i.lastTestAt && <p className="text-xs text-slate-500">Last test {fmtDateTime(i.lastTestAt, tz)}: {i.lastTestResult}</p>}
            <ActionForm action={testIntegrationAction.bind(null, i.kind)} className="mt-3"><Submit size="sm" variant="secondary">Test connection</Submit></ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
