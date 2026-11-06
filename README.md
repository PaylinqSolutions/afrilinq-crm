# Afrilinq CRM

One connected platform for Afrilinq Technologies: sales and lead management, accounts and contacts, deal pipeline and forecasting, a mandatory closed-won **handover** from Sales to Onboarding, onboarding/implementation projects, customer **training**, a **support desk** with configurable SLA clocks and escalations, customer success (health, renewals, expansion), knowledge base and SOPs, tasks, notifications, reports, audit trail and role-based access control.

All modules share one relational database, so a customer's 360° page shows contacts, deals, handovers, onboarding, training, tickets, activities, files and audit history on one timeline.

> **Demo data is fictional.** Organisations, people, phone numbers and emails are invented (`.demo` / `.example` domains). Report figures computed from demo data are not Afrilinq's real performance.

---

## Quick start (local)

Requirements: **Node.js 20+** (tested on 22.16). No Docker or separate database needed for local use.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. On first start the app creates an embedded Postgres database in `./.data/pglite`, applies migrations and loads demo data.

**Demo sign-ins** (all use the demo password `Afrilinq-Demo-2026`, override with `SEED_PASSWORD` before first start):

| Email | Role |
|---|---|
| `owner@afrilinq.demo` | Super Admin — your own login to explore everything |
| `admin@afrilinq.demo` | Super Admin |
| `cco@afrilinq.demo` | Executive / CCO (read-only dashboards) |
| `sales.manager@afrilinq.demo` | Sales Manager (approves discounts, overrides handovers) |
| `emeka@afrilinq.demo`, `fatima@afrilinq.demo` | Sales Executives |
| `onboarding@afrilinq.demo`, `ibrahim@afrilinq.demo` | Customer Success / Onboarding Managers |
| `trainer@afrilinq.demo`, `segun@afrilinq.demo` | Trainers |
| `support@afrilinq.demo` (Customer Support), `aisha@afrilinq.demo` (Technical Support) | Support Agents |
| `support.lead@afrilinq.demo` | Support Lead |
| `engineering@afrilinq.demo` | Product / Engineering |
| `finance@afrilinq.demo` | Finance / Billing |

Useful commands:

```bash
npm test            # unit + integration/acceptance tests (in-memory Postgres)
npm run typecheck
npm run build && npm start
npm run db:reset    # wipe the local embedded DB and reload demo data (stop the dev server first)
npm run db:generate # regenerate SQL migrations after editing src/db/schema.ts
npm run db:migrate  # apply migrations to DATABASE_URL (or the embedded DB)
```

---

## Stack, and documented substitutions

| Spec | Implemented | Why |
|---|---|---|
| Next.js + TypeScript | Next.js 16 (App Router, server components, server actions), TypeScript strict | — |
| Tailwind + shadcn/ui | Tailwind v4 with a small in-repo accessible component set (`src/components`) in the shadcn style | Keeps the UI dependency-light; no generated component tree to maintain. |
| PostgreSQL via Supabase | **PostgreSQL via Drizzle ORM.** Production: any Postgres 14+, including Supabase (`DATABASE_URL`). Local/demo: **PGlite** (real Postgres compiled to WASM, in-process). | The build machine had no Docker/Postgres. The same SQL migrations run on both. |
| Supabase Auth | **Server-side session auth** (scrypt password hashing, random 256-bit session tokens stored hashed, httpOnly SameSite cookies) with **invitation-based onboarding** | Supabase Auth requires a hosted project. The auth module (`src/server/auth-core.ts`, `src/server/session.ts`) is the adapter boundary if you later switch to Supabase Auth. |
| Server-enforced RBAC | Permission catalogue + DB-stored role→permission mapping; every service call checks permissions and applies row scope (`src/server/services/scope.ts`) | — |
| Row-level security | Enforced in the **server data-access layer** (every query for a scoped entity ANDs a scope condition), and tested. Postgres RLS policies are **not** used. | The app connects as one server role, so database RLS would not distinguish users without per-request `SET ROLE`/claims. See “Hardening before production”. |
| React chart library | Recharts (+ plain-HTML bar lists for categorical breakdowns) | — |
| Tests | Vitest unit tests + service-level integration/acceptance tests against an in-memory Postgres. **No browser E2E suite** — critical paths were verified manually in a browser (procedure below). | Playwright browsers were not installed in the build environment. |

---

## Architecture

```
src/
  db/schema.ts          ← single relational schema (55 tables)
  db/index.ts           ← driver selection (PGlite or postgres-js), migrations, auto-seed
  db/seed.ts            ← reference data (roles, permissions, pipeline, SLA, rules, templates) + demo data
  lib/rules/*.ts        ← pure business rules (unit-tested): SLA business hours, priority matrix,
                          pipeline gates, handover checklist, onboarding risk, health score
  lib/permissions.ts    ← permission catalogue + default role mapping
  lib/schemas.ts        ← shared zod input schemas
  server/
    actor.ts, auth-core.ts, session.ts, audit.ts, notify.ts, settings.ts, errors.ts
    services/           ← ALL business logic and authorisation (UI and tests call the same functions)
      sales, accounts, activities, handover, onboarding, tickets, sweep (SLA + automations),
      training, health, kb, workflows (rule engine), integrations, files, reports, admin, scope
  app/
    (app)/…             ← authenticated screens (server components)
    actions/*.ts        ← server actions: thin wrappers → services
    portal/…            ← customer-facing ticket page + help centre (public content only)
    api/…               ← CSV export, secure file download, cron sweep, health check
  instrumentation.ts    ← in-process SLA/automation sweep every SWEEP_INTERVAL_SECONDS
drizzle/                ← generated SQL migrations
tests/                  ← rules.test.ts, seed.test.ts, acceptance.test.ts
```

**Request flow.** Page (server component) → `ctx()` resolves the signed-in actor → service function checks permission + scope → Drizzle query. Mutations go through `act()` (`src/server/action.ts`), which maps domain errors to field-level form errors and never leaks stack traces.

**Workflows.** Core invariants are hard-coded in services and cannot be disabled (handover creation on Closed Won, one onboarding project per handover, SLA calculation, incident workflow). The configurable rule engine (`workflows.ts`) adds notifications, tasks and assignment. Each rule runs once per event key (idempotent), and failures are kept with the error and can be retried up to 3 times from **Settings → Workflow rules**.

**Scheduling.** `runAllSweeps()` evaluates SLA clocks (warning → escalation → breach, recorded once per clock cycle), idle leads, stale deals, overdue tasks, onboarding risk and overdue milestones, renewals and customer health. It runs in-process every 60s by default. On serverless hosts set `SWEEP_INTERVAL_SECONDS=0` and call `POST /api/cron/sweep` with `Authorization: Bearer $CRON_SECRET`. Admins and support leads also have a “Run SLA check now” button.

### Data model (main tables)

Identity & config: `users, teams, roles, permissions, role_permissions, user_roles, sessions, invitations, settings, custom_fields, custom_field_values, saved_views`
Accounts: `companies, contacts, products`
Sales: `leads, pipelines, pipeline_stages, deals, deal_contacts, deal_products, deal_stage_history, activities, tasks`
Handover/onboarding: `handover_records (deal_id UNIQUE), handover_reviews, onboarding_templates, onboarding_template_tasks, onboarding_projects (handover_id UNIQUE), onboarding_tasks, onboarding_blockers`
Training: `training_programs, training_sessions, training_participants, training_materials, assessments, assessment_results`
Support: `sla_policies, tickets, ticket_messages (customer-visible), ticket_internal_notes (separate table), ticket_attachments, sla_events, ticket_escalations, escalation_updates, ticket_status_history`
Knowledge & success: `knowledge_articles, article_ticket_links, customer_health_snapshots, renewals, expansion_opportunities`
Platform: `files, notifications, workflow_rules, workflow_runs, integrations, outbound_messages, audit_logs`

Timestamps everywhere, soft deletion (`deleted_at`) on customer records, foreign keys and indexes on frequent query paths, unique constraints enforcing the "exactly one" rules.

### Route map

| Area | Routes |
|---|---|
| Auth | `/login`, `/invite/[token]` |
| Home | `/` (daily workspace: overdue tasks, today's appointments, follow-ups, deals needing attention, handovers, my tickets + role KPIs) |
| Sales | `/leads`, `/leads/new`, `/leads/[id]` · `/contacts`, `/contacts/new`, `/contacts/[id]` · `/companies`, `/companies/new`, `/companies/[id]?tab=overview\|contacts\|deals\|onboarding\|training\|tickets\|activities\|files\|audit` · `/deals` (Kanban), `/deals/table`, `/deals/new`, `/deals/[id]` |
| Handover | `/handovers`, `/handovers/[id]` (checklist, submit, accept / request changes / override, corrections) |
| Onboarding | `/onboarding` (board / list), `/onboarding/[id]` (milestones, dependencies, blockers, go-live checklist, training readiness, completion) |
| Training | `/training` (week calendar / list / programs), `/training/programs/new`, `/training/programs/[id]`, `/training/sessions/new`, `/training/sessions/[id]`, `/training/participants/[contactId]` |
| Support | `/tickets` (11 queues, table / board), `/tickets/new`, `/tickets/[id]` · `/escalations` (my queue, team, raised by me, to confirm, approvals, all, closed) |
| Billing & agreements | `/billing?tab=invoice\|quote\|payments\|sla`, `/documents/new?type=sla\|quote\|invoice`, `/documents/[id]` (edit, send, attach signed copy, record payment, void, quote → invoice), `/print/documents/[id]` (A4 view → Save as PDF) |
| Customer-facing | `/d/[token]` (client views a quote, invoice or SLA, downloads the PDF, signs/accepts or declines) · `/portal/t/[token]` (public conversation, reply, confirm/reopen, CSAT), `/portal/help` (published customer articles) |
| Success | `/success` |
| Knowledge | `/kb`, `/kb/new`, `/kb/[id]`, `/kb/[id]/edit` |
| Other | `/tasks`, `/notifications`, `/search`, `/reports` (executive / sales / onboarding / support), `/reports/records?m=…` (drill-down) |
| Settings | `/settings` (general, health weights, routing), `/settings/users`, `/settings/roles`, `/settings/pipelines`, `/settings/sla`, `/settings/workflows`, `/settings/integrations`, `/settings/templates`, `/settings/fields`, `/settings/audit` |
| API | `GET /api/export/[leads\|deals\|companies\|contacts\|tickets]` (permission-checked, audit-logged CSV), `GET /api/files/[file\|attachment]/[id]`, `POST /api/cron/sweep`, `GET /api/health` |

---

## Key rules implemented

**Pipeline.** Ten seeded stages with probabilities, entry/exit criteria, stale thresholds and admin-configurable required fields. Every open deal needs a next step and due date. **Closed Won** always requires value, primary contact, ≥1 product, signed agreement/approval reference, billing frequency, start date and no unapproved discount. **Closed Lost** requires a loss reason. Discounts above the threshold (default 10%) need Sales Manager approval. Commercial fields lock after Closed Won. Stage history records duration in each stage.

**Handover (mandatory).** Moving a deal to Closed Won creates exactly one handover (`UNIQUE(deal_id)` + idempotent insert), pre-fills it from the deal, notifies the Sales Executive, their manager and the onboarding queue, and labels the deal “Handover Incomplete”. Sales completes a 20-item checklist (17 required). Submitting creates a draft onboarding project (once). Onboarding accepts or requests changes, with a comment required either way. Accepting an incomplete or unsubmitted handover requires `handover.override` plus a written reason, and is audit-logged with the missing fields. On acceptance the matching template (product, then segment) creates dated tasks, milestones, dependencies and the go-live checklist. After acceptance, Sales is read-only. Corrections go through a request/approve flow that keeps the old value in the audit log and notifies the onboarding owner.

**Onboarding.** 15 stages, including On Hold (reason required). Risk is rule-based and every reason is shown: overdue milestones (>7 days → high), open high/critical blockers, go-live date passed, and required training gaps inside the configurable window before go-live. Task dependencies block starting or completing a task. Completion is an explicit confirmation by the owner or an onboarding manager, with go-live date and closure notes. Anything outstanding (checklist, tasks, blockers, training) requires an exception reason, which is audit-logged.

**Support & SLA.** Priority comes from impact × urgency, not tone. A documented workaround caps P2 at P3. Suspected security, data-exposure, outage or data-loss incidents are always P1, open an incident record and immediately notify the Support Lead, executives and admins. Only an authorised confirmer can resolve an incident, and only with evidence. Manual priority override requires `tickets.priority_override` plus a reason (logged).

SLA policies hold the business calendar (time zone, hours, workdays, holidays), per-priority targets (24×7 or business hours), warn/escalate thresholds and an explicit pause list. Policies are selected by customer tier (Standard vs Strategic are seeded). Pauses and resumes are recorded with who and why, and due dates are extended by the paused working time. Waiting statuses that the policy does not pause are recorded as “clock continues”.

The automated acknowledgement does not count as first response unless an admin enables that. Resolving requires a summary and category, and P1/P2/incident tickets also need a root cause, or “Root cause not yet known” plus a follow-up owner (which creates a task). Reopening snapshots the previous resolution into status history.

Likely duplicates for the same customer, product and subject are flagged and must be explicitly dismissed. Routing assigns a team by category or tier and the least-loaded agent. Engineering escalations require full technical context and Support Lead approval. Engineering sees only escalations assigned to its team, and its updates stay internal until an agent writes a customer-safe reply.

**Private notes.** Internal notes live in a separate table (`ticket_internal_notes`). The customer portal's data function selects only customer-safe ticket columns and `ticket_messages`, so internal data can't leak by accident. Internal attachments require `tickets.notes`.

**Training.** Programs by product, role and segment, with objectives, materials (customer or internal) and assessments. Sessions link to the customer, onboarding project and participants. Attendance can be Attended, Absent, Rescheduled or Cancelled. Completion, competency and retraining flags are recorded per participant, and a failed assessment flags retraining. Required programs feed onboarding risk. Trainers see only sessions they facilitate and only the participants they need, and can schedule follow-up or refresher sessions only for customers they're assigned to. Reminders go in-app; email reminders need a provider (otherwise they can only be recorded as simulated, with explicit confirmation).

**Customer health.** A transparent weighted score made of onboarding, support load, overdue actions, training completion, engagement recency and CSAT. Weights and thresholds are editable, and every component is shown with its reason. An “At Risk” account creates an account-review task. Renewals within the notice window create renewal-review tasks.

**Integrations.** Email, SMS, WhatsApp, calendar, telephony and issue-tracker integrations are optional adapters configured by environment variables only. Status is **Not configured** until the variables exist, and **Connected** only after an adapter is registered and a test succeeds. No provider adapters ship, by design. In-app notifications always work. Any send without a connected provider requires an explicit “simulate” confirmation and is labelled *Simulated — not delivered* everywhere.

**Edit conflict detection.** Edit forms carry the record version they were loaded from (`updated_at`). This covers leads, companies, contacts, deals (including stage moves and product lines), handover checklists, onboarding projects, tickets (triage, priority, assignment, status, resolve), knowledge articles and SLA policies.

If someone else saved in the meantime, including you in another tab or a customer replying to a ticket, the save is rejected rather than silently overwriting their work. The message says who changed it, when, and which fields, with options to reload or to open the latest version in a new tab and compare. The write itself is a compare-and-set (`UPDATE … WHERE updated_at = loaded version`), so two simultaneous saves can't both win. Append-only actions such as replies, notes and activity logs never conflict. See `src/server/concurrency.ts` and `tests/concurrency.test.ts`.

**Product catalogue (`/products`).** Every staff member can browse what Afrilinq sells. Each product or service shows its live open pipeline, won revenue, customers and open tickets, scoped to what the viewer may see. The detail page has tabs for deals, customers and renewals, support tickets, and onboarding projects, templates and training. Users with `products.manage` (Sales Manager and Super Admin by default) can add products, edit them with conflict detection, and retire or reactivate them with a reason. Products are never deleted, so history stays intact. Codes are unique and uppercased (e.g. `AFQ-PAY`). New permissions added in later releases are synced into existing databases at startup and granted only to the roles that include them by default; admin customisations are left alone.

**Contacts workspace (`/contacts`).**

- *Views and filters.* Tabs for My, Unassigned and All contacts, plus your own saved views (`+` or **Clone**). There are filter chips for contact owner (including "Me" and "No owner"), create date, last activity date and lead status (is any of / is none of). **Advanced filters** cover lifecycle stage, referral source, whether company, email or phone is known, and city.
- *Data-quality cards.* Missing owner, missing email, missing lead status, no recent activity (30 days), missing phone and new in the last 30 days. Click a card to filter the list; the gear picks which cards show.
- *Inline editing.* Every cell can be edited in place, and each save checks for edit conflicts. The phone editor has a country code, validation (`0803 481 9348` → `+234-803-481-9348`) and an option to keep the number exactly as typed. Referral sources are searchable, and staff can add new ones inline. Lead status, lifecycle stage, owner and company each open a searchable picker.
- *List tools.* Column picker and ordering, sort on any column, page numbers with 25, 50 or 100 per page, and a board grouped by lead status with drag-and-drop. Bulk actions: assign, set status, set lifecycle stage, export, and delete with undo. Also a duplicate finder (same email or phone) and a quick-view side panel.
- *Contact record.* Note, Email, Call, Task, Meeting and More actions (WhatsApp, SMS, LinkedIn, postal mail), each with a follow-up task option. Properties are editable, buying roles show as chips, and there are communication preferences.
- *Record tabs.* **Overview** shows highlights, pinned, recent and upcoming activity, and associations. **Activities** has sub-tabs, search, filters, collapse, and log or schedule buttons. **Intelligence** shows profile, company, outreach details, an engagement score, next best action, channel mix and data completeness.
- *Record sidebar.* Rule-based record summary (no AI, no data leaves the CRM), deals, colleagues at the same company, tickets, training, onboarding, attachments and playbooks.
- *Automation.* Logging a call moves an untouched contact's lead status forward: *Connected* if they were reached, otherwise *Attempted to contact*. Quotes, invoices and payments are labelled *Coming later*.

**How the modules connect.**
- *Leads* are unqualified enquiries. Converting one creates or reuses a contact, optionally a company and a deal.
- *Companies* are the account that everything else attaches to. *Contacts* are its people (or individuals with no company).
- *Deals* belong to a company, involve contacts, and carry product lines.
- *Winning a deal* makes the company a customer and automatically creates the *handover*. When Onboarding accepts it, an *onboarding project* starts from the product's template.
- *Training sessions* are scheduled for the company, usually tied to that project, with contacts as participants. Required programs count towards go-live readiness.
- *Tickets* are always raised on an existing company or contact. A requester email that matches one of the company's contacts links that contact.
- *Customer success* tracks health, renewals and expansion for every company whose lifecycle is "customer".
- *Customer journey.* Company and contact records, plus deal, handover, onboarding, ticket, training and lead pages, show it: Lead → Opportunity → Closed won → Handover → Onboarding → Training → Live → Customer success, each step linked to its record. Steps needing attention are highlighted, such as a passed go-live date or at-risk health.
- *Related records.* Every detail page has the same panel listing the company, contacts, deals, products, handover, onboarding, training and tickets connected to it, limited to the modules the viewer can open.

**Leads and conversion.**
- *Organisation is optional.* Leave it blank for an individual, such as a doctor met at an event.
- *Converting.* Use **Convert** on the Leads list or the **Convert lead** card on a lead. The lead always becomes a **contact**, and its logged activity moves onto that contact.
- *Company.* It's optional and preselected when one with the lead's organisation name already exists. Otherwise the organisation is created, or no company is used for an individual.
- *Deal.* Tick **Also open a deal** to open one; a deal needs a company.
- *No duplicates.* Before creating a contact, the CRM looks for the same person by email (any case), then phone number (formatting ignored), then full name at the same company. It reuses that contact and fills only blank details. The form shows the match, with an option to create a separate contact instead.

**Companies workspace (`/companies`).** The Companies list mirrors Contacts:

- *List.* Tabs for All, My companies, Customers and saved views. Filters for owner, create date, last activity, lead status, plus advanced filters (lifecycle, segment, tier, region, industry, city, has contacts, has open deals).
- *Summary cards.* Missing owner, missing phone, no contacts, no recent activity, with open deals, and created in the last 30 days.
- *Editing and tools.* Inline editing with conflict checks, contact/deal/ticket counts, a lifecycle board, bulk actions with undo, export, a duplicate finder (similar names or the same domain) and a quick-view panel.
- *Company record (`/companies/[id]`).* Editable properties: domain, industry, owner, CSM, lifecycle, lead status, segment, tier, phone, city, region, postal code, address, employees, annual revenue, time zone, description, LinkedIn page and record source. Note, Email, Call, Task and Meeting buttons log against the company. Tabs are Overview (highlights, timeline, searchable contacts table, deals, upcoming activity), Activities and Intelligence (firmographics, buying committee, engagement, health breakdown, next best action, data completeness). The side panel shows contacts, deals, tickets, onboarding, training, renewals and attachments.
- *Customer 360.* The original view, with billing, custom fields, handovers and audit history, is now at `/companies/[id]/360`.

**Tasks (`/tasks`).**

- *Views.* Due today, Overdue, Upcoming, All open, Completed and saved views. Filters cover due date, assigned to ("Me" by default), task type, task stage (including "All closed"), queue and advanced options.
- *Fields and layouts.* Tasks have a stage (Not started, In progress, Waiting, Completed, Deferred), a type (To-do, Call, Email, Meeting, WhatsApp), a priority and a queue. Every column edits in place. There's also a stage board, a task side panel, bulk complete/reschedule/reassign, export, and **Start N tasks** to work through a list one at a time.
- *Linked to records.* A task created on a contact or company record, or as a follow-up when logging a call, note or email, shows on the Tasks page with its contact and company. It also stays on that record's timeline with a "View details" link back. Completing or editing it in either place updates both.
- *Notifications.* Assigning a task to someone notifies them in-app. Completing a task someone else created notifies its creator. Calendar sync needs a calendar integration (see Settings → Integrations).

To see the full prospect demo data (contacts with no company, missing emails and varied statuses), run `npm run db:reset` with the dev server stopped. This wipes local changes.

**Escalations.** Support can escalate a ticket to Engineering, another support agent, the Support Lead, Sales (account owner), Onboarding or Management. The flow is raise → approval (when the target needs it) → accept → updates → resolve → the requester confirms. It can also be reopened, reassigned, withdrawn or declined; a decline needs a reason. Response targets follow ticket priority (P1 4h, P2 24h, P3 72h, P4 120h). Assignees see escalated tickets even outside their normal ticket scope. The `/escalations` inbox has a badge in the navigation.

**Billing & agreements (SLA, quotes, invoices, payments).**

- *SLA agreement.* Built from the customer's support tier and SLA policy. The targets table is frozen when the draft is created. The 13 standard clauses can be edited, reordered or removed before sending.
- *Quotes and invoices.* A quote can copy a deal's products and prices. VAT defaults to the rate in Settings → Billing details. An invoice can be created from an accepted quote.
- *Sending.* "Mark as sent" creates a private client link (`/d/[token]`) and opens a ready-made email in your mail app. The CRM has no email provider yet.
- *Client view.* The client can view the document, download it as a PDF (browser print → Save as PDF), and sign online with a typed name, title and authorisation box (date, time and IP are recorded) or decline with a reason. Opens, signatures and declines notify the creator.
- *Paper signatures.* "Attach signed copy" uploads the returned PDF to the company's Files and marks the document signed.
- *Payments.* Record payments against a sent invoice (part or full; overpayment is refused). The status moves to Part paid, then Paid. Overdue and expired statuses are worked out from the due and validity dates.
- *Where it shows up.* Everything appears on the company and contact records, in Related records on deals, and on the company timeline.
- *Permissions.* SLAs need `accounts.edit`. Quotes need `deals.edit` or `billing.manage`. Invoices and payments need `billing.manage` (Finance, Sales Manager, Super Admin).
- *Company details.* Legal name, RC/TIN, bank details and signatory are set in **Settings → Billing details**. The defaults are placeholders.

**Security.** Server-side permission checks plus row scope on every read and write. Record-level denials return 404 so record existence isn't revealed; module-level denials show a 403 page. Other protections:

- Audit log covering role changes, permission edits, financial/contract fields, deal stage and amount, discount decisions, ticket priority/status, handover decisions and overrides, onboarding completion/exceptions, settings, SLA policy changes and data exports.
- Login rate limiting with a generic error message; portal and feedback rate limiting.
- Uploads are validated by extension, MIME type and magic bytes, capped at 10 MB, stored under random names outside any public path with `0600` permissions, and served only through an authorised route.
- CSV exports neutralise formula injection.
- Security headers: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Server actions get Next.js origin checks.
- Markdown rendering escapes HTML.

---

## Environment variables

See [`.env.example`](.env.example). Summary:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (e.g. Supabase pooler, port 5432 session mode). Empty → embedded PGlite. |
| `PGLITE_DIR` | Embedded DB directory (default `./.data/pglite`). |
| `AUTO_SEED` | Load demo data into an empty DB. Defaults to `true` in development, `false` when `NODE_ENV=production`. |
| `SEED_PASSWORD` | Demo users' password (demo only). |
| `APP_URL` | Public base URL for invitation and customer ticket links. |
| `CRON_SECRET` | Bearer token for `POST /api/cron/sweep`. Endpoint disabled when unset. |
| `STORAGE_DIR` | Private upload directory. Use a persistent volume, or replace `files.ts` storage with object storage. |
| `SWEEP_INTERVAL_SECONDS` | In-process sweep interval (0 disables). |
| `EMAIL_*`, `SMS_*`, `WHATSAPP_*`, `CALENDAR_*`, `TELEPHONY_*`, `ISSUE_TRACKER_*` | Optional integration credentials (server-only). Each needs an adapter registered in `src/server/services/integrations.ts`. |

No secrets are committed. `.env*` and `.data/` are git-ignored.

## Deployment

1. Create a Postgres database (e.g. a Supabase project) and set `DATABASE_URL`. Migrations run automatically on first connection, or run `npm run db:migrate` in your release step.
2. Create the first administrator. Either run once with `AUTO_SEED=true` against an **empty, non-production** database and invite real users from `admin@afrilinq.demo`, or insert one admin user and role via SQL. Never load demo data into production.
3. Set `APP_URL`, `CRON_SECRET`, `STORAGE_DIR` (a persistent volume) and `NODE_ENV=production`.
4. Long-running Node host (Docker, VM, Render, Railway, Fly): `npm ci && npm run build && npm start`. The in-process sweep runs every 60s.
   Serverless (e.g. Vercel): set `SWEEP_INTERVAL_SECONDS=0`, schedule `POST /api/cron/sweep` every 1–5 minutes, and move file storage to object storage (local disk is ephemeral).
5. Backups: enable automated Postgres backups / point-in-time recovery on your provider and back up `STORAGE_DIR`. Recovery = restore DB + storage to the same point. Agree RPO/RTO internally.

### Live demo on Fly.io (shareable link)

The repo includes a `Dockerfile` and `fly.toml` that run the real CRM with its built-in database and the demo data.

- **Demo data at build time.** The image loads the demo data while it builds, so the server starts ready. Seeding at runtime needs about 1 GB of memory.
- **Stops when idle.** The 1 GB machine stops when nobody is using it and starts on the next visit. Each start, and each deploy, resets to the sample data.
- **Customer links.** Ticket-portal, document and invitation links use `APP_URL`, or `https://<app>.fly.dev` when `APP_URL` is unset.

To deploy, run these from the project folder:

1. Run `fly auth signup`, or `fly auth login` if you already have an account. Add a payment card in the Fly dashboard.
2. Run `fly launch --copy-config --no-deploy`, keeping the app name from `fly.toml` or choosing a free one.
3. Run `fly secrets set CRON_SECRET=$(openssl rand -hex 32)`.
4. Run `fly deploy` to upload this folder and build it on Fly. `.dockerignore` keeps `.env.local`, `node_modules` and local data out.
5. Open `https://<app>.fly.dev`.

The demo accounts and password are the same as locally (see Quick start). Anyone with the link can sign in with them, so only share it with people you trust, and never put real customer data in the demo.

### Hardening before production

- Put a shared rate limiter (edge/WAF) in front of the app. The built-in limiter is per instance.
- Optionally add Postgres RLS as defence in depth (per-request `set_config('app.user_id', …)` inside transactions), or move to Supabase Auth + RLS using the auth adapter boundary.
- Configure an email provider adapter for invitations, customer replies and CSAT. Invitations currently show a one-time link to share securely.
- Add a browser E2E suite (Playwright) for the paths in the manual procedure below.
- Review the **configuration decisions** in the spec with the business (stages and probabilities, discount threshold, required handover fields, templates, required training, SLA targets, hours and holidays, retention).

---

## Acceptance criteria → evidence

`npm test` runs 51 tests (23 rule unit tests, a full seed run through the real services, 21 acceptance tests and 6 edit-conflict tests). `tests/acceptance.test.ts` maps to the spec's section 18:

| # | Criterion | Evidence |
|---|---|---|
| 1 | Lead → activity → deal → pipeline | `1. Sales executive…` |
| 2 | Closed Won blocked without fields | `2. Closed Won gate` (+ Closed Lost reason) |
| 3 | Exactly one handover, idempotent | `3. Exactly one handover…` (repeat move + direct re-call) |
| 4 | Submit / accept / request changes / override | `4–6 …` both tests (missing-field block, unauthorised override rejected, audited override) |
| 5 | Exactly one onboarding project, correct template | same test (Pay product → Pay template; second accept rejected) |
| 6 | Sales can't silently edit accepted handover | same test (+ audited correction keeps old value) |
| 7 | Tasks/blockers/training gaps drive risk; explicit completion | `7. Onboarding risk` |
| 8 | Trainer scope | `8. Trainer scope` |
| 9 | Triage & resolve; no resolution without summary | `9.` + root-cause rule test |
| 10 | Business hours & timezone | `10.` + 10 SLA unit tests (weekends, holidays, other zones, 24×7) |
| 11 | Approaching/breached SLA logged + escalated | `11.` (idempotent re-run) |
| 12 | Explicit pause/resume with reason | `12.` |
| 13 | Private notes never reach customer views | `13.` |
| 14 | Server-side scope (agents, sales, engineering) | `14.` |
| 15 | Reopen preserves resolution & history | `15.` |
| 16 | Customer 360 linkage | `16.` |
| 17 | Reports from records + drill-down | `17.` (drill row counts equal metric values) |
| 18 | Desktop/mobile, loading/error/empty/success states | Manual procedure below. `loading.tsx`, `error.tsx`, `not-found.tsx`, `forbidden.tsx`, empty states and form success/error banners throughout. |
| 19 | Clean install from README | Quick start above. |
| 20 | No secrets; no fake "connected" | `20.` + `.gitignore` |

### Manual browser procedure (repeatable)

1. **Emeka** (sales exec): Dashboard shows overdue/today tasks and appointments. On **Deals**, drag *Enugu Coal City Pharma* to *Closed Won*: rejected, listing the missing contract reference, billing frequency and start date. Open **Handovers → Zuma**, fill the checklist, then *Submit*.
2. **Chiamaka** (onboarding@): **Handover queue → Lekki Pearl** → comment + owner → *Accept*. Confirm a project appears in **Onboarding** with dated tasks. On **Ibadan** (changes requested), Emeka can edit. On **Kanem** (accepted), Emeka sees it read-only.
3. **Onboarding → Obudu Agro** shows high risk with reasons (overdue milestones, critical blocker, training gaps). Complete a task whose dependency is open: rejected.
4. **Bola** (support.lead@): **Tickets → SLA at risk / Overdue** queues. Open **AFL-1**: public reply vs internal note are separate, the escalation shows an engineering update, and *Run SLA check now* records warnings and breaches. Open the *customer ticket page* link in a private window: the internal note and engineering update are absent.
5. **Kelechi** (support@) cannot open AFL-1 (Technical Support queue) → 404. **Yusuf** (engineering@) sees only AFL-1.
6. **Funke** (trainer@): only her sessions appear. *Schedule session* lists only Calabar. Recording “Completed” on an absent participant is rejected.
7. **Tunde** (cco@): **Reports → Executive**. Click any tile to see the underlying records.
8. Resize to a phone (≈375px): navigation collapses to a drawer, tables scroll inside cards, and no page scrolls sideways.

---

## Phase log

- **Phase 1 – CRM foundation:** auth, invitations, RBAC + scoping, companies, contacts, leads (qualification, conversion), deals (Kanban + table, stage gates, discounts, products, history), activities, tasks, global search, saved views, CSV export, daily workspace, sales dashboard.
- **Phase 2 – Handover & onboarding:** full handover checklist and statuses, review, override, corrections, audit; templates, projects, milestones, dependencies, blockers, go-live checklist, risk engine, explicit completion.
- **Phase 3 – Support desk:** tickets, 11 queues, table/board, routing, duplicates, priority matrix, configurable SLA clocks with pause policy, sweeps/escalations, public vs internal, engineering escalation, incidents, resolve/close/reopen, customer portal, CSAT, ticket reports.
- **Phase 4 – Training & success:** programs, sessions, calendar, attendance, materials, assessments, participant records, training summary, health score, renewals, expansion.
- **Phase 5 – Integrations & automation:** rule engine with editor, history and retry; integration adapter boundary and test; knowledge base with review workflow, SOP templates, suggestions and help centre; executive/sales/onboarding/support dashboards with drill-down; custom fields; onboarding template editor; SLA policy editor.

### Not implemented / limitations (by design or out of scope for this build)

- No real email/SMS/WhatsApp/calendar/telephony/issue-tracker provider adapters. The boundary, configuration status and test flow exist; adding a provider means implementing `Adapter`.
- Inbound email-to-ticket and a full self-service customer portal with login are not built. Customers use per-ticket links and the public help centre.
- Custom fields apply to companies only. There's one pipeline (the data model supports more; the UI edits the default).
- Online card or bank payment links aren't built: they need a payment provider (e.g. Paystack or Flutterwave). Payments are recorded manually by Finance.
- PDFs come from the browser's print dialog (Save as PDF), not a server PDF renderer. Online signatures are typed-name e-signatures with an audit trail, not certificate-based digital signatures.
- Assessments record scores entered by the trainer. There's no in-app quiz-taking UI.
- Postgres RLS and browser E2E tests: see “Hardening before production”.
