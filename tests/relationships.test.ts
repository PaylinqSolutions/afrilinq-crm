import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import * as tickets from "@/server/services/tickets";
import { customerJourney, relatedFor } from "@/server/services/journey";

let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);
const base = { subject: "Cannot post invoices", description: "Error on save.", channel: "phone", category: "How-to / Training", impact: "single_user", urgency: "medium", ignoreDuplicates: true };

describe("tickets are always raised on an existing customer", () => {
  it("rejects a ticket with only a requester email", async () => {
    const agent = await actor(db, "support");
    const [p] = await db.select().from(s.products).limit(1);
    const e = await tickets.createTicket(db, agent, { ...base, productId: p.id, requesterEmail: "someone@unknown.example" }).catch((x) => x);
    expect(e.fieldErrors?.companyId).toMatch(/existing company or contact/);
  });

  it("rejects unknown or deleted companies", async () => {
    const agent = await actor(db, "support");
    const [p] = await db.select().from(s.products).limit(1);
    await expect(tickets.createTicket(db, agent, { ...base, productId: p.id, companyId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/doesn't exist/);
  });

  it("a ticket on a contact picks up their company, and a requester email links the matching contact", async () => {
    const agent = await actor(db, "support");
    const [p] = await db.select().from(s.products).limit(1);
    const [c] = await db.select().from(s.contacts).where(eq(s.contacts.lastName, "Udo"));
    const t1 = await tickets.createTicket(db, agent, { ...base, productId: p.id, contactId: c.id });
    expect(t1.companyId).toBe(c.companyId);
    const t2 = await tickets.createTicket(db, agent, { ...base, productId: p.id, companyId: c.companyId, requesterEmail: c.email!.toUpperCase() });
    expect(t2.contactId).toBe(c.id);
  });
});

describe("customer journey and related records", () => {
  it("shows a customer's path from won deal through onboarding, with links", async () => {
    const [co] = await db.select().from(s.companies).where(eq(s.companies.lifecycle, "customer")).limit(1);
    const steps = await customerJourney(db, co.id);
    expect(steps.map((x) => x.key)).toEqual(["lead", "deal", "won", "handover", "onboarding", "training", "live", "success"]);
    expect(steps.find((x) => x.key === "won")!.status).toBe("done");
    expect(steps.find((x) => x.key === "handover")!.href).toMatch(/^\/handovers\//);
  });

  it("links a deal to its company, contacts, products and tickets", async () => {
    const mgr = await actor(db, "sales.manager");
    const [dp] = await db.select().from(s.dealProducts).limit(1);
    const r = await relatedFor(db, mgr, "deal", dp.dealId);
    const keys = r.groups.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(["company", "contacts", "deals", "products"]));
    expect(r.groups.find((g) => g.key === "products")!.items[0].href).toBe(`/products/${dp.productId}`);
  });

  it("hides modules the viewer can't open", async () => {
    const trainer = await actor(db, "trainer");
    const [dp] = await db.select().from(s.dealProducts).limit(1);
    const r = await relatedFor(db, trainer, "deal", dp.dealId);
    expect(r.groups.some((g) => g.key === "deals" || g.key === "tickets")).toBe(false);
  });
});
