export const TICKET_STATUSES = [
  { key: "new", label: "New" },
  { key: "triaged", label: "Triaged" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting_on_customer", label: "Waiting on Customer" },
  { key: "waiting_on_engineering", label: "Waiting on Engineering / Product" },
  { key: "waiting_on_third_party", label: "Waiting on Third Party" },
  { key: "resolved", label: "Resolved — Pending Confirmation" },
  { key: "closed", label: "Closed" },
  { key: "reopened", label: "Reopened" },
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number]["key"];
export const ticketStatusLabel = (s: string) => TICKET_STATUSES.find((x) => x.key === s)?.label ?? s;

export const WAITING_STATUSES: TicketStatus[] = ["waiting_on_customer", "waiting_on_engineering", "waiting_on_third_party"];
export const OPEN_STATUSES: TicketStatus[] = ["new", "triaged", "assigned", "in_progress", "reopened", ...WAITING_STATUSES];
export const isOpenStatus = (s: string) => (OPEN_STATUSES as string[]).includes(s);

const T: Record<TicketStatus, TicketStatus[]> = {
  new: ["triaged", "assigned", "in_progress", "waiting_on_customer", "resolved", "closed"],
  triaged: ["assigned", "in_progress", "waiting_on_customer", "waiting_on_engineering", "waiting_on_third_party", "resolved"],
  assigned: ["in_progress", "waiting_on_customer", "waiting_on_engineering", "waiting_on_third_party", "resolved"],
  in_progress: ["waiting_on_customer", "waiting_on_engineering", "waiting_on_third_party", "resolved", "assigned"],
  waiting_on_customer: ["in_progress", "resolved", "waiting_on_engineering", "waiting_on_third_party", "closed"],
  waiting_on_engineering: ["in_progress", "resolved", "waiting_on_customer", "waiting_on_third_party"],
  waiting_on_third_party: ["in_progress", "resolved", "waiting_on_customer", "waiting_on_engineering"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["triaged", "assigned", "in_progress", "waiting_on_customer", "waiting_on_engineering", "waiting_on_third_party", "resolved"],
};
export const allowedTicketTransitions = (from: string) => T[from as TicketStatus] ?? [];

export const IMPACTS = [
  { key: "widespread", label: "Widespread — many customers or platform-wide", score: 4 },
  { key: "multiple_users", label: "Multiple users or a whole customer", score: 3 },
  { key: "single_user", label: "Single user or one workflow", score: 2 },
  { key: "minimal", label: "Minimal / cosmetic", score: 1 },
] as const;
export const URGENCIES = [
  { key: "critical", label: "Critical — business operation stopped", score: 4 },
  { key: "high", label: "High — material impairment, no workaround", score: 3 },
  { key: "medium", label: "Medium — limited, workaround possible", score: 2 },
  { key: "low", label: "Low — how-to, enhancement, inconvenience", score: 1 },
] as const;
export const INCIDENT_TYPES = [
  { key: "security", label: "Suspected security incident" },
  { key: "data_exposure", label: "Suspected data exposure" },
  { key: "outage", label: "Service-wide outage" },
  { key: "data_loss", label: "Data loss" },
] as const;

export type Priority = "P1" | "P2" | "P3" | "P4";
export const PRIORITIES: { key: Priority; label: string; description: string }[] = [
  { key: "P1", label: "P1 — Critical", description: "Platform unavailable, suspected security/data incident, or severe multi-customer failure." },
  { key: "P2", label: "P2 — High", description: "Major functionality blocked for one customer or critical workflow impaired, no workaround." },
  { key: "P3", label: "P3 — Normal", description: "Limited functionality affected, workaround exists, or regular operational help." },
  { key: "P4", label: "P4 — Low", description: "How-to, cosmetic issue, minor inconvenience or enhancement." },
];

/**
 * Impact × urgency matrix. Tone of the request plays no part: only structured triage inputs do.
 * Suspected security/data incidents and outages are always P1. A documented workaround caps P2 at P3.
 */
export function classifyPriority(input: {
  impact: string; urgency: string; workaroundAvailable?: boolean; incidentType?: string | null;
}): Priority {
  if (input.incidentType) return "P1";
  const i = IMPACTS.find((x) => x.key === input.impact)?.score ?? 2;
  const u = URGENCIES.find((x) => x.key === input.urgency)?.score ?? 2;
  const s = i + u;
  let p: Priority = s >= 8 ? "P1" : s >= 6 ? "P2" : s >= 4 ? "P3" : "P4";
  if (input.workaroundAvailable && p === "P2") p = "P3";
  return p;
}

export const RESOLUTION_CODES = [
  "Fixed — configuration change", "Fixed — product defect resolved", "Workaround provided", "User guidance / how-to",
  "Data corrected", "Third-party resolved", "Duplicate", "Cannot reproduce", "Enhancement logged", "Customer withdrew",
];
export const TICKET_CATEGORIES: Record<string, string[]> = {
  "Access & Login": ["Password reset", "SSO", "User provisioning", "Permissions"],
  "Billing & Invoicing": ["Invoice query", "Payment failure", "Plan change"],
  "Data & Reporting": ["Report incorrect", "Export", "Import / migration"],
  "Integration": ["API", "Webhook", "Payment gateway", "Accounting sync"],
  "Performance & Availability": ["Slow", "Unavailable", "Timeouts"],
  "Functional Defect": ["Error message", "Incorrect behaviour", "Mobile app"],
  "How-to / Training": ["Feature usage", "Best practice"],
  "Feature Request": ["Enhancement"],
};

export const NOT_YET_KNOWN = "Root cause not yet known";

export type ResolutionInput = {
  priority: string; isIncident: boolean; resolutionSummary?: string | null; resolutionCode?: string | null;
  rootCause?: string | null; rootCauseFollowUpOwnerId?: string | null;
};

/** Returns field errors that block resolution. */
export function validateResolution(t: ResolutionInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!t.resolutionSummary?.trim() || t.resolutionSummary.trim().length < 10)
    e.resolutionSummary = "A resolution summary (at least 10 characters) is required to resolve a ticket.";
  if (!t.resolutionCode?.trim()) e.resolutionCode = "Choose a resolution category.";
  const highImpact = t.priority === "P1" || t.priority === "P2" || t.isIncident;
  if (highImpact) {
    if (!t.rootCause?.trim()) e.rootCause = `High-impact tickets need a root cause, or "${NOT_YET_KNOWN}" with a follow-up owner.`;
    else if (t.rootCause.trim() === NOT_YET_KNOWN && !t.rootCauseFollowUpOwnerId)
      e.rootCauseFollowUpOwnerId = "Assign a follow-up owner when the root cause is not yet known.";
  }
  return e;
}
