"use client";

import { useState } from "react";
import { IMPACTS, INCIDENT_TYPES, PRIORITIES, TICKET_CATEGORIES, URGENCIES, classifyPriority } from "@/lib/rules/tickets";
import { Checkbox, Grid, Input, Select, Textarea } from "./forms";

type Init = { category?: string; subcategory?: string | null; impact?: string; urgency?: string; workaroundAvailable?: boolean; workaround?: string | null; affectedUsers?: number | null; businessImpact?: string | null; incidentType?: string | null; productId?: string | null };

/** Triage inputs with a live preview of the impact × urgency priority. The server recalculates authoritatively. */
export function TriageFields({ init = {}, products }: { init?: Init; products: { id: string; name: string }[] }) {
  const [impact, setImpact] = useState(init.impact ?? "single_user");
  const [urgency, setUrgency] = useState(init.urgency ?? "medium");
  const [workaround, setWorkaround] = useState(!!init.workaroundAvailable);
  const [incident, setIncident] = useState(init.incidentType ?? "");
  const [category, setCategory] = useState(init.category ?? "How-to / Training");
  const p = classifyPriority({ impact, urgency, workaroundAvailable: workaround, incidentType: incident || null });
  const meta = PRIORITIES.find((x) => x.key === p)!;
  const high = p === "P1" || p === "P2";
  return (
    <div className="space-y-3">
      <Grid>
        <Select name="productId" label="Affected product" required defaultValue={init.productId ?? ""} placeholder="Choose…" options={products.map((x) => ({ value: x.id, label: x.name }))} />
        <Select name="category" label="Category" required value={category} onChange={(e) => setCategory(e.target.value)} options={Object.keys(TICKET_CATEGORIES).map((c) => ({ value: c, label: c }))} />
        <Select name="subcategory" label="Subcategory" defaultValue={init.subcategory ?? ""} placeholder="—" options={(TICKET_CATEGORIES[category] ?? []).map((c) => ({ value: c, label: c }))} />
        <Input name="affectedUsers" label="Affected users (approx.)" type="number" min={0} defaultValue={init.affectedUsers ?? ""} />
        <Select name="impact" label="Impact" required value={impact} onChange={(e) => setImpact(e.target.value)} options={IMPACTS.map((i) => ({ value: i.key, label: i.label }))} />
        <Select name="urgency" label="Urgency" required value={urgency} onChange={(e) => setUrgency(e.target.value)} options={URGENCIES.map((i) => ({ value: i.key, label: i.label }))} />
      </Grid>
      <div onChange={(e) => { const t = e.target as HTMLInputElement; if (t.name === "workaroundAvailable") setWorkaround(t.checked); }}>
        <Checkbox name="workaroundAvailable" label="A reasonable workaround exists" defaultChecked={workaround} />
      </div>
      {workaround && <Textarea name="workaround" label="Workaround" defaultValue={init.workaround ?? ""} rows={2} />}
      <Select name="incidentType" label="Suspected incident type" value={incident} onChange={(e) => setIncident(e.target.value)} placeholder="Not an incident" options={INCIDENT_TYPES.map((i) => ({ value: i.key, label: i.label }))} hint="Security, data exposure, outage or data loss always start the P1 incident workflow." />
      <Textarea name="businessImpact" label="Business impact" defaultValue={init.businessImpact ?? ""} rows={2} required={high || !!incident} hint={high ? "Required for P1/P2: what is blocked, for whom, and the business consequence." : undefined} />
      <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${p === "P1" ? "border-red-300 bg-red-50 text-red-900" : p === "P2" ? "border-orange-300 bg-orange-50 text-orange-900" : "border-slate-200 bg-slate-50 text-slate-800"}`}>
        Calculated priority: <strong>{meta.label}</strong> — {meta.description} Priority is set from impact and urgency, not from tone.
      </div>
    </div>
  );
}
