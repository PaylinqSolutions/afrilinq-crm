/**
 * Permission catalogue and the default role → permission mapping.
 * The mapping is seeded into the database (role_permissions) and is editable by a Super Admin;
 * server code always checks the database copy via the actor's permission set.
 */
export const PERMISSIONS = {
  // Administration
  "admin.users": { category: "Administration", description: "Invite users, change roles and deactivate accounts" },
  "admin.roles": { category: "Administration", description: "Edit role permission mappings" },
  "admin.settings": { category: "Administration", description: "Edit general settings, custom fields and templates" },
  "admin.pipelines": { category: "Administration", description: "Configure pipelines, stages and required fields" },
  "admin.sla": { category: "Administration", description: "Configure SLA policies and business hours" },
  "admin.workflows": { category: "Administration", description: "Configure workflow rules and retry runs" },
  "admin.integrations": { category: "Administration", description: "Configure and test integration adapters" },
  "audit.view": { category: "Administration", description: "View the audit log" },
  "data.export": { category: "Administration", description: "Export records to CSV (audit-logged)" },
  "data.delete": { category: "Administration", description: "Soft-delete customer records (audit-logged)" },
  "billing.manage": { category: "Administration", description: "Create and send invoices, record payments, and edit billing details" },
  "products.manage": { category: "Administration", description: "Add, edit and retire products and services in the catalogue" },

  // Sales
  "leads.view_all": { category: "Sales", description: "View all leads" },
  "leads.view_own": { category: "Sales", description: "View leads assigned to me" },
  "leads.edit": { category: "Sales", description: "Create and edit leads I can view" },
  "leads.assign": { category: "Sales", description: "Assign leads to other users" },
  "accounts.view_all": { category: "Accounts", description: "View all companies and contacts" },
  "accounts.view_own": { category: "Accounts", description: "View companies I own or work with" },
  "accounts.edit": { category: "Accounts", description: "Create and edit companies and contacts I can view" },
  "deals.view_all": { category: "Sales", description: "View all deals" },
  "deals.view_own": { category: "Sales", description: "View deals I own" },
  "deals.edit": { category: "Sales", description: "Create, edit and move deals I can view" },
  "deals.approve_discount": { category: "Sales", description: "Approve or reject discounts above the threshold" },
  "deals.reassign": { category: "Sales", description: "Change deal owner" },
  "activities.log": { category: "Sales", description: "Log calls, meetings, demos, notes and messages" },
  "tasks.view_all": { category: "Sales", description: "View all users' tasks" },

  // Handover & onboarding
  "handover.view": { category: "Handover", description: "View handover records" },
  "handover.submit": { category: "Handover", description: "Complete and submit handovers for my deals" },
  "handover.review": { category: "Handover", description: "Accept handovers or request changes" },
  "handover.override": { category: "Handover", description: "Accept an incomplete handover with a documented reason" },
  "onboarding.view": { category: "Onboarding", description: "View onboarding projects" },
  "onboarding.manage": { category: "Onboarding", description: "Manage onboarding projects, tasks and blockers" },
  "onboarding.complete": { category: "Onboarding", description: "Confirm go-live and onboarding completion" },

  // Training
  "training.view_all": { category: "Training", description: "View all training programs and sessions" },
  "training.view_assigned": { category: "Training", description: "View sessions I facilitate and their customers" },
  "training.manage": { category: "Training", description: "Schedule sessions, record attendance and completion" },
  "training.programs": { category: "Training", description: "Create and edit training programs, materials and assessments" },

  // Support
  "tickets.view_all": { category: "Support", description: "View all tickets" },
  "tickets.view_team": { category: "Support", description: "View tickets in my team queue" },
  "tickets.view_assigned": { category: "Support", description: "View tickets assigned to me" },
  "tickets.view_escalated": { category: "Support", description: "View tickets escalated to my team" },
  "tickets.create": { category: "Support", description: "Create tickets" },
  "tickets.edit": { category: "Support", description: "Triage and update tickets I can view" },
  "tickets.reply": { category: "Support", description: "Send public replies to customers" },
  "tickets.notes": { category: "Support", description: "Read and write private internal notes" },
  "tickets.reassign": { category: "Support", description: "Assign tickets to any agent or queue" },
  "tickets.priority_override": { category: "Support", description: "Override calculated priority (logged)" },
  "tickets.escalate": { category: "Support", description: "Raise escalations" },
  "tickets.approve_escalation": { category: "Support", description: "Approve escalations and confirm incidents" },
  "engineering.update": { category: "Support", description: "Add engineering updates, root cause and fix version" },

  // Knowledge base
  "kb.view_internal": { category: "Knowledge", description: "Read internal articles and runbooks" },
  "kb.edit": { category: "Knowledge", description: "Write and submit articles for review" },
  "kb.publish": { category: "Knowledge", description: "Review, publish and archive articles" },

  // Customer success & finance
  "success.view": { category: "Customer success", description: "View customer health, renewals and expansion" },
  "success.manage": { category: "Customer success", description: "Review health, manage renewals and expansion" },
  "finance.view": { category: "Finance", description: "View contract and billing fields" },
  "finance.edit": { category: "Finance", description: "Record payment/invoice status and flag unpaid accounts" },

  // Reporting
  "reports.executive": { category: "Reports", description: "Organisation-wide executive dashboard" },
  "reports.sales": { category: "Reports", description: "Sales dashboard" },
  "reports.onboarding": { category: "Reports", description: "Onboarding dashboard" },
  "reports.support": { category: "Reports", description: "Support dashboard" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const readAll: Permission[] = [
  "leads.view_all", "accounts.view_all", "deals.view_all", "tasks.view_all", "handover.view", "onboarding.view",
  "training.view_all", "tickets.view_all", "kb.view_internal", "success.view", "finance.view",
  "reports.executive", "reports.sales", "reports.onboarding", "reports.support",
];

export const ROLE_DEFINITIONS: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    key: "super_admin", name: "Super Admin",
    description: "Full configuration access including users, roles, pipelines, SLA policy, automations and audit logs.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "executive", name: "Executive / Management",
    description: "Organisation-wide read access to dashboards, pipeline, onboarding, training, support and health. No editing by default.",
    permissions: [...readAll, "audit.view"],
  },
  {
    key: "sales_manager", name: "Sales Manager",
    description: "Team sales performance, lead distribution, discount approval, forecast and handover audit.",
    permissions: [
      "leads.view_all", "leads.edit", "leads.assign", "accounts.view_all", "accounts.edit", "deals.view_all", "deals.edit",
      "deals.approve_discount", "deals.reassign", "activities.log", "tasks.view_all", "handover.view", "handover.submit", "products.manage", "billing.manage",
      "handover.override", "onboarding.view", "success.view", "kb.view_internal", "reports.sales", "data.export", "tickets.create",
    ],
  },
  {
    key: "sales_executive", name: "Sales Executive",
    description: "Own leads, contacts, activities and deals; request approvals; submit handovers.",
    permissions: [
      "leads.view_own", "leads.edit", "accounts.view_own", "accounts.edit", "deals.view_own", "deals.edit",
      "activities.log", "handover.view", "handover.submit", "kb.view_internal", "tickets.create",
    ],
  },
  {
    key: "onboarding_manager", name: "Customer Success / Onboarding Manager",
    description: "Review handovers, run onboarding projects and go-live readiness, manage customer health.",
    permissions: [
      "accounts.view_all", "accounts.edit", "deals.view_all", "activities.log", "handover.view", "handover.review",
      "handover.override", "onboarding.view", "onboarding.manage", "onboarding.complete", "training.view_all",
      "training.manage", "tickets.view_all", "tickets.create", "kb.view_internal", "kb.edit", "success.view",
      "success.manage", "reports.onboarding", "tasks.view_all",
    ],
  },
  {
    key: "trainer", name: "Trainer",
    description: "Plan and deliver training for assigned sessions only.",
    permissions: ["training.view_assigned", "training.manage", "training.programs", "kb.view_internal", "activities.log"],
  },
  {
    key: "support_agent", name: "Support Agent",
    description: "Work assigned and team-queue tickets, reply to customers and write internal notes.",
    permissions: [
      "tickets.view_team", "tickets.view_assigned", "tickets.create", "tickets.edit", "tickets.reply", "tickets.notes",
      "tickets.escalate", "kb.view_internal", "kb.edit", "activities.log",
    ],
  },
  {
    key: "support_lead", name: "Support Lead",
    description: "All permitted queues, reassignment, escalation approval, SLA monitoring and quality review.",
    permissions: [
      "tickets.view_all", "tickets.create", "tickets.edit", "tickets.reply", "tickets.notes", "tickets.reassign",
      "tickets.priority_override", "tickets.escalate", "tickets.approve_escalation", "kb.view_internal", "kb.edit",
      "kb.publish", "reports.support", "accounts.view_all", "activities.log", "data.export", "tasks.view_all",
    ],
  },
  {
    key: "engineering", name: "Product / Engineering",
    description: "Escalated tickets with technical context; internal updates, root cause and fix version.",
    permissions: ["tickets.view_escalated", "tickets.notes", "engineering.update", "kb.view_internal", "kb.edit"],
  },
  {
    key: "finance", name: "Finance / Billing",
    description: "Approved contract and billing fields, payment/invoice status and unpaid flags.",
    permissions: ["accounts.view_all", "deals.view_all", "finance.view", "finance.edit", "success.view", "billing.manage"],
  },
];
