import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import * as tickets from "@/server/services/tickets";

let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);

const eng = { reproductionSteps: "Open invoice 12, click Post", expectedResult: "Posts", actualResult: "500 error", environment: "Prod v4", evidence: "req id 123", customerImpact: "Cannot invoice", workaround: null, businessConsequence: "Revenue delayed" };
const blank = { reproductionSteps: null, expectedResult: null, actualResult: null, environment: null, evidence: null, customerImpact: null, workaround: null, businessConsequence: null, requestedTeamId: null };
async function newTicket() {
  const agent = await actor(db, "support");
  const [c] = await db.select().from(s.contacts).where(eq(s.contacts.lastName, "Udo"));
  const [p] = await db.select().from(s.products).limit(1);
  return tickets.createTicket(db, agent, { subject: `Pricing question ${Math.random()}`, description: "Customer asks about extra licences.", contactId: c.id, channel: "phone", productId: p.id, category: "How-to / Training", impact: "single_user", urgency: "medium", ignoreDuplicates: true });
}
const statusOf = async (id: string) => (await db.select().from(s.ticketEscalations).where(eq(s.ticketEscalations.id, id)))[0];

describe("escalation to Sales: raise → accept → resolve → confirm", () => {
  it("routes to the account owner, who can open the ticket and work it through", async () => {
    const agent = await actor(db, "support");
    const t = await newTicket();
    const [co] = await db.select().from(s.companies).where(eq(s.companies.id, t.companyId!));
    const owner = await actor(db, (await db.select().from(s.users).where(eq(s.users.id, co.ownerId!)))[0].email.split("@")[0]);
    const e = await tickets.escalateTicket(db, agent, t.id, { ...blank, kind: "sales", severity: "P3", reason: "Can they add 5 licences mid-term at the same price?" });
    expect(e.status).toBe("open");
    expect(e.assignedToId).toBe(owner.id); // defaults to the account owner
    const n = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, owner.id), eq(s.notifications.kind, "escalation")));
    expect(n.length).toBeGreaterThan(0);
    expect((await tickets.listEscalations(db, owner, "mine")).some((x) => x.id === e.id)).toBe(true);
    await tickets.getTicket(db, owner, t.id); // sales can open the escalated ticket
    await expect(tickets.confirmEscalation(db, agent, e.id, null)).rejects.toThrow(/Only resolved/);
    await tickets.acceptEscalation(db, owner, e.id, null);
    expect((await statusOf(e.id)).status).toBe("in_progress");
    await expect(tickets.resolveEscalation(db, owner, e.id, "")).rejects.toThrow(/Describe/);
    await tickets.resolveEscalation(db, owner, e.id, "Yes — pro-rated at the current price. Quote sent.");
    expect((await tickets.listEscalations(db, agent, "confirm")).some((x) => x.id === e.id)).toBe(true);
    await expect(tickets.confirmEscalation(db, owner, e.id, null)).rejects.toThrow(/Only the person who raised it/);
    await tickets.confirmEscalation(db, agent, e.id, "Thanks");
    const done = await statusOf(e.id);
    expect(done.status).toBe("closed");
    expect(done.confirmedBy).toBe(agent.id);
    expect((await tickets.getTicket(db, agent, t.id)).escalationLevel).toBe(0);
  });
});

describe("escalation to engineering", () => {
  it("needs approval when an agent raises it, then resolving hands the ticket back to support, and reopening sends it back", async () => {
    const agent = await actor(db, "support");
    const lead = await actor(db, "support.lead");
    const t = await newTicket();
    const [team] = await db.select().from(s.teams).where(eq(s.teams.kind, "engineering"));
    const err = await tickets.escalateTicket(db, agent, t.id, { ...blank, kind: "engineering", severity: "P2", reason: "Posting fails" }).catch((x) => x);
    expect(err.fieldErrors?.reproductionSteps).toBeTruthy();
    const e = await tickets.escalateTicket(db, agent, t.id, { ...blank, ...eng, kind: "engineering", severity: "P2", reason: "Posting fails", requestedTeamId: team.id });
    expect(e.status).toBe("pending_approval");
    await tickets.decideEscalation(db, lead, e.id, true, null);
    expect((await statusOf(e.id)).status).toBe("open");
    expect((await tickets.getTicket(db, agent, t.id)).status).toBe("waiting_on_engineering");
    const engineer = await actor(db, (await db.select().from(s.users).where(eq(s.users.teamId, team.id)))[0].email.split("@")[0]);
    await tickets.addEscalationUpdate(db, engineer, e.id, { body: "Reproduced; null currency on legacy invoices." });
    expect((await statusOf(e.id)).status).toBe("in_progress");
    await tickets.resolveEscalation(db, engineer, e.id, "Fixed in v4.13, deployed.");
    expect((await tickets.getTicket(db, agent, t.id)).status).toBe("in_progress");
    await tickets.reopenEscalation(db, agent, e.id, "Still failing for invoice 14");
    const again = await statusOf(e.id);
    expect(again.status).toBe("in_progress");
    expect(again.reopenCount).toBe(1);
  });

  it("can be declined (with a reason) or withdrawn, and peers can't be yourself", async () => {
    const agent = await actor(db, "support");
    const lead = await actor(db, "support.lead");
    const t = await newTicket();
    const m = await tickets.escalateTicket(db, agent, t.id, { ...blank, kind: "management", severity: "P2", reason: "Customer threatening to cancel" });
    await expect(tickets.decideEscalation(db, lead, m.id, false, null)).rejects.toThrow(/why/);
    await tickets.decideEscalation(db, lead, m.id, false, "Handle at lead level first");
    expect((await statusOf(m.id)).status).toBe("rejected");
    await expect(tickets.escalateTicket(db, agent, t.id, { ...blank, kind: "support_peer", severity: "P3", reason: "x", assignedToId: agent.id })).rejects.toThrow(/yourself/);
    const p = await tickets.escalateTicket(db, agent, t.id, { ...blank, kind: "support_peer", severity: "P3", reason: "Know this module?", assignedToId: (await actor(db, "aisha")).id });
    await tickets.cancelEscalation(db, agent, p.id, "Found the answer in the KB");
    expect((await statusOf(p.id)).status).toBe("cancelled");
  });
});
