export const LEAD_STATUSES = [
  "New", "Attempting Contact", "Contacted", "Qualified", "Demo/Discovery Scheduled", "Nurturing", "Disqualified", "Converted",
] as const;
export const LEAD_SOURCES = [
  "Website", "Referral", "Partner", "Trade Event", "Outbound Call", "LinkedIn", "WhatsApp Inquiry", "Existing Customer", "Tender",
];
export const SEGMENTS = ["SME", "Mid-Market", "Enterprise", "Public Sector"];
export const TIERS = ["Standard", "Premium", "Strategic"];
export const REGIONS = ["Lagos", "Abuja (FCT)", "South-South", "South-East", "North", "South-West (ex-Lagos)", "Ghana", "Kenya"];
export const CONTACT_ROLES = [
  { key: "decision_maker", label: "Decision-maker" }, { key: "champion", label: "Champion" },
  { key: "billing", label: "Billing contact" }, { key: "technical", label: "Technical contact" },
  { key: "training_coordinator", label: "Training coordinator" }, { key: "end_user", label: "End user" },
];
export const ACTIVITY_TYPES = [
  { key: "call", label: "Call" }, { key: "email", label: "Email" }, { key: "meeting", label: "Meeting" },
  { key: "demo", label: "Demo" }, { key: "proposal", label: "Proposal sent" }, { key: "note", label: "Note" },
  { key: "whatsapp", label: "WhatsApp" }, { key: "other", label: "Other" },
];
export const LOSS_REASONS = [
  "Price / budget", "Chose competitor", "No decision / stalled", "Missing feature", "Timing", "Procurement / compliance", "Lost contact",
];
export const FORECAST_CATEGORIES = [
  { key: "pipeline", label: "Pipeline" }, { key: "best_case", label: "Best case" }, { key: "commit", label: "Commit" },
  { key: "closed", label: "Closed" }, { key: "omitted", label: "Omitted" },
];
export const BILLING_FREQUENCIES = ["One-off", "Monthly", "Quarterly", "Annually", "Multi-year"];

/** Deal fields an admin can mark as required on entry to a stage. */
export const DEAL_REQUIRABLE_FIELDS: Record<string, string> = {
  amount: "Deal value",
  expectedCloseDate: "Expected close date",
  primaryContactId: "Primary contact",
  products: "At least one product/service",
  nextStep: "Next step",
  nextStepDue: "Next step due date",
  competitor: "Competitor",
  contractReference: "Signed agreement / approval reference",
  billingFrequency: "Billing frequency",
  startDate: "Agreed start date",
  lossReason: "Loss reason",
};

/** Always required to close won, regardless of stage configuration. */
export const CLOSED_WON_REQUIRED = ["amount", "primaryContactId", "products", "contractReference", "billingFrequency", "startDate"];

export type DealForValidation = {
  amount: number | null; expectedCloseDate: string | null; primaryContactId: string | null; nextStep: string | null;
  nextStepDue: string | null; competitor: string | null; contractReference: string | null; billingFrequency: string | null;
  startDate: string | null; lossReason: string | null; discountPct: number | null; discountStatus: string; productCount: number;
};
export type StageForValidation = { name: string; isWon: boolean; isLost: boolean; requiredFields: string[] };

function filled(d: DealForValidation, field: string) {
  if (field === "products") return d.productCount > 0;
  if (field === "amount") return (d.amount ?? 0) > 0;
  const v = (d as Record<string, unknown>)[field];
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** Validates moving a deal into `stage`. Returns field → message for everything that blocks the move. */
export function validateStageEntry(d: DealForValidation, stage: StageForValidation, discountThreshold: number) {
  const errors: Record<string, string> = {};
  const req = new Set(stage.requiredFields);
  if (stage.isWon) CLOSED_WON_REQUIRED.forEach((f) => req.add(f));
  if (stage.isLost) req.add("lossReason");
  if (!stage.isWon && !stage.isLost) { req.add("nextStep"); req.add("nextStepDue"); }
  for (const f of req) {
    if (stage.isLost && f !== "lossReason") continue; // losing a deal only needs the reason
    if (!filled(d, f)) errors[f] = `${DEAL_REQUIRABLE_FIELDS[f] ?? f} is required for “${stage.name}”.`;
  }
  if (stage.isWon && (d.discountPct ?? 0) > discountThreshold && d.discountStatus !== "approved")
    errors.discountPct = `A ${d.discountPct}% discount exceeds the ${discountThreshold}% threshold and needs manager approval before Closed Won.`;
  return errors;
}

export function effectiveProbability(stageProbability: number, override: number | null) {
  return override ?? stageProbability;
}
export const weighted = (amount: number | null, probability: number) => Math.round(((amount ?? 0) * probability) / 100);

export function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}
