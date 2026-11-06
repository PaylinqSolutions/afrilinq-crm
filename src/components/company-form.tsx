import type { companies } from "@/db/schema";
import { SEGMENTS, TIERS, REGIONS } from "@/lib/rules/sales";
import { Grid, Input, Select, Submit, Textarea } from "./forms";

export function CompanyFields({ c, users }: { c?: typeof companies.$inferSelect; users: { id: string; name: string }[] }) {
  return (
    <div className="space-y-4">
      <Grid>
        <Input name="name" label="Company name" defaultValue={c?.name} required />
        <Input name="industry" label="Industry" defaultValue={c?.industry ?? ""} />
        <Select name="segment" label="Segment" defaultValue={c?.segment ?? "SME"} options={SEGMENTS.map((s) => ({ value: s, label: s }))} required />
        <Select name="tier" label="Customer tier" defaultValue={c?.tier ?? "Standard"} options={TIERS.map((s) => ({ value: s, label: s }))} required hint="Tier selects the SLA policy." />
        <Select name="lifecycle" label="Lifecycle" defaultValue={c?.lifecycle ?? "prospect"} options={[{ value: "prospect", label: "Prospect" }, { value: "customer", label: "Customer" }, { value: "churned", label: "Churned" }]} required />
        <Select name="region" label="Region" defaultValue={c?.region ?? ""} placeholder="—" options={REGIONS.map((s) => ({ value: s, label: s }))} />
        <Input name="city" label="City" defaultValue={c?.city ?? ""} />
        <Input name="phone" label="Phone" defaultValue={c?.phone ?? ""} />
        <Input name="website" label="Website" defaultValue={c?.website ?? ""} />
        <Input name="address" label="Address" defaultValue={c?.address ?? ""} />
        <Select name="ownerId" label="Account owner" defaultValue={c?.ownerId ?? ""} placeholder="Me" options={users.map((u) => ({ value: u.id, label: u.name }))} />
        <Select name="csmId" label="Customer success owner" defaultValue={c?.csmId ?? ""} placeholder="—" options={users.map((u) => ({ value: u.id, label: u.name }))} />
      </Grid>
      <Textarea name="notes" label="Notes" defaultValue={c?.notes ?? ""} />
      <Submit>{c ? "Save company" : "Create company"}</Submit>
    </div>
  );
}
