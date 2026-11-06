import type { contacts } from "@/db/schema";
import { CONTACT_ROLES } from "@/lib/rules/sales";
import { CONTACT_LEAD_STATUSES, DEFAULT_REFERRAL_SOURCES, LIFECYCLE_STAGES } from "@/lib/rules/contacts";
import { Checkbox, Grid, Input, Select, Submit } from "./forms";

export function ContactFields({ c, companies, users, sources = DEFAULT_REFERRAL_SOURCES }: { c?: typeof contacts.$inferSelect; companies: { id: string; name: string }[]; users?: { id: string; name: string }[]; sources?: string[] }) {
  const srcs = [...new Set([...sources, ...(c?.referralSource ? [c.referralSource] : [])])];
  return (
    <div className="space-y-4">
      <Grid>
        <Input name="firstName" label="First name" defaultValue={c?.firstName} required />
        <Input name="lastName" label="Last name" defaultValue={c?.lastName} required />
        <Select name="companyId" label="Company" defaultValue={c?.companyId ?? ""} placeholder="—" options={companies.map((x) => ({ value: x.id, label: x.name }))} />
        <Input name="jobTitle" label="Job title" defaultValue={c?.jobTitle ?? ""} />
        <Input name="email" label="Email" type="email" defaultValue={c?.email ?? ""} />
        <Input name="phone" label="Phone" defaultValue={c?.phone ?? ""} />
        <Input name="whatsapp" label="WhatsApp" defaultValue={c?.whatsapp ?? ""} />
        <Input name="city" label="City" defaultValue={c?.city ?? ""} />
        <Select name="leadStatus" label="Lead status" defaultValue={c?.leadStatus ?? ""} placeholder="—" options={CONTACT_LEAD_STATUSES.map((x) => ({ value: x.key, label: x.label }))} />
        <Select name="lifecycleStage" label="Lifecycle stage" defaultValue={c?.lifecycleStage ?? "lead"} options={LIFECYCLE_STAGES.map((x) => ({ value: x.key, label: x.label }))} />
        <Select name="referralSource" label="Referral source" defaultValue={c?.referralSource ?? ""} placeholder="—" options={srcs.map((x) => ({ value: x, label: x }))} />
        {users && <Select name="ownerId" label="Contact owner" defaultValue={c?.ownerId ?? ""} placeholder="Unassigned" options={users.map((u) => ({ value: u.id, label: u.name }))} />}
        <Select name="preferredChannel" label="Preferred channel" defaultValue={c?.preferredChannel ?? ""} placeholder="—" options={[{ value: "email", label: "Email" }, { value: "phone", label: "Phone" }, { value: "whatsapp", label: "WhatsApp" }]} />
      </Grid>
      <fieldset><legend className="mb-1 text-sm font-medium text-slate-700">Contact roles</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{CONTACT_ROLES.map((r) => <Checkbox key={r.key} name="contactRoles" value={r.key} label={r.label} defaultChecked={c?.contactRoles.includes(r.key)} />)}</div>
      </fieldset>
      <Checkbox name="marketingConsent" label="Consents to marketing communication" defaultChecked={c?.marketingConsent} hint="Record consent before sending marketing messages." />
      <Submit>{c ? "Save contact" : "Create contact"}</Submit>
    </div>
  );
}
