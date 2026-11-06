"use server";

import { act, bool, optional, str, type ActionResult } from "@/server/action";
import * as handover from "@/server/services/handover";
import * as onboarding from "@/server/services/onboarding";
import { HANDOVER_FIELDS } from "@/lib/rules/handover";
import type { GoLiveItem } from "@/db/schema";

type A = ActionResult | null;
const paths = ["/handovers", "/onboarding", "/deals"];

export async function saveHandoverAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const input = Object.fromEntries(HANDOVER_FIELDS.map((f) => [f.key, str(fd, f.key)]));
    const r = await handover.saveHandoverChecklist(db, actor, id, input, optional(fd, "_version"));
    if (str(fd, "intent") === "submit") { await handover.submitHandover(db, actor, id); return "Submitted for onboarding review."; }
    return r.missing.length ? `Saved — ${r.completeness}% complete (${r.missing.length} required item(s) left).` : "Saved — all required items complete. You can submit now.";
  }, paths);
}
export async function reviewHandoverAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    if (str(fd, "decision") === "accept") {
      await handover.acceptHandover(db, actor, id, { comment: optional(fd, "comment"), onboardingOwnerId: optional(fd, "onboardingOwnerId"), overrideReason: optional(fd, "overrideReason"), templateId: optional(fd, "templateId") });
      return "Accepted. The onboarding project is live with dated tasks and milestones.";
    }
    await handover.requestHandoverChanges(db, actor, id, optional(fd, "comment"));
    return "Returned to Sales with your comments.";
  }, paths);
}
export async function requestCorrectionAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await handover.requestHandoverCorrection(db, actor, id, { field: str(fd, "field"), newValue: str(fd, "newValue"), reason: str(fd, "reason") }); return "Correction requested. The onboarding owner has been notified."; }, paths);
}
export async function applyCorrectionAction(id: string, reviewId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { const ok = str(fd, "decision") === "apply"; await handover.applyHandoverCorrection(db, actor, id, reviewId, ok); return ok ? "Correction applied; the previous value is kept in the audit log." : "Correction declined."; }, paths);
}

export async function updateOnbTaskAction(taskId: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    await onboarding.updateOnboardingTask(db, actor, taskId, { status: optional(fd, "status") ?? undefined, ownerId: fd.has("ownerId") ? optional(fd, "ownerId") : undefined, dueDate: fd.has("dueDate") ? optional(fd, "dueDate") : undefined, notes: fd.has("notes") ? optional(fd, "notes") : undefined, evidenceUrl: fd.has("evidenceUrl") ? optional(fd, "evidenceUrl") : undefined });
    return "Task updated.";
  }, paths);
}
export async function addOnbTaskAction(projectId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await onboarding.addOnboardingTask(db, actor, projectId, { title: str(fd, "title"), stageKey: str(fd, "stageKey"), dueDate: optional(fd, "dueDate"), ownerId: optional(fd, "ownerId"), isMilestone: bool(fd, "isMilestone"), customerResponsibility: bool(fd, "customerResponsibility") }); return "Task added."; }, paths);
}
export async function addBlockerAction(projectId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await onboarding.addBlocker(db, actor, projectId, { description: str(fd, "description"), severity: str(fd, "severity") || "medium", ownerId: optional(fd, "ownerId"), customerSide: bool(fd, "customerSide") }); return "Blocker logged."; }, paths);
}
export async function resolveBlockerAction(blockerId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await onboarding.resolveBlocker(db, actor, blockerId, str(fd, "resolution")); return "Blocker resolved."; }, paths);
}
export async function setStageAction(projectId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await onboarding.setProjectStage(db, actor, projectId, str(fd, "stage"), optional(fd, "reason"), optional(fd, "_version")); return "Stage updated."; }, paths);
}
export async function updateDatesAction(projectId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await onboarding.updateProjectDates(db, actor, projectId, { targetGoLive: optional(fd, "targetGoLive"), kickoffDate: optional(fd, "kickoffDate"), internalNotes: optional(fd, "internalNotes") }, optional(fd, "_version")); return "Project updated."; }, paths);
}
export async function goLiveChecklistAction(projectId: string, count: number, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const items: GoLiveItem[] = Array.from({ length: count }, (_, i) => ({ label: "", done: bool(fd, `done_${i}`), na: bool(fd, `na_${i}`), note: str(fd, `note_${i}`) || undefined }));
    await onboarding.updateGoLiveChecklist(db, actor, projectId, items, optional(fd, "_version"));
    return "Go-live checklist saved.";
  }, paths);
}
export async function completeProjectAction(projectId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await onboarding.completeProject(db, actor, projectId, { notes: str(fd, "notes"), actualGoLive: optional(fd, "actualGoLive"), exceptionReason: optional(fd, "exceptionReason") }); return "Onboarding confirmed complete."; }, paths);
}
