import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import * as sales from "@/server/services/sales";
import * as cw from "@/server/services/contacts-workspace";
import { logActivity } from "@/server/services/activities";

let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);
const base = { source: "Referral", status: "New", nextAction: "Call", contactName: "Test Person" };

describe("lead conversion", () => {
  it("reuses an existing contact with the same email instead of creating a duplicate", async () => {
    const mgr = await actor(db, "sales.manager");
    const existing = (await cw.workspaceContacts(db, mgr)).find((c) => c.email && c.companyId)!;
    const lead = await sales.createLead(db, mgr, { ...base, name: "Upsell", organization: "Some Other Name Ltd", contactName: "Different Spelling", email: existing.email!.toUpperCase() });
    const before = (await db.select().from(s.contacts)).length;
    const r = await sales.convertLead(db, mgr, lead.id, {});
    expect(r.contactId).toBe(existing.id);
    expect(r.reusedContact?.matchedBy).toBe("email");
    expect(r.companyId).toBe(existing.companyId); // the person's own company wins over a name guess
    expect((await db.select().from(s.contacts)).length).toBe(before);
  });

  it("matches by phone regardless of formatting, and can be told to create a separate contact", async () => {
    const mgr = await actor(db, "sales.manager");
    const c = (await cw.workspaceContacts(db, mgr)).find((x) => x.phone?.startsWith("+234-803-481"))!;
    const lead = await sales.createLead(db, mgr, { ...base, name: "Clinic EMR", phone: "0803 481 9348" });
    expect((await sales.findMatchingContact(db, null, "0803 481 9348"))?.id).toBe(c.id);
    const r = await sales.convertLead(db, mgr, lead.id, { createDeal: false, newContact: true });
    expect(r.contactId).not.toBe(c.id);
  });

  it("converts an individual (no organisation) into a contact only, carrying their activity", async () => {
    const mgr = await actor(db, "sales.manager");
    const lead = await sales.createLead(db, mgr, { ...base, name: "Met at district meeting", contactName: "Ngozi Adeyemi", phone: "+234 809 111 2233" });
    expect(lead.organization).toBeNull();
    await logActivity(db, mgr, { type: "call", subject: "Intro call", leadId: lead.id, outcome: "Connected" });
    await expect(sales.convertLead(db, mgr, lead.id, { createDeal: true })).rejects.toThrow(/needs a company/);
    const r = await sales.convertLead(db, mgr, lead.id, { createDeal: false });
    expect(r.dealId).toBeNull();
    expect(r.companyId).toBeNull();
    const [contact] = await db.select().from(s.contacts).where(eq(s.contacts.id, r.contactId));
    expect(`${contact.firstName} ${contact.lastName}`).toBe("Ngozi Adeyemi");
    expect(contact.companyId).toBeNull();
    const rec = await cw.contactRecord(db, mgr, r.contactId);
    expect(rec.activities.some((a) => a.subject === "Intro call")).toBe(true);
    expect((await sales.getLead(db, mgr, lead.id)).status).toBe("Converted");
  });

  it("reuses a company with the same name and opens a deal when asked", async () => {
    const mgr = await actor(db, "sales.manager");
    const [co] = await db.select().from(s.companies).limit(1);
    const lead = await sales.createLead(db, mgr, { ...base, name: "New module", organization: co.name.toLowerCase(), contactName: "Brand New Person", email: "brand.new.person@example.com" });
    const r = await sales.convertLead(db, mgr, lead.id, {});
    expect(r.companyId).toBe(co.id);
    expect(r.dealId).toBeTruthy();
  });
});

describe("lead conversion: same person under a different email", () => {
  it("matches by full name at the same company", async () => {
    const mgr = await actor(db, "sales.manager");
    const c = (await cw.workspaceContacts(db, mgr)).find((x) => x.companyId && x.companyName)!;
    const lead = await sales.createLead(db, mgr, { ...base, name: "Expansion", organization: ` ${c.companyName!.toUpperCase()} `, contactName: `${c.firstName}  ${c.lastName}`, email: "personal.address@example.org" });
    const r = await sales.convertLead(db, mgr, lead.id, { createDeal: false });
    expect(r.contactId).toBe(c.id);
    expect(r.reusedContact?.matchedBy).toBe("name at the same company");
  });
});
