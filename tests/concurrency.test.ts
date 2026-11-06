import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import { StaleError } from "@/server/concurrency";
import * as sales from "@/server/services/sales";
import * as tickets from "@/server/services/tickets";
import * as accounts from "@/server/services/accounts";
import * as handover from "@/server/services/handover";

let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);

const stale = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { expect(e).toBeInstanceOf(StaleError); return e as StaleError; }
  throw new Error("Expected a StaleError");
};

describe("edit conflict detection (optimistic concurrency)", () => {
  it("rejects a deal save based on an outdated version and names who changed it", async () => {
    const emeka = await actor(db, "emeka");
    const mgr = await actor(db, "sales.manager");
    const deal = (await sales.listDeals(db, emeka, { q: "Enugu" })).rows[0];
    const loaded = await sales.getDeal(db, emeka, deal.id); // both users open the same deal
    const form = (amount: string) => ({ name: loaded.name, companyId: loaded.companyId, primaryContactId: loaded.primaryContactId, amount, currency: "NGN", forecastCategory: "best_case", nextStep: "Revised pricing", nextStepDue: "2026-11-10", expectedCloseDate: "2026-11-30" });
    await sales.updateDeal(db, mgr, deal.id, form("13000000"), loaded.updatedAt.toISOString()); // manager saves first
    const e = await stale(sales.updateDeal(db, emeka, deal.id, form("11000000"), loaded.updatedAt.toISOString()));
    expect(e.message).toContain("Ngozi Eze");
    expect(e.message).toContain("amount");
    expect((await sales.getDeal(db, emeka, deal.id)).amount).toBe(13_000_000); // nothing overwritten
    const fresh = await sales.getDeal(db, emeka, deal.id);
    await sales.updateDeal(db, emeka, deal.id, form("11000000"), fresh.updatedAt.toISOString()); // reload + reapply works
    expect((await sales.getDeal(db, emeka, deal.id)).amount).toBe(11_000_000);
  });

  it("treats the same user in another tab as a conflict too", async () => {
    const emeka = await actor(db, "emeka");
    const c = (await accounts.listCompanies(db, emeka, { q: "Accra" })).rows[0];
    const before = await accounts.getCompany(db, emeka, c.id);
    const v = before.updatedAt.toISOString();
    const base = { name: before.name, segment: before.segment, tier: before.tier, lifecycle: before.lifecycle };
    await accounts.updateCompany(db, emeka, c.id, { ...base, city: "Kumasi" }, v);
    const e = await stale(accounts.updateCompany(db, emeka, c.id, { ...base, city: "Tema" }, v));
    expect(e.message).toContain("You (in another tab");
  });

  it("detects a stale stage move and product edit on the pipeline", async () => {
    const emeka = await actor(db, "emeka");
    const deal = (await sales.listDeals(db, emeka, { q: "Accra Bridge" })).rows[0];
    const v = (await sales.getDeal(db, emeka, deal.id)).updatedAt.toISOString();
    const [qualified] = await db.select().from(s.pipelineStages).where(eq(s.pipelineStages.key, "qualified"));
    await sales.moveDealStage(db, emeka, deal.id, qualified.id, { expected: v });
    const pay = (await db.select().from(s.products).where(eq(s.products.code, "AFQ-PAY")))[0];
    await stale(sales.setDealProducts(db, emeka, deal.id, [{ productId: pay.id, quantity: 2, unitPrice: 1 }], v));
    const [demo] = await db.select().from(s.pipelineStages).where(eq(s.pipelineStages.key, "demo_scheduled"));
    await stale(sales.moveDealStage(db, emeka, deal.id, demo.id, { expected: v }));
  });

  it("flags a ticket status change after a customer replied in the meantime", async () => {
    const lead = await actor(db, "support.lead");
    const t = (await tickets.listTickets(db, lead, { q: "Webhook" })).rows[0].t;
    const v = t.updatedAt.toISOString();
    await new Promise((r) => setTimeout(r, 1700));
    await tickets.portalReply(db, t.portalToken!, "Still failing — new error code 401 since 10am.");
    const e = await stale(tickets.changeTicketStatus(db, lead, t.id, "in_progress", { expected: v }));
    expect(e.message).toContain("This ticket was updated");
    const fresh = await tickets.getTicket(db, lead, t.id);
    await tickets.changeTicketStatus(db, lead, t.id, "in_progress", { expected: fresh.updatedAt.toISOString() });
  });

  it("guards the handover checklist between two sales editors", async () => {
    const emeka = await actor(db, "emeka");
    const mgr = await actor(db, "sales.manager");
    const h = (await handover.listHandovers(db, emeka, { status: "Pending Sales Submission" }))[0];
    const { h: rec } = await handover.getHandover(db, emeka, h.id);
    const v = rec.updatedAt.toISOString();
    await handover.saveHandoverChecklist(db, mgr, h.id, { risks: "Manager's note on risks" }, v);
    await stale(handover.saveHandoverChecklist(db, emeka, h.id, { risks: "Emeka's older text" }, v));
    expect((await handover.getHandover(db, emeka, h.id)).h.checklist.risks).toBe("Manager's note on risks");
  });

  it("keeps working for callers that do not send a version (API, automations)", async () => {
    const emeka = await actor(db, "emeka");
    const c = (await accounts.listCompanies(db, emeka, { q: "Owerri" })).rows[0];
    const before = await accounts.getCompany(db, emeka, c.id);
    await accounts.updateCompany(db, emeka, c.id, { name: before.name, segment: before.segment, tier: before.tier, lifecycle: before.lifecycle, city: "Owerri" });
  });
});
