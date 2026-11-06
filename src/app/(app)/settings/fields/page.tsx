import { ctx, requirePerm } from "@/server/page";
import { customFields } from "@/db/schema";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Grid, Input, Select, Submit } from "@/components/forms";
import { addCustomFieldAction, deleteCustomFieldAction } from "@/app/actions/admin";

export const metadata = { title: "Custom fields" };

export default async function FieldsPage() {
  const { actor, db } = await ctx();
  requirePerm(actor, "admin.settings");
  const rows = await db.select().from(customFields);
  return (
    <>
      <PageHeader title="Custom fields" subtitle="Extra fields shown and validated on company records." />
      <Card title="Fields">
        {rows.length === 0 ? <EmptyState title="No custom fields yet" /> : <ul className="divide-y divide-slate-100">{rows.map((f) => <li key={f.id} className="flex items-center gap-2 py-2 text-sm"><span className="font-medium">{f.label}</span><Badge>{f.entityType}</Badge><Badge>{f.fieldType}</Badge>{f.required && <Badge tone="red">Required</Badge>}{f.options && <span className="text-xs text-slate-500">{f.options.join(", ")}</span>}<ActionForm action={deleteCustomFieldAction.bind(null, f.id)} className="ml-auto"><Submit size="sm" variant="ghost">Remove</Submit></ActionForm></li>)}</ul>}
      </Card>
      <Card title="Add field" className="mt-4">
        <ActionForm action={addCustomFieldAction} resetOnSuccess className="space-y-2">
          <input type="hidden" name="entityType" value="company" />
          <Grid cols={3}><Input name="label" label="Label" required /><Select name="fieldType" label="Type" options={["text", "number", "date", "select"].map((t) => ({ value: t, label: t }))} /><Input name="options" label="Options (select only, comma-separated)" /></Grid>
          <Checkbox name="required" label="Required" />
          <Submit size="sm">Add field</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
