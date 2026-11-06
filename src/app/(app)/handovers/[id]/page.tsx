import { customerJourney, relatedFor } from "@/server/services/journey";
import { JourneyTracker, RelatedPanel } from "@/components/related";
import Link from "next/link";
import { ctx, load } from "@/server/page";
import { getHandoverDetail } from "@/server/services/handover";
import { usersInRoles, listTemplates } from "@/server/services/admin";
import { HANDOVER_FIELDS, fieldLabel } from "@/lib/rules/handover";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { stageLabel } from "@/lib/rules/onboarding";
import { Card, KV, Notice, PageHeader, Progress, RiskBadge, StatusBadge, VersionField } from "@/components/ui";
import { ActionForm, Disclosure, Grid, Input, Select, Submit, Textarea } from "@/components/forms";
import { applyCorrectionAction, requestCorrectionAction, reviewHandoverAction, saveHandoverAction } from "@/app/actions/handover";

export default async function HandoverDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const related = await relatedFor(db, actor, "handover", id);
  const journey = related.companyId ? await customerJourney(db, related.companyId) : [];
  const d = await load(() => getHandoverDetail(db, actor, id));
  const { h, deal, company } = d;
  const sections = [...new Set(HANDOVER_FIELDS.map((f) => f.section))];
  const owners = await usersInRoles(db, ["onboarding_manager"]);
  const templates = await listTemplates(db);
  const pendingCorrections = d.reviews.filter((r) => r.action === "correction_requested").filter((r) => !d.reviews.some((x) => x.createdAt > r.createdAt && x.action.startsWith("correction_") && x.action !== "correction_requested"));
  return (
    <>
      <PageHeader title={`Handover: ${deal.name}`} crumbs={[{ href: "/handovers", label: "Handover queue" }]}
        subtitle={<><Link className="hover:underline" href={`/companies/${company.id}`}>{company.name}</Link> · <Link className="hover:underline" href={`/deals/${deal.id}`}>{fmtMoney(deal.amount, deal.currency)} deal</Link></>}
        actions={<StatusBadge status={h.status} />} />
      {h.status === "Changes Requested" && h.reviewComment && <Notice tone="amber" title="Onboarding requested changes">{h.reviewComment}</Notice>}
      {!d.canEdit && ["Accepted by Onboarding", "In Onboarding", "Complete"].includes(h.status) && (
        <Notice tone="green" title="Accepted — read-only for Sales">Accepted {fmtDateTime(h.acceptedAt, tz)}. Changes now require a documented correction, which keeps the previous value in the audit log and notifies the onboarding owner.{h.overrideReason && <> <strong>Accepted with override:</strong> {h.overrideReason}</>}</Notice>
      )}
      {journey.length > 0 && <div className="mb-4"><JourneyTracker steps={journey} /></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Handover checklist" actions={<div className="w-40"><Progress value={h.completeness} label="Required items complete" /></div>}>
            {d.canEdit ? (
              <ActionForm action={saveHandoverAction.bind(null, id)} className="space-y-5"><VersionField at={h.updatedAt} />
                {sections.map((s) => (
                  <fieldset key={s} className="space-y-3"><legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">{s}</legend>
                    <Grid>{HANDOVER_FIELDS.filter((f) => f.section === s).map((f) => f.long
                      ? <Textarea key={f.key} name={f.key} label={f.label} required={f.required} defaultValue={h.checklist[f.key] ?? ""} hint={f.hint} className="sm:col-span-2" rows={3} />
                      : <Input key={f.key} name={f.key} label={f.label} required={f.required} defaultValue={h.checklist[f.key] ?? ""} hint={f.hint} type={f.key === "targetGoLive" || f.key === "startDate" ? "date" : "text"} />)}</Grid>
                  </fieldset>
                ))}
                <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 px-4 py-3">
                  <Submit name="intent" value="save" variant="secondary">Save progress</Submit>
                  <Submit name="intent" value="submit">Submit to onboarding</Submit>
                  <span className="self-center text-xs text-slate-500">{d.missing.length ? `${d.missing.length} required item(s) still missing` : "All required items complete"}</span>
                </div>
              </ActionForm>
            ) : (
              <div className="space-y-5">
                {sections.map((s) => (
                  <section key={s}><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">{s}</h3>
                    <KV items={HANDOVER_FIELDS.filter((f) => f.section === s).map((f) => [<span key="l">{f.label}{f.required && !h.checklist[f.key]?.trim() && <span className="ml-1 text-xs font-semibold text-red-700">MISSING</span>}</span>, <span key="v" className="whitespace-pre-wrap">{h.checklist[f.key] || "—"}</span>])} />
                  </section>
                ))}
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <RelatedPanel groups={related.groups} />
          {d.canReview && (
            <Card title="Onboarding review">
              <ActionForm action={reviewHandoverAction.bind(null, id)} className="space-y-3">
                {d.missing.length > 0 && <Notice tone="red" title={`${d.missing.length} required item(s) missing`}><ul className="list-disc pl-4 text-xs">{d.missing.map((m) => <li key={m}>{fieldLabel(m)}</li>)}</ul></Notice>}
                <Textarea name="comment" label="Review comment" required rows={3} hint="Mandatory for both accept and request changes." />
                <Select name="onboardingOwnerId" label="Onboarding owner" placeholder="Choose…" options={owners.map((u) => ({ value: u.id, label: u.name }))} hint="Required to accept" />
                <Select name="templateId" label="Onboarding template" placeholder="Auto-select by product & segment" options={templates.map((t) => ({ value: t.t.id, label: t.t.name }))} />
                {d.missing.length > 0 && d.canOverride && <Textarea name="overrideReason" label="Manager override reason" rows={2} hint="Only to accept despite missing items. Audit-logged." />}
                <div className="flex flex-wrap gap-2"><Submit name="decision" value="accept">Accept handover</Submit><Submit name="decision" value="changes" variant="secondary">Request changes</Submit></div>
              </ActionForm>
            </Card>
          )}
          {d.canOverrideAccept && !d.canReview && (
            <Card title="Manager override">
              <p className="mb-2 text-xs text-slate-600">Sales has not submitted this handover. Accepting early requires a documented reason and is audit-logged.</p>
              <ActionForm action={reviewHandoverAction.bind(null, id)} className="space-y-3">
                <Textarea name="comment" label="Comment" required rows={2} />
                <Select name="onboardingOwnerId" label="Onboarding owner" placeholder="Choose…" options={owners.map((u) => ({ value: u.id, label: u.name }))} />
                <Textarea name="overrideReason" label="Override reason" required rows={2} />
                <Submit name="decision" value="accept" variant="danger">Accept with override</Submit>
              </ActionForm>
            </Card>
          )}
          {d.project && (
            <Card title="Onboarding project">
              <Link className="text-sm font-medium hover:underline" href={`/onboarding/${d.project.id}`}>{d.project.name}</Link>
              <p className="mt-1 text-xs text-slate-600">{d.project.state === "draft" ? "Draft — starts when the handover is accepted" : stageLabel(d.project.stage)}</p>
              {d.project.state !== "draft" && <div className="mt-2"><RiskBadge level={d.project.riskLevel} /></div>}
            </Card>
          )}
          {d.canRequestCorrection && (
            <Card title="Request a correction">
              <ActionForm action={requestCorrectionAction.bind(null, id)} className="space-y-2" resetOnSuccess>
                <Select name="field" label="Checklist item" required placeholder="Choose…" options={HANDOVER_FIELDS.map((f) => ({ value: f.key, label: f.label }))} />
                <Textarea name="newValue" label="Corrected value" required rows={2} />
                <Textarea name="reason" label="Why" required rows={2} />
                <Submit size="sm">Request correction</Submit>
              </ActionForm>
            </Card>
          )}
          {d.canApplyCorrection && pendingCorrections.map((r) => {
            const c = JSON.parse(r.comment ?? "{}") as { field: string; newValue: string; reason: string };
            return (
              <Card key={r.id} title="Pending correction">
                <KV items={[["Item", fieldLabel(c.field)], ["Current", h.checklist[c.field] ?? "—"], ["Proposed", c.newValue], ["Reason", c.reason], ["By", r.actor]]} />
                <ActionForm action={applyCorrectionAction.bind(null, id, r.id)} className="mt-3 flex gap-2"><Submit size="sm" name="decision" value="apply">Apply</Submit><Submit size="sm" variant="secondary" name="decision" value="decline">Decline</Submit></ActionForm>
              </Card>
            );
          })}
          <Card title="Timeline">
            <ol className="space-y-3 text-sm">
              {d.reviews.map((r) => (
                <li key={r.id}><p className="font-medium capitalize">{r.action.replace(/_/g, " ")}</p><p className="text-xs text-slate-500">{fmtDateTime(r.createdAt, tz)} · {r.actor ?? "System"}</p>
                  {r.comment && !r.action.startsWith("correction_requested") && <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{r.comment}</p>}
                  {r.missingFields && r.missingFields.length > 0 && <p className="text-xs text-red-700">Missing: {r.missingFields.map(fieldLabel).join("; ")}</p>}</li>
              ))}
            </ol>
          </Card>
          <Disclosure label="Deal summary" variant="ghost"><Card><KV items={[["Contract ref.", deal.contractReference], ["Billing", deal.billingFrequency], ["Start", deal.startDate], ["Submitted", fmtDateTime(h.submittedAt, tz)], ["Accepted", fmtDateTime(h.acceptedAt, tz)]]} /></Card></Disclosure>
        </div>
      </div>
    </>
  );
}
