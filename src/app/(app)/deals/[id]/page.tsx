import { customerJourney, relatedFor } from "@/server/services/journey";
import { JourneyTracker, RelatedPanel } from "@/components/related";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ctx, load } from "@/server/page";
import { can } from "@/server/actor";
import { getDealDetail, getStages } from "@/server/services/sales";
import { activitiesFor, tasksForRecord } from "@/server/services/activities";
import { listCompanies, listContacts } from "@/server/services/accounts";
import { simpleUsers, usersInRoles } from "@/server/services/admin";
import { activities, handoverRecords, products } from "@/db/schema";
import { DEAL_REQUIRABLE_FIELDS, CLOSED_WON_REQUIRED, LOSS_REASONS, effectiveProbability, weighted } from "@/lib/rules/sales";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { Badge, Card, KV, Notice, PageHeader, Progress, StatusBadge, Table, Td, VersionField } from "@/components/ui";
import { ActionForm, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { DealFields } from "@/components/deal-form";
import { ActivityForm, NewTaskForm, TaskList, Timeline } from "@/components/records";
import { decideDiscountAction, moveStageAction, setDealProductsAction, updateDealAction } from "@/app/actions/crm";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db } = await ctx();
  try { return { title: (await getDealDetail(db, actor, id)).deal.name }; } catch { return { title: "Deal" }; }
}

export default async function DealDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz, settings } = await ctx();
  const related = await relatedFor(db, actor, "deal", id);
  const journey = related.companyId ? await customerJourney(db, related.companyId) : [];
  const d = await load(() => getDealDetail(db, actor, id));
  const { deal, stage, company } = d;
  const stages = await getStages(db, deal.pipelineId);
  const acts = await activitiesFor(db, eq(activities.dealId, id));
  const ts = await tasksForRecord(db, "deal", id);
  const [handover] = await db.select().from(handoverRecords).where(eq(handoverRecords.dealId, id));
  const ps = await db.select().from(products).where(eq(products.active, true));
  const prob = effectiveProbability(stage.probability, deal.probabilityOverride);
  const editable = can(actor, "deals.edit");
  const daysInStage = Math.floor((Date.now() - deal.stageEnteredAt.getTime()) / 86400000);
  const lineTotal = d.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const wonReqs = CLOSED_WON_REQUIRED.map((f) => ({ f, label: DEAL_REQUIRABLE_FIELDS[f], ok: f === "products" ? d.lines.length > 0 : f === "amount" ? (deal.amount ?? 0) > 0 : !!(deal as Record<string, unknown>)[f] }));
  const { rows: cos } = await listCompanies(db, actor, {}, true);
  const { rows: cs } = await listContacts(db, actor, { company: deal.companyId }, true);
  return (
    <>
      <PageHeader title={deal.name} crumbs={[{ href: "/deals", label: "Deals" }]}
        subtitle={<><Link href={`/companies/${company.id}`} className="hover:underline">{company.name}</Link> · Owner {d.owner?.name} · {daysInStage} day(s) in stage</>}
        actions={<><Badge tone={stage.isWon ? "green" : stage.isLost ? "gray" : "blue"}>{stage.name}</Badge>{stage.isWon && handover && !["Accepted by Onboarding", "In Onboarding", "Complete"].includes(handover.status) && <Badge tone="amber">Handover Incomplete</Badge>}</>} />
      {stage.isWon && handover && (
        <Notice tone={["Accepted by Onboarding", "In Onboarding", "Complete"].includes(handover.status) ? "green" : "amber"} title="Closed-won handover">
          Handover status: <strong>{handover.status}</strong> ({handover.completeness}% of required items). <Link className="font-medium underline" href={`/handovers/${handover.id}`}>Open the handover</Link>
        </Notice>
      )}
      {deal.discountStatus === "pending" && (
        <Notice tone="amber" title="Discount awaiting approval">{deal.discountPct}% exceeds the {settings.discountApprovalThreshold}% threshold. The deal cannot close won until a manager approves.
          {can(actor, "deals.approve_discount") && (
            <ActionForm action={decideDiscountAction.bind(null, id)} className="mt-2 flex flex-wrap items-end gap-2">
              <Input name="comment" label="Comment" className="min-w-[14rem]" /><Submit size="sm" name="decision" value="approve">Approve</Submit><Submit size="sm" variant="danger" name="decision" value="reject">Reject</Submit>
            </ActionForm>
          )}
        </Notice>
      )}
      {journey.length > 0 && <div className="mb-4"><JourneyTracker steps={journey} /></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Pipeline stage">
            <ol className="mb-4 flex flex-wrap gap-1" aria-label="Stages">
              {stages.map((s) => <li key={s.id}><span className={`inline-block rounded px-2 py-1 text-xs ${s.id === stage.id ? "bg-brand-600 font-semibold text-white" : s.position < stage.position ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-600"}`} aria-current={s.id === stage.id ? "step" : undefined}>{s.name}</span></li>)}
            </ol>
            {editable && !stage.isWon && (
              <ActionForm action={moveStageAction.bind(null, id)} className="space-y-3"><VersionField at={deal.updatedAt} />
                <Grid>
                  <Select name="stageId" label="Move to stage" required options={stages.filter((s) => s.id !== stage.id).map((s) => ({ value: s.id, label: `${s.name} (${s.probability}%)` }))} />
                  <Select name="lossReason" label="Loss reason (for Closed Lost)" placeholder="—" options={LOSS_REASONS.map((r) => ({ value: r, label: r }))} />
                  <Textarea name="lossNotes" label="Loss notes" rows={2} className="sm:col-span-2" />
                </Grid>
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  <p className="mb-1 font-semibold">Closed Won requires</p>
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">{wonReqs.map((r) => <li key={r.f} className={r.ok ? "text-emerald-800" : "text-red-700"}>{r.ok ? "✓" : "✗"} {r.ok ? r.label : <a href={r.f === "products" ? "#products" : "#deal-details"} className="underline">{r.label} — {r.f === "products" ? "add below" : "fill in"}</a>}</li>)}
                    <li className={deal.discountStatus === "pending" ? "text-red-700" : "text-emerald-800"}>{deal.discountStatus === "pending" ? "✗" : "✓"} No unapproved discount</li></ul>
                </div>
                <Submit>Move deal</Submit>
              </ActionForm>
            )}
            {stage.exitCriteria && <p className="mt-3 text-xs text-slate-500"><span className="font-medium">Exit criteria for {stage.name}:</span> {stage.exitCriteria}</p>}
          </Card>
          <Card id="products" title="Products & services" actions={<span className="text-xs text-slate-500">Line total {fmtMoney(lineTotal, deal.currency)}</span>}>
            {editable && !stage.isWon ? (
              <ActionForm action={setDealProductsAction.bind(null, id)} className="space-y-2"><VersionField at={deal.updatedAt} />
                {[...d.lines, { id: "new", productId: "", name: "", code: "", quantity: 1, unitPrice: 0 }].map((l, i) => (
                  <div key={l.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_6rem_9rem]">
                    <Select name="productId" label={i === 0 ? "Product" : <span className="sr-only">Product</span>} defaultValue={l.productId} placeholder={l.id === "new" ? "Add product…" : "Remove"} options={ps.map((p) => ({ value: p.id, label: p.name }))} />
                    <Input name="quantity" label={i === 0 ? "Qty" : <span className="sr-only">Qty</span>} type="number" min={1} defaultValue={l.quantity} />
                    <Input name="unitPrice" label={i === 0 ? "Unit price" : <span className="sr-only">Unit price</span>} inputMode="decimal" defaultValue={l.unitPrice || ""} />
                  </div>
                ))}
                <Submit size="sm" variant="secondary">Save products</Submit>
              </ActionForm>
            ) : (
              <Table head={["Product", "Qty", "Unit price", "Total"]}>{d.lines.map((l) => <tr key={l.id}><Td>{l.name}</Td><Td>{l.quantity}</Td><Td>{fmtMoney(l.unitPrice, deal.currency)}</Td><Td>{fmtMoney(l.unitPrice * l.quantity, deal.currency)}</Td></tr>)}</Table>
            )}
          </Card>
          <Card title="Activity" actions={can(actor, "activities.log") ? <ActivityForm link={{ dealId: id }} contacts={cs} /> : undefined}>
            <Timeline tz={tz} items={acts.map((a) => ({ at: a.occurredAt, kind: a.type, title: a.subject, detail: [a.outcome, a.body].filter(Boolean).join(" — "), by: a.by, simulated: a.simulated }))} />
          </Card>
          {editable && <div id="deal-details" className="scroll-mt-20">{!cs.length && <Notice tone="amber" title="No contacts at this company yet">A primary contact is required to close this deal. <Link className="font-medium underline" href={`/contacts/new?company=${company.id}`}>Add a contact to {company.name}</Link>, then pick them below.</Notice>}<Disclosure label="Edit deal details (amount, primary contact, agreement, billing, start date)" defaultOpen={!stage.isWon && wonReqs.some((r) => !r.ok && r.f !== "products")}><Card><ActionForm action={updateDealAction.bind(null, id)}><VersionField at={deal.updatedAt} /><DealFields d={deal} companies={cos} contacts={cs} users={await usersInRoles(db, ["sales_executive", "sales_manager"])} currencies={settings.currencies} canReassign={can(actor, "deals.reassign")} locked={stage.isWon} /></ActionForm></Card></Disclosure></div>}
        </div>
        <div className="space-y-4">
          <RelatedPanel groups={related.groups} />
          <Card title="Forecast">
            <KV items={[["Value", fmtMoney(deal.amount, deal.currency)], ["Probability", `${prob}%${deal.probabilityOverride !== null ? " (override)" : ""}`], ["Weighted", fmtMoney(weighted(deal.amount, prob), deal.currency)], ["Expected close", fmtDate(deal.expectedCloseDate, tz)], ["Next step", deal.nextStep], ["Next step due", fmtDate(deal.nextStepDue, tz)], ["Discount", deal.discountPct ? <span key="d">{deal.discountPct}% <StatusBadge status={deal.discountStatus} map={{ approved: "green", pending: "amber", rejected: "red", none: "gray" }} /></span> : "None"], ["Competitor", deal.competitor], ["Contract ref.", deal.contractReference], ["Billing", deal.billingFrequency], ["Start date", fmtDate(deal.startDate, tz)], ...(stage.isLost ? [["Loss reason", deal.lossReason], ["Loss notes", deal.lossNotes]] as [string, string | null][] : [])]} />
          </Card>
          <Card title="Contacts on this deal"><ul className="space-y-1 text-sm">{d.contacts.map((c) => <li key={c.id}><Link className="hover:underline" href={`/contacts/${c.id}`}>{c.firstName} {c.lastName}</Link> <span className="text-xs text-slate-500">{c.role}</span></li>)}</ul></Card>
          <Card title="Tasks"><TaskList tasks={ts} tz={tz} compact /><div className="mt-3"><Disclosure label="Add task"><NewTaskForm users={await simpleUsers(db)} link={{ relatedType: "deal", relatedId: id, companyId: deal.companyId }} /></Disclosure></div></Card>
          <Card title="Stage history">
            <ol className="space-y-2 text-sm">{d.history.map((h) => <li key={h.id}><span className="font-medium">{h.toStage}</span><p className="text-xs text-slate-500">{fmtDateTime(h.changedAt, tz)} · {h.by ?? "System"}{h.durationSeconds ? ` · previous stage ${Math.round(h.durationSeconds / 86400)}d` : ""}</p></li>)}</ol>
          </Card>
          {handover && <Card title="Handover"><Progress value={handover.completeness} label="Handover completeness" /></Card>}
        </div>
      </div>
    </>
  );
}
