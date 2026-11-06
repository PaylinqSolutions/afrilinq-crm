import {
  pgTable, uuid, text, integer, boolean, timestamp, numeric, jsonb, date, serial, bigint, real,
  index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 16, scale: 2, mode: "number" });
const created = () => ts("created_at").defaultNow().notNull();
const updated = () => ts("updated_at").defaultNow().notNull();

// ---------------------------------------------------------------------------
// Identity, access control, configuration
// ---------------------------------------------------------------------------

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  kind: text("kind").notNull(), // sales | onboarding | training | support | engineering | finance | management
  createdAt: created(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  title: text("title"),
  phone: text("phone"),
  passwordHash: text("password_hash"),
  teamId: uuid("team_id").references(() => teams.id),
  managerId: uuid("manager_id"),
  active: boolean("active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: created(),
  updatedAt: updated(),
  deletedAt: ts("deleted_at"),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(true),
});

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  category: text("category").notNull(),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionKey: text("permission_key").notNull().references(() => permissions.key, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })]);

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the session token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: created(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  teamId: uuid("team_id").references(() => teams.id),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  revokedAt: ts("revoked_at"),
  createdAt: created(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updated(),
});

export const customFields = pgTable("custom_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(), // company | deal | ticket
  key: text("key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull(), // text | number | date | select
  options: jsonb("options").$type<string[]>(),
  required: boolean("required").notNull().default(false),
  createdAt: created(),
}, (t) => [uniqueIndex("custom_fields_entity_key").on(t.entityType, t.key)]);

export const customFieldValues = pgTable("custom_field_values", {
  fieldId: uuid("field_id").notNull().references(() => customFields.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull(),
  value: text("value"),
}, (t) => [primaryKey({ columns: [t.fieldId, t.entityId] })]);

export const savedViews = pgTable("saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  createdAt: created(),
});

// ---------------------------------------------------------------------------
// Accounts, contacts, catalog
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  industry: text("industry"),
  segment: text("segment").notNull().default("SME"), // SME | Mid-Market | Enterprise | Public Sector
  tier: text("tier").notNull().default("Standard"), // Standard | Premium | Strategic
  lifecycle: text("lifecycle").notNull().default("prospect"), // prospect | customer | churned
  region: text("region"),
  city: text("city"),
  address: text("address"),
  website: text("website"),
  phone: text("phone"),
  ownerId: uuid("owner_id").references(() => users.id),
  csmId: uuid("csm_id").references(() => users.id),
  billingStatus: text("billing_status"), // current | overdue | unpaid | n/a
  billingNotes: text("billing_notes"),
  notes: text("notes"), // shown as the company description
  postalCode: text("postal_code"),
  employees: integer("employees"),
  annualRevenue: money("annual_revenue"),
  timeZone: text("time_zone"),
  linkedinUrl: text("linkedin_url"),
  leadStatus: text("lead_status"), // same vocabulary as contacts
  recordSource: text("record_source").notNull().default("CRM UI"),
  createdAt: created(),
  updatedAt: updated(),
  deletedAt: ts("deleted_at"),
}, (t) => [index("companies_owner_idx").on(t.ownerId), index("companies_name_idx").on(t.name)]);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  jobTitle: text("job_title"),
  contactRoles: jsonb("contact_roles").$type<string[]>().notNull().default([]),
  preferredChannel: text("preferred_channel"), // email | phone | whatsapp
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  ownerId: uuid("owner_id").references(() => users.id),
  leadStatus: text("lead_status"), // see CONTACT_LEAD_STATUSES
  lifecycleStage: text("lifecycle_stage").notNull().default("lead"),
  referralSource: text("referral_source"), // where the contact came from, e.g. an event or district meeting
  city: text("city"),
  createdAt: created(),
  updatedAt: updated(),
  deletedAt: ts("deleted_at"),
}, (t) => [index("contacts_company_idx").on(t.companyId), index("contacts_email_idx").on(t.email)]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // product | service
  description: text("description"),
  listPrice: money("list_price"),
  currency: text("currency").notNull().default("NGN"),
  billingFrequency: text("billing_frequency"),
  category: text("category"),
  unit: text("unit"), // e.g. "per licence / year", "per day", "one-off"
  managerId: uuid("manager_id").references(() => users.id),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").defaultNow().notNull(),
  updatedAt: ts("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export type Qualification = {
  need?: string; fit?: string; timing?: string; decisionProcess?: string; budget?: string; painPoints?: string;
};

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  organization: text("organization"), // optional: individuals (e.g. a doctor met at an event) have none
  contactName: text("contact_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source").notNull(),
  status: text("status").notNull().default("New"),
  ownerId: uuid("owner_id").references(() => users.id),
  productInterestId: uuid("product_interest_id").references(() => products.id),
  segment: text("segment"),
  region: text("region"),
  nextAction: text("next_action"),
  nextActionDue: ts("next_action_due"),
  qualification: jsonb("qualification").$type<Qualification>().notNull().default({}),
  disqualifyReason: text("disqualify_reason"),
  convertedAt: ts("converted_at"),
  convertedCompanyId: uuid("converted_company_id").references(() => companies.id),
  convertedContactId: uuid("converted_contact_id").references(() => contacts.id),
  convertedDealId: uuid("converted_deal_id"),
  lastActivityAt: ts("last_activity_at"),
  createdAt: created(),
  updatedAt: updated(),
  deletedAt: ts("deleted_at"),
}, (t) => [index("leads_owner_idx").on(t.ownerId), index("leads_status_idx").on(t.status)]);

export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: created(),
});

export const pipelineStages = pgTable("pipeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  probability: integer("probability").notNull(),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
  requiredFields: jsonb("required_fields").$type<string[]>().notNull().default([]),
  entryCriteria: text("entry_criteria"),
  exitCriteria: text("exit_criteria"),
  staleAfterDays: integer("stale_after_days").notNull().default(14),
}, (t) => [uniqueIndex("pipeline_stage_key").on(t.pipelineId, t.key)]);

export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  primaryContactId: uuid("primary_contact_id").references(() => contacts.id),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id),
  stageId: uuid("stage_id").notNull().references(() => pipelineStages.id),
  amount: money("amount"),
  currency: text("currency").notNull().default("NGN"),
  expectedCloseDate: date("expected_close_date"),
  probabilityOverride: integer("probability_override"),
  nextStep: text("next_step"),
  nextStepDue: date("next_step_due"),
  competitor: text("competitor"),
  lossReason: text("loss_reason"),
  lossNotes: text("loss_notes"),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2, mode: "number" }),
  discountStatus: text("discount_status").notNull().default("none"), // none | pending | approved | rejected
  discountApprovedBy: uuid("discount_approved_by").references(() => users.id),
  forecastCategory: text("forecast_category").notNull().default("pipeline"), // pipeline | best_case | commit | closed | omitted
  contractReference: text("contract_reference"),
  billingFrequency: text("billing_frequency"),
  startDate: date("start_date"),
  leadSource: text("lead_source"),
  stageEnteredAt: ts("stage_entered_at").defaultNow().notNull(),
  closedAt: ts("closed_at"),
  lastActivityAt: ts("last_activity_at"),
  createdAt: created(),
  updatedAt: updated(),
  deletedAt: ts("deleted_at"),
}, (t) => [
  index("deals_owner_idx").on(t.ownerId), index("deals_stage_idx").on(t.stageId), index("deals_company_idx").on(t.companyId),
]);

export const dealContacts = pgTable("deal_contacts", {
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  role: text("role"),
}, (t) => [primaryKey({ columns: [t.dealId, t.contactId] })]);

export const dealProducts = pgTable("deal_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: money("unit_price").notNull(),
});

export const dealStageHistory = pgTable("deal_stage_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  fromStageId: uuid("from_stage_id").references(() => pipelineStages.id),
  toStageId: uuid("to_stage_id").notNull().references(() => pipelineStages.id),
  changedBy: uuid("changed_by").references(() => users.id),
  durationSeconds: integer("duration_seconds"),
  changedAt: ts("changed_at").defaultNow().notNull(),
}, (t) => [index("deal_stage_history_deal_idx").on(t.dealId)]);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // call | email | meeting | demo | note | whatsapp | proposal | other
  subject: text("subject").notNull(),
  body: text("body"),
  outcome: text("outcome"),
  occurredAt: ts("occurred_at").defaultNow().notNull(),
  scheduledFor: ts("scheduled_for"),
  durationMinutes: integer("duration_minutes"),
  companyId: uuid("company_id").references(() => companies.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  dealId: uuid("deal_id").references(() => deals.id),
  leadId: uuid("lead_id").references(() => leads.id),
  ticketId: uuid("ticket_id"),
  onboardingProjectId: uuid("onboarding_project_id"),
  simulated: boolean("simulated").notNull().default(false),
  pinnedAt: ts("pinned_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [
  index("activities_company_idx").on(t.companyId), index("activities_deal_idx").on(t.dealId),
  index("activities_contact_idx").on(t.contactId), index("activities_lead_idx").on(t.leadId),
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  dueAt: ts("due_at"),
  remindAt: ts("remind_at"),
  priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
  status: text("status").notNull().default("open"), // open | done | cancelled
  stage: text("stage").notNull().default("not_started"), // not_started | in_progress | waiting | completed | deferred
  taskType: text("task_type").notNull().default("todo"), // todo | call | email | meeting | whatsapp
  queue: text("queue"),
  outcome: text("outcome"),
  relatedType: text("related_type"), // lead | deal | company | contact | ticket | onboarding | handover | training
  relatedId: uuid("related_id"),
  companyId: uuid("company_id").references(() => companies.id),
  dedupeKey: text("dedupe_key").unique(),
  createdBy: uuid("created_by").references(() => users.id),
  completedAt: ts("completed_at"),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index("tasks_owner_idx").on(t.ownerId, t.status), index("tasks_related_idx").on(t.relatedType, t.relatedId)]);

// ---------------------------------------------------------------------------
// Handover and onboarding
// ---------------------------------------------------------------------------

export type HandoverChecklist = Record<string, string>;

export const handoverRecords = pgTable("handover_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  dealId: uuid("deal_id").notNull().references(() => deals.id).unique(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  status: text("status").notNull().default("Pending Sales Submission"),
  checklist: jsonb("checklist").$type<HandoverChecklist>().notNull().default({}),
  completeness: integer("completeness").notNull().default(0),
  submittedBy: uuid("submitted_by").references(() => users.id),
  submittedAt: ts("submitted_at"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: ts("reviewed_at"),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  acceptedAt: ts("accepted_at"),
  reviewComment: text("review_comment"),
  overrideReason: text("override_reason"),
  overrideBy: uuid("override_by").references(() => users.id),
  returnCount: integer("return_count").notNull().default(0),
  correctionRequested: boolean("correction_requested").notNull().default(false),
  onboardingProjectId: uuid("onboarding_project_id"),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index("handover_status_idx").on(t.status)]);

export const handoverReviews = pgTable("handover_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoverId: uuid("handover_id").notNull().references(() => handoverRecords.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // created | submitted | changes_requested | accepted | override_accepted | correction_requested | correction_applied
  comment: text("comment"),
  missingFields: jsonb("missing_fields").$type<string[]>(),
  actorId: uuid("actor_id").references(() => users.id),
  createdAt: created(),
});

export const onboardingTemplates = pgTable("onboarding_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  productId: uuid("product_id").references(() => products.id),
  segment: text("segment"),
  description: text("description"),
  durationDays: integer("duration_days").notNull().default(45),
  goLiveChecklist: jsonb("go_live_checklist").$type<string[]>(),
  active: boolean("active").notNull().default(true),
});

export const onboardingTemplateTasks = pgTable("onboarding_template_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => onboardingTemplates.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  stageKey: text("stage_key").notNull(),
  offsetDays: integer("offset_days").notNull(),
  isMilestone: boolean("is_milestone").notNull().default(false),
  customerResponsibility: boolean("customer_responsibility").notNull().default(false),
  dependsOnPosition: integer("depends_on_position"),
});

export type GoLiveItem = { label: string; done: boolean; note?: string; na?: boolean };

export const onboardingProjects = pgTable("onboarding_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  dealId: uuid("deal_id").references(() => deals.id),
  handoverId: uuid("handover_id").references(() => handoverRecords.id).unique(),
  productId: uuid("product_id").references(() => products.id),
  templateId: uuid("template_id").references(() => onboardingTemplates.id),
  ownerId: uuid("owner_id").references(() => users.id),
  stage: text("stage").notNull().default("handover_review"),
  state: text("state").notNull().default("draft"), // draft | active | on_hold | completed
  riskLevel: text("risk_level").notNull().default("low"), // low | medium | high
  riskReasons: jsonb("risk_reasons").$type<string[]>().notNull().default([]),
  onHoldReason: text("on_hold_reason"),
  kickoffDate: date("kickoff_date"),
  targetGoLive: date("target_go_live"),
  actualGoLive: date("actual_go_live"),
  goLiveChecklist: jsonb("go_live_checklist").$type<GoLiveItem[]>().notNull().default([]),
  completionNotes: text("completion_notes"),
  completionException: text("completion_exception"),
  completedBy: uuid("completed_by").references(() => users.id),
  completedAt: ts("completed_at"),
  internalNotes: text("internal_notes"),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index("onboarding_company_idx").on(t.companyId), index("onboarding_owner_idx").on(t.ownerId)]);

export const onboardingTasks = pgTable("onboarding_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => onboardingProjects.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  stageKey: text("stage_key").notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  dueDate: date("due_date"),
  status: text("status").notNull().default("todo"), // todo | in_progress | blocked | done
  isMilestone: boolean("is_milestone").notNull().default(false),
  customerResponsibility: boolean("customer_responsibility").notNull().default(false),
  dependsOnTaskId: uuid("depends_on_task_id"),
  notes: text("notes"),
  evidenceUrl: text("evidence_url"),
  completedAt: ts("completed_at"),
}, (t) => [index("onboarding_tasks_project_idx").on(t.projectId)]);

export const onboardingBlockers = pgTable("onboarding_blockers", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => onboardingProjects.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  ownerId: uuid("owner_id").references(() => users.id),
  customerSide: boolean("customer_side").notNull().default(false),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  raisedAt: ts("raised_at").defaultNow().notNull(),
  resolvedAt: ts("resolved_at"),
});

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export const trainingPrograms = pgTable("training_programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  productId: uuid("product_id").references(() => products.id),
  audienceRole: text("audience_role").notNull(), // e.g. administrator, end_user, finance_user
  segment: text("segment"),
  description: text("description"),
  objectives: jsonb("objectives").$type<string[]>().notNull().default([]),
  requiredForGoLive: boolean("required_for_go_live").notNull().default(true),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
});

export const trainingSessions = pgTable("training_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => trainingPrograms.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  onboardingProjectId: uuid("onboarding_project_id").references(() => onboardingProjects.id),
  facilitatorId: uuid("facilitator_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  startsAt: ts("starts_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(120),
  channel: text("channel").notNull().default("virtual"), // onsite | virtual | hybrid
  location: text("location"),
  meetingLink: text("meeting_link"),
  agenda: text("agenda"),
  status: text("status").notNull().default("scheduled"), // scheduled | completed | cancelled | rescheduled
  isRefresher: boolean("is_refresher").notNull().default(false),
  topicsCovered: text("topics_covered"),
  notes: text("notes"),
  createdAt: created(),
}, (t) => [index("training_sessions_company_idx").on(t.companyId), index("training_sessions_facilitator_idx").on(t.facilitatorId)]);

export const trainingParticipants = pgTable("training_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => trainingSessions.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  requiredRole: text("required_role"),
  attendance: text("attendance").notNull().default("pending"), // pending | attended | absent | rescheduled | cancelled
  completed: boolean("completed").notNull().default(false),
  competency: text("competency").notNull().default("not_assessed"), // not_assessed | developing | competent | proficient
  needsRetraining: boolean("needs_retraining").notNull().default(false),
  feedbackScore: integer("feedback_score"),
  feedback: text("feedback"),
}, (t) => [uniqueIndex("training_participant_unique").on(t.sessionId, t.contactId)]);

export const trainingMaterials = pgTable("training_materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => trainingPrograms.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // guide | video | recording | slides | link
  url: text("url").notNull(),
  visibility: text("visibility").notNull().default("customer"), // internal | customer
  createdAt: created(),
});

export type AssessmentQuestion = { q: string; options: string[]; answer: number };

export const assessments = pgTable("assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => trainingPrograms.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  passMark: integer("pass_mark").notNull().default(70),
  questions: jsonb("questions").$type<AssessmentQuestion[]>().notNull().default([]),
});

export const assessmentResults = pgTable("assessment_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
  participantId: uuid("participant_id").notNull().references(() => trainingParticipants.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  passed: boolean("passed").notNull(),
  takenAt: ts("taken_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Support desk
// ---------------------------------------------------------------------------

export type SlaTarget = {
  firstResponseMins: number; resolutionMins: number; updateMins: number;
  businessHours: boolean; warnAtPct: number; escalateAtPct: number;
};
export type BusinessCalendar = { timezone: string; workdays: number[]; start: string; end: string; holidays: string[] };

export const slaPolicies = pgTable("sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  customerTier: text("customer_tier"), // null = default for all tiers
  isDefault: boolean("is_default").notNull().default(false),
  calendar: jsonb("calendar").$type<BusinessCalendar>().notNull(),
  targets: jsonb("targets").$type<Record<string, SlaTarget>>().notNull(),
  pauseStatuses: jsonb("pause_statuses").$type<string[]>().notNull().default([]),
  automatedAckCountsAsResponse: boolean("automated_ack_counts").notNull().default(false),
  active: boolean("active").notNull().default(true),
  updatedAt: updated(),
});

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: serial("number").notNull().unique(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  requesterEmail: text("requester_email"),
  channel: text("channel").notNull().default("manual"), // manual | email | portal | phone | whatsapp | integration
  productId: uuid("product_id").references(() => products.id),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  impact: text("impact").notNull(), // widespread | multiple_users | single_user | minimal
  urgency: text("urgency").notNull(), // critical | high | medium | low
  priority: text("priority").notNull(), // P1 | P2 | P3 | P4
  priorityOverridden: boolean("priority_overridden").notNull().default(false),
  status: text("status").notNull().default("new"),
  waitingReason: text("waiting_reason"),
  waitingFollowUpAt: ts("waiting_follow_up_at"),
  ownerId: uuid("owner_id").references(() => users.id),
  teamId: uuid("team_id").references(() => teams.id),
  slaPolicyId: uuid("sla_policy_id").references(() => slaPolicies.id),
  firstResponseDueAt: ts("first_response_due_at"),
  resolutionDueAt: ts("resolution_due_at"),
  nextUpdateDueAt: ts("next_update_due_at"),
  firstRespondedAt: ts("first_responded_at"),
  slaPausedAt: ts("sla_paused_at"),
  slaPausedBy: uuid("sla_paused_by").references(() => users.id),
  slaPausedTotalMins: integer("sla_paused_total_mins").notNull().default(0),
  firstResponseBreached: boolean("first_response_breached").notNull().default(false),
  resolutionBreached: boolean("resolution_breached").notNull().default(false),
  escalationLevel: integer("escalation_level").notNull().default(0),
  isIncident: boolean("is_incident").notNull().default(false),
  incidentType: text("incident_type"), // security | data_exposure | outage | data_loss
  incidentConfirmedBy: uuid("incident_confirmed_by").references(() => users.id),
  affectedUsers: integer("affected_users"),
  affectedCustomers: integer("affected_customers"),
  businessImpact: text("business_impact"),
  workaroundAvailable: boolean("workaround_available").notNull().default(false),
  workaround: text("workaround"),
  onboardingProjectId: uuid("onboarding_project_id").references(() => onboardingProjects.id),
  dealId: uuid("deal_id").references(() => deals.id),
  resolutionSummary: text("resolution_summary"),
  resolutionCode: text("resolution_code"),
  rootCause: text("root_cause"),
  rootCauseFollowUpOwnerId: uuid("root_cause_follow_up_owner_id").references(() => users.id),
  resolvedAt: ts("resolved_at"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  closedAt: ts("closed_at"),
  reopenCount: integer("reopen_count").notNull().default(0),
  csatScore: integer("csat_score"),
  csatComment: text("csat_comment"),
  portalToken: text("portal_token").unique(),
  lastPublicUpdateAt: ts("last_public_update_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
  deletedAt: ts("deleted_at"),
}, (t) => [
  index("tickets_status_idx").on(t.status), index("tickets_owner_idx").on(t.ownerId), index("tickets_team_idx").on(t.teamId),
  index("tickets_company_idx").on(t.companyId), index("tickets_priority_idx").on(t.priority),
]);

/** Customer-visible conversation. Internal notes live in a separate table on purpose. */
export const ticketMessages = pgTable("ticket_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").references(() => users.id),
  authorContactId: uuid("author_contact_id").references(() => contacts.id),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  isAutomated: boolean("is_automated").notNull().default(false),
  deliveryStatus: text("delivery_status").notNull().default("recorded"), // recorded | simulated | sent | failed
  createdAt: created(),
}, (t) => [index("ticket_messages_ticket_idx").on(t.ticketId)]);

export const ticketInternalNotes = pgTable("ticket_internal_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: created(),
}, (t) => [index("ticket_notes_ticket_idx").on(t.ticketId)]);

export const ticketAttachments = pgTable("ticket_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  visibility: text("visibility").notNull().default("internal"), // internal | public
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: created(),
});

export const slaEvents = pgTable("sla_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // started | warning | escalated | breached | met | paused | resumed | recalculated
  metric: text("metric").notNull(), // first_response | resolution | update | clock
  dedupeKey: text("dedupe_key").unique(),
  details: text("details"),
  actorId: uuid("actor_id").references(() => users.id),
  createdAt: created(),
}, (t) => [index("sla_events_ticket_idx").on(t.ticketId)]);

export const ticketEscalations = pgTable("ticket_escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // engineering | support_peer | support_lead | sales | onboarding | management | incident
  severity: text("severity").notNull(),
  // pending_approval → open → in_progress → resolved → closed (confirmed); also rejected, cancelled. Incidents use "approved".
  status: text("status").notNull().default("pending_approval"),
  assignedToId: uuid("assigned_to_id").references(() => users.id), // a specific person, when escalated to someone rather than a team
  dueAt: ts("due_at"), // response target from severity
  acceptedAt: ts("accepted_at"),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  resolvedAt: ts("resolved_at"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolution: text("resolution"),
  confirmedAt: ts("confirmed_at"),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
  reopenCount: integer("reopen_count").notNull().default(0),
  requestedTeamId: uuid("requested_team_id").references(() => teams.id),
  assignedTeamId: uuid("assigned_team_id").references(() => teams.id), // set on approval; grants that team visibility
  reason: text("reason"),
  reproductionSteps: text("reproduction_steps"),
  expectedResult: text("expected_result"),
  actualResult: text("actual_result"),
  environment: text("environment"),
  evidence: text("evidence"),
  customerImpact: text("customer_impact"),
  workaround: text("workaround"),
  businessConsequence: text("business_consequence"),
  engineeringStatus: text("engineering_status"), // investigating | identified | fix_in_progress | fix_released | wont_fix
  rootCause: text("root_cause"),
  fixVersion: text("fix_version"),
  externalRef: text("external_ref"),
  createdBy: uuid("created_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index("ticket_escalations_ticket_idx").on(t.ticketId)]);

export const escalationUpdates = pgTable("escalation_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  escalationId: uuid("escalation_id").notNull().references(() => ticketEscalations.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: created(),
});

export const ticketStatusHistory = pgTable("ticket_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  reason: text("reason"),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
  changedBy: uuid("changed_by").references(() => users.id),
  changedByLabel: text("changed_by_label"),
  createdAt: created(),
}, (t) => [index("ticket_status_history_ticket_idx").on(t.ticketId)]);

// ---------------------------------------------------------------------------
// Knowledge, customer success
// ---------------------------------------------------------------------------

export const knowledgeArticles = pgTable("knowledge_articles", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  summary: text("summary"),
  body: text("body").notNull(),
  category: text("category").notNull(),
  productId: uuid("product_id").references(() => products.id),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  audience: text("audience").notNull().default("internal"), // internal | customer
  status: text("status").notNull().default("draft"), // draft | in_review | published | archived
  isSop: boolean("is_sop").notNull().default(false),
  authorId: uuid("author_id").references(() => users.id),
  ownerId: uuid("owner_id").references(() => users.id),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  version: integer("version").notNull().default(1),
  reviewComment: text("review_comment"),
  publishedAt: ts("published_at"),
  helpfulCount: integer("helpful_count").notNull().default(0),
  notHelpfulCount: integer("not_helpful_count").notNull().default(0),
  createdAt: created(),
  updatedAt: updated(),
});

export const articleTicketLinks = pgTable("article_ticket_links", {
  articleId: uuid("article_id").notNull().references(() => knowledgeArticles.id, { onDelete: "cascade" }),
  ticketId: uuid("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  linkedBy: uuid("linked_by").references(() => users.id),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.articleId, t.ticketId] })]);

export type HealthComponent = { key: string; label: string; score: number; weight: number; detail: string };

export const customerHealthSnapshots = pgTable("customer_health_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  status: text("status").notNull(), // healthy | watch | at_risk
  components: jsonb("components").$type<HealthComponent[]>().notNull(),
  computedAt: ts("computed_at").defaultNow().notNull(),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: ts("reviewed_at"),
  reviewNotes: text("review_notes"),
}, (t) => [index("health_company_idx").on(t.companyId, t.computedAt)]);

export const renewals = pgTable("renewals", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  dealId: uuid("deal_id").references(() => deals.id),
  productId: uuid("product_id").references(() => products.id),
  renewalDate: date("renewal_date").notNull(),
  amount: money("amount"),
  currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("upcoming"), // upcoming | in_progress | renewed | churned
  ownerId: uuid("owner_id").references(() => users.id),
  notes: text("notes"),
  createdAt: created(),
});

export const expansionOpportunities = pgTable("expansion_opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  productId: uuid("product_id").references(() => products.id),
  kind: text("kind").notNull().default("upsell"), // upsell | cross_sell
  description: text("description").notNull(),
  estimatedValue: money("estimated_value"),
  status: text("status").notNull().default("identified"), // identified | qualified | converted | dropped
  ownerId: uuid("owner_id").references(() => users.id),
  dealId: uuid("deal_id").references(() => deals.id),
  createdAt: created(),
});

// ---------------------------------------------------------------------------
// Files, notifications, automation, integrations, audit
// ---------------------------------------------------------------------------

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(), // company | deal | handover | onboarding
  entityId: uuid("entity_id").notNull(),
  companyId: uuid("company_id").references(() => companies.id),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  restricted: boolean("restricted").notNull().default(false), // contracts and financial docs
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("files_entity_idx").on(t.entityType, t.entityId)]);

export type DocLine = { productId: string | null; description: string; quantity: number; unitPrice: number; discountPct: number };
export type DocSection = { heading: string; body: string };
export type SlaSnapshot = {
  policyName: string; tier: string; timezone: string; hours: string; workdays: string; holidays: string[];
  targets: { priority: string; firstResponse: string; resolution: string; updates: string; coverage: string }[];
  products: string[];
};

/** Documents we send to customers: SLA agreements, quotes and invoices. Each has a public share link for the client. */
export const clientDocuments = pgTable("client_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(), // SLA-2026-0001, QUO-2026-0001, INV-2026-0001
  type: text("type").notNull(), // sla | quote | invoice
  status: text("status").notNull().default("draft"), // draft | sent | viewed | accepted(signed) | declined | paid | part_paid | void | expired
  title: text("title").notNull(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  contactId: uuid("contact_id").references(() => contacts.id), // who receives and signs
  dealId: uuid("deal_id").references(() => deals.id),
  sourceId: uuid("source_id"), // e.g. the quote an invoice was raised from
  currency: text("currency").notNull().default("NGN"),
  lines: jsonb("lines").$type<DocLine[]>().notNull().default([]),
  taxRate: real("tax_rate").notNull().default(0),
  subtotal: money("subtotal").notNull().default(0),
  discountTotal: money("discount_total").notNull().default(0),
  tax: money("tax").notNull().default(0),
  total: money("total").notNull().default(0),
  amountPaid: money("amount_paid").notNull().default(0),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date"), // invoice due date / quote valid until / SLA effective date
  termMonths: integer("term_months"), // SLA term
  sections: jsonb("sections").$type<DocSection[]>().notNull().default([]), // editable clauses (SLA) or terms (quotes/invoices)
  sla: jsonb("sla").$type<SlaSnapshot | null>(),
  notes: text("notes"),
  shareToken: text("share_token").notNull().unique(),
  sentAt: ts("sent_at"),
  viewedAt: ts("viewed_at"),
  decidedAt: ts("decided_at"),
  signedByName: text("signed_by_name"),
  signedByTitle: text("signed_by_title"),
  signatureMethod: text("signature_method"), // online | uploaded
  signatureIp: text("signature_ip"),
  declineReason: text("decline_reason"),
  signedFileId: uuid("signed_file_id").references(() => files.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index("client_documents_company_idx").on(t.companyId), index("client_documents_type_idx").on(t.type, t.status)]);

export const documentPayments = pgTable("document_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => clientDocuments.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  method: text("method").notNull(), // bank_transfer | card | cash | cheque | pos | other
  reference: text("reference"),
  paidOn: date("paid_on").notNull(),
  notes: text("notes"),
  recordedBy: uuid("recorded_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("document_payments_doc_idx").on(t.documentId)]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  dedupeKey: text("dedupe_key"),
  readAt: ts("read_at"),
  createdAt: created(),
}, (t) => [index("notifications_user_idx").on(t.userId, t.readAt), uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey)]);

export type RuleCondition = { field: string; op: "eq" | "neq" | "in" | "gte" | "lte" | "exists"; value?: unknown };
export type RuleAction = { type: string; params: Record<string, unknown> };

export const workflowRules = pgTable("workflow_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions").$type<RuleCondition[]>().notNull().default([]),
  actions: jsonb("actions").$type<RuleAction[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: updated(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ruleId: uuid("rule_id").notNull().references(() => workflowRules.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  trigger: text("trigger").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull(), // success | failed | skipped
  error: text("error"),
  attempts: integer("attempts").notNull().default(1),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  startedAt: ts("started_at").defaultNow().notNull(),
  finishedAt: ts("finished_at"),
}, (t) => [index("workflow_runs_rule_idx").on(t.ruleId, t.startedAt)]);

export const integrations = pgTable("integrations", {
  kind: text("kind").primaryKey(), // email | sms | whatsapp | calendar | telephony | issue_tracker
  status: text("status").notNull().default("not_configured"), // not_configured | configured | connected | error
  provider: text("provider"),
  lastTestAt: ts("last_test_at"),
  lastTestResult: text("last_test_result"),
  updatedAt: updated(),
});

export const outboundMessages = pgTable("outbound_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status").notNull(), // simulated | sent | failed
  provider: text("provider"),
  error: text("error"),
  relatedType: text("related_type"),
  relatedId: uuid("related_id"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
});

export const auditLogs = pgTable("audit_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid("actor_id").references(() => users.id),
  actorLabel: text("actor_label"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
  reason: text("reason"),
  createdAt: created(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)]);
