import { redirect } from "next/navigation";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { listTeams } from "@/server/services/admin";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { updateSettingsAction } from "@/app/actions/admin";

export const metadata = { title: "Settings" };

export default async function GeneralSettings() {
  const { actor, db, settings: s } = await ctx();
  if (!can(actor, "admin.settings")) { if (can(actor, "audit.view")) redirect("/settings/audit"); if (can(actor, "admin.users")) redirect("/settings/users"); requirePerm(actor, "admin.settings"); }
  const teams = await listTeams(db);
  const w = s.health.weights;
  return (
    <>
      <PageHeader title="General settings" subtitle="All values are configurable defaults — confirm them internally before production use. Changes are audit-logged." />
      <ActionForm action={updateSettingsAction} className="space-y-4">
        <Card title="Organisation & locale"><Grid cols={3}>
          <Input name="orgName" label="Organisation name" defaultValue={s.orgName} />
          <Input name="timezone" label="Time zone (IANA)" defaultValue={s.timezone} hint="e.g. Africa/Lagos, Africa/Nairobi" />
          <Input name="currency" label="Default currency" defaultValue={s.currency} />
          <Input name="currencies" label="Allowed currencies" defaultValue={s.currencies.join(", ")} />
          <Input name="monthlySalesTarget" label="Monthly sales target" defaultValue={s.monthlySalesTarget} inputMode="numeric" />
        </Grid></Card>
        <Card title="Sales rules"><Grid cols={3}>
          <Input name="discountApprovalThreshold" label="Discount approval above (%)" type="number" defaultValue={s.discountApprovalThreshold} />
          <Input name="staleDealDays" label="Default stale-deal days" type="number" defaultValue={s.staleDealDays} />
          <Input name="idleLeadDays" label="Lead idle reminder (days)" type="number" defaultValue={s.idleLeadDays} />
          <Input name="idleLeadEscalateDays" label="Lead idle escalation (days)" type="number" defaultValue={s.idleLeadEscalateDays} />
        </Grid></Card>
        <Card title="Onboarding, support & customer success"><Grid cols={3}>
          <Input name="goLiveTrainingWindowDays" label="Training-gap risk window before go-live (days)" type="number" defaultValue={s.goLiveTrainingWindowDays} />
          <Input name="renewalNoticeDays" label="Renewal review notice (days)" type="number" defaultValue={s.renewalNoticeDays} />
          <Input name="duplicateWindowDays" label="Duplicate-ticket window (days)" type="number" defaultValue={s.duplicateWindowDays} />
          <Select name="defaultTeam" label="Default support queue" defaultValue={s.ticketRouting.defaultTeam} options={teams.filter((t) => t.kind === "support").map((t) => ({ value: t.name, label: t.name }))} />
          <div className="flex flex-col gap-2 pt-6"><Checkbox name="autoAssign" label="Auto-assign tickets to least-loaded agent" defaultChecked={s.ticketRouting.autoAssign} /><Checkbox name="csatOnClose" label="Request CSAT on closure" defaultChecked={s.csatOnClose} /></div>
        </Grid></Card>
        <Card title="Customer health score (weights & thresholds)"><Grid cols={3}>
          <Input name="w_onboarding" label="Onboarding weight" type="number" defaultValue={w.onboarding} /><Input name="w_tickets" label="Support load weight" type="number" defaultValue={w.tickets} />
          <Input name="w_overdue" label="Overdue actions weight" type="number" defaultValue={w.overdue} /><Input name="w_training" label="Training weight" type="number" defaultValue={w.training} />
          <Input name="w_engagement" label="Engagement weight" type="number" defaultValue={w.engagement} /><Input name="w_satisfaction" label="CSAT weight" type="number" defaultValue={w.satisfaction} />
          <Input name="atRiskBelow" label="At Risk below" type="number" defaultValue={s.health.atRiskBelow} /><Input name="watchBelow" label="Watch below" type="number" defaultValue={s.health.watchBelow} />
          <Input name="engagementStaleDays" label="Engagement stale after (days)" type="number" defaultValue={s.health.engagementStaleDays} />
        </Grid></Card>
        <Card title="Billing details (shown on quotes, invoices and SLA agreements)"><Grid cols={3}>
          <Input name="billing_legalName" label="Legal company name" defaultValue={s.billing.legalName} />
          <Input name="billing_rcNumber" label="RC number" defaultValue={s.billing.rcNumber} />
          <Input name="billing_tin" label="Tax ID (TIN)" defaultValue={s.billing.tin} />
          <Textarea name="billing_address" label="Address" defaultValue={s.billing.address} rows={2} />
          <Input name="billing_email" label="Billing email" defaultValue={s.billing.email} />
          <Input name="billing_phone" label="Billing phone" defaultValue={s.billing.phone} />
          <Input name="billing_website" label="Website" defaultValue={s.billing.website} />
          <Input name="billing_vatRate" label="VAT rate (%)" type="number" step="0.5" defaultValue={s.billing.vatRate} />
          <Input name="billing_paymentTermsDays" label="Invoice payment terms (days)" type="number" defaultValue={s.billing.paymentTermsDays} />
          <Input name="billing_quoteValidityDays" label="Quotes valid for (days)" type="number" defaultValue={s.billing.quoteValidityDays} />
          <Input name="billing_bankName" label="Bank name" defaultValue={s.billing.bankName} />
          <Input name="billing_accountName" label="Account name" defaultValue={s.billing.accountName} />
          <Input name="billing_accountNumber" label="Account number" defaultValue={s.billing.accountNumber} />
          <Input name="billing_signatoryName" label="Our signatory (name or role)" defaultValue={s.billing.signatoryName} />
          <Input name="billing_signatoryTitle" label="Signatory line" defaultValue={s.billing.signatoryTitle} />
          <Input name="billing_footer" label="Document footer" defaultValue={s.billing.footer} />
        </Grid></Card>
        <Submit>Save settings</Submit>
      </ActionForm>
    </>
  );
}
