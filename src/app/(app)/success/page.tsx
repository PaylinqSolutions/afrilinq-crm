import Link from "next/link";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { successOverview } from "@/server/services/health";
import { usersInRoles } from "@/server/services/admin";
import { products } from "@/db/schema";
import { stageLabel } from "@/lib/rules/onboarding";
import { fmtDate, fmtMoney, fmtRelative } from "@/lib/format";
import { Badge, Card, EmptyState, HealthBadge, PageHeader, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { ActionForm, Disclosure, Grid, Input, Select, Submit } from "@/components/forms";
import { addExpansionAction, upsertRenewalAction } from "@/app/actions/success";

export const metadata = { title: "Customer success" };

export default async function SuccessPage() {
  const { actor, db, tz, settings } = await ctx();
  requirePerm(actor, "success.view");
  const rows = (await successOverview(db)).sort((a, b) => (a.health?.score ?? 101) - (b.health?.score ?? 101));
  const owners = await usersInRoles(db, ["onboarding_manager", "sales_executive", "sales_manager"]);
  const ps = await db.select({ id: products.id, name: products.name }).from(products);
  const manage = can(actor, "success.manage");
  return (
    <>
      <PageHeader title="Customer success" subtitle="Active customers ordered by health. Health is an explainable score from onboarding, support load, overdue actions, training, engagement and CSAT — open an account to see the factors." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="At risk" value={rows.filter((r) => r.health?.status === "at_risk").length} tone="red" href="/reports/records?m=accounts_at_risk" />
        <Stat label="Watch" value={rows.filter((r) => r.health?.status === "watch").length} tone="amber" />
        <Stat label="Renewals next 90d" value={rows.filter((r) => r.renewal && Date.parse(r.renewal.renewalDate) - Date.now() < 90 * 86400000).length} href="/reports/records?m=renewals_90" />
        <Stat label="Open expansion" value={fmtMoney(rows.flatMap((r) => r.expansions).reduce((s, x) => s + (x.estimatedValue ?? 0), 0), settings.currency, true)} />
      </div>
      <Card pad={false}>
        <Table head={["Customer", "Health", "Onboarding", "Open tickets", "Last contact", "Next touchpoint", "Renewal", "Expansion", "Billing"]} empty={<EmptyState title="No active customers" />}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td><Link className="font-medium hover:underline" href={`/companies/${r.id}`}>{r.name}</Link><div className="text-xs text-slate-500">{r.segment} · {r.tier} · CSM {r.csm ?? "—"}</div></Td>
              <Td><HealthBadge status={r.health?.status} score={r.health?.score} />{r.health && !r.health.reviewedAt && r.health.status === "at_risk" && <div className="text-xs text-red-700">Review needed</div>}</Td>
              <Td className="text-xs">{r.onboarding ? (r.onboarding.state === "completed" ? `Live since ${fmtDate(r.onboarding.actualGoLive, tz)}` : stageLabel(r.onboarding.stage)) : "—"}</Td>
              <Td className="tabular-nums">{r.openTickets.n}{r.openTickets.p12 > 0 && <Badge tone="orange">{r.openTickets.p12} P1/P2</Badge>}</Td>
              <Td className="text-xs">{r.lastContact ? fmtRelative(r.lastContact) : "Never"}</Td>
              <Td className="text-xs">{r.nextTouch ? fmtDate(r.nextTouch, tz) : <span className="text-amber-700">None planned</span>}</Td>
              <Td className="text-xs">{r.renewal ? <>{fmtDate(r.renewal.renewalDate, tz)}<div>{fmtMoney(r.renewal.amount, r.renewal.currency)}</div></> : "—"}</Td>
              <Td className="text-xs">{r.expansions.map((x) => <div key={x.id}>{x.description} <StatusBadge status={x.status} map={{ identified: "blue", qualified: "green" }} /></div>)}</Td>
              <Td>{r.billingStatus ? <StatusBadge status={r.billingStatus} map={{ current: "green", overdue: "amber", unpaid: "red" }} /> : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      {manage && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Disclosure label="Add / update renewal"><Card>
            <ActionForm action={upsertRenewalAction} resetOnSuccess className="space-y-2">
              <Grid><Select name="companyId" label="Customer" required placeholder="Choose…" options={rows.map((r) => ({ value: r.id, label: r.name }))} /><Input name="renewalDate" label="Renewal date" type="date" required />
                <Input name="amount" label="Value" inputMode="decimal" /><Select name="status" label="Status" options={["upcoming", "in_progress", "renewed", "churned"].map((s) => ({ value: s, label: s }))} />
                <Select name="ownerId" label="Owner" placeholder="—" options={owners.map((u) => ({ value: u.id, label: u.name }))} /><Input name="notes" label="Notes" /></Grid>
              <Submit size="sm">Save renewal</Submit>
            </ActionForm>
          </Card></Disclosure>
          <Disclosure label="Add cross-sell / upsell opportunity"><Card>
            <ActionForm action={addExpansionAction} resetOnSuccess className="space-y-2">
              <Grid><Select name="companyId" label="Customer" required placeholder="Choose…" options={rows.map((r) => ({ value: r.id, label: r.name }))} /><Select name="productId" label="Product" placeholder="—" options={ps.map((p) => ({ value: p.id, label: p.name }))} />
                <Select name="kind" label="Type" options={[{ value: "upsell", label: "Upsell" }, { value: "cross_sell", label: "Cross-sell" }]} /><Input name="estimatedValue" label="Estimated value" inputMode="decimal" />
                <Input name="description" label="Description" required className="sm:col-span-2" /></Grid>
              <Submit size="sm">Add opportunity</Submit>
            </ActionForm>
          </Card></Disclosure>
        </div>
      )}
    </>
  );
}
