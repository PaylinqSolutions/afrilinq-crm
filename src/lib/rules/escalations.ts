/** Who a ticket can be escalated to, and what each route needs. */
export const ESCALATION_TARGETS = [
  { key: "engineering", label: "Development / Engineering team", target: "team", needsApproval: true, hint: "Product defects and anything needing a code or config change. Needs full technical detail; agents' requests wait for Support Lead approval." },
  { key: "support_peer", label: "Another support agent", target: "person", needsApproval: false, hint: "Hand a specific question to a colleague with the right product knowledge." },
  { key: "support_lead", label: "Support Lead", target: "person", needsApproval: false, hint: "Guidance, priority calls, or customer handling." },
  { key: "sales", label: "Sales (account owner or a sales rep)", target: "person", needsApproval: false, hint: "Commercial questions: pricing, licences, contract scope, renewals." },
  { key: "onboarding", label: "Onboarding / implementation", target: "person", needsApproval: false, hint: "Setup, migration or go-live issues for a customer still being onboarded." },
  { key: "management", label: "Management", target: "role", needsApproval: true, hint: "Critical customer risk. Agents' requests wait for Support Lead approval." },
] as const;
export type EscalationKind = (typeof ESCALATION_TARGETS)[number]["key"];
export const escalationTarget = (k: string) => ESCALATION_TARGETS.find((t) => t.key === k);
export const escalationKindLabel = (k: string) => (k === "incident" ? "Incident response" : escalationTarget(k)?.label ?? k);

export const ESCALATION_STATUSES: Record<string, { label: string; tone: "amber" | "blue" | "violet" | "green" | "gray" | "red"; active: boolean }> = {
  pending_approval: { label: "Awaiting approval", tone: "amber", active: true },
  open: { label: "Waiting to be accepted", tone: "blue", active: true },
  approved: { label: "Open", tone: "blue", active: true }, // incidents
  in_progress: { label: "In progress", tone: "violet", active: true },
  resolved: { label: "Resolved — awaiting confirmation", tone: "green", active: true },
  closed: { label: "Resolved and confirmed", tone: "gray", active: false },
  rejected: { label: "Declined", tone: "red", active: false },
  cancelled: { label: "Withdrawn", tone: "gray", active: false },
};
export const ACTIVE_ESCALATION_STATUSES = Object.entries(ESCALATION_STATUSES).filter(([, v]) => v.active).map(([k]) => k);

/** Hours to accept an escalation, by severity. */
export const ESCALATION_RESPONSE_HOURS: Record<string, number> = { P1: 4, P2: 24, P3: 72, P4: 120 };
