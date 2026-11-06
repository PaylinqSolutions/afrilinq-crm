export const ONBOARDING_STAGES = [
  { key: "handover_review", label: "Handover Review" },
  { key: "kickoff_pending", label: "Kickoff Pending" },
  { key: "kickoff_completed", label: "Kickoff Completed" },
  { key: "data_collection", label: "Customer Information / Data Collection" },
  { key: "configuration", label: "Configuration and Setup" },
  { key: "data_migration", label: "Data Migration / Import" },
  { key: "quality_check", label: "Internal Quality Check" },
  { key: "uat", label: "Customer Validation / UAT" },
  { key: "training_scheduled", label: "Training Scheduled" },
  { key: "training_in_progress", label: "Training In Progress" },
  { key: "go_live_review", label: "Go-Live Readiness Review" },
  { key: "go_live", label: "Go-Live" },
  { key: "post_go_live", label: "Post-Go-Live Follow-Up" },
  { key: "completed", label: "Onboarding Completed" },
  { key: "on_hold", label: "On Hold / At Risk" },
] as const;
export const stageLabel = (k: string) => ONBOARDING_STAGES.find((s) => s.key === k)?.label ?? k;

export const DEFAULT_GO_LIVE_CHECKLIST = [
  "Contract/scope confirmed",
  "Required customer details collected",
  "Configuration/setup verified",
  "Data import/migration validated (if applicable)",
  "Required user accounts/access provisioned",
  "Training delivered to required roles, or a documented training exception approved",
  "Customer validation/UAT complete (where applicable)",
  "Support contact and escalation route communicated",
  "Outstanding issues and workarounds documented",
  "Customer confirms readiness and target go-live date",
];

export type RiskInput = {
  today: string; // YYYY-MM-DD in org timezone
  targetGoLive: string | null;
  state: string;
  tasks: { status: string; dueDate: string | null; isMilestone: boolean }[];
  blockers: { status: string; severity: string }[];
  trainingGaps: number; // required participants/roles not yet trained
  trainingWindowDays: number;
};

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Transparent, rule-based risk. Every reason is shown to the user. */
export function assessOnboardingRisk(r: RiskInput): { level: "low" | "medium" | "high"; reasons: string[]; progress: number } {
  const reasons: string[] = [];
  let high = false;
  let medium = false;
  const open = r.tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.dueDate && t.dueDate < r.today);
  const overdueMilestones = overdue.filter((t) => t.isMilestone);
  if (overdueMilestones.length) {
    const worst = Math.max(...overdueMilestones.map((t) => dayDiff(t.dueDate!, r.today)));
    reasons.push(`${overdueMilestones.length} overdue milestone(s), up to ${worst} day(s) late`);
    if (worst > 7) high = true; else medium = true;
  }
  const overdueTasks = overdue.length - overdueMilestones.length;
  if (overdueTasks) { reasons.push(`${overdueTasks} overdue task(s)`); medium = true; }
  const openBlockers = r.blockers.filter((b) => b.status === "open");
  const severe = openBlockers.filter((b) => b.severity === "high" || b.severity === "critical");
  if (severe.length) { reasons.push(`${severe.length} open high/critical blocker(s)`); high = true; }
  else if (openBlockers.length) { reasons.push(`${openBlockers.length} open blocker(s)`); medium = true; }
  if (r.targetGoLive && r.state !== "completed") {
    const days = dayDiff(r.today, r.targetGoLive);
    if (days < 0) { reasons.push(`Target go-live passed ${-days} day(s) ago`); high = true; }
    if (r.trainingGaps > 0) {
      reasons.push(`${r.trainingGaps} required training completion(s) outstanding`);
      if (days <= r.trainingWindowDays) high = true; else medium = true;
    }
  }
  if (r.state === "on_hold") { reasons.push("Project is on hold"); medium = true; }
  const done = r.tasks.filter((t) => t.status === "done").length;
  const progress = r.tasks.length ? Math.round((done / r.tasks.length) * 100) : 0;
  return { level: high ? "high" : medium ? "medium" : "low", reasons, progress };
}
