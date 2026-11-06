"use server";

import { act, bool, optional, str, type ActionResult } from "@/server/action";
import * as kb from "@/server/services/kb";
import { getDb } from "@/db";
import { rateLimit } from "@/server/rate-limit";
import { clientIp } from "@/server/session";

type A = ActionResult | null;
const input = (fd: FormData) => ({
  title: str(fd, "title"), summary: optional(fd, "summary"), body: str(fd, "body"), category: str(fd, "category"), productId: optional(fd, "productId"),
  tags: str(fd, "tags").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12), audience: str(fd, "audience"), isSop: bool(fd, "isSop"),
});

export async function createArticleAction(_: A, fd: FormData) {
  return act(async (actor, db) => { const a = await kb.createArticle(db, actor, input(fd)); return { message: "Draft saved.", data: { id: a.id } }; }, ["/kb"]);
}
export async function updateArticleAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await kb.updateArticle(db, actor, id, input(fd), optional(fd, "_version")); return { message: "Article saved.", data: { id } }; }, ["/kb"]);
}
export async function articleWorkflowAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const step = str(fd, "step");
    if (step === "submit") { await kb.submitArticle(db, actor, id, optional(fd, "reviewerId")); return "Submitted for review."; }
    if (step === "publish") { await kb.reviewArticle(db, actor, id, true, optional(fd, "comment")); return "Published."; }
    if (step === "return") { await kb.reviewArticle(db, actor, id, false, optional(fd, "comment")); return "Returned to the author."; }
    if (step === "archive") { await kb.archiveArticle(db, actor, id); return "Archived."; }
    return "No change.";
  }, ["/kb"]);
}
export async function articleFeedbackAction(id: string, _: A, fd: FormData) {
  if (!rateLimit(`kbfb:${await clientIp()}:${id}`, 1, 24 * 3600000)) return { ok: true, message: "Thanks — feedback already recorded.", at: Date.now() };
  await kb.articleFeedback(await getDb(), id, str(fd, "helpful") === "yes");
  return { ok: true, message: "Thanks for the feedback.", at: Date.now() };
}
