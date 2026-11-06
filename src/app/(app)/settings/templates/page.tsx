import { ctx, requirePerm } from "@/server/page";
import { listTemplates } from "@/server/services/admin";
import { products } from "@/db/schema";
import { SEGMENTS } from "@/lib/rules/sales";
import { ONBOARDING_STAGES } from "@/lib/rules/onboarding";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { saveTemplateAction } from "@/app/actions/admin";

export const metadata = { title: "Onboarding templates" };
type T = Awaited<ReturnType<typeof listTemplates>>[number];

function TemplateForm({ t, ps }: { t?: T; ps: { id: string; name: string }[] }) {
  const lines = t?.tasks.map((x) => [x.title, x.stageKey, x.offsetDays, x.isMilestone ? "y" : "n", x.customerResponsibility ? "y" : "n", x.dependsOnPosition ?? ""].join(" | ")).join("\n") ?? "";
  return (
    <ActionForm action={saveTemplateAction.bind(null, t?.t.id ?? null)} className="space-y-2" resetOnSuccess={!t}>
      <Grid cols={3}><Input name="name" label="Name" defaultValue={t?.t.name} required /><Select name="productId" label="Product" defaultValue={t?.t.productId ?? ""} placeholder="Any product" options={ps.map((p) => ({ value: p.id, label: p.name }))} /><Select name="segment" label="Segment" defaultValue={t?.t.segment ?? ""} placeholder="Any segment" options={SEGMENTS.map((s) => ({ value: s, label: s }))} /></Grid>
      <Grid><Input name="durationDays" label="Default duration (days)" type="number" defaultValue={t?.t.durationDays ?? 30} /><Input name="description" label="Description" defaultValue={t?.t.description ?? ""} /></Grid>
      <Textarea name="tasks" label="Tasks (one per line)" defaultValue={lines} rows={10} className="font-mono" required hint={`Title | stage | offset days from start | milestone y/n | customer responsibility y/n | depends on line #. Stages: ${ONBOARDING_STAGES.map((s) => s.key).join(", ")}`} />
      <Submit size="sm">Save template</Submit>
    </ActionForm>
  );
}

export default async function TemplatesPage() {
  const { actor, db } = await ctx();
  requirePerm(actor, "admin.settings");
  const ts = await listTemplates(db);
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  return (
    <>
      <PageHeader title="Onboarding templates" subtitle="On acceptance, the most specific template (product, then segment) is applied unless the reviewer picks one." />
      <div className="space-y-3">
        {ts.map((t) => (
          <Card key={t.t.id} title={t.t.name} actions={<><Badge>{t.product ?? "Any product"}</Badge><Badge>{t.t.segment ?? "Any segment"}</Badge><Badge>{t.tasks.length} tasks · {t.t.durationDays}d</Badge></>}>
            <Disclosure label="Edit"><TemplateForm t={t} ps={ps} /></Disclosure>
          </Card>
        ))}
        <Card title="New template"><TemplateForm ps={ps} /></Card>
      </div>
    </>
  );
}
