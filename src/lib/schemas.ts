import { z } from "zod";
import { fromLocalInput } from "./format";

/** Shared input schemas. Used by server services (authoritative) and available to client forms. */

const str = (label: string, max = 200) => z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max);
export const optStr = (max = 5000) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optUuid = z.string().trim().optional().nullable().transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Invalid selection.");
const optDate = z.string().trim().optional().nullable().transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use YYYY-MM-DD.");
const optDateTime = z.string().trim().optional().nullable().transform((v) => (v ? fromLocalInput(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Invalid date/time.");
const optNum = z.union([z.string(), z.number()]).optional().nullable()
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(/[, ]/g, ""))))
  .refine((v) => v === null || Number.isFinite(v), "Enter a number.");
const optEmail = z.string().trim().optional().nullable().transform((v) => (v ? v.toLowerCase() : null))
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address.");
const bool = z.union([z.boolean(), z.string()]).optional().nullable().transform((v) => v === true || v === "on" || v === "true");

export const zh = { str, optStr, optUuid, optDate, optDateTime, optNum, optEmail, bool };

export const leadSchema = z.object({
  name: str("Lead name"), organization: optStr(160), contactName: str("Primary contact name"),
  email: optEmail, phone: optStr(40), source: str("Lead source"), status: str("Status"),
  ownerId: optUuid, productInterestId: optUuid, segment: optStr(40), region: optStr(60),
  nextAction: str("Next action", 300), nextActionDue: optDateTime,
  need: optStr(), fit: optStr(), timing: optStr(), decisionProcess: optStr(), budget: optStr(), painPoints: optStr(),
  disqualifyReason: optStr(500),
}).refine((v) => v.email || v.phone, { path: ["email"], message: "Provide an email or phone number." })
  .refine((v) => v.status !== "Disqualified" || v.disqualifyReason, { path: ["disqualifyReason"], message: "Give a reason for disqualifying." });

export const companySchema = z.object({
  name: str("Company name"), industry: optStr(80), segment: str("Segment"), tier: str("Tier"), lifecycle: str("Lifecycle"),
  region: optStr(60), city: optStr(60), address: optStr(300), website: optStr(200), phone: optStr(40),
  ownerId: optUuid, csmId: optUuid, notes: optStr(),
});

export const contactSchema = z.object({
  companyId: optUuid, firstName: str("First name", 80), lastName: str("Last name", 80), email: optEmail,
  phone: optStr(40), whatsapp: optStr(40), jobTitle: optStr(120), contactRoles: z.array(z.string()).default([]),
  preferredChannel: optStr(20), marketingConsent: bool, ownerId: optUuid,
  leadStatus: optStr(40), lifecycleStage: z.string().trim().min(1).max(40).default("lead"), referralSource: optStr(80), city: optStr(60),
});

export const dealSchema = z.object({
  name: str("Deal name"), companyId: z.string().uuid("Choose a company."), primaryContactId: optUuid, ownerId: optUuid,
  amount: optNum, currency: str("Currency", 3), expectedCloseDate: optDate, probabilityOverride: optNum,
  nextStep: optStr(300), nextStepDue: optDate, competitor: optStr(120), forecastCategory: str("Forecast category"),
  contractReference: optStr(120), billingFrequency: optStr(40), startDate: optDate, discountPct: optNum, leadSource: optStr(60),
});

export const activitySchema = z.object({
  type: str("Type"), subject: str("Subject", 300), body: optStr(), outcome: optStr(300), occurredAt: optDateTime,
  scheduledFor: optDateTime, durationMinutes: optNum,
  companyId: optUuid, contactId: optUuid, dealId: optUuid, leadId: optUuid, ticketId: optUuid, onboardingProjectId: optUuid,
  followUpTitle: optStr(300), followUpDue: optDateTime,
});

export const taskSchema = z.object({
  title: str("Title", 300), description: optStr(), ownerId: optUuid, dueAt: optDateTime, remindAt: optDateTime,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  taskType: z.enum(["todo", "call", "email", "meeting", "whatsapp"]).default("todo"),
  stage: z.enum(["not_started", "in_progress", "waiting", "completed", "deferred"]).default("not_started"),
  queue: optStr(60),
  relatedType: optStr(30), relatedId: optUuid, companyId: optUuid,
});

export const ticketSchema = z.object({
  subject: str("Subject", 300), description: str("Description", 20000), companyId: optUuid, contactId: optUuid,
  requesterEmail: optEmail, channel: str("Channel"), productId: z.string().uuid("Choose the affected product."),
  category: str("Category"), subcategory: optStr(80), impact: str("Impact"), urgency: str("Urgency"),
  affectedUsers: optNum, affectedCustomers: optNum, businessImpact: optStr(2000), workaroundAvailable: bool, workaround: optStr(2000),
  incidentType: optStr(40), ownerId: optUuid, teamId: optUuid, onboardingProjectId: optUuid, dealId: optUuid,
  ignoreDuplicates: bool,
}).refine((v) => v.companyId || v.contactId, { path: ["companyId"], message: "Raise the ticket on an existing company or contact." })
  .refine((v) => !["widespread", "multiple_users"].includes(v.impact) || v.businessImpact, { path: ["businessImpact"], message: "Describe the business impact for multi-user issues." })
  .refine((v) => !v.incidentType || v.businessImpact, { path: ["businessImpact"], message: "Incidents need business impact details." });

export function formToObject(fd: FormData, multi: string[] = []) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (multi.includes(k)) ((o[k] as unknown[]) ??= []).push(v);
    else o[k] = typeof v === "string" ? v : v;
  }
  for (const k of multi) o[k] ??= [];
  return o;
}
