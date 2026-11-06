import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import {
  trainingPrograms, trainingSessions, trainingParticipants, trainingMaterials, assessments, assessmentResults, contacts, companies,
  users, products, onboardingProjects, type AssessmentQuestion,
} from "@/db/schema";
import { type Actor, assertCan, can } from "../actor";
import { audit } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { trainingScope } from "./scope";
import { recomputeRisk } from "./onboarding";
import { sendViaAdapter } from "./integrations";

const canSeeTraining = (a: Actor) => can(a, "training.view_all", "training.view_assigned");

export async function trainerAssignedCompanies(db: DB, actor: Actor) {
  const rows = await db.selectDistinct({ id: trainingSessions.companyId }).from(trainingSessions).where(eq(trainingSessions.facilitatorId, actor.id));
  return rows.map((r) => r.id);
}

export async function schedulableCompanies(db: DB, actor: Actor) {
  if (can(actor, "training.view_all")) return db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(asc(companies.name));
  const ids = await trainerAssignedCompanies(db, actor);
  return ids.length ? db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, ids)).orderBy(asc(companies.name)) : [];
}

export async function listPrograms(db: DB, actor: Actor) {
  if (!canSeeTraining(actor)) throw forbidden();
  return db.select({ p: trainingPrograms, productName: products.name }).from(trainingPrograms).leftJoin(products, eq(products.id, trainingPrograms.productId))
    .orderBy(asc(trainingPrograms.name));
}

export async function getProgram(db: DB, actor: Actor, id: string) {
  if (!canSeeTraining(actor)) throw forbidden();
  const [p] = await db.select().from(trainingPrograms).where(eq(trainingPrograms.id, id));
  if (!p) throw notFound("Program");
  const materials = await db.select().from(trainingMaterials).where(eq(trainingMaterials.programId, id)).orderBy(asc(trainingMaterials.createdAt));
  const tests = await db.select().from(assessments).where(eq(assessments.programId, id));
  const sessions = await db.select({ id: trainingSessions.id, title: trainingSessions.title, startsAt: trainingSessions.startsAt, status: trainingSessions.status, companyName: companies.name, facilitator: users.name })
    .from(trainingSessions).innerJoin(companies, eq(companies.id, trainingSessions.companyId)).innerJoin(users, eq(users.id, trainingSessions.facilitatorId))
    .where(and(eq(trainingSessions.programId, id), trainingScope(actor))).orderBy(desc(trainingSessions.startsAt));
  const [product] = p.productId ? await db.select().from(products).where(eq(products.id, p.productId)) : [];
  return { p, materials, assessments: tests, sessions, product, canEdit: can(actor, "training.programs") };
}

export async function saveProgram(db: DB, actor: Actor, id: string | null, v: {
  name: string; productId: string | null; audienceRole: string; segment: string | null; description: string | null; objectives: string[];
  requiredForGoLive: boolean; durationMinutes: number;
}) {
  assertCan(actor, "training.programs");
  if (!v.name?.trim()) throw invalid("Program name is required.", { name: "Required." });
  if (!v.audienceRole?.trim()) throw invalid("Audience role is required.", { audienceRole: "Required." });
  if (id) {
    await db.update(trainingPrograms).set(v).where(eq(trainingPrograms.id, id));
    await audit(db, actor, "training.program_updated", "training_program", id);
    return id;
  }
  const [p] = await db.insert(trainingPrograms).values(v).returning();
  await audit(db, actor, "training.program_created", "training_program", p.id);
  return p.id;
}

export async function addMaterial(db: DB, actor: Actor, programId: string, v: { title: string; kind: string; url: string; visibility: string }) {
  assertCan(actor, "training.programs");
  if (!v.title?.trim()) throw invalid("Title is required.", { title: "Required." });
  if (!/^https?:\/\//.test(v.url)) throw invalid("Materials must be http(s) links to your document or video store.", { url: "Use a full URL." });
  if (!["internal", "customer"].includes(v.visibility)) throw invalid("Choose visibility.");
  await db.insert(trainingMaterials).values({ programId, ...v });
}

export async function addAssessment(db: DB, actor: Actor, programId: string, v: { title: string; passMark: number; questions: AssessmentQuestion[] }) {
  assertCan(actor, "training.programs");
  if (!v.title?.trim()) throw invalid("Title is required.", { title: "Required." });
  if (!(v.passMark >= 1 && v.passMark <= 100)) throw invalid("Pass mark must be 1–100.", { passMark: "1–100" });
  await db.insert(assessments).values({ programId, ...v });
}

export type SessionFilters = { from?: string; to?: string; company?: string; status?: string; mine?: string };

export async function listSessions(db: DB, actor: Actor, f: SessionFilters = {}) {
  if (!canSeeTraining(actor)) throw forbidden();
  const conds: (SQL | undefined)[] = [trainingScope(actor)];
  if (f.from) conds.push(gte(trainingSessions.startsAt, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) conds.push(lte(trainingSessions.startsAt, new Date(`${f.to}T23:59:59Z`)));
  if (f.company) conds.push(eq(trainingSessions.companyId, f.company));
  if (f.status) conds.push(eq(trainingSessions.status, f.status));
  if (f.mine) conds.push(eq(trainingSessions.facilitatorId, actor.id));
  return db.select({
    s: trainingSessions, program: trainingPrograms.name, companyName: companies.name, facilitator: users.name,
  }).from(trainingSessions).innerJoin(trainingPrograms, eq(trainingPrograms.id, trainingSessions.programId))
    .innerJoin(companies, eq(companies.id, trainingSessions.companyId)).innerJoin(users, eq(users.id, trainingSessions.facilitatorId))
    .where(and(...conds)).orderBy(asc(trainingSessions.startsAt));
}

export async function getSession(db: DB, actor: Actor, id: string) {
  const [s] = await db.select().from(trainingSessions).where(and(eq(trainingSessions.id, id), trainingScope(actor)));
  if (!s) throw notFound("Training session");
  return s;
}

export async function getSessionDetail(db: DB, actor: Actor, id: string) {
  const s = await getSession(db, actor, id);
  const [program] = await db.select().from(trainingPrograms).where(eq(trainingPrograms.id, s.programId));
  // Only the company name and the contacts needed for this session are exposed to trainers.
  const [company] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, s.companyId));
  const [facilitator] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, s.facilitatorId));
  const participants = await db.select({
    p: trainingParticipants, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, jobTitle: contacts.jobTitle,
  }).from(trainingParticipants).innerJoin(contacts, eq(contacts.id, trainingParticipants.contactId)).where(eq(trainingParticipants.sessionId, id)).orderBy(asc(contacts.lastName));
  const companyContacts = can(actor, "training.manage")
    ? await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle }).from(contacts).where(eq(contacts.companyId, s.companyId))
    : [];
  const materials = await db.select().from(trainingMaterials).where(eq(trainingMaterials.programId, s.programId));
  const tests = await db.select().from(assessments).where(eq(assessments.programId, s.programId));
  const results = participants.length ? await db.select().from(assessmentResults).where(inArray(assessmentResults.participantId, participants.map((p) => p.p.id))) : [];
  const [project] = s.onboardingProjectId ? await db.select({ id: onboardingProjects.id, name: onboardingProjects.name }).from(onboardingProjects).where(eq(onboardingProjects.id, s.onboardingProjectId)) : [];
  return {
    s, program, company, facilitator, participants, companyContacts: companyContacts.filter((c) => !participants.some((p) => p.p.contactId === c.id)),
    materials, assessments: tests, results, project, canManage: can(actor, "training.manage"), canOpenCompany: can(actor, "accounts.view_all", "accounts.view_own"),
  };
}

export async function scheduleSession(db: DB, actor: Actor, v: {
  programId: string; companyId: string; onboardingProjectId: string | null; facilitatorId: string | null; title: string; startsAt: Date | null;
  durationMinutes: number | null; channel: string; location: string | null; meetingLink: string | null; agenda: string | null; isRefresher: boolean; contactIds: string[];
}) {
  assertCan(actor, "training.manage");
  // Trainers may schedule (e.g. refresher) sessions only for customers they are already assigned to.
  if (!can(actor, "training.view_all")) {
    if (v.companyId && !(await trainerAssignedCompanies(db, actor)).includes(v.companyId))
      throw forbidden("You can only schedule sessions for customers you are assigned to. Ask an onboarding manager to assign you.");
    if (v.facilitatorId && v.facilitatorId !== actor.id) throw forbidden("Trainers schedule sessions they facilitate themselves.");
  }
  const errs: Record<string, string> = {};
  if (!v.programId) errs.programId = "Choose a program.";
  if (!v.companyId) errs.companyId = "Choose a customer.";
  if (!v.startsAt) errs.startsAt = "Choose a date and time.";
  if (!v.title?.trim()) errs.title = "Title is required.";
  if (!["onsite", "virtual", "hybrid"].includes(v.channel)) errs.channel = "Choose a channel.";
  if (v.channel !== "onsite" && v.meetingLink && !/^https?:\/\//.test(v.meetingLink)) errs.meetingLink = "Use a full https:// link.";
  if (v.channel !== "virtual" && !v.location) errs.location = "Location is required for onsite/hybrid sessions.";
  if (Object.keys(errs).length) throw invalid("Please correct the session details.", errs);
  if (v.onboardingProjectId) {
    const [p] = await db.select().from(onboardingProjects).where(eq(onboardingProjects.id, v.onboardingProjectId));
    if (!p || p.companyId !== v.companyId) throw invalid("The onboarding project must belong to the same customer.", { onboardingProjectId: "Mismatch." });
  }
  const [program] = await db.select().from(trainingPrograms).where(eq(trainingPrograms.id, v.programId));
  const [s] = await db.insert(trainingSessions).values({
    programId: v.programId, companyId: v.companyId, onboardingProjectId: v.onboardingProjectId, facilitatorId: v.facilitatorId ?? actor.id,
    title: v.title.trim(), startsAt: v.startsAt!, durationMinutes: v.durationMinutes ?? program?.durationMinutes ?? 120, channel: v.channel,
    location: v.location, meetingLink: v.meetingLink, agenda: v.agenda, isRefresher: v.isRefresher,
  }).returning();
  if (v.contactIds.length) await addParticipantsUnchecked(db, s.id, s.companyId, v.contactIds, program?.audienceRole ?? null);
  await audit(db, actor, "training.session_scheduled", "training_session", s.id);
  await notifyUsers(db, [s.facilitatorId], { kind: "training", title: `Training session assigned: ${s.title}`, link: `/training/sessions/${s.id}` });
  if (s.onboardingProjectId) await recomputeRisk(db, s.onboardingProjectId);
  return s;
}

async function addParticipantsUnchecked(db: DB, sessionId: string, companyId: string, contactIds: string[], requiredRole: string | null) {
  const valid = await db.select({ id: contacts.id }).from(contacts).where(and(inArray(contacts.id, contactIds), eq(contacts.companyId, companyId)));
  if (valid.length !== new Set(contactIds).size) throw invalid("Participants must be contacts of the session's customer.");
  await db.insert(trainingParticipants).values(valid.map((c) => ({ sessionId, contactId: c.id, requiredRole }))).onConflictDoNothing();
}

export async function addParticipants(db: DB, actor: Actor, sessionId: string, contactIds: string[], requiredRole: string | null) {
  assertCan(actor, "training.manage");
  const s = await getSession(db, actor, sessionId);
  if (!contactIds.length) throw invalid("Choose at least one participant.", { contactIds: "Required." });
  await addParticipantsUnchecked(db, s.id, s.companyId, contactIds, requiredRole);
  if (s.onboardingProjectId) await recomputeRisk(db, s.onboardingProjectId);
}

export async function updateSession(db: DB, actor: Actor, id: string, v: { startsAt: Date | null; meetingLink: string | null; location: string | null; agenda: string | null; status: string; notes: string | null }) {
  assertCan(actor, "training.manage");
  const s = await getSession(db, actor, id);
  if (s.status === "completed") throw conflict("Completed sessions are read-only.");
  if (!["scheduled", "rescheduled", "cancelled"].includes(v.status)) throw invalid("Use “Mark session delivered” to complete a session.");
  const moved = v.startsAt && v.startsAt.getTime() !== s.startsAt.getTime();
  const status = moved && v.status === "scheduled" ? "rescheduled" : v.status;
  await db.update(trainingSessions).set({ ...v, startsAt: v.startsAt ?? s.startsAt, status }).where(eq(trainingSessions.id, id));
  if (status === "cancelled") await db.update(trainingParticipants).set({ attendance: "cancelled" }).where(and(eq(trainingParticipants.sessionId, id), eq(trainingParticipants.attendance, "pending")));
  await audit(db, actor, "training.session_updated", "training_session", id, { status: { from: s.status, to: status }, startsAt: { from: s.startsAt, to: v.startsAt ?? s.startsAt } });
  if (s.onboardingProjectId) await recomputeRisk(db, s.onboardingProjectId);
}

export async function recordAttendance(db: DB, actor: Actor, participantId: string, v: {
  attendance: string; completed: boolean; competency: string; needsRetraining: boolean; feedbackScore: number | null; feedback: string | null;
}) {
  assertCan(actor, "training.manage");
  const [p] = await db.select().from(trainingParticipants).where(eq(trainingParticipants.id, participantId));
  if (!p) throw notFound("Participant");
  const s = await getSession(db, actor, p.sessionId);
  if (!["pending", "attended", "absent", "rescheduled", "cancelled"].includes(v.attendance)) throw invalid("Unknown attendance status.");
  if (v.completed && v.attendance !== "attended") throw invalid("Only participants who attended can be marked complete.", { completed: "Mark attendance first." });
  if (v.feedbackScore !== null && !(v.feedbackScore >= 1 && v.feedbackScore <= 5)) throw invalid("Feedback score is 1–5.", { feedbackScore: "1–5" });
  await db.update(trainingParticipants).set(v).where(eq(trainingParticipants.id, participantId));
  await audit(db, actor, "training.attendance", "training_session", s.id, { [participantId]: { from: `${p.attendance}/${p.completed}`, to: `${v.attendance}/${v.completed}` } });
  if (s.onboardingProjectId) await recomputeRisk(db, s.onboardingProjectId);
}

export async function recordAssessmentResult(db: DB, actor: Actor, participantId: string, assessmentId: string, score: number) {
  assertCan(actor, "training.manage");
  const [p] = await db.select().from(trainingParticipants).where(eq(trainingParticipants.id, participantId));
  if (!p) throw notFound("Participant");
  await getSession(db, actor, p.sessionId);
  const [a] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
  if (!a) throw notFound("Assessment");
  if (!(score >= 0 && score <= 100)) throw invalid("Score must be 0–100.", { score: "0–100" });
  const passed = score >= a.passMark;
  await db.insert(assessmentResults).values({ assessmentId, participantId, score, passed });
  await db.update(trainingParticipants).set({ competency: passed ? (score >= 90 ? "proficient" : "competent") : "developing", needsRetraining: !passed }).where(eq(trainingParticipants.id, participantId));
}

export async function completeSession(db: DB, actor: Actor, id: string, topicsCovered: string) {
  assertCan(actor, "training.manage");
  const s = await getSession(db, actor, id);
  if (s.status === "cancelled") throw conflict("Cancelled sessions cannot be completed.");
  if (!topicsCovered?.trim()) throw invalid("Record the topics covered.", { topicsCovered: "Required." });
  const pending = await db.select({ id: trainingParticipants.id }).from(trainingParticipants).where(and(eq(trainingParticipants.sessionId, id), eq(trainingParticipants.attendance, "pending")));
  if (pending.length) throw conflict(`Record attendance for all participants first (${pending.length} pending).`);
  await db.update(trainingSessions).set({ status: "completed", topicsCovered: topicsCovered.trim() }).where(eq(trainingSessions.id, id));
  await audit(db, actor, "training.session_completed", "training_session", id);
  if (s.onboardingProjectId) await recomputeRisk(db, s.onboardingProjectId);
}

export async function sendSessionReminders(db: DB, actor: Actor, id: string, confirmSimulated: boolean) {
  assertCan(actor, "training.manage");
  const d = await getSessionDetail(db, actor, id);
  const to = d.participants.filter((p) => p.email && p.p.attendance === "pending");
  if (!to.length) throw invalid("No pending participants with email addresses.");
  let simulated = 0;
  for (const p of to) {
    const r = await sendViaAdapter(db, actor, {
      channel: "email", to: p.email!, subject: `Reminder: ${d.s.title}`, body: `Your training session starts ${d.s.startsAt.toISOString()}. ${d.s.meetingLink ?? d.s.location ?? ""}`,
      relatedType: "training_session", relatedId: id, confirmSimulated,
    });
    if (r.status === "simulated") simulated++;
  }
  await notifyUsers(db, [d.s.facilitatorId], { kind: "training", title: `Session reminder: ${d.s.title}`, link: `/training/sessions/${id}`, dedupeKey: `reminder:${id}:${new Date().toISOString().slice(0, 10)}` });
  return { count: to.length, simulated };
}

export async function participantRecord(db: DB, actor: Actor, contactId: string) {
  if (!canSeeTraining(actor)) throw forbidden();
  const rows = await db.select({
    p: trainingParticipants, session: trainingSessions.title, sessionId: trainingSessions.id, startsAt: trainingSessions.startsAt, status: trainingSessions.status,
    program: trainingPrograms.name, required: trainingPrograms.requiredForGoLive,
  }).from(trainingParticipants).innerJoin(trainingSessions, eq(trainingSessions.id, trainingParticipants.sessionId))
    .innerJoin(trainingPrograms, eq(trainingPrograms.id, trainingSessions.programId))
    .where(and(eq(trainingParticipants.contactId, contactId), trainingScope(actor))).orderBy(desc(trainingSessions.startsAt));
  if (!rows.length) throw notFound("Participant record");
  const [c] = await db.select({ id: contacts.id, companyId: contacts.companyId, firstName: contacts.firstName, lastName: contacts.lastName, jobTitle: contacts.jobTitle, email: contacts.email, companyName: companies.name })
    .from(contacts).leftJoin(companies, eq(companies.id, contacts.companyId)).where(eq(contacts.id, contactId));
  const results = await db.select({ r: assessmentResults, title: assessments.title, passMark: assessments.passMark }).from(assessmentResults)
    .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId)).where(inArray(assessmentResults.participantId, rows.map((r) => r.p.id)));
  return { contact: c, rows, results };
}

export async function trainingSummaryForCompany(db: DB, companyId: string) {
  const sessions = await db.select({ s: trainingSessions, program: trainingPrograms.name }).from(trainingSessions)
    .innerJoin(trainingPrograms, eq(trainingPrograms.id, trainingSessions.programId)).where(eq(trainingSessions.companyId, companyId));
  const parts = sessions.length ? await db.select().from(trainingParticipants).where(inArray(trainingParticipants.sessionId, sessions.map((s) => s.s.id))) : [];
  const held = sessions.filter((s) => s.s.status === "completed");
  const scored = parts.filter((p) => p.feedbackScore);
  return {
    sessionsHeld: held.length, upcoming: sessions.filter((s) => s.s.status === "scheduled" || s.s.status === "rescheduled").length,
    participants: parts.length, attended: parts.filter((p) => p.attendance === "attended").length, completed: parts.filter((p) => p.completed).length,
    needsRetraining: parts.filter((p) => p.needsRetraining).length,
    avgFeedback: scored.length ? scored.reduce((a, p) => a + p.feedbackScore!, 0) / scored.length : null,
    topics: held.map((s) => s.s.topicsCovered).filter(Boolean) as string[],
  };
}
