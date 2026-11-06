import type { trainingPrograms } from "@/db/schema";
import { SEGMENTS } from "@/lib/rules/sales";
import { Checkbox, Grid, Input, Select, Submit, Textarea } from "./forms";

export function ProgramFields({ p, products }: { p?: typeof trainingPrograms.$inferSelect; products: { id: string; name: string }[] }) {
  return (
    <div className="space-y-3">
      <Grid>
        <Input name="name" label="Program name" defaultValue={p?.name} required className="sm:col-span-2" />
        <Select name="productId" label="Product" defaultValue={p?.productId ?? ""} placeholder="All products" options={products.map((x) => ({ value: x.id, label: x.name }))} />
        <Input name="audienceRole" label="Audience role" defaultValue={p?.audienceRole ?? ""} required hint="e.g. administrator, finance_user, dispatcher" />
        <Select name="segment" label="Customer segment" defaultValue={p?.segment ?? ""} placeholder="Any" options={SEGMENTS.map((s) => ({ value: s, label: s }))} />
        <Input name="durationMinutes" label="Duration (minutes)" type="number" defaultValue={p?.durationMinutes ?? 120} />
      </Grid>
      <Textarea name="description" label="Description" defaultValue={p?.description ?? ""} rows={2} />
      <Textarea name="objectives" label="Learning objectives (one per line)" defaultValue={p?.objectives.join("\n") ?? ""} rows={3} />
      <Checkbox name="requiredForGoLive" label="Required before go-live" defaultChecked={p?.requiredForGoLive ?? true} hint="Incomplete required training raises onboarding risk." />
      <Submit>{p ? "Save program" : "Create program"}</Submit>
    </div>
  );
}
