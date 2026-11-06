"use server";

import { act, num, optional, str, type ActionResult } from "@/server/action";
import * as health from "@/server/services/health";

type A = ActionResult | null;

export async function reviewHealthAction(snapshotId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await health.reviewHealth(db, actor, snapshotId, str(fd, "notes")); return "Review recorded."; }, ["/companies", "/success"]);
}
export async function recomputeHealthAction(companyId: string) {
  return act(async (actor, db) => { const { assertCan } = await import("@/server/actor"); assertCan(actor, "success.manage"); await health.computeCompanyHealth(db, companyId); return "Health recalculated."; }, ["/companies", "/success"]);
}
export async function upsertRenewalAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    await health.upsertRenewal(db, actor, { id: optional(fd, "id"), companyId: str(fd, "companyId"), renewalDate: str(fd, "renewalDate"), amount: num(fd, "amount"), status: str(fd, "status") || "upcoming", ownerId: optional(fd, "ownerId"), notes: optional(fd, "notes") });
    return "Renewal saved.";
  }, ["/success", "/companies"]);
}
export async function addExpansionAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    await health.addExpansion(db, actor, { companyId: str(fd, "companyId"), productId: optional(fd, "productId"), kind: str(fd, "kind") || "upsell", description: str(fd, "description"), estimatedValue: num(fd, "estimatedValue"), ownerId: optional(fd, "ownerId") });
    return "Opportunity added.";
  }, ["/success"]);
}
export async function expansionStatusAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await health.setExpansionStatus(db, actor, id, str(fd, "status")); return "Updated."; }, ["/success"]);
}
