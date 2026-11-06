"use server";

import { act, all, bool, num, optional, str, type ActionResult } from "@/server/action";
import * as training from "@/server/services/training";
import { invalid } from "@/server/errors";
import type { AssessmentQuestion } from "@/db/schema";
import { fromLocalInput } from "@/lib/format";

type A = ActionResult | null;
const paths = ["/training"];

export async function scheduleSessionAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    const st = optional(fd, "startsAt");
    const s = await training.scheduleSession(db, actor, {
      programId: str(fd, "programId"), companyId: str(fd, "companyId"), onboardingProjectId: optional(fd, "onboardingProjectId"), facilitatorId: optional(fd, "facilitatorId"),
      title: str(fd, "title"), startsAt: st ? fromLocalInput(st) : null, durationMinutes: num(fd, "durationMinutes"), channel: str(fd, "channel"), location: optional(fd, "location"),
      meetingLink: optional(fd, "meetingLink"), agenda: optional(fd, "agenda"), isRefresher: bool(fd, "isRefresher"), contactIds: all(fd, "contactIds"),
    });
    return { message: "Session scheduled.", data: { id: s.id } };
  }, paths);
}
export async function updateSessionAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const st = optional(fd, "startsAt");
    await training.updateSession(db, actor, id, { startsAt: st ? fromLocalInput(st) : null, meetingLink: optional(fd, "meetingLink"), location: optional(fd, "location"), agenda: optional(fd, "agenda"), status: str(fd, "status"), notes: optional(fd, "notes") });
    return "Session updated.";
  }, paths);
}
export async function addParticipantsAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await training.addParticipants(db, actor, id, all(fd, "contactIds"), optional(fd, "requiredRole")); return "Participants added."; }, paths);
}
export async function attendanceAction(participantId: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    await training.recordAttendance(db, actor, participantId, { attendance: str(fd, "attendance"), completed: bool(fd, "completed"), competency: str(fd, "competency") || "not_assessed", needsRetraining: bool(fd, "needsRetraining"), feedbackScore: num(fd, "feedbackScore"), feedback: optional(fd, "feedback") });
    return "Attendance recorded.";
  }, paths);
}
export async function assessmentResultAction(participantId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await training.recordAssessmentResult(db, actor, participantId, str(fd, "assessmentId"), Number(str(fd, "score"))); return "Assessment result recorded."; }, paths);
}
export async function completeSessionAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await training.completeSession(db, actor, id, str(fd, "topicsCovered")); return "Session marked delivered."; }, paths);
}
export async function remindersAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const r = await training.sendSessionReminders(db, actor, id, bool(fd, "confirmSimulated"));
    return r.simulated ? `${r.simulated} reminder(s) recorded as SIMULATED (email not configured). In-app reminder sent to the facilitator.` : `${r.count} reminder(s) sent.`;
  }, paths);
}
export async function saveProgramAction(id: string | null, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const pid = await training.saveProgram(db, actor, id, {
      name: str(fd, "name"), productId: optional(fd, "productId"), audienceRole: str(fd, "audienceRole"), segment: optional(fd, "segment"), description: optional(fd, "description"),
      objectives: str(fd, "objectives").split("\n").map((x) => x.trim()).filter(Boolean), requiredForGoLive: bool(fd, "requiredForGoLive"), durationMinutes: num(fd, "durationMinutes") ?? 120,
    });
    return { message: "Program saved.", data: { id: pid } };
  }, paths);
}
export async function addMaterialAction(programId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await training.addMaterial(db, actor, programId, { title: str(fd, "title"), kind: str(fd, "kind"), url: str(fd, "url"), visibility: str(fd, "visibility") }); return "Material added."; }, paths);
}
export async function addAssessmentAction(programId: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    // One question per line: Question | option A | option B | option C | index of correct option (1-based)
    const questions: AssessmentQuestion[] = str(fd, "questions").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 4)
      .map((p) => ({ q: p[0], options: p.slice(1, -1), answer: Math.max(0, Number(p[p.length - 1]) - 1) }));
    if (!questions.length) throw invalid("Add at least one question.", { questions: "Format: Question | A | B | correct option number" });
    await training.addAssessment(db, actor, programId, { title: str(fd, "title"), passMark: num(fd, "passMark") ?? 70, questions });
    return "Assessment added.";
  }, paths);
}
