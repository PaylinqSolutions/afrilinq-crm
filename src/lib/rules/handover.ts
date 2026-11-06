export const HANDOVER_STATUSES = [
  "Draft", "Pending Sales Submission", "Submitted for Review", "Changes Requested", "Accepted by Onboarding", "In Onboarding", "Complete",
] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

export type ChecklistField = { key: string; label: string; section: string; required: boolean; long?: boolean; hint?: string };

export const HANDOVER_FIELDS: ChecklistField[] = [
  { section: "Customer", key: "customerName", label: "Correct organisation / customer name", required: true },
  { section: "Customer", key: "primaryContact", label: "Primary contact (name, role, email/phone)", required: true },
  { section: "Customer", key: "secondaryContacts", label: "Secondary contacts and roles", required: false, long: true },
  { section: "Commercial", key: "productsSold", label: "Products / services sold, licensed scope and quantity", required: true, long: true },
  { section: "Commercial", key: "agreementReference", label: "Signed agreement or documented approval reference", required: true },
  { section: "Commercial", key: "pricing", label: "Price and billing frequency", required: true },
  { section: "Commercial", key: "startDate", label: "Agreed start date", required: true },
  { section: "Commercial", key: "paymentStatus", label: "Payment / invoice status (if tracked)", required: false },
  { section: "Commercial", key: "discount", label: "Approved discount (or “None”)", required: true },
  { section: "Customer goals", key: "goals", label: "Customer goals, pain points and success criteria", required: true, long: true },
  { section: "Customer goals", key: "currentProcesses", label: "Current processes, requirements, configuration choices and constraints", required: true, long: true },
  { section: "Commitments", key: "commitments", label: "All representations, feature commitments, custom work, integrations, migration, timelines and delivery promises made by Sales", required: true, long: true, hint: "Write “No commitments beyond standard scope” if none." },
  { section: "Readiness", key: "technicalReadiness", label: "Technical readiness, data migration requirements, responsible customer contacts and dependencies", required: true, long: true },
  { section: "Training", key: "trainingNeeds", label: "Training roles, estimated attendees, preferred times and communication channel", required: true, long: true },
  { section: "Timeline", key: "targetGoLive", label: "Target go-live date", required: true, hint: "YYYY-MM-DD" },
  { section: "Timeline", key: "goLiveReason", label: "Reason for the go-live date commitment", required: true },
  { section: "Documents", key: "documents", label: "Proposal, contract, meeting and demo notes, files (links or file names)", required: true, long: true },
  { section: "Risks", key: "risks", label: "Known risks, open questions and items still requiring confirmation", required: true, long: true },
  { section: "Submission", key: "salesExecutive", label: "Sales Executive name", required: true },
  { section: "Submission", key: "internalSummary", label: "Internal summary (optional)", required: false, long: true },
];

export const REQUIRED_HANDOVER_KEYS = HANDOVER_FIELDS.filter((f) => f.required).map((f) => f.key);

export function missingHandoverFields(checklist: Record<string, string | undefined>) {
  return REQUIRED_HANDOVER_KEYS.filter((k) => !checklist[k]?.trim());
}

export function handoverCompleteness(checklist: Record<string, string | undefined>) {
  const missing = missingHandoverFields(checklist).length;
  return Math.round(((REQUIRED_HANDOVER_KEYS.length - missing) / REQUIRED_HANDOVER_KEYS.length) * 100);
}

export const SALES_EDITABLE_STATUSES: HandoverStatus[] = ["Draft", "Pending Sales Submission", "Changes Requested"];
export const REVIEWABLE_STATUSES: HandoverStatus[] = ["Submitted for Review"];
export const ACCEPTED_STATUSES: HandoverStatus[] = ["Accepted by Onboarding", "In Onboarding", "Complete"];

export const fieldLabel = (key: string) => HANDOVER_FIELDS.find((f) => f.key === key)?.label ?? key;
