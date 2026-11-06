import type { deals } from "@/db/schema";
import { BILLING_FREQUENCIES, FORECAST_CATEGORIES } from "@/lib/rules/sales";
import { Grid, Input, Select, Submit } from "./forms";

export function DealFields({ d, companies, contacts, users, currencies, canReassign, locked }: {
  d?: typeof deals.$inferSelect; companies: { id: string; name: string }[]; contacts: { id: string; firstName: string; lastName: string; companyName?: string | null }[];
  users: { id: string; name: string }[]; currencies: string[]; canReassign: boolean; locked?: boolean;
}) {
  return (
    <div className="space-y-4">
      {locked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Commercial fields are locked on Closed Won deals. Corrections go through the handover.</p>}
      <Grid>
        <Input name="name" label="Deal name" defaultValue={d?.name} required className="sm:col-span-2" />
        <Select name="companyId" label="Company" defaultValue={d?.companyId} required placeholder="Choose…" options={companies.map((c) => ({ value: c.id, label: c.name }))} />
        <Select name="primaryContactId" label="Primary contact" defaultValue={d?.primaryContactId ?? ""} placeholder="—" options={contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}${c.companyName ? ` (${c.companyName})` : ""}` }))} />
        <Input name="amount" label="Deal value" inputMode="decimal" defaultValue={d?.amount ?? ""} readOnly={locked} />
        <Select name="currency" label="Currency" defaultValue={d?.currency ?? "NGN"} options={currencies.map((c) => ({ value: c, label: c }))} />
        <Input name="expectedCloseDate" label="Expected close date" type="date" defaultValue={d?.expectedCloseDate ?? ""} />
        <Input name="probabilityOverride" label="Probability override (%)" type="number" min={0} max={100} defaultValue={d?.probabilityOverride ?? ""} hint="Leave empty to use the stage probability" />
        <Input name="nextStep" label="Next step" defaultValue={d?.nextStep ?? ""} required={!locked} />
        <Input name="nextStepDue" label="Next step due" type="date" defaultValue={d?.nextStepDue ?? ""} required={!locked} />
        <Select name="forecastCategory" label="Forecast category" defaultValue={d?.forecastCategory ?? "pipeline"} options={FORECAST_CATEGORIES.map((f) => ({ value: f.key, label: f.label }))} />
        <Input name="competitor" label="Competitor" defaultValue={d?.competitor ?? ""} />
        <Input name="discountPct" label="Discount (%)" type="number" step="0.5" min={0} max={100} defaultValue={d?.discountPct ?? ""} readOnly={locked} hint="Above the threshold requires manager approval" />
        <Input name="contractReference" label="Signed agreement / approval ref." defaultValue={d?.contractReference ?? ""} readOnly={locked} />
        <Select name="billingFrequency" label="Billing frequency" defaultValue={d?.billingFrequency ?? ""} placeholder="—" options={BILLING_FREQUENCIES.map((b) => ({ value: b, label: b }))} />
        <Input name="startDate" label="Agreed start date" type="date" defaultValue={d?.startDate ?? ""} readOnly={locked} />
        {canReassign ? <Select name="ownerId" label="Owner" defaultValue={d?.ownerId ?? ""} placeholder="Me" options={users.map((u) => ({ value: u.id, label: u.name }))} /> : <input type="hidden" name="ownerId" value={d?.ownerId ?? ""} />}
      </Grid>
      <Submit>{d ? "Save deal" : "Create deal"}</Submit>
    </div>
  );
}
