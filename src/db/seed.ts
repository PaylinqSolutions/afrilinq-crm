/**
 * Demo seed. All organisations, people, phone numbers and emails are fictional (".demo" / ".example" domains).
 * Figures are illustrative and must not be presented as Afrilinq's real performance.
 */
import { and, count, eq } from "drizzle-orm";
import type { DB } from "./index";
import * as s from "./schema";
import { PERMISSIONS, ROLE_DEFINITIONS } from "@/lib/permissions";
import { DEFAULT_GO_LIVE_CHECKLIST } from "@/lib/rules/onboarding";
import { addDays, todayIn } from "@/lib/format";

export const DEMO_PASSWORD = process.env.SEED_PASSWORD || "Afrilinq-Demo-2026";

export async function seedIfEmpty(db: DB) {
  const [{ n }] = await db.select({ n: count() }).from(s.users);
  if (n > 0) return false;
  await seed(db);
  return true;
}

/**
 * Adds permissions introduced after a database was created and grants each new one to the roles whose
 * default definition includes it. Existing role customisations made by admins are never changed.
 */
export async function syncPermissions(db: DB) {
  const added = await db.insert(s.permissions).values(Object.entries(PERMISSIONS).map(([key, v]) => ({ key, ...v })))
    .onConflictDoNothing().returning({ key: s.permissions.key });
  if (!added.length) return [];
  const roles = await db.select().from(s.roles);
  for (const { key } of added) {
    for (const def of ROLE_DEFINITIONS) {
      const role = roles.find((r) => r.key === def.key);
      if (role && (def.permissions as string[]).includes(key)) await db.insert(s.rolePermissions).values({ roleId: role.id, permissionKey: key }).onConflictDoNothing();
    }
  }
  return added.map((a) => a.key);
}

export async function seedReference(db: DB) {
  await db.insert(s.permissions).values(Object.entries(PERMISSIONS).map(([key, v]) => ({ key, ...v }))).onConflictDoNothing();
  for (const r of ROLE_DEFINITIONS) {
    const [role] = await db.insert(s.roles).values({ key: r.key, name: r.name, description: r.description }).onConflictDoNothing().returning();
    if (role) await db.insert(s.rolePermissions).values(r.permissions.map((p) => ({ roleId: role.id, permissionKey: p })));
  }
  const { DEFAULT_SETTINGS } = await import("@/server/settings");
  await db.insert(s.settings).values({ key: "app", value: DEFAULT_SETTINGS }).onConflictDoNothing();
  for (const kind of ["email", "sms", "whatsapp", "calendar", "telephony", "issue_tracker"]) await db.insert(s.integrations).values({ kind }).onConflictDoNothing();

  const [pipe] = await db.insert(s.pipelines).values({ name: "New business", isDefault: true }).returning();
  const stages: [string, string, number, string[], string, string, number][] = [
    ["new", "New Opportunity", 10, [], "Inbound or converted lead with an identified need", "Discovery call booked", 7],
    ["discovery", "Discovery / Needs Assessment", 20, [], "Discovery call booked", "Pain points, stakeholders and timeline documented", 10],
    ["qualified", "Qualified", 30, ["amount", "expectedCloseDate"], "Need, fit, timing and decision process confirmed", "Demo agreed with decision-maker", 14],
    ["demo_scheduled", "Demo / Presentation Scheduled", 40, ["amount", "expectedCloseDate", "primaryContactId"], "Demo date confirmed with attendees", "Demo delivered", 10],
    ["demo_completed", "Demo Completed", 50, ["amount", "expectedCloseDate", "primaryContactId"], "Demo delivered; feedback captured", "Proposal requested", 10],
    ["proposal", "Proposal / Quote Sent", 60, ["amount", "expectedCloseDate", "primaryContactId", "products"], "Priced proposal sent", "Customer feedback on proposal", 14],
    ["negotiation", "Negotiation / Objection Handling", 70, ["amount", "expectedCloseDate", "primaryContactId", "products"], "Commercial or scope objections raised", "Terms agreed in principle", 14],
    ["verbal", "Verbal Commitment", 85, ["amount", "expectedCloseDate", "primaryContactId", "products", "billingFrequency"], "Decision-maker has verbally committed", "Signed agreement or documented approval", 7],
    ["won", "Closed Won", 100, [], "Signed agreement or documented approval reference", "Handover accepted by onboarding", 999],
    ["lost", "Closed Lost", 0, ["lossReason"], "Customer declined or opportunity abandoned", "—", 999],
  ];
  await db.insert(s.pipelineStages).values(stages.map(([key, name, probability, requiredFields, entryCriteria, exitCriteria, staleAfterDays], i) => ({
    pipelineId: pipe.id, key, name, position: i + 1, probability, requiredFields, entryCriteria, exitCriteria, staleAfterDays, isWon: key === "won", isLost: key === "lost",
  })));

  const cal = (tz = "Africa/Lagos"): s.BusinessCalendar => ({
    timezone: tz, workdays: [1, 2, 3, 4, 5], start: "08:00", end: "17:00",
    holidays: ["2026-01-01", "2026-03-20", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-27", "2026-06-12", "2026-10-01", "2026-12-25", "2026-12-28"],
  });
  await db.insert(s.slaPolicies).values([
    {
      name: "Standard support", isDefault: true, calendar: cal(),
      description: "Example policy — confirm internally before production use. Holiday dates are examples; confirm gazetted dates each year.",
      targets: {
        P1: { firstResponseMins: 15, resolutionMins: 60, updateMins: 30, businessHours: false, warnAtPct: 50, escalateAtPct: 75 },
        P2: { firstResponseMins: 60, resolutionMins: 480, updateMins: 120, businessHours: true, warnAtPct: 40, escalateAtPct: 50 },
        P3: { firstResponseMins: 240, resolutionMins: 1080, updateMins: 1080, businessHours: true, warnAtPct: 50, escalateAtPct: 75 },
        P4: { firstResponseMins: 540, resolutionMins: 2700, updateMins: 2700, businessHours: true, warnAtPct: 75, escalateAtPct: 90 },
      },
      pauseStatuses: ["waiting_on_customer", "waiting_on_third_party"],
    },
    {
      name: "Strategic accounts", customerTier: "Strategic", calendar: cal(),
      description: "Example policy — confirm internally before production use. Faster P2–P4 targets for Strategic-tier customers.",
      targets: {
        P1: { firstResponseMins: 15, resolutionMins: 60, updateMins: 30, businessHours: false, warnAtPct: 50, escalateAtPct: 75 },
        P2: { firstResponseMins: 30, resolutionMins: 360, updateMins: 60, businessHours: false, warnAtPct: 40, escalateAtPct: 50 },
        P3: { firstResponseMins: 120, resolutionMins: 900, updateMins: 540, businessHours: true, warnAtPct: 50, escalateAtPct: 75 },
        P4: { firstResponseMins: 480, resolutionMins: 2160, updateMins: 2160, businessHours: true, warnAtPct: 75, escalateAtPct: 90 },
      },
      pauseStatuses: ["waiting_on_customer", "waiting_on_third_party"],
    },
  ]);

  const rules: (typeof s.workflowRules.$inferInsert)[] = [
    { key: "lead_assign", name: "Assign new leads and create first-contact task", trigger: "lead.created", description: "Territory/source map first, otherwise round-robin by open lead load.",
      actions: [{ type: "assign_lead", params: { map: { "Abuja (FCT)": "fatima@afrilinq.demo", Tender: "fatima@afrilinq.demo", Referral: "emeka@afrilinq.demo" } } },
        { type: "create_task", params: { assignTo: "owner", title: "First contact: {{organization}}", dueInDays: 1, priority: "high" } }] },
    { key: "lead_idle_owner", name: "Remind owner about idle lead", trigger: "lead.idle", actions: [{ type: "notify", params: { to: ["owner"], title: "Lead idle {{daysIdle}} days: {{name}}", body: "No logged activity. Contact {{organization}} or update the next action." } }] },
    { key: "lead_idle_manager", name: "Escalate long-idle lead to manager", trigger: "lead.idle", conditions: [{ field: "daysIdle", op: "gte", value: 10 }],
      actions: [{ type: "notify", params: { to: ["manager"], title: "Lead idle {{daysIdle}} days (escalated): {{name}}" } }] },
    { key: "demo_followup", name: "Demo completed → follow-up task", trigger: "activity.logged", conditions: [{ field: "type", op: "eq", value: "demo" }],
      actions: [{ type: "create_task", params: { assignTo: "owner", title: "Send demo recap and next steps: {{subject}}", dueInDays: 1, priority: "high" } }] },
    { key: "proposal_followup", name: "Proposal sent → follow-up task", trigger: "activity.logged", conditions: [{ field: "type", op: "eq", value: "proposal" }],
      actions: [{ type: "create_task", params: { assignTo: "owner", title: "Follow up on proposal: {{subject}}", dueInDays: 3 } }] },
    { key: "deal_stale", name: "Stale deal reminder", trigger: "deal.stale", actions: [{ type: "notify", params: { to: ["owner"], title: "Deal inactive {{daysInactive}} days: {{name}}" } }] },
    { key: "closed_won_notify", name: "Closed Won → notify reviewers", trigger: "deal.closed_won", description: "The handover record itself is always created by the system; this rule adds notifications.",
      actions: [{ type: "notify_roles", params: { roles: ["sales_manager"], title: "Deal won: {{name}}", body: "Handover pending Sales submission." } }] },
    { key: "discount_request", name: "Discount approval requested", trigger: "deal.discount_requested", actions: [{ type: "notify", params: { to: ["manager"], title: "Approve discount: {{name}}" } }] },
    { key: "handover_returned", name: "Handover returned → notify Sales", trigger: "handover.returned",
      actions: [{ type: "notify", params: { to: ["owner", "submitter"], title: "Handover returned: {{name}}", body: "Comment: {{comment}}. Missing: {{missing}}" } },
        { type: "create_task", params: { assignTo: "owner", title: "Fix handover for {{name}}", dueInDays: 1, priority: "high" } }] },
    { key: "handover_accepted", name: "Handover accepted → notify owners", trigger: "handover.accepted",
      actions: [{ type: "notify", params: { to: ["owner", "onboardingOwner"], title: "Handover accepted — onboarding started: {{name}}" } }] },
    { key: "milestone_overdue", name: "Onboarding milestone overdue", trigger: "onboarding.milestone_overdue",
      actions: [{ type: "notify", params: { to: ["owner"], title: "Milestone overdue {{daysLate}}d: {{milestone}} ({{name}})" } }] },
    { key: "milestone_critical", name: "Escalate critically late milestone", trigger: "onboarding.milestone_overdue", conditions: [{ field: "critical", op: "eq", value: true }],
      actions: [{ type: "notify_roles", params: { roles: ["onboarding_manager"], title: "Critical: milestone {{daysLate}} days late — {{name}}" } }] },
    { key: "training_gap", name: "Required training incomplete before go-live", trigger: "onboarding.training_gap",
      actions: [{ type: "notify", params: { to: ["owner"], title: "Training gap before go-live: {{name}}", body: "{{gaps}} required completion(s) outstanding. Project flagged at risk." } }] },
    { key: "p1p2_created", name: "New P1/P2 ticket → notify Support Lead", trigger: "ticket.created", conditions: [{ field: "priority", op: "in", value: ["P1", "P2"] }],
      actions: [{ type: "notify_roles", params: { roles: ["support_lead"], title: "{{priority}} ticket: {{number}} {{subject}}" } }] },
    { key: "p1_management", name: "New P1 → management alert", trigger: "ticket.created", conditions: [{ field: "priority", op: "eq", value: "P1" }],
      actions: [{ type: "notify_roles", params: { roles: ["executive"], title: "P1 raised: {{number}} {{subject}}" } }] },
    { key: "sla_breach_lead", name: "SLA breached → notify Support Lead", trigger: "ticket.sla_breached",
      actions: [{ type: "notify_roles", params: { roles: ["support_lead"], title: "SLA breach recorded: {{number}} ({{metric}})" } }] },
    { key: "ticket_resolved_confirm", name: "Ticket resolved → confirm with customer", trigger: "ticket.resolved",
      actions: [{ type: "create_task", params: { assignTo: "owner", title: "Confirm resolution with customer: {{number}}", dueInDays: 2 } }] },
    { key: "task_overdue", name: "Overdue task reminder", trigger: "task.overdue", actions: [{ type: "notify", params: { to: ["owner"], title: "Overdue: {{title}}" } }] },
    { key: "account_at_risk", name: "Customer at risk → account review task", trigger: "account.at_risk",
      actions: [{ type: "create_task", params: { assignTo: "owner", title: "Account review: {{name}} (health {{score}})", description: "Factors: {{factors}}", dueInDays: 3, priority: "high" } }] },
    { key: "renewal_approaching", name: "Renewal approaching → account review task", trigger: "renewal.approaching",
      actions: [{ type: "create_task", params: { assignTo: "owner", title: "Renewal review: {{name}} (renews {{renewalDate}})", dueInDays: 5 } }] },
  ];
  await db.insert(s.workflowRules).values(rules);
}

export async function seed(db: DB) {
  const { hashPassword } = await import("@/server/auth-core");
  const { loadActor } = await import("@/server/actor");
  const sales = await import("@/server/services/sales");
  const handover = await import("@/server/services/handover");
  const onboarding = await import("@/server/services/onboarding");
  const tickets = await import("@/server/services/tickets");
  const training = await import("@/server/services/training");
  const activitiesSvc = await import("@/server/services/activities");
  const sweep = await import("@/server/services/sweep");

  await seedReference(db);
  const now = new Date();
  const today = todayIn("Africa/Lagos", now);
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * 86400000 - hours * 3600000);
  const d = (offset: number) => addDays(today, offset);

  // ------------------------------------------------------------------ Teams & users
  const teamRows = await db.insert(s.teams).values([
    { name: "Sales", kind: "sales" }, { name: "Onboarding & Customer Success", kind: "onboarding" }, { name: "Training", kind: "training" },
    { name: "Customer Support", kind: "support" }, { name: "Technical Support", kind: "support" }, { name: "Platform Engineering", kind: "engineering" },
    { name: "Finance", kind: "finance" }, { name: "Management", kind: "management" },
  ]).returning();
  const team = (n: string) => teamRows.find((t) => t.name === n)!.id;
  const roleRows = await db.select().from(s.roles);
  const role = (k: string) => roleRows.find((r) => r.key === k)!.id;
  const hash = hashPassword(DEMO_PASSWORD);
  const people: [string, string, string, string, string[]][] = [
    ["admin", "Adaeze Okafor", "Head of Business Systems", "Management", ["super_admin"]],
    ["owner", "Platform Owner", "Platform owner (your demo login)", "Management", ["super_admin"]],
    ["cco", "Tunde Bakare", "Chief Commercial Officer", "Management", ["executive"]],
    ["sales.manager", "Ngozi Eze", "Sales Manager", "Sales", ["sales_manager"]],
    ["emeka", "Emeka Nwosu", "Account Executive", "Sales", ["sales_executive"]],
    ["fatima", "Fatima Bello", "Account Executive — Public Sector", "Sales", ["sales_executive"]],
    ["onboarding", "Chiamaka Obi", "Head of Onboarding & Customer Success", "Onboarding & Customer Success", ["onboarding_manager"]],
    ["ibrahim", "Ibrahim Musa", "Implementation Consultant", "Onboarding & Customer Success", ["onboarding_manager"]],
    ["trainer", "Funke Adeyemi", "Customer Trainer", "Training", ["trainer"]],
    ["segun", "Segun Ojo", "Customer Trainer", "Training", ["trainer"]],
    ["support", "Kelechi Ude", "Support Agent", "Customer Support", ["support_agent"]],
    ["aisha", "Aisha Lawal", "Technical Support Engineer", "Technical Support", ["support_agent"]],
    ["support.lead", "Bola Akande", "Support Lead", "Customer Support", ["support_lead"]],
    ["engineering", "Yusuf Danjuma", "Platform Engineer", "Platform Engineering", ["engineering"]],
    ["finance", "Grace Etim", "Billing Officer", "Finance", ["finance"]],
  ];
  const U: Record<string, string> = {};
  for (const [handle, name, title, t, rs] of people) {
    const [u] = await db.insert(s.users).values({ email: `${handle}@afrilinq.demo`, name, title, teamId: team(t), passwordHash: hash, phone: "+234 800 000 0000" }).returning();
    U[handle] = u.id;
    await db.insert(s.userRoles).values(rs.map((r) => ({ userId: u.id, roleId: role(r) })));
  }
  for (const h of ["emeka", "fatima"]) await db.update(s.users).set({ managerId: U["sales.manager"] }).where(eq(s.users.id, U[h]));
  for (const h of ["support", "aisha"]) await db.update(s.users).set({ managerId: U["support.lead"] }).where(eq(s.users.id, U[h]));
  await db.update(s.users).set({ managerId: U.onboarding }).where(eq(s.users.id, U.ibrahim));
  const A = async (h: string) => (await loadActor(db, U[h]))!;

  // ------------------------------------------------------------------ Catalogue
  const prodRows = await db.insert(s.products).values([
    { code: "AFQ-BOOKS", name: "Afrilinq Books — Accounting & ERP", kind: "product", category: "Finance software", unit: "per company / year", listPrice: 9_500_000, billingFrequency: "Annually", description: "Cloud accounting, inventory and procurement." },
    { code: "AFQ-PAY", name: "Afrilinq Pay — Payments Gateway", kind: "product", category: "Payments", unit: "per merchant / year", listPrice: 6_000_000, billingFrequency: "Annually", description: "Card, transfer and USSD collections with settlement reconciliation." },
    { code: "AFQ-PEOPLE", name: "Afrilinq People — HR & Payroll", kind: "product", category: "HR software", unit: "per company / year", listPrice: 4_800_000, billingFrequency: "Annually", description: "HR records, leave, PAYE/pension-ready payroll." },
    { code: "AFQ-FLEET", name: "Afrilinq Fleet — Logistics Tracking", kind: "product", category: "Logistics software", unit: "per fleet / year", listPrice: 7_200_000, billingFrequency: "Annually", description: "Vehicle tracking, trip and proof-of-delivery management." },
    { code: "SVC-IMPL", name: "Implementation & Configuration", kind: "service", category: "Professional services", unit: "per project", listPrice: 3_000_000, billingFrequency: "One-off" },
    { code: "SVC-MIG", name: "Data Migration Service", kind: "service", category: "Professional services", unit: "per project", listPrice: 1_500_000, billingFrequency: "One-off" },
    { code: "SVC-TRN", name: "Additional Training Day", kind: "service", category: "Training", unit: "per day", listPrice: 450_000, billingFrequency: "One-off" },
  ]).returning();
  const P = (code: string) => prodRows.find((p) => p.code === code)!;

  // ------------------------------------------------------------------ Templates & programs
  type TT = [string, string, number, boolean?, boolean?, number?];
  const mkTemplate = async (name: string, productId: string | null, segment: string | null, durationDays: number, tasks: TT[]) => {
    const [t] = await db.insert(s.onboardingTemplates).values({ name, productId, segment, durationDays, goLiveChecklist: DEFAULT_GO_LIVE_CHECKLIST, description: `${durationDays}-day plan` }).returning();
    await db.insert(s.onboardingTemplateTasks).values(tasks.map(([title, stageKey, offsetDays, isMilestone, customerResponsibility, dependsOnPosition], i) => ({
      templateId: t.id, position: i + 1, title, stageKey, offsetDays, isMilestone: !!isMilestone, customerResponsibility: !!customerResponsibility, dependsOnPosition: dependsOnPosition ?? null,
    })));
    return t;
  };
  await mkTemplate("Standard SaaS onboarding", null, null, 35, [
    ["Review accepted handover and confirm scope", "handover_review", 0, false],
    ["Kickoff meeting held with customer sponsor", "kickoff_completed", 3, true, false, 1],
    ["Customer submits company data & user list", "data_collection", 8, false, true, 2],
    ["Configure workspace, roles and settings", "configuration", 14, false, false, 3],
    ["Import opening data", "data_migration", 18, false, false, 4],
    ["Internal quality check", "quality_check", 21, true, false, 5],
    ["Customer UAT sign-off", "uat", 25, true, true, 6],
    ["Deliver role-based training", "training_in_progress", 28, true, false],
    ["Go-live readiness review", "go_live_review", 32, true, false, 7],
    ["Go-live", "go_live", 35, true, false, 9],
    ["30-day post-go-live check-in", "post_go_live", 65, false],
  ]);
  await mkTemplate("Enterprise implementation", null, "Enterprise", 60, [
    ["Review handover, commitments and risks", "handover_review", 0, false],
    ["Executive kickoff and governance plan agreed", "kickoff_completed", 5, true, false, 1],
    ["Process workshops (finance, procurement, inventory)", "data_collection", 15, false, false, 2],
    ["Customer provides chart of accounts & master data", "data_collection", 18, false, true, 2],
    ["Solution configuration", "configuration", 30, true, false, 3],
    ["Data migration trial load", "data_migration", 36, false, false, 4],
    ["Internal QA and security review", "quality_check", 42, true, false, 5],
    ["Customer UAT", "uat", 48, true, true, 7],
    ["Train administrators and finance users", "training_in_progress", 52, true, false],
    ["Go-live readiness review", "go_live_review", 56, true, false, 8],
    ["Cutover and go-live", "go_live", 60, true, false, 10],
    ["Hypercare and post-go-live review", "post_go_live", 75, false],
  ]);
  await mkTemplate("Afrilinq Pay integration onboarding", P("AFQ-PAY").id, null, 30, [
    ["Review handover and merchant KYC status", "handover_review", 0, false],
    ["Kickoff with merchant technical team", "kickoff_completed", 2, true, false, 1],
    ["Merchant completes KYC & settlement account", "data_collection", 7, false, true, 2],
    ["Sandbox API keys issued and integration started", "configuration", 9, false, false, 3],
    ["Merchant completes integration in sandbox", "configuration", 16, true, true, 4],
    ["Internal transaction certification", "quality_check", 20, true, false, 5],
    ["Live keys and settlement test", "uat", 23, true, false, 6],
    ["Merchant operations training", "training_in_progress", 25, true, false],
    ["Go-live readiness review", "go_live_review", 28, true, false, 7],
    ["Go-live", "go_live", 30, true, false, 9],
  ]);

  const progRows = await db.insert(s.trainingPrograms).values([
    { name: "Afrilinq Books — Administrator Essentials", productId: P("AFQ-BOOKS").id, audienceRole: "administrator", requiredForGoLive: true, durationMinutes: 180, objectives: ["Configure users and roles", "Manage approval workflows", "Run period close"], description: "For customer system administrators." },
    { name: "Afrilinq Books — Finance User Training", productId: P("AFQ-BOOKS").id, audienceRole: "finance_user", requiredForGoLive: true, durationMinutes: 240, objectives: ["Post journals and invoices", "Bank reconciliation", "Standard reports"] },
    { name: "Afrilinq Pay — Merchant Operations", productId: P("AFQ-PAY").id, audienceRole: "operations", requiredForGoLive: true, durationMinutes: 120, objectives: ["Read settlement reports", "Handle refunds and disputes", "Escalation route"] },
    { name: "Afrilinq People — HR Admin & Payroll Run", productId: P("AFQ-PEOPLE").id, audienceRole: "hr_admin", requiredForGoLive: true, durationMinutes: 180, objectives: ["Employee records", "Monthly payroll run", "PAYE and pension schedules"] },
    { name: "Afrilinq Fleet — Dispatcher Training", productId: P("AFQ-FLEET").id, audienceRole: "dispatcher", requiredForGoLive: true, durationMinutes: 120, objectives: ["Trip planning", "Live tracking", "Proof of delivery"] },
    { name: "Refresher: Reporting & Dashboards", productId: null, audienceRole: "end_user", requiredForGoLive: false, durationMinutes: 90, objectives: ["Build saved reports", "Export to Excel"] },
  ]).returning();
  const PR = (prefix: string) => progRows.find((p) => p.name.startsWith(prefix))!;
  await db.insert(s.trainingMaterials).values([
    { programId: PR("Afrilinq Books — Administrator").id, title: "Administrator guide (PDF)", kind: "guide", url: "https://learn.afrilinq.example/books/admin-guide.pdf", visibility: "customer" },
    { programId: PR("Afrilinq Books — Administrator").id, title: "Trainer slide deck", kind: "slides", url: "https://learn.afrilinq.example/books/admin-trainer-deck", visibility: "internal" },
    { programId: PR("Afrilinq Pay").id, title: "Settlement reports walkthrough (video)", kind: "video", url: "https://learn.afrilinq.example/pay/settlements-video", visibility: "customer" },
    { programId: PR("Afrilinq People").id, title: "Payroll run checklist", kind: "guide", url: "https://learn.afrilinq.example/people/payroll-checklist.pdf", visibility: "customer" },
  ]);
  await db.insert(s.assessments).values([
    { programId: PR("Afrilinq Books — Administrator").id, title: "Administrator competency check", passMark: 70, questions: [{ q: "Where do you assign approval limits?", options: ["Roles & permissions", "Chart of accounts", "Reports"], answer: 0 }] },
    { programId: PR("Afrilinq Pay").id, title: "Merchant operations quiz", passMark: 75, questions: [{ q: "Who approves a refund above the threshold?", options: ["Any cashier", "Finance approver", "Customer"], answer: 1 }] },
  ]);

  // ------------------------------------------------------------------ Companies & contacts
  type Co = { name: string; industry: string; segment: string; tier: string; lifecycle: string; region: string; city: string; owner: string; csm?: string; billing?: string };
  const cos: Co[] = [
    { name: "Kanem Logistics Ltd", industry: "Logistics", segment: "Mid-Market", tier: "Premium", lifecycle: "customer", region: "North", city: "Kano", owner: "emeka", csm: "ibrahim", billing: "current" },
    { name: "Lekki Pearl Hospitals", industry: "Healthcare", segment: "Enterprise", tier: "Strategic", lifecycle: "prospect", region: "Lagos", city: "Lagos", owner: "emeka" },
    { name: "Zuma Microfinance Bank", industry: "Financial services", segment: "Mid-Market", tier: "Premium", lifecycle: "prospect", region: "Abuja (FCT)", city: "Abuja", owner: "emeka" },
    { name: "Ibadan Textile Works", industry: "Manufacturing", segment: "Mid-Market", tier: "Standard", lifecycle: "prospect", region: "South-West (ex-Lagos)", city: "Ibadan", owner: "fatima" },
    { name: "Calabar Marine Services", industry: "Maritime", segment: "SME", tier: "Standard", lifecycle: "customer", region: "South-South", city: "Calabar", owner: "fatima", csm: "onboarding", billing: "current" },
    { name: "Obudu Agro Processing", industry: "Agribusiness", segment: "Mid-Market", tier: "Premium", lifecycle: "customer", region: "South-South", city: "Ogoja", owner: "emeka", csm: "onboarding", billing: "overdue" },
    { name: "Jos Highlands Schools", industry: "Education", segment: "SME", tier: "Standard", lifecycle: "customer", region: "North", city: "Jos", owner: "fatima", csm: "ibrahim", billing: "current" },
    { name: "Abuja Civic Water Board", industry: "Public utilities", segment: "Public Sector", tier: "Strategic", lifecycle: "prospect", region: "Abuja (FCT)", city: "Abuja", owner: "fatima" },
    { name: "Enugu Coal City Pharma", industry: "Pharmaceuticals", segment: "Mid-Market", tier: "Standard", lifecycle: "prospect", region: "South-East", city: "Enugu", owner: "emeka" },
    { name: "Port Harcourt Energy Services", industry: "Oil & gas services", segment: "Enterprise", tier: "Strategic", lifecycle: "prospect", region: "South-South", city: "Port Harcourt", owner: "emeka" },
    { name: "Ikeja Fresh Foods", industry: "FMCG distribution", segment: "SME", tier: "Standard", lifecycle: "prospect", region: "Lagos", city: "Lagos", owner: "fatima" },
    { name: "Accra Bridge Retail", industry: "Retail", segment: "Mid-Market", tier: "Standard", lifecycle: "prospect", region: "Ghana", city: "Accra", owner: "emeka" },
    { name: "Savannah Clinics Nairobi", industry: "Healthcare", segment: "SME", tier: "Standard", lifecycle: "prospect", region: "Kenya", city: "Nairobi", owner: "fatima" },
    { name: "Owerri Builders Cooperative", industry: "Construction", segment: "SME", tier: "Standard", lifecycle: "prospect", region: "South-East", city: "Owerri", owner: "emeka" },
  ];
  const C: Record<string, string> = {};
  for (const c of cos) {
    const [row] = await db.insert(s.companies).values({
      name: c.name, industry: c.industry, segment: c.segment, tier: c.tier, lifecycle: c.lifecycle, region: c.region, city: c.city,
      ownerId: U[c.owner], csmId: c.csm ? U[c.csm] : null, billingStatus: c.billing ?? null, website: `https://${c.name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
      phone: "+234 700 000 0000", createdAt: ago(200),
    }).returning();
    C[c.name.split(" ")[0]] = row.id;
  }
  const contactSeed: [string, string, string, string, string[]][] = [
    ["Kanem", "Musa", "Abdullahi", "Operations Director", ["decision_maker", "champion"]], ["Kanem", "Hauwa", "Sani", "Fleet Supervisor", ["training_coordinator", "end_user"]], ["Kanem", "Danladi", "Yakubu", "IT Lead", ["technical"]],
    ["Lekki", "Dr. Olumide", "Coker", "Chief Financial Officer", ["decision_maker"]], ["Lekki", "Bisi", "Adebayo", "Finance Manager", ["champion", "billing", "training_coordinator"]], ["Lekki", "Tobi", "Ajayi", "Head of IT", ["technical"]],
    ["Zuma", "Chinedu", "Okeke", "MD/CEO", ["decision_maker"]], ["Zuma", "Amaka", "Nnaji", "Head of Digital Channels", ["champion", "technical"]],
    ["Ibadan", "Kunle", "Oyewole", "General Manager", ["decision_maker"]], ["Ibadan", "Mariam", "Afolabi", "HR Manager", ["champion", "training_coordinator"]],
    ["Calabar", "Effiong", "Bassey", "Managing Director", ["decision_maker"]], ["Calabar", "Ekaette", "Udo", "Accountant", ["end_user", "billing"]],
    ["Obudu", "Ogar", "Ayuk", "Finance Director", ["decision_maker"]], ["Obudu", "Ene", "Obi", "Head of Sales Ops", ["champion", "training_coordinator"]], ["Obudu", "Patrick", "Agbor", "Systems Administrator", ["technical"]], ["Obudu", "Rita", "Ikpi", "Cashier Supervisor", ["end_user"]],
    ["Jos", "Gyang", "Dung", "Proprietor", ["decision_maker"]], ["Jos", "Naomi", "Pam", "Bursar", ["billing", "end_user"]],
    ["Abuja", "Engr. Usman", "Garba", "Director, Commercial Services", ["decision_maker"]], ["Abuja", "Zainab", "Aliyu", "Head of Finance", ["champion", "billing"]], ["Abuja", "Ifeanyi", "Chukwu", "ICT Manager", ["technical", "training_coordinator"]],
    ["Enugu", "Obinna", "Eze", "Commercial Director", ["decision_maker"]], ["Port", "Tamuno", "Briggs", "CFO", ["decision_maker"]], ["Ikeja", "Shade", "Balogun", "Owner", ["decision_maker"]],
    ["Accra", "Kwame", "Mensah", "Finance Director", ["decision_maker"]], ["Savannah", "Wanjiru", "Kamau", "Practice Manager", ["decision_maker"]], ["Owerri", "Uche", "Iwu", "Chairman", ["decision_maker"]],
  ];
  const K: Record<string, string> = {};
  const STATUSES = ["connected", "in_progress", "open_deal", null, "attempted", "call_back", "new", "not_interested"];
  const SOURCES = ["Referral", "Website", "District meeting", "Trade show", null, "Partner", "Cold call"];
  let ci = 0;
  for (const [co, f, l, title, roles] of contactSeed) {
    const email = `${f.replace(/^(Dr\.|Engr\.)\s*/, "").toLowerCase()}.${l.toLowerCase()}@${co.toLowerCase()}.example`;
    const [company] = await db.select().from(s.companies).where(eq(s.companies.id, C[co]));
    const phone = `+234-80${3 + (ci % 5)}-${String(200 + ci * 37).slice(-3)}-${String(1000 + ci * 211).slice(-4)}`;
    const [row] = await db.insert(s.contacts).values({
      companyId: C[co], firstName: f, lastName: l, jobTitle: title, contactRoles: roles, email, phone, whatsapp: phone, preferredChannel: ci % 3 === 0 ? "whatsapp" : "email", ownerId: company.ownerId,
      leadStatus: company.lifecycle === "customer" ? "connected" : STATUSES[ci % STATUSES.length], referralSource: SOURCES[ci % SOURCES.length], city: company.city,
      lifecycleStage: company.lifecycle === "customer" ? "customer" : ci % 2 ? "sql" : "lead", createdAt: new Date(Date.now() - (5 + ci * 9) * 86400000),
    }).returning();
    K[`${co}:${l}`] = row.id;
    ci++;
  }
  // Prospects met at events and calls who aren't tied to a company yet (some missing email or status, as in real life).
  const prospects: [string, string, string | null, string | null, string, string | null, string][] = [
    ["Dr Danjuma", "Yusuf", "+234-803-481-9348", null, "District meeting", null, "Lagos"], ["Abodunrin", "Wright", "+234-740-782-1000", null, "Trade show", null, "Lagos"],
    ["Alabi", "Victor", "+234-803-352-9059", "vm.alabi@example.com", "Trade show", "not_interested", "Lagos"], ["George", "Vincent", "+234-803-410-1718", null, "Cold call", "connected", "Abuja"],
    ["Dr Chinyere", "Uzoma", "+234-802-318-6501", null, "Referral", "in_progress", "Enugu"], ["Dr Bartholomew", "Udeh", "+234-803-925-6954", null, "Cold call", "in_progress", "Port Harcourt"],
    ["Princess", "Udeh", null, "princess.udeh@example.com", "Website", null, "Lagos"], ["Hadiza", "Bello", "+234-806-555-0192", "hadiza.bello@example.com", "Webinar", "new", "Kano"],
  ];
  const reps = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.active, true)).limit(4);
  for (const [i, [f, l, phone, email, source, status, city]] of prospects.entries()) {
    await db.insert(s.contacts).values({ firstName: f, lastName: l, phone, email, referralSource: source, leadStatus: status, city, lifecycleStage: "lead", ownerId: i === 1 ? null : reps[i % reps.length]?.id ?? null, createdAt: new Date(Date.now() - (2 + i * 13) * 86400000) });
  }

  // ------------------------------------------------------------------ Leads
  const leadSeed: [string, string, string, string, string, string | null, string, string, number][] = [
    ["ERP replacement for 4 depots", "Owerri Builders Cooperative", "Uche Iwu", "Referral", "Qualified", "emeka", "AFQ-BOOKS", "South-East", 3],
    ["Payroll for 350 staff", "Benue Valley Farms", "Terkula Iorliam", "Website", "Attempting Contact", "fatima", "AFQ-PEOPLE", "North", 8],
    ["Collections via USSD", "Aba Shoe Makers Guild", "Ngozi Uzor", "Trade Event", "New", null, "AFQ-PAY", "South-East", 0],
    ["Fleet tracking for 40 trucks", "Sapele Timber Haulage", "Efe Okoro", "Outbound Call", "Contacted", "emeka", "AFQ-FLEET", "South-South", 12],
    ["Hospital billing integration", "Ilorin Specialist Clinic", "Dr. Kemi Salami", "Partner", "Demo/Discovery Scheduled", "fatima", "AFQ-PAY", "North", 2],
    ["State revenue collections", "Kogi State Revenue Service", "Abubakar Ohiare", "Tender", "Nurturing", "fatima", "AFQ-PAY", "North", 25],
    ["Accounting for NGO grants", "Hope Rising Foundation", "Joy Edet", "Website", "Disqualified", "emeka", "AFQ-BOOKS", "South-South", 40],
    ["Inventory & POS for 12 stores", "Yaba Gadgets Hub", "Seyi Lawson", "LinkedIn", "New", "emeka", "AFQ-BOOKS", "Lagos", 1],
    ["HR records for school group", "Minna Royal Academies", "Hadiza Kolo", "WhatsApp Inquiry", "Attempting Contact", "fatima", "AFQ-PEOPLE", "North", 6],
    ["Merchant payments for e-commerce", "Surulere Market Online", "Femi Ade", "Website", "Contacted", "emeka", "AFQ-PAY", "Lagos", 4],
    ["Cold-chain fleet visibility", "Asaba Fresh Dairies", "Ifeoma Okafor", "Referral", "New", null, "AFQ-FLEET", "South-South", 0],
    ["Group consolidation (3 entities)", "Kaduna Polymers Group", "Bashir Lawal", "Existing Customer", "Qualified", "emeka", "AFQ-BOOKS", "North", 5],
  ];
  const emeka = await A("emeka");
  const adminA = await A("admin");
  for (const [name, org, contact, source, status, owner, prod, region, ageDays] of leadSeed) {
    const actor = owner ? await A(owner) : adminA;
    const l = await sales.createLead(db, owner ? actor : await A("sales.manager"), {
      name, organization: org, contactName: contact, email: `${contact.split(" ").pop()!.toLowerCase()}@${org.split(" ")[0].toLowerCase()}.example`, phone: "+234 800 000 0000",
      source, status: status === "Converted" ? "New" : status, ownerId: owner ? U[owner] : null, productInterestId: P(prod).id, segment: "Mid-Market", region,
      nextAction: status === "Disqualified" ? "None — disqualified" : "Call to confirm requirements and decision timeline", nextActionDue: new Date(now.getTime() + (ageDays % 3 === 0 ? -1 : 2) * 86400000).toISOString(),
      need: "Replace spreadsheets and manual reconciliation", timing: "This quarter", painPoints: "Month-end close takes 12+ days; no live visibility",
      disqualifyReason: status === "Disqualified" ? "Grant-funded budget not available until next fiscal year" : null,
    });
    await db.update(s.leads).set({ createdAt: ago(ageDays), lastActivityAt: ageDays > 6 ? ago(ageDays) : null }).where(eq(s.leads.id, l.id));
  }

  // ------------------------------------------------------------------ Deals
  const stageRows = await db.select().from(s.pipelineStages);
  const ST = (k: string) => stageRows.find((x) => x.key === k)!;
  type DealSpec = {
    key: string; name: string; co: string; contact: string; owner: string; stage: string; amount: number; lines: [string, number][]; closeIn: number;
    createdDaysAgo: number; nextStep?: string; contract?: string; billing?: string; start?: number; discount?: number; discountStatus?: string; competitor?: string; lastActivityDaysAgo?: number;
  };
  const D: Record<string, string> = {};
  const mkDeal = async (x: DealSpec) => {
    const st = ST(x.stage);
    const [deal] = await db.insert(s.deals).values({
      name: x.name, companyId: C[x.co], primaryContactId: K[x.contact], ownerId: U[x.owner], pipelineId: st.pipelineId, stageId: st.id, amount: x.amount,
      expectedCloseDate: d(x.closeIn), nextStep: x.nextStep ?? "Follow up with decision-maker", nextStepDue: d(Math.max(-3, Math.min(x.closeIn, 5))),
      contractReference: x.contract ?? null, billingFrequency: x.billing ?? null, startDate: x.start !== undefined ? d(x.start) : null,
      discountPct: x.discount ?? null, discountStatus: x.discountStatus ?? "none", competitor: x.competitor ?? null, leadSource: "Referral",
      forecastCategory: st.probability >= 70 ? "commit" : st.probability >= 50 ? "best_case" : "pipeline",
      createdAt: ago(x.createdDaysAgo), stageEnteredAt: ago(Math.min(x.createdDaysAgo, 6)), lastActivityAt: ago(x.lastActivityDaysAgo ?? 2),
    }).returning();
    await db.insert(s.dealContacts).values({ dealId: deal.id, contactId: K[x.contact], role: "primary" });
    await db.insert(s.dealProducts).values(x.lines.map(([code, qty]) => ({ dealId: deal.id, productId: P(code).id, quantity: qty, unitPrice: P(code).listPrice! })));
    await db.insert(s.dealStageHistory).values({ dealId: deal.id, toStageId: ST("new").id, changedBy: U[x.owner], changedAt: ago(x.createdDaysAgo) });
    if (x.stage !== "new") await db.insert(s.dealStageHistory).values({ dealId: deal.id, fromStageId: ST("new").id, toStageId: st.id, changedBy: U[x.owner], changedAt: ago(Math.min(x.createdDaysAgo, 6)), durationSeconds: 86400 * Math.max(1, x.createdDaysAgo - 6) });
    D[x.key] = deal.id;
    return deal;
  };
  const won = async (key: string, owner: string, closedDaysAgo: number) => {
    await sales.moveDealStage(db, await A(owner), D[key], ST("won").id);
    await db.update(s.deals).set({ closedAt: ago(closedDaysAgo), stageEnteredAt: ago(closedDaysAgo) }).where(eq(s.deals.id, D[key]));
    await db.update(s.dealStageHistory).set({ changedAt: ago(closedDaysAgo) }).where(and(eq(s.dealStageHistory.dealId, D[key]), eq(s.dealStageHistory.toStageId, ST("won").id)));
    const [h] = await db.select().from(s.handoverRecords).where(eq(s.handoverRecords.dealId, D[key]));
    await db.update(s.handoverRecords).set({ createdAt: ago(closedDaysAgo), updatedAt: ago(closedDaysAgo) }).where(eq(s.handoverRecords.id, h.id));
    return h;
  };

  const winSpec = (x: Omit<DealSpec, "stage" | "contract" | "billing" | "start">, start = 7): DealSpec => ({ ...x, stage: "verbal", contract: `AFQ-MSA-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`, billing: "Annually", start });
  await mkDeal(winSpec({ key: "kanem", name: "Kanem Logistics — Fleet tracking (60 vehicles)", co: "Kanem", contact: "Kanem:Abdullahi", owner: "emeka", amount: 11_700_000, lines: [["AFQ-FLEET", 1], ["SVC-IMPL", 1], ["SVC-TRN", 3]], closeIn: 0, createdDaysAgo: 110 }));
  await mkDeal(winSpec({ key: "lekki", name: "Lekki Pearl Hospitals — Books ERP + migration", co: "Lekki", contact: "Lekki:Coker", owner: "emeka", amount: 14_000_000, lines: [["AFQ-BOOKS", 1], ["SVC-IMPL", 1], ["SVC-MIG", 1]], closeIn: 0, createdDaysAgo: 75 }, 21));
  await mkDeal(winSpec({ key: "zuma", name: "Zuma Microfinance — Pay collections", co: "Zuma", contact: "Zuma:Okeke", owner: "emeka", amount: 6_900_000, lines: [["AFQ-PAY", 1], ["SVC-TRN", 2]], closeIn: 0, createdDaysAgo: 48 }, 14));
  await mkDeal(winSpec({ key: "ibadan", name: "Ibadan Textile Works — People payroll", co: "Ibadan", contact: "Ibadan:Oyewole", owner: "fatima", amount: 5_400_000, lines: [["AFQ-PEOPLE", 1], ["SVC-TRN", 1]], closeIn: 0, createdDaysAgo: 60 }, 10));
  await mkDeal(winSpec({ key: "calabar", name: "Calabar Marine — Books starter", co: "Calabar", contact: "Calabar:Bassey", owner: "fatima", amount: 9_500_000, lines: [["AFQ-BOOKS", 1]], closeIn: 0, createdDaysAgo: 220 }));
  await mkDeal(winSpec({ key: "obudu", name: "Obudu Agro — Pay merchant collections", co: "Obudu", contact: "Obudu:Ayuk", owner: "emeka", amount: 7_500_000, lines: [["AFQ-PAY", 1], ["SVC-IMPL", 1]], closeIn: 0, createdDaysAgo: 90, discount: 8 }));
  await mkDeal(winSpec({ key: "jos", name: "Jos Highlands Schools — People HR & payroll", co: "Jos", contact: "Jos:Dung", owner: "fatima", amount: 4_800_000, lines: [["AFQ-PEOPLE", 1]], closeIn: 0, createdDaysAgo: 400 }));
  await mkDeal(winSpec({ key: "abuja", name: "Abuja Civic Water Board — Books ERP (Phase 1)", co: "Abuja", contact: "Abuja:Garba", owner: "fatima", amount: 22_500_000, lines: [["AFQ-BOOKS", 1], ["SVC-IMPL", 2], ["SVC-MIG", 1], ["SVC-TRN", 5]], closeIn: 0, createdDaysAgo: 140 }, 10));

  // Open pipeline
  await mkDeal({ key: "enugu", name: "Enugu Coal City Pharma — Books + inventory", co: "Enugu", contact: "Enugu:Eze", owner: "emeka", stage: "proposal", amount: 12_500_000, lines: [["AFQ-BOOKS", 1], ["SVC-IMPL", 1]], closeIn: 18, createdDaysAgo: 35, nextStep: "Walk CFO through proposal pricing", competitor: "Local reseller (on-premise ERP)" });
  await mkDeal({ key: "ph", name: "Port Harcourt Energy — Group ERP", co: "Port", contact: "Port:Briggs", owner: "emeka", stage: "negotiation", amount: 38_000_000, lines: [["AFQ-BOOKS", 3], ["SVC-IMPL", 3], ["SVC-MIG", 2]], closeIn: 30, createdDaysAgo: 80, nextStep: "Legal review of MSA redlines", discount: 15, discountStatus: "pending", competitor: "Global ERP vendor" });
  await mkDeal({ key: "ikeja", name: "Ikeja Fresh Foods — Pay + Books", co: "Ikeja", contact: "Ikeja:Balogun", owner: "fatima", stage: "demo_scheduled", amount: 8_200_000, lines: [["AFQ-PAY", 1], ["AFQ-BOOKS", 1]], closeIn: 45, createdDaysAgo: 14, nextStep: "Demo with owner and accountant" });
  await mkDeal({ key: "accra", name: "Accra Bridge Retail — Pay (GHS)", co: "Accra", contact: "Accra:Mensah", owner: "emeka", stage: "discovery", amount: 5_500_000, lines: [["AFQ-PAY", 1]], closeIn: 60, createdDaysAgo: 9, nextStep: "Confirm Ghana settlement bank requirements" });
  await mkDeal({ key: "savannah", name: "Savannah Clinics — People payroll", co: "Savannah", contact: "Savannah:Kamau", owner: "fatima", stage: "qualified", amount: 3_600_000, lines: [["AFQ-PEOPLE", 1]], closeIn: 40, createdDaysAgo: 22, nextStep: "Send KES payroll statutory checklist", lastActivityDaysAgo: 19 });
  await mkDeal({ key: "owerri", name: "Owerri Builders — Books starter", co: "Owerri", contact: "Owerri:Iwu", owner: "emeka", stage: "verbal", amount: 9_500_000, lines: [["AFQ-BOOKS", 1]], closeIn: 7, createdDaysAgo: 40, nextStep: "Collect signed order form", start: 14 });
  await db.update(s.deals).set({ billingFrequency: "Annually" }).where(eq(s.deals.id, D.owerri));
  await mkDeal({ key: "kanem2", name: "Kanem Logistics — Pay for driver collections (upsell)", co: "Kanem", contact: "Kanem:Abdullahi", owner: "emeka", stage: "demo_completed", amount: 6_000_000, lines: [["AFQ-PAY", 1]], closeIn: 25, createdDaysAgo: 12, nextStep: "Proposal for COD collections" });
  await mkDeal({ key: "lostA", name: "Ikeja Fresh Foods — Fleet (lost)", co: "Ikeja", contact: "Ikeja:Balogun", owner: "fatima", stage: "proposal", amount: 7_200_000, lines: [["AFQ-FLEET", 1]], closeIn: -20, createdDaysAgo: 70 });
  await mkDeal({ key: "lostB", name: "Port Harcourt Energy — Payroll (lost)", co: "Port", contact: "Port:Briggs", owner: "emeka", stage: "negotiation", amount: 9_600_000, lines: [["AFQ-PEOPLE", 2]], closeIn: -35, createdDaysAgo: 120 });
  await sales.moveDealStage(db, await A("fatima"), D.lostA, ST("lost").id, { lossReason: "Price / budget", lossNotes: "Chose a cheaper GPS-only tracker." });
  await sales.moveDealStage(db, emeka, D.lostB, ST("lost").id, { lossReason: "Chose competitor", lossNotes: "Incumbent HR vendor offered a 3-year freeze." });
  await db.update(s.deals).set({ closedAt: ago(18) }).where(eq(s.deals.id, D.lostA));
  await db.update(s.deals).set({ closedAt: ago(33) }).where(eq(s.deals.id, D.lostB));

  // ------------------------------------------------------------------ Handovers & onboarding scenarios
  const fullChecklist = (co: string, extra: Record<string, string> = {}) => ({
    customerName: co, primaryContact: "See deal primary contact", secondaryContacts: "Finance and IT leads listed on the account",
    productsSold: "As per deal line items", agreementReference: "Signed MSA on file", pricing: "Per deal value, billed annually", startDate: d(7), paymentStatus: "Invoice issued",
    discount: "None", goals: "Close month-end in 5 days; real-time cash visibility; reduce manual reconciliation.",
    currentProcesses: "Excel workbooks and a legacy desktop package; approvals by email.", commitments: "No commitments beyond standard scope; standard SLA.",
    technicalReadiness: "IT lead available 2 days/week; opening balances available; no custom integrations.",
    trainingNeeds: "2 administrators and ~10 end users; prefers mornings; WhatsApp group for coordination.", targetGoLive: d(30), goLiveReason: "Aligned to start of next financial month.",
    documents: "Proposal v3, signed order form, discovery notes (shared drive link)", risks: "Data quality of opening balances to be confirmed.", salesExecutive: "", ...extra,
  });
  const ob = await A("onboarding");
  const ib = await A("ibrahim");
  const fatima = await A("fatima");

  const hKanem = await won("kanem", "emeka", 50);
  await handover.saveHandoverChecklist(db, emeka, hKanem.id, fullChecklist("Kanem Logistics Ltd", { salesExecutive: "Emeka Nwosu", targetGoLive: d(-5), productsSold: "Afrilinq Fleet for 60 vehicles; implementation; 3 training days", goLiveReason: "Before harmattan peak season." }));
  await handover.submitHandover(db, emeka, hKanem.id);
  const pKanem = await handover.acceptHandover(db, ob, hKanem.id, { comment: "Complete and clear. Ibrahim will lead.", onboardingOwnerId: U.ibrahim });

  const hCal = await won("calabar", "fatima", 180);
  await handover.saveHandoverChecklist(db, fatima, hCal.id, fullChecklist("Calabar Marine Services", { salesExecutive: "Fatima Bello" }));
  await handover.submitHandover(db, fatima, hCal.id);
  const pCal = await handover.acceptHandover(db, ob, hCal.id, { comment: "Accepted. Standard SME rollout.", onboardingOwnerId: U.onboarding });

  const hJos = await won("jos", "fatima", 330);
  await handover.saveHandoverChecklist(db, fatima, hJos.id, fullChecklist("Jos Highlands Schools", { salesExecutive: "Fatima Bello" }));
  await handover.submitHandover(db, fatima, hJos.id);
  const pJos = await handover.acceptHandover(db, ob, hJos.id, { comment: "Accepted.", onboardingOwnerId: U.ibrahim });

  const hObudu = await won("obudu", "emeka", 34);
  await handover.saveHandoverChecklist(db, emeka, hObudu.id, fullChecklist("Obudu Agro Processing", { salesExecutive: "Emeka Nwosu", targetGoLive: d(6), commitments: "Promised settlement to two bank accounts and a custom daily settlement email (not standard).", goLiveReason: "Customer's new collections season starts next week." }));
  await handover.submitHandover(db, emeka, hObudu.id);
  const pObudu = await handover.acceptHandover(db, ob, hObudu.id, { comment: "Accepted; note the custom settlement email commitment needs product sign-off.", onboardingOwnerId: U.onboarding });

  const hAbuja = await won("abuja", "fatima", 6);
  await handover.saveHandoverChecklist(db, fatima, hAbuja.id, fullChecklist("Abuja Civic Water Board", { salesExecutive: "Fatima Bello", targetGoLive: d(70), risks: "Procurement approvals for Phase 2 not yet secured; data migration from legacy billing system." }));
  await handover.submitHandover(db, fatima, hAbuja.id);
  await handover.acceptHandover(db, ob, hAbuja.id, { comment: "Accepted. Enterprise template applies.", onboardingOwnerId: U.ibrahim });

  const hLekki = await won("lekki", "emeka", 12);
  await handover.saveHandoverChecklist(db, emeka, hLekki.id, fullChecklist("Lekki Pearl Hospitals", { salesExecutive: "Emeka Nwosu", targetGoLive: d(50), commitments: "Integration with existing hospital billing (HL7 export) — discovery required.", productsSold: "Afrilinq Books ERP, implementation, data migration from legacy system" }));
  await handover.submitHandover(db, emeka, hLekki.id); // left in "Submitted for Review" for the demo

  const hIbadan = await won("ibadan", "fatima", 15);
  await handover.saveHandoverChecklist(db, fatima, hIbadan.id, fullChecklist("Ibadan Textile Works", { salesExecutive: "Fatima Bello" }));
  await handover.submitHandover(db, fatima, hIbadan.id);
  await handover.requestHandoverChanges(db, ob, hIbadan.id, "Payroll statutory details (pension PFA list, PAYE state) are missing from technical readiness, and the go-live date reason is unclear.");

  const hZuma = await won("zuma", "emeka", 3); // left in "Pending Sales Submission" with prefilled items only
  void hZuma;

  // Shift project timelines so they look like real projects in flight.
  const shift = async (projectId: string, days: number, doneUpTo: number) => {
    const ts = await db.select().from(s.onboardingTasks).where(eq(s.onboardingTasks.projectId, projectId));
    for (const t of ts) {
      const due = t.dueDate ? addDays(t.dueDate, -days) : null;
      await db.update(s.onboardingTasks).set({ dueDate: due, status: t.position <= doneUpTo ? "done" : t.status, completedAt: t.position <= doneUpTo ? ago(days - t.position) : null }).where(eq(s.onboardingTasks.id, t.id));
    }
    const [p] = await db.select().from(s.onboardingProjects).where(eq(s.onboardingProjects.id, projectId));
    await db.update(s.onboardingProjects).set({ kickoffDate: p.kickoffDate ? addDays(p.kickoffDate, -days) : null, createdAt: ago(days) }).where(eq(s.onboardingProjects.id, projectId));
  };
  await shift(pKanem, 45, 4);
  await db.update(s.onboardingProjects).set({ targetGoLive: d(-3) }).where(eq(s.onboardingProjects.id, pKanem));
  await onboarding.setProjectStage(db, ib, pKanem, "data_migration", null);
  await onboarding.addBlocker(db, ib, pKanem, { description: "Customer GPS devices on 12 trucks report stale firmware; vendor replacing units.", severity: "medium", ownerId: U.ibrahim, customerSide: true });

  await shift(pObudu, 30, 3);
  await db.update(s.onboardingProjects).set({ targetGoLive: d(6) }).where(eq(s.onboardingProjects.id, pObudu));
  await onboarding.setProjectStage(db, ob, pObudu, "configuration", null);
  await onboarding.addBlocker(db, ob, pObudu, { description: "Product has not approved the custom daily settlement email promised by Sales.", severity: "high", ownerId: U.onboarding, customerSide: false });

  for (const [pid, days, owner] of [[pCal, 170, ob], [pJos, 320, ib]] as const) {
    await shift(pid, days, 99);
    const [p] = await db.select().from(s.onboardingProjects).where(eq(s.onboardingProjects.id, pid));
    await onboarding.updateGoLiveChecklist(db, owner, pid, p.goLiveChecklist.map(() => ({ label: "", done: true })));
    await onboarding.setProjectStage(db, owner, pid, "post_go_live", null);
  }
  const completeLater = [[pCal, ob, -150], [pJos, ib, -300]] as const;

  // ------------------------------------------------------------------ Training
  const funke = await A("trainer");
  const mkSession = async (prog: string, co: string, projectId: string | null, facilitator: string, startOffsetDays: number, contactsKeys: string[], title: string, hour = 10) => {
    const st = new Date(`${d(startOffsetDays)}T${String(hour - 1).padStart(2, "0")}:00:00Z`);
    return training.scheduleSession(db, ob, {
      programId: PR(prog).id, companyId: C[co], onboardingProjectId: projectId, facilitatorId: U[facilitator], title, startsAt: st, durationMinutes: null,
      channel: "virtual", location: null, meetingLink: "https://meet.afrilinq.example/training-room", agenda: "Objectives, hands-on exercises, Q&A", isRefresher: false,
      contactIds: contactsKeys.map((k) => K[k]),
    });
  };
  const sCal = await mkSession("Afrilinq Books — Finance", "Calabar", pCal, "trainer", -160, ["Calabar:Udo", "Calabar:Bassey"], "Calabar Marine — Finance users");
  for (const p of await db.select().from(s.trainingParticipants).where(eq(s.trainingParticipants.sessionId, sCal.id)))
    await training.recordAttendance(db, funke, p.id, { attendance: "attended", completed: true, competency: "competent", needsRetraining: false, feedbackScore: 5, feedback: "Clear and practical." });
  await training.completeSession(db, funke, sCal.id, "Journals, invoices, bank reconciliation, VAT report");
  const sCal2 = await mkSession("Afrilinq Books — Administrator", "Calabar", pCal, "trainer", -158, ["Calabar:Bassey"], "Calabar Marine — Administrator");
  for (const p of await db.select().from(s.trainingParticipants).where(eq(s.trainingParticipants.sessionId, sCal2.id)))
    await training.recordAttendance(db, funke, p.id, { attendance: "attended", completed: true, competency: "proficient", needsRetraining: false, feedbackScore: 4, feedback: null });
  await training.completeSession(db, funke, sCal2.id, "Users, roles, approval workflows, period close");

  const sJos = await mkSession("Afrilinq People", "Jos", pJos, "segun", -300, ["Jos:Pam", "Jos:Dung"], "Jos Highlands — Payroll run");
  const segun = await A("segun");
  const jp = await db.select().from(s.trainingParticipants).where(eq(s.trainingParticipants.sessionId, sJos.id));
  await training.recordAttendance(db, segun, jp[0].id, { attendance: "attended", completed: true, competency: "competent", needsRetraining: false, feedbackScore: 3, feedback: "Too fast for first payroll." });
  await training.recordAttendance(db, segun, jp[1].id, { attendance: "absent", completed: false, competency: "not_assessed", needsRetraining: true, feedbackScore: null, feedback: null });
  await training.completeSession(db, segun, sJos.id, "Employee records, payroll run, payslips");
  for (const [pid, owner, goLive] of completeLater) {
    await onboarding.completeProject(db, owner, pid, {
      notes: "Customer live; hypercare completed and support route handed over.", actualGoLive: d(goLive),
      exceptionReason: pid === pJos ? "Bursar missed payroll training; refresher session to be booked. Approved by Head of Onboarding." : null,
    });
    await db.update(s.onboardingProjects).set({ completedAt: ago(-goLive) }).where(eq(s.onboardingProjects.id, pid));
  }

  await mkSession("Afrilinq Fleet", "Kanem", pKanem, "trainer", 2, ["Kanem:Sani", "Kanem:Yakubu"], "Kanem Logistics — Dispatcher training");
  await mkSession("Afrilinq Pay", "Obudu", pObudu, "segun", 4, ["Obudu:Obi", "Obudu:Ikpi"], "Obudu Agro — Merchant operations");
  const ref = await mkSession("Refresher: Reporting", "Calabar", null, "trainer", 0, ["Calabar:Udo"], "Calabar Marine — Reporting refresher", 14);
  await db.update(s.trainingSessions).set({ isRefresher: true }).where(eq(s.trainingSessions.id, ref.id));

  // ------------------------------------------------------------------ Activities & tasks
  const log = async (who: string, v: Record<string, unknown>, at: Date) => {
    const a = await activitiesSvc.logActivity(db, await A(who), v);
    await db.update(s.activities).set({ occurredAt: at }).where(eq(s.activities.id, a.id));
  };
  await log("emeka", { type: "demo", subject: "Fleet demo with operations team", dealId: D.kanem, contactId: K["Kanem:Abdullahi"], outcome: "Strong fit; asked for COD collections" }, ago(100));
  await log("emeka", { type: "call", subject: "Proposal walkthrough call", dealId: D.enugu, contactId: K["Enugu:Eze"], outcome: "CFO wants phased payment" }, ago(4));
  await log("emeka", { type: "proposal", subject: "Proposal v2 sent — Group ERP", dealId: D.ph, contactId: K["Port:Briggs"] }, ago(9));
  await log("emeka", { type: "whatsapp", subject: "Shared settlement bank checklist", dealId: D.accra, contactId: K["Accra:Mensah"], body: "Logged WhatsApp conversation (sent from phone)." }, ago(2));
  await log("fatima", { type: "meeting", subject: "Discovery workshop at Water Board HQ", dealId: D.abuja, contactId: K["Abuja:Garba"], outcome: "Phase 1 scope agreed" }, ago(60));
  await log("fatima", { type: "email", subject: "Sent demo agenda", dealId: D.ikeja, contactId: K["Ikeja:Balogun"] }, ago(1));
  await log("ibrahim", { type: "meeting", subject: "Weekly implementation check-in", companyId: C.Kanem, contactId: K["Kanem:Yakubu"], outcome: "Migration trial load next week" }, ago(3));
  await log("onboarding", { type: "call", subject: "Escalation call on settlement email commitment", companyId: C.Obudu, contactId: K["Obudu:Ayuk"], outcome: "Customer unhappy; wants written timeline" }, ago(1));
  await log("ibrahim", { type: "call", subject: "Quarterly check-in", companyId: C.Jos, contactId: K["Jos:Dung"], outcome: "Payroll errors last month; considering alternatives" }, ago(41));
  // Today's appointments for the sales workspace
  for (const [who, deal, contact, subj, hour] of [["emeka", "enugu", "Enugu:Eze", "Pricing session with CFO", 11], ["emeka", "owerri", "Owerri:Iwu", "Order form signing visit", 15], ["fatima", "ikeja", "Ikeja:Balogun", "Product demo", 13]] as const) {
    const at = new Date(`${today}T${hour - 1}:00:00Z`);
    const a = await activitiesSvc.logActivity(db, await A(who), { type: "meeting", subject: subj, dealId: D[deal], contactId: K[contact], scheduledFor: at.toISOString() });
    await db.update(s.activities).set({ occurredAt: at }).where(eq(s.activities.id, a.id));
  }
  await db.insert(s.tasks).values([
    { title: "Send revised MSA redlines to legal", ownerId: U.emeka, dueAt: ago(1), priority: "high", relatedType: "deal", relatedId: D.ph, companyId: C.Port },
    { title: "Confirm Accra settlement bank", ownerId: U.emeka, dueAt: new Date(now.getTime() + 3 * 3600000), relatedType: "deal", relatedId: D.accra, companyId: C.Accra },
    { title: "Complete Zuma handover checklist", ownerId: U.emeka, dueAt: new Date(now.getTime() + 6 * 3600000), priority: "urgent", relatedType: "deal", relatedId: D.zuma, companyId: C.Zuma },
    { title: "Prepare tender documents for Kogi revenue", ownerId: U.fatima, dueAt: new Date(now.getTime() + 2 * 86400000), relatedType: "company", companyId: C.Abuja },
    { title: "Review Obudu go-live readiness", ownerId: U.onboarding, dueAt: new Date(now.getTime() + 86400000), priority: "high", relatedType: "onboarding", relatedId: pObudu, companyId: C.Obudu },
  ]);

  // ------------------------------------------------------------------ Tickets
  const kel = await A("support");
  const lead = await A("support.lead");
  const aisha = await A("aisha");
  const tk = async (who: Awaited<ReturnType<typeof A>>, createdHoursAgo: number, v: Record<string, unknown>) =>
    tickets.createTicket(db, who, { channel: "email", ignoreDuplicates: true, ...v }, { now: new Date(now.getTime() - createdHoursAgo * 3600000) });
  const backdate = async (id: string, patch: Partial<typeof s.tickets.$inferInsert>) => db.update(s.tickets).set(patch).where(eq(s.tickets.id, id));

  const t1 = await tk(kel, 3, { subject: "Settlements not reaching bank since 06:00", description: "No settlement credits for yesterday's collections. Customers' transfers show successful.", companyId: C.Obudu, contactId: K["Obudu:Ayuk"], productId: P("AFQ-PAY").id, category: "Integration", subcategory: "Payment gateway", impact: "multiple_users", urgency: "critical", businessImpact: "≈₦18m of collections not settled; payroll for 400 farm workers due tomorrow.", affectedUsers: 40 });
  await tickets.replyToTicket(db, aisha, t1.id, "We're investigating the settlement batch for your account and will update you within the hour.");
  await tickets.escalateTicket(db, lead, t1.id, { kind: "engineering", severity: "P2", reason: "Settlement batch job failing for one merchant", requestedTeamId: team("Platform Engineering"), reproductionSteps: "Trigger settlement for merchant OBU-001 in admin console.", expectedResult: "Batch posts to bank API", actualResult: "Batch stuck in PENDING; bank API returns 422", environment: "Production, settlement-worker v4.12", evidence: "Worker log excerpt attached internally", customerImpact: "No settlements since 06:00", workaround: "Manual settlement file upload (finance approval needed)", businessConsequence: "Customer payroll at risk; churn risk on new account" });
  await tickets.addInternalNote(db, lead, t1.id, "Customer is already unhappy about the settlement email commitment. Keep updates frequent. Do NOT promise a fix time until engineering confirms root cause.");
  await tickets.addEngineeringUpdate(db, await A("engineering"), (await db.select().from(s.ticketEscalations).where(eq(s.ticketEscalations.ticketId, t1.id)))[0].id, { body: "Bank rejected batch due to new narration length limit (max 30 chars). Hotfix in review.", engineeringStatus: "fix_in_progress", rootCause: "Bank API narration length validation change", fixVersion: "settlement-worker 4.12.1" });

  const t2 = await tk(kel, 30, { subject: "Payroll PAYE schedule shows wrong state", description: "Our PAYE schedule lists Lagos instead of Plateau for all staff.", companyId: C.Jos, contactId: K["Jos:Pam"], productId: P("AFQ-PEOPLE").id, category: "Data & Reporting", subcategory: "Report incorrect", impact: "multiple_users", urgency: "high", businessImpact: "Statutory remittance due this week.", workaroundAvailable: false });
  await backdate(t2.id, { firstRespondedAt: null });

  const t3 = await tk(kel, 50, { subject: "How do I add a new cost centre?", description: "We opened a new branch and need a cost centre for it.", companyId: C.Calabar, contactId: K["Calabar:Udo"], productId: P("AFQ-BOOKS").id, category: "How-to / Training", impact: "single_user", urgency: "low" });
  await tickets.replyToTicket(db, kel, t3.id, "Go to Settings → Cost centres → New. I've linked our guide. Could you confirm the branch code you want to use?");
  await tickets.changeTicketStatus(db, kel, t3.id, "waiting_on_customer", { waitingReason: "Branch code for the new cost centre", followUpAt: new Date(now.getTime() + 86400000) });

  const t4 = await tk(kel, 8, { subject: "Driver app crashes on proof-of-delivery photo", description: "Android drivers report the app closes when attaching a photo.", companyId: C.Kanem, contactId: K["Kanem:Sani"], productId: P("AFQ-FLEET").id, category: "Functional Defect", subcategory: "Mobile app", impact: "multiple_users", urgency: "medium", businessImpact: "Drivers fall back to paper POD.", workaroundAvailable: true, workaround: "Capture photo first, then attach from gallery." });

  const t5 = await tk(kel, 1, { subject: "Cannot log in after password reset", description: "Reset email received but new password is rejected.", companyId: C.Calabar, contactId: K["Calabar:Bassey"], productId: P("AFQ-BOOKS").id, category: "Access & Login", subcategory: "Password reset", impact: "single_user", urgency: "medium" });
  await backdate(t5.id, { ownerId: null, status: "new" });

  const t6 = await tk(lead, 75, { subject: "Bank reconciliation import rejects GTB statement", description: "CSV statement from bank fails with 'column mismatch'.", companyId: C.Calabar, contactId: K["Calabar:Udo"], productId: P("AFQ-BOOKS").id, category: "Data & Reporting", subcategory: "Import / migration", impact: "single_user", urgency: "high" });
  await backdate(t6.id, { firstRespondedAt: new Date(now.getTime() - 74 * 3600000) });

  const t7 = await tk(kel, 200, { subject: "Payslip PDF missing pension line", description: "Pension deduction not shown on payslip PDF.", companyId: C.Jos, contactId: K["Jos:Pam"], productId: P("AFQ-PEOPLE").id, category: "Functional Defect", impact: "multiple_users", urgency: "medium", businessImpact: "Staff queries to bursar.", workaroundAvailable: true });
  await tickets.replyToTicket(db, kel, t7.id, "Thanks — we've reproduced this and are fixing the template.");
  await tickets.resolveTicket(db, kel, t7.id, { resolutionSummary: "Payslip template updated to include pension deduction line; regenerated last month's payslips.", resolutionCode: "Fixed — product defect resolved", rootCause: null, rootCauseFollowUpOwnerId: null });
  await tickets.reopenTicket(db, kel, t7.id, "Customer reports voluntary pension contributions still missing.");

  const t8 = await tk(kel, 400, { subject: "Invoice numbering restarted at 1", description: "After year-end, invoice numbers restarted.", companyId: C.Calabar, contactId: K["Calabar:Udo"], productId: P("AFQ-BOOKS").id, category: "Functional Defect", impact: "single_user", urgency: "medium" });
  await tickets.replyToTicket(db, kel, t8.id, "This is controlled by the numbering sequence setting; we've updated it for you.");
  await tickets.resolveTicket(db, kel, t8.id, { resolutionSummary: "Set invoice sequence to continue across financial years and renumbered drafts.", resolutionCode: "Fixed — configuration change", rootCause: null, rootCauseFollowUpOwnerId: null });
  await tickets.closeTicket(db, kel, t8.id, "Customer confirmed by phone");
  await backdate(t8.id, { csatScore: 5, csatComment: "Quick and friendly." });

  const t9 = await tk(kel, 150, { subject: "Payroll run took 40 minutes", description: "Monthly run very slow.", companyId: C.Jos, contactId: K["Jos:Dung"], productId: P("AFQ-PEOPLE").id, category: "Performance & Availability", subcategory: "Slow", impact: "single_user", urgency: "medium" });
  await tickets.replyToTicket(db, aisha, t9.id, "We've optimised your payroll run configuration.");
  await tickets.resolveTicket(db, aisha, t9.id, { resolutionSummary: "Removed duplicated pay elements causing recalculation loops.", resolutionCode: "Fixed — configuration change", rootCause: null, rootCauseFollowUpOwnerId: null });
  await tickets.closeTicket(db, aisha, t9.id, "No response after 5 days");
  await backdate(t9.id, { csatScore: 2, csatComment: "Took too long and payroll was late." });

  const t10 = await tk(kel, 20, { subject: "Request: export trips to Excel by depot", description: "Would like a depot filter on the trips export.", companyId: C.Kanem, contactId: K["Kanem:Abdullahi"], productId: P("AFQ-FLEET").id, category: "Feature Request", impact: "minimal", urgency: "low" });
  void t10;
  const t11 = await tk(kel, 4, { subject: "Webhook signature validation failing", description: "Our callback rejects signatures since this morning.", companyId: C.Obudu, contactId: K["Obudu:Agbor"], productId: P("AFQ-PAY").id, category: "Integration", subcategory: "Webhook", impact: "single_user", urgency: "high" });
  void t11;
  const t12 = await tk(kel, 26, { subject: "Need training on settlement reports", description: "New cashier supervisor needs onboarding on reports.", companyId: C.Obudu, contactId: K["Obudu:Ikpi"], productId: P("AFQ-PAY").id, category: "How-to / Training", impact: "single_user", urgency: "low" });
  void t12;

  // Run sweeps so SLA warnings/breaches, risk flags, health and automation reflect the seeded state.
  await sweep.runAllSweeps(db, now);

  // ------------------------------------------------------------------ Customer success
  await db.insert(s.renewals).values([
    { companyId: C.Jos, dealId: D.jos, productId: P("AFQ-PEOPLE").id, renewalDate: d(45), amount: 4_800_000, ownerId: U.ibrahim, notes: "At risk — payroll complaints." },
    { companyId: C.Calabar, dealId: D.calabar, productId: P("AFQ-BOOKS").id, renewalDate: d(185), amount: 9_500_000, ownerId: U.onboarding },
    { companyId: C.Kanem, dealId: D.kanem, productId: P("AFQ-FLEET").id, renewalDate: d(315), amount: 7_200_000, ownerId: U.ibrahim },
    { companyId: C.Obudu, dealId: D.obudu, productId: P("AFQ-PAY").id, renewalDate: d(331), amount: 6_000_000, ownerId: U.onboarding },
  ]);
  await db.insert(s.expansionOpportunities).values([
    { companyId: C.Kanem, productId: P("AFQ-PAY").id, kind: "cross_sell", description: "COD collections for drivers", estimatedValue: 6_000_000, status: "qualified", ownerId: U.emeka, dealId: D.kanem2 },
    { companyId: C.Calabar, productId: P("AFQ-PEOPLE").id, kind: "cross_sell", description: "Payroll for 60 crew members", estimatedValue: 3_200_000, status: "identified", ownerId: U.onboarding },
  ]);
  await sweep.runAutomationSweep(db, now);

  // ------------------------------------------------------------------ Knowledge base & SOPs
  const kb = (title: string, category: string, audience: string, body: string, opts: { sop?: boolean; product?: string; tags?: string[]; status?: string; summary?: string } = {}) => ({
    title, category, audience, body, summary: opts.summary ?? body.split("\n")[0].slice(0, 160), isSop: !!opts.sop, productId: opts.product ? P(opts.product).id : null,
    tags: opts.tags ?? [], status: opts.status ?? "published", authorId: U["support.lead"], ownerId: U["support.lead"], reviewerId: U.admin, publishedAt: (opts.status ?? "published") === "published" ? ago(30) : null,
  });
  await db.insert(s.knowledgeArticles).values([
    kb("SOP: Sales discovery call", "Sales playbook", "internal", "Purpose: qualify need, fit, timing, decision process and budget.\n\n## Before the call\n- Review the lead source and any prior activity\n- Prepare 3 hypotheses about the customer's pain\n\n## During the call\n- Confirm the problem in the customer's words\n- Map decision-makers and the buying process\n- Agree a next step with a date\n\n## After the call\n- Log the call with outcome and update qualification fields within 24 hours", { sop: true, tags: ["sales", "qualification"] }),
    kb("SOP: Demo preparation", "Sales playbook", "internal", "Purpose: run demos tailored to discovered pain points.\n\n- Confirm attendees and roles 48h before\n- Load a demo tenant with the customer's industry data\n- Rehearse the 3 scenarios that map to their pain\n- Log the demo; the follow-up task is created automatically", { sop: true, tags: ["sales", "demo"] }),
    kb("SOP: Closed-won handover", "Onboarding playbook", "internal", "Purpose: make sure onboarding inherits every promise made in the sale.\n\n- Moving a deal to Closed Won creates the handover automatically\n- Complete every required checklist item; write “None” rather than leaving blanks\n- List ALL commitments: features, custom work, integrations, dates\n- Submit; onboarding will accept or return with comments\n- After acceptance, request corrections through the handover page only", { sop: true, tags: ["handover"] }),
    kb("SOP: Onboarding kickoff", "Onboarding playbook", "internal", "Purpose: align on scope, plan and responsibilities.\n\n- Review handover commitments and risks before the meeting\n- Confirm customer project lead, technical contact and training coordinator\n- Walk through milestones and customer responsibilities\n- Record kickoff notes and mark the milestone complete", { sop: true, tags: ["onboarding"] }),
    kb("SOP: Go-live readiness review", "Onboarding playbook", "internal", "Purpose: go live only when the customer is ready.\n\n- Every go-live checklist item must be confirmed or marked N/A with a note\n- Required training must be complete, or an exception approved and recorded\n- Communicate the support route and escalation contacts\n- The onboarding owner confirms completion with go-live notes", { sop: true, tags: ["go-live"] }),
    kb("SOP: Ticket triage", "Support runbook", "internal", "Purpose: classify consistently by impact and urgency — not by tone.\n\n- Confirm the affected product, users and business impact\n- Ask whether a workaround exists\n- Suspected security/data incidents and outages are always P1 and start the incident workflow\n- Check for duplicates before creating a new ticket", { sop: true, tags: ["triage", "priority"] }),
    kb("SOP: Incident escalation", "Support runbook", "internal", "Purpose: contain and communicate during P1 incidents.\n\n- The incident is opened automatically for P1 security/data/outage tickets\n- Support Lead coordinates; update the customer every 30 minutes\n- Translate engineering updates into customer-safe language\n- Never state an incident is fixed without evidence and a responsible confirmer", { sop: true, tags: ["incident", "P1"] }),
    kb("SOP: Ticket closure", "Support runbook", "internal", "Purpose: close cleanly and learn.\n\n- Resolution summary and category are mandatory\n- High-impact tickets need a root cause, or “Root cause not yet known” with a follow-up owner\n- Customer confirms resolution or the ticket auto-closes per policy\n- Post-incident review task is created for P1/P2", { sop: true, tags: ["closure"] }),
    kb("Runbook: Payment gateway settlement failures", "Support runbook", "internal", "Internal only. Steps to diagnose stuck settlement batches.\n\n1. Check the settlement-worker dashboard for PENDING batches\n2. Inspect bank API response codes\n3. If 422, check narration and account-name validation rules\n4. Escalate to Platform Engineering with batch IDs", { product: "AFQ-PAY", tags: ["settlement", "pay", "bank"] }),
    kb("How to reset your password", "Getting started", "customer", "If you've forgotten your password, click “Forgot password” on the sign-in page and follow the email link within 30 minutes.\n\nIf the new password is rejected, make sure it has at least 10 characters with letters and numbers, and that you're using the most recent email link.", { tags: ["login", "password", "reset"] }),
    kb("Reconciling Afrilinq Pay settlements", "Billing", "customer", "Settlements are paid to your registered account each business day.\n\nUse Reports → Settlements to match collections to bank credits. Settlement references appear in your bank narration.", { product: "AFQ-PAY", tags: ["settlement", "reconciliation", "bank"] }),
    kb("Importing bank statements into Afrilinq Books", "Integrations", "customer", "Go to Banking → Import statement. Supported formats: CSV and OFX.\n\nIf you see “column mismatch”, download the template and map your bank's columns to Date, Description, Debit, Credit.", { product: "AFQ-BOOKS", tags: ["bank", "import", "reconciliation", "statement"] }),
    kb("Running your first payroll", "Getting started", "customer", "Before your first run: confirm employee records, pay elements, PAYE state and pension fund administrators.\n\nThen go to Payroll → New run, review the variance report and approve.", { product: "AFQ-PEOPLE", tags: ["payroll", "paye", "pension"] }),
    kb("Draft: Fleet proof-of-delivery best practice", "Troubleshooting", "customer", "Guidance for drivers capturing proof-of-delivery photos on low-end Android devices.\n\nCapture first, then attach from gallery.", { product: "AFQ-FLEET", status: "in_review", tags: ["fleet", "pod", "mobile"] }),
  ]);
  return true;
}
