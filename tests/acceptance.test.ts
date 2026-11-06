/**
 * Acceptance tests mapped to section 18 of the build specification.
 * They run the real service layer (the same code the UI's server actions call) against an
 * in-memory Postgres with migrations and demo seed applied.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { and, count, eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import { AppError } from "@/server/errors";
import * as sales from "@/server/services/sales";
import * as handover from "@/server/services/handover";
import * as onboarding from "@/server/services/onboarding";
import * as tickets from "@/server/services/tickets";
import * as training from "@/server/services/training";
import * as accounts from "@/server/services/accounts";
import * as activities from "@/server/services/activities";
import * as reports from "@/server/services/reports";
import * as integrations from "@/server/services/integrations";
import { runSlaSweep } from "@/server/services/sweep";
import { HANDOVER_FIELDS, REQUIRED_HANDOVER_KEYS } from "@/lib/rules/handover";
import { addBusinessMinutes } from "@/lib/rules/sla";
import { NOT_YET_KNOWN } from "@/lib/rules/tickets";

let db: DB;
const rejects = async (p: Promise<unknown>, code?: AppError["code"]) => {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    if (code) expect((e as AppError).code).toBe(code);
    return e as AppError;
  }
  throw new Error("Expected the call to be rejected");
};
const stage = async (key: string) => (await db.select().from(s.pipelineStages).where(eq(s.pipelineStages.key, key)))[0];
const product = async (code: string) => (await db.select().from(s.products).where(eq(s.products.code, code)))[0];
const company = async (prefix: string) => (await db.select().from(s.companies)).find((c) => c.name.startsWith(prefix))!;
const fullChecklist = () => Object.fromEntries(HANDOVER_FIELDS.map((f) => [f.key, f.key === "targetGoLive" ? "2027-01-15" : `Test value for ${f.label}`]));

beforeAll(async () => { db = await seededDb(); }, 180000);

/** A won deal for a fresh prospect, owned by Emeka, using Afrilinq Pay. */
async function wonDeal(name: string) {
  const emeka = await actor(db, "emeka");
  const co = await accounts.createCompany(db, emeka, { name, segment: "SME", tier: "Standard", lifecycle: "prospect" });
  const contact = await accounts.createContact(db, emeka, { companyId: co.id, firstName: "Test", lastName: name.split(" ")[0], email: `${name.split(" ")[0].toLowerCase()}@test.example`, contactRoles: ["decision_maker"] });
  const deal = await sales.createDeal(db, emeka, { name: `${name} deal`, companyId: co.id, primaryContactId: contact.id, amount: "6000000", currency: "NGN", forecastCategory: "commit", nextStep: "Sign", nextStepDue: "2026-12-01", expectedCloseDate: "2026-12-01" });
  const pay = await product("AFQ-PAY");
  await sales.setDealProducts(db, emeka, deal.id, [{ productId: pay.id, quantity: 1, unitPrice: 6_000_000 }]);
  await sales.updateDeal(db, emeka, deal.id, { name: deal.name, companyId: co.id, primaryContactId: contact.id, amount: "6000000", currency: "NGN", forecastCategory: "commit", nextStep: "Sign", nextStepDue: "2026-12-01", expectedCloseDate: "2026-12-01", contractReference: "MSA-T-1", billingFrequency: "Annually", startDate: "2026-12-01" });
  const res = await sales.moveDealStage(db, emeka, deal.id, (await stage("won")).id);
  const [h] = await db.select().from(s.handoverRecords).where(eq(s.handoverRecords.dealId, deal.id));
  return { emeka, co, contact, deal, h, res };
}

describe("1. Sales executive lead → activity → deal → pipeline", () => {
  it("creates a lead, logs activity, converts to a deal and moves stages", async () => {
    const emeka = await actor(db, "emeka");
    const lead = await sales.createLead(db, emeka, { name: "Payroll for 80 staff", organization: "Test Lagos Bakery", contactName: "Ada Test", email: "ada@bakery.example", source: "Website", status: "New", nextAction: "Call Ada", nextActionDue: "2026-11-01T09:00" });
    expect(lead.ownerId).toBe(emeka.id);
    await activities.logActivity(db, emeka, { type: "call", subject: "Intro call", leadId: lead.id, outcome: "Interested" });
    expect((await sales.getLead(db, emeka, lead.id)).status).toBe("Attempting Contact");
    const conv = await sales.convertLead(db, emeka, lead.id, { amount: 2_000_000 });
    expect(conv.dealId).toBeTruthy(); // converting with a deal (the default) opens one
    const dealId = conv.dealId!;
    await sales.updateDeal(db, emeka, dealId, { name: "Bakery payroll", companyId: conv.companyId!, primaryContactId: conv.contactId, amount: "2000000", currency: "NGN", forecastCategory: "pipeline", nextStep: "Discovery", nextStepDue: "2026-11-05", expectedCloseDate: "2026-12-15" });
    await sales.moveDealStage(db, emeka, dealId, (await stage("discovery")).id);
    await sales.moveDealStage(db, emeka, dealId, (await stage("qualified")).id);
    const d = await sales.getDealDetail(db, emeka, dealId);
    expect(d.stage.key).toBe("qualified");
    expect(d.history.length).toBe(3);
  });
});

describe("2. Closed Won gate", () => {
  it("rejects Closed Won without required commercial fields, and Closed Lost without a reason", async () => {
    const emeka = await actor(db, "emeka");
    const enugu = (await sales.listDeals(db, emeka, { q: "Enugu" })).rows[0];
    const err = await rejects(sales.moveDealStage(db, emeka, enugu.id, (await stage("won")).id), "validation");
    expect(Object.keys(err.fieldErrors!)).toEqual(expect.arrayContaining(["contractReference", "billingFrequency", "startDate"]));
    await rejects(sales.moveDealStage(db, emeka, enugu.id, (await stage("lost")).id), "validation");
    const [h] = await db.select({ n: count() }).from(s.handoverRecords).where(eq(s.handoverRecords.dealId, enugu.id));
    expect(h.n).toBe(0);
  });
});

describe("3. Exactly one handover per won deal", () => {
  it("is idempotent across repeated requests", async () => {
    const { emeka, deal, res } = await wonDeal("Idempotent Foods");
    expect(res.handoverCreated).toBe(true);
    const again = await sales.moveDealStage(db, emeka, deal.id, (await stage("won")).id);
    expect(again.unchanged).toBe(true);
    const direct = await db.transaction((tx) => handover.ensureHandoverForDeal(tx, emeka, { ...deal }));
    expect(direct.created).toBe(false);
    const [{ n }] = await db.select({ n: count() }).from(s.handoverRecords).where(eq(s.handoverRecords.dealId, deal.id));
    expect(n).toBe(1);
  });
});

describe("4–6. Handover submit / review / accept and sales read-only", () => {
  it("blocks submission with missing fields, supports request-changes and acceptance", async () => {
    const { emeka, h } = await wonDeal("Review Path Ltd");
    const ob = await actor(db, "onboarding");
    await rejects(handover.submitHandover(db, emeka, h.id), "validation");
    await handover.saveHandoverChecklist(db, emeka, h.id, fullChecklist());
    await handover.submitHandover(db, emeka, h.id);
    await rejects(handover.requestHandoverChanges(db, ob, h.id, ""), "validation"); // mandatory comment
    await handover.requestHandoverChanges(db, ob, h.id, "Please confirm the training attendee count.");
    expect((await handover.getHandover(db, ob, h.id)).h.status).toBe("Changes Requested");
    await handover.submitHandover(db, emeka, h.id);
    const projectId = await handover.acceptHandover(db, ob, h.id, { comment: "All good, accepted.", onboardingOwnerId: ob.id });
    const projects = await db.select().from(s.onboardingProjects).where(eq(s.onboardingProjects.handoverId, h.id));
    expect(projects).toHaveLength(1); // 5. exactly one project
    expect(projects[0].id).toBe(projectId);
    const [tpl] = await db.select().from(s.onboardingTemplates).where(eq(s.onboardingTemplates.id, projects[0].templateId!));
    expect(tpl.name).toBe("Afrilinq Pay integration onboarding"); // 5. correct template for the product
    const tasks = await db.select().from(s.onboardingTasks).where(eq(s.onboardingTasks.projectId, projectId));
    expect(tasks.length).toBeGreaterThan(5);
    expect(tasks.every((t) => t.dueDate)).toBe(true);
    await rejects(handover.acceptHandover(db, ob, h.id, { comment: "Again please", onboardingOwnerId: ob.id }), "conflict");
    // 6. Sales sees status but cannot silently edit
    const view = await handover.getHandoverDetail(db, emeka, h.id);
    expect(view.h.status).toBe("Accepted by Onboarding");
    expect(view.canEdit).toBe(false);
    await rejects(handover.saveHandoverChecklist(db, emeka, h.id, { risks: "changed silently" }), "forbidden");
    await rejects(onboarding.updateOnboardingTask(db, emeka, tasks[0].id, { status: "done" }), "forbidden");
    // Documented correction preserves the old value in the audit log
    await handover.requestHandoverCorrection(db, emeka, h.id, { field: "risks", newValue: "Customer IT lead leaving in December", reason: "New information from customer" });
    const req = (await db.select().from(s.handoverReviews).where(and(eq(s.handoverReviews.handoverId, h.id), eq(s.handoverReviews.action, "correction_requested"))))[0];
    await handover.applyHandoverCorrection(db, ob, h.id, req.id, true);
    const [log] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, h.id), eq(s.auditLogs.action, "handover.correction_applied")));
    expect(log.changes!.risks.from).toContain("Test value");
    expect(log.changes!.risks.to).toBe("Customer IT lead leaving in December");
  });

  it("blocks accepting an incomplete handover unless an authorised manager overrides with an audited reason", async () => {
    const { h } = await wonDeal("Override Case Ltd");
    const ob = await actor(db, "onboarding");
    const lead = await actor(db, "support.lead");
    await rejects(handover.acceptHandover(db, ob, h.id, { comment: "Accepting early", onboardingOwnerId: ob.id }), "validation");
    await rejects(handover.acceptHandover(db, lead, h.id, { comment: "Accepting early", onboardingOwnerId: ob.id, overrideReason: "Customer escalation, CEO approved" }), "forbidden");
    await handover.acceptHandover(db, ob, h.id, { comment: "Accepting early", onboardingOwnerId: ob.id, overrideReason: "Customer go-live is contractually fixed; Sales on leave. Approved by COO." });
    const [log] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, h.id), eq(s.auditLogs.action, "handover.override_accepted")));
    expect(log.reason).toContain("contractually fixed");
    expect((log.changes!.missingFields.to as string[]).length).toBeGreaterThan(0);
  });
});

describe("7. Onboarding risk", () => {
  it("raises risk from overdue milestones, blockers and training gaps, and requires explicit completion", async () => {
    const { h, emeka } = await wonDeal("Risky Rollout Ltd");
    const ob = await actor(db, "onboarding");
    await handover.saveHandoverChecklist(db, emeka, h.id, fullChecklist());
    await handover.submitHandover(db, emeka, h.id);
    const pid = await handover.acceptHandover(db, ob, h.id, { comment: "Accepted for risk test", onboardingOwnerId: ob.id });
    await onboarding.updateProjectDates(db, ob, pid, { targetGoLive: "2026-10-30", kickoffDate: null, internalNotes: null });
    let p = (await db.select().from(s.onboardingProjects).where(eq(s.onboardingProjects.id, pid)))[0];
    expect(p.riskLevel).toBe("high"); // training gap within 14 days of go-live
    expect(p.riskReasons.join(" ")).toContain("training");
    await onboarding.addBlocker(db, ob, pid, { description: "Bank KYC rejected", severity: "critical", ownerId: ob.id, customerSide: true });
    p = (await db.select().from(s.onboardingProjects).where(eq(s.onboardingProjects.id, pid)))[0];
    expect(p.riskReasons.join(" ")).toContain("blocker");
    // Completing every task is not enough: completion is an explicit, authorised confirmation.
    for (const t of await db.select().from(s.onboardingTasks).where(eq(s.onboardingTasks.projectId, pid)).orderBy(s.onboardingTasks.position))
      await onboarding.updateOnboardingTask(db, ob, t.id, { status: "done" });
    expect((await db.select().from(s.onboardingProjects).where(eq(s.onboardingProjects.id, pid)))[0].state).toBe("active");
    await rejects(onboarding.completeProject(db, ob, pid, { notes: "Live!", actualGoLive: "2026-10-30", exceptionReason: null }), "validation");
    const err = await rejects(onboarding.completeProject(db, ob, pid, { notes: "Customer is live and stable.", actualGoLive: "2026-10-30", exceptionReason: null }), "validation");
    expect(err.message).toContain("Outstanding");
    await onboarding.completeProject(db, ob, pid, { notes: "Customer is live and stable.", actualGoLive: "2026-10-30", exceptionReason: "Blocker accepted by customer; training booked next week." });
    const [log] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, pid), eq(s.auditLogs.action, "onboarding.completed_with_exception")));
    expect(log).toBeTruthy();
    expect((await db.select().from(s.handoverRecords).where(eq(s.handoverRecords.id, h.id)))[0].status).toBe("Complete");
  });
});

describe("8. Trainer scope", () => {
  it("schedules, records attendance and completion only for assigned customers", async () => {
    const trainer = await actor(db, "trainer"); // Funke facilitates Calabar sessions
    const calabar = await company("Calabar");
    const lekki = await company("Lekki");
    const prog = (await db.select().from(s.trainingPrograms)).find((p) => p.name.startsWith("Refresher"))!;
    const contactsCal = await db.select().from(s.contacts).where(eq(s.contacts.companyId, calabar.id));
    const base = { programId: prog.id, onboardingProjectId: null, facilitatorId: null, title: "Refresher", startsAt: new Date("2026-11-10T09:00:00Z"), durationMinutes: 60, channel: "virtual", location: null, meetingLink: "https://meet.example/x", agenda: null, isRefresher: true };
    const sess = await training.scheduleSession(db, trainer, { ...base, companyId: calabar.id, contactIds: [contactsCal[0].id] });
    await rejects(training.scheduleSession(db, trainer, { ...base, companyId: lekki.id, contactIds: [] }), "forbidden");
    const lekkiContact = (await db.select().from(s.contacts).where(eq(s.contacts.companyId, lekki.id)))[0];
    await rejects(training.addParticipants(db, trainer, sess.id, [lekkiContact.id], null), "validation");
    const [p] = await db.select().from(s.trainingParticipants).where(eq(s.trainingParticipants.sessionId, sess.id));
    await rejects(training.recordAttendance(db, trainer, p.id, { attendance: "absent", completed: true, competency: "competent", needsRetraining: false, feedbackScore: null, feedback: null }), "validation");
    await training.recordAttendance(db, trainer, p.id, { attendance: "attended", completed: true, competency: "competent", needsRetraining: false, feedbackScore: 5, feedback: null });
    await training.completeSession(db, trainer, sess.id, "Saved reports and Excel export");
    // No access to unrelated accounts or other trainers' sessions
    await rejects(accounts.getCompany(db, trainer, calabar.id), "not_found");
    const segunSession = (await db.select().from(s.trainingSessions)).find((x) => x.title.startsWith("Jos"))!;
    await rejects(training.getSessionDetail(db, trainer, segunSession.id), "not_found");
    const visible = await training.listSessions(db, trainer);
    expect(visible.every((v) => v.s.facilitatorId === trainer.id)).toBe(true);
  });
});

describe("9–15. Support desk", () => {
  async function newTicket(who = "support", extra: Record<string, unknown> = {}, now?: Date) {
    const a = await actor(db, who);
    const calabar = await company("Calabar");
    const books = await product("AFQ-BOOKS");
    return tickets.createTicket(db, a, { subject: `Unique issue ${Math.random().toString(36).slice(2)}`, description: "Details of the problem.", companyId: calabar.id, channel: "email", productId: books.id, category: "How-to / Training", impact: "single_user", urgency: "medium", requesterEmail: "ekaette.udo@calabar.example", ignoreDuplicates: true, ...extra }, now ? { now } : {});
  }

  it("9. triages and resolves; rejects resolution without a summary", async () => {
    const kel = await actor(db, "support");
    const t = await newTicket();
    await tickets.updateTriage(db, kel, t.id, { category: "Access & Login", subcategory: "Permissions", impact: "single_user", urgency: "high", productId: t.productId, workaroundAvailable: false, workaround: null, affectedUsers: 1, businessImpact: null, incidentType: null });
    const tri = await tickets.getTicket(db, kel, t.id);
    expect(tri.priority).toBe("P3");
    await rejects(tickets.resolveTicket(db, kel, t.id, { resolutionSummary: "", resolutionCode: null, rootCause: null, rootCauseFollowUpOwnerId: null }), "validation");
    await tickets.resolveTicket(db, kel, t.id, { resolutionSummary: "Granted the missing approver permission.", resolutionCode: "Fixed — configuration change", rootCause: null, rootCauseFollowUpOwnerId: null });
    expect((await tickets.getTicket(db, kel, t.id)).status).toBe("resolved");
  });

  it("requires root cause or 'not yet known' + owner for P1/P2", async () => {
    const lead = await actor(db, "support.lead");
    const t = await newTicket("support.lead", { impact: "multiple_users", urgency: "critical", businessImpact: "Finance team blocked" });
    expect(t.priority).toBe("P2");
    const e = await rejects(tickets.resolveTicket(db, lead, t.id, { resolutionSummary: "Restarted the reporting service", resolutionCode: "Workaround provided", rootCause: null, rootCauseFollowUpOwnerId: null }));
    expect(e.fieldErrors!.rootCause).toBeTruthy();
    await tickets.resolveTicket(db, lead, t.id, { resolutionSummary: "Restarted the reporting service", resolutionCode: "Workaround provided", rootCause: NOT_YET_KNOWN, rootCauseFollowUpOwnerId: lead.id });
    const [task] = await db.select().from(s.tasks).where(eq(s.tasks.dedupeKey, `rootcause:${t.id}:0`));
    expect(task.ownerId).toBe(lead.id);
  });

  it("10. calculates deadlines with configured business hours and timezone", async () => {
    const created = new Date("2026-10-30T15:00:00Z"); // Friday 16:00 Africa/Lagos
    const t = await newTicket("support", {}, created); // P3: 240 business minutes first response
    const [policy] = await db.select().from(s.slaPolicies).where(eq(s.slaPolicies.isDefault, true));
    expect(t.firstResponseDueAt!.toISOString()).toBe(addBusinessMinutes(created, 240, policy.calendar).toISOString());
    expect(t.firstResponseDueAt!.toISOString()).toBe("2026-11-02T10:00:00.000Z"); // Monday 11:00 Lagos
  });

  it("11. approaching and breached SLAs create logged events, notifications and escalations", async () => {
    const t = await newTicket("support", { impact: "single_user", urgency: "critical", businessImpact: "Cannot invoice" }, new Date(Date.now() - 3 * 86400000)); // P2, long overdue
    const res = await runSlaSweep(db);
    expect(res.breaches).toBeGreaterThan(0);
    const events = await db.select().from(s.slaEvents).where(eq(s.slaEvents.ticketId, t.id));
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["warning", "escalated", "breached"]));
    const after = (await db.select().from(s.tickets).where(eq(s.tickets.id, t.id)))[0];
    expect(after.firstResponseBreached).toBe(true);
    expect(after.escalationLevel).toBeGreaterThanOrEqual(2);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.link, `/tickets/${t.id}`));
    expect(notes.some((n) => n.title.startsWith("SLA BREACHED"))).toBe(true);
    const again = await runSlaSweep(db); // idempotent
    const events2 = await db.select().from(s.slaEvents).where(eq(s.slaEvents.ticketId, t.id));
    expect(events2.length).toBe(events.length);
    void again;
  });

  it("12. pauses only per explicit policy and records why and who", async () => {
    const kel = await actor(db, "support");
    const t = await newTicket();
    await rejects(tickets.changeTicketStatus(db, kel, t.id, "waiting_on_customer", {}), "validation");
    await tickets.changeTicketStatus(db, kel, t.id, "waiting_on_customer", { waitingReason: "Screenshot of the error", followUpAt: new Date(Date.now() + 86400000) });
    let row = (await db.select().from(s.tickets).where(eq(s.tickets.id, t.id)))[0];
    expect(row.slaPausedAt).not.toBeNull();
    expect(row.slaPausedBy).toBe(kel.id);
    const dueBefore = row.resolutionDueAt!;
    await db.update(s.tickets).set({ slaPausedAt: new Date(Date.now() - 5 * 86400000) }).where(eq(s.tickets.id, t.id)); // pretend 5 days paused
    await tickets.changeTicketStatus(db, kel, t.id, "waiting_on_engineering", { waitingReason: "Defect suspected" });
    row = (await db.select().from(s.tickets).where(eq(s.tickets.id, t.id)))[0];
    expect(row.slaPausedAt).toBeNull(); // engineering wait does not pause under the default policy
    expect(row.resolutionDueAt!.getTime()).toBeGreaterThan(dueBefore.getTime());
    const kinds = (await db.select().from(s.slaEvents).where(eq(s.slaEvents.ticketId, t.id))).map((e) => `${e.kind}:${e.details}`);
    expect(kinds.some((k) => k.startsWith("paused:") && k.includes("Screenshot"))).toBe(true);
    expect(kinds.some((k) => k.startsWith("resumed:"))).toBe(true);
    expect(kinds.some((k) => k.startsWith("continues:"))).toBe(true);
  });

  it("13. private notes never reach the customer-visible view", async () => {
    const kel = await actor(db, "support");
    const t = await newTicket();
    const secret = "INTERNAL-ONLY customer seems to be shopping competitors";
    await tickets.addInternalNote(db, kel, t.id, secret);
    await tickets.replyToTicket(db, kel, t.id, "We are looking into this for you.");
    const portal = await tickets.getPortalTicket(db, t.portalToken!);
    const json = JSON.stringify(portal);
    expect(json).toContain("We are looking into this");
    expect(json).not.toContain("INTERNAL-ONLY");
    expect(json).not.toContain("portalToken");
    expect(await tickets.getPortalTicket(db, "x".repeat(24))).toBeNull();
  });

  it("14. scope: agents only see permitted queues; sales cannot read internal notes", async () => {
    const kel = await actor(db, "support"); // Customer Support team
    const aisha = await actor(db, "aisha"); // Technical Support team
    const tech = await newTicket("support.lead", { category: "Integration", subject: "API callback failing for tech team" });
    expect(tech.ownerId).toBe(aisha.id);
    await rejects(tickets.getTicketDetail(db, kel, tech.id), "not_found");
    expect((await tickets.getTicketDetail(db, aisha, tech.id)).t.id).toBe(tech.id);
    const list = await tickets.listTickets(db, kel, { queue: "all_open" });
    expect(list.all.every((r) => r.t.teamId === kel.teamId || r.t.ownerId === kel.id || r.t.createdBy === kel.id)).toBe(true);
    const emeka = await actor(db, "emeka");
    const mine = await newTicket("emeka", { subject: "Customer asked sales about login trouble" });
    await tickets.addInternalNote(db, kel, mine.id, "Internal triage note");
    const view = await tickets.getTicketDetail(db, emeka, mine.id);
    expect(view.notes).toBeNull();
    await rejects(tickets.addInternalNote(db, emeka, mine.id, "x"), "forbidden");
    await rejects(tickets.resolveTicket(db, emeka, mine.id, { resolutionSummary: "Sales says it's fixed now", resolutionCode: "Fixed — configuration change", rootCause: null, rootCauseFollowUpOwnerId: null }), "forbidden");
    const eng = await actor(db, "engineering");
    await rejects(tickets.getTicketDetail(db, eng, mine.id), "not_found");
  });

  it("15. reopening preserves the previous resolution and full history", async () => {
    const kel = await actor(db, "support");
    const t = await newTicket();
    await tickets.resolveTicket(db, kel, t.id, { resolutionSummary: "Cleared browser cache and re-synced.", resolutionCode: "User guidance / how-to", rootCause: null, rootCauseFollowUpOwnerId: null });
    await tickets.portalReopen(db, t.portalToken!, "Still happening on mobile");
    const row = (await db.select().from(s.tickets).where(eq(s.tickets.id, t.id)))[0];
    expect(row.status).toBe("reopened");
    expect(row.reopenCount).toBe(1);
    expect(row.resolutionSummary).toBeNull();
    const hist = await db.select().from(s.ticketStatusHistory).where(eq(s.ticketStatusHistory.ticketId, t.id));
    const reopen = hist.find((h) => h.toStatus === "reopened")!;
    expect((reopen.snapshot as { previousResolution: { resolutionSummary: string } }).previousResolution.resolutionSummary).toBe("Cleared browser cache and re-synced.");
    expect(hist.map((h) => h.toStatus)).toEqual(expect.arrayContaining(["resolved", "reopened"]));
  });

  it("warns about likely duplicates for the same customer and product", async () => {
    const first = await newTicket("support", { subject: "Fixed asset depreciation schedule doubled" });
    const e = await rejects(newTicket("support", { subject: "Depreciation schedule doubled for fixed assets", ignoreDuplicates: false }), "validation");
    expect(e.message).toContain(`AFL-${first.number}`);
    expect(e.fieldErrors!.ignoreDuplicates).toBeTruthy();
  });

  it("starts the incident workflow for suspected data exposure", async () => {
    const t = await newTicket("support", { incidentType: "data_exposure", impact: "minimal", urgency: "low", businessImpact: "Customer saw another tenant's invoice" });
    expect(t.priority).toBe("P1");
    const [esc] = await db.select().from(s.ticketEscalations).where(and(eq(s.ticketEscalations.ticketId, t.id), eq(s.ticketEscalations.kind, "incident")));
    expect(esc).toBeTruthy();
    const kel = await actor(db, "support");
    const e = await rejects(tickets.resolveTicket(db, kel, t.id, { resolutionSummary: "Tenant isolation bug fixed and verified", resolutionCode: "Fixed — product defect resolved", rootCause: "Cache key missing tenant id", rootCauseFollowUpOwnerId: null }));
    expect(e.fieldErrors!.incidentEvidence).toBeTruthy(); // agents cannot declare incidents fixed
  });
});

describe("16. Customer 360", () => {
  it("shows linked deals, handovers, onboarding, training, tickets and activities", async () => {
    const admin = await actor(db, "admin");
    const kanem = await company("Kanem");
    const v = await accounts.customer360(db, admin, kanem.id);
    expect(v.deals.length).toBeGreaterThanOrEqual(2);
    expect(v.handovers.length).toBe(1);
    expect(v.projects.length).toBe(1);
    expect(v.sessions.length).toBeGreaterThanOrEqual(1);
    expect(v.tickets.length).toBeGreaterThanOrEqual(2);
    expect(v.activities.length).toBeGreaterThanOrEqual(1);
    expect(v.timeline.length).toBeGreaterThan(v.activities.length);
    expect(v.health).not.toBeNull();
  });
});

describe("17. Reports computed from records with drill-down", () => {
  it("matches the underlying rows", async () => {
    const cco = await actor(db, "cco");
    const f = { from: "2025-01-01", to: "2027-12-31" };
    const m = await reports.salesMetrics(db, cco, f);
    const drillWon = await reports.drill(db, cco, "deals_won", f);
    expect(drillWon.rows.length).toBe(m.won);
    const sup = await reports.supportMetrics(db, cco, f);
    const drillOpen = await reports.drill(db, cco, "tickets_open", f);
    expect(drillOpen.rows.length).toBe(sup.openTotal);
    const emeka = await actor(db, "emeka");
    await rejects(reports.supportMetrics(db, emeka, f), "forbidden");
  });
});

describe("20. Integrations are never falsely shown as connected", () => {
  it("reports not configured and refuses silent sends", async () => {
    const list = await integrations.listIntegrations(db);
    expect(list.every((i) => i.status === "not_configured")).toBe(true);
    const admin = await actor(db, "admin");
    const r = await integrations.testIntegration(db, admin, "email");
    expect(r.status).toBe("not_configured");
    await rejects(integrations.sendViaAdapter(db, admin, { channel: "email", to: "x@test.example", body: "hi", confirmSimulated: false }), "validation");
    const sim = await integrations.sendViaAdapter(db, admin, { channel: "email", to: "x@test.example", body: "hi", confirmSimulated: true });
    expect(sim.status).toBe("simulated");
  });
});

describe("RBAC admin guardrails", () => {
  it("records role changes and prevents self lock-out", async () => {
    const { setUserRoles } = await import("@/server/services/admin");
    const admin = await actor(db, "admin");
    const emeka = await actor(db, "emeka");
    const roles = await db.select().from(s.roles);
    await rejects(setUserRoles(db, emeka, admin.id, []), "forbidden");
    await rejects(setUserRoles(db, admin, admin.id, [roles.find((r) => r.key === "executive")!.id]), "conflict");
    await setUserRoles(db, admin, emeka.id, [roles.find((r) => r.key === "sales_executive")!.id, roles.find((r) => r.key === "trainer")!.id]);
    const [log] = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, emeka.id), eq(s.auditLogs.action, "user.roles_changed")));
    expect(log.changes!.roles.to).toEqual(expect.arrayContaining(["Trainer"]));
    void REQUIRED_HANDOVER_KEYS;
  });
});
