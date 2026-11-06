import type { leads } from "@/db/schema";
import { LEAD_SOURCES, LEAD_STATUSES, SEGMENTS, REGIONS } from "@/lib/rules/sales";
import { Grid, Input, Select, Submit, Textarea } from "./forms";
import { toLocalInput } from "@/lib/format";

type Lead = typeof leads.$inferSelect;

export function LeadFields({ lead, users, products, canAssign }: { lead?: Lead; users: { id: string; name: string }[]; products: { id: string; name: string }[]; canAssign: boolean }) {
  const q = lead?.qualification ?? {};
  return (
    <div className="space-y-4">
      <Grid>
        <Input name="name" label="Lead name" defaultValue={lead?.name} required placeholder="e.g. Payroll for 350 staff" />
        <Input name="organization" label="Organisation (optional)" defaultValue={lead?.organization ?? ""} hint="Leave blank for an individual. You can link a company when you convert." />
        <Input name="contactName" label="Primary contact" defaultValue={lead?.contactName} required />
        <Input name="email" label="Email" type="email" defaultValue={lead?.email ?? ""} />
        <Input name="phone" label="Phone / WhatsApp" defaultValue={lead?.phone ?? ""} />
        <Select name="source" label="Lead source" defaultValue={lead?.source} required placeholder="Choose…" options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} />
        <Select name="status" label="Status" defaultValue={lead?.status ?? "New"} options={LEAD_STATUSES.filter((s) => s !== "Converted").map((s) => ({ value: s, label: s }))} />
        <Select name="productInterestId" label="Product / service interest" defaultValue={lead?.productInterestId ?? ""} placeholder="—" options={products.map((p) => ({ value: p.id, label: p.name }))} />
        <Select name="segment" label="Segment" defaultValue={lead?.segment ?? ""} placeholder="—" options={SEGMENTS.map((s) => ({ value: s, label: s }))} />
        <Select name="region" label="Region / territory" defaultValue={lead?.region ?? ""} placeholder="—" options={REGIONS.map((s) => ({ value: s, label: s }))} />
        {canAssign ? <Select name="ownerId" label="Owner" defaultValue={lead?.ownerId ?? ""} placeholder="Auto-assign (rule)" options={users.map((u) => ({ value: u.id, label: u.name }))} /> : <input type="hidden" name="ownerId" value={lead?.ownerId ?? ""} />}
        <Input name="nextAction" label="Next action" defaultValue={lead?.nextAction ?? ""} required />
        <Input name="nextActionDue" label="Next action due" type="datetime-local" defaultValue={toLocalInput(lead?.nextActionDue)} />
        <Input name="disqualifyReason" label="Disqualification reason" defaultValue={lead?.disqualifyReason ?? ""} hint="Required if status is Disqualified" />
      </Grid>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-700">Qualification</legend>
        <Grid>
          <Textarea name="need" label="Need" defaultValue={q.need ?? ""} rows={2} />
          <Textarea name="painPoints" label="Major pain points" defaultValue={q.painPoints ?? ""} rows={2} />
          <Textarea name="fit" label="Fit" defaultValue={q.fit ?? ""} rows={2} />
          <Textarea name="timing" label="Timing" defaultValue={q.timing ?? ""} rows={2} />
          <Textarea name="decisionProcess" label="Decision process" defaultValue={q.decisionProcess ?? ""} rows={2} />
          <Textarea name="budget" label="Budget / buying readiness" defaultValue={q.budget ?? ""} rows={2} />
        </Grid>
      </fieldset>
      <Submit>{lead ? "Save lead" : "Create lead"}</Submit>
    </div>
  );
}
