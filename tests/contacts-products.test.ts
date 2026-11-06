import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import { StaleError } from "@/server/concurrency";
import * as ws from "@/server/services/contacts-workspace";
import * as products from "@/server/services/products";
import { logActivity } from "@/server/services/activities";
import { normalisePhone } from "@/lib/rules/contacts";

let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);

describe("phone normalisation", () => {
  it("formats Nigerian numbers in international form and rejects short ones", () => {
    expect(normalisePhone("0803 481 9348")).toEqual({ value: "+234-803-481-9348", valid: true });
    expect(normalisePhone("+2348034819348").value).toBe("+234-803-481-9348");
    expect(normalisePhone("7407821").valid).toBe(false);
    expect(normalisePhone("0244 123 456", "233").value).toBe("+233244123456");
  });
});

describe("contacts workspace", () => {
  it("scopes contacts: a sales executive sees their own and their accounts', not everyone's", async () => {
    const owner = await actor(db, "owner");
    const emeka = await actor(db, "emeka");
    const all = await ws.workspaceContacts(db, owner);
    const mine = await ws.workspaceContacts(db, emeka);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    expect(all.some((c) => !c.companyId)).toBe(true); // prospects without a company are listed
  });

  it("inline edit validates, formats the phone, audits, and detects conflicts", async () => {
    const owner = await actor(db, "owner");
    const c = (await ws.workspaceContacts(db, owner)).find((x) => x.firstName === "Dr Danjuma")!;
    await expect(ws.patchContact(db, owner, c.id, { email: "not-an-email" }, c.updatedAt.toISOString())).rejects.toThrow(/valid email/);
    await expect(ws.patchContact(db, owner, c.id, { leadStatus: "made_up" }, c.updatedAt.toISOString())).rejects.toThrow(/Unknown lead status/);
    const row = await ws.patchContact(db, owner, c.id, { phone: "08034819348", referralSource: "Ifako - Ijaiye district meeting" }, c.updatedAt.toISOString());
    expect(row.phone).toBe("+234-803-481-9348");
    expect(await ws.referralSources(db)).toContain("Ifako - Ijaiye district meeting");
    const err = await ws.patchContact(db, owner, c.id, { city: "Ikeja" }, c.updatedAt.toISOString()).catch((e) => e);
    expect(err).toBeInstanceOf(StaleError);
    const log = await db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, c.id));
    expect(log.some((l) => l.action === "contact.updated")).toBe(true);
  });

  it("a logged call moves an untouched contact's lead status forward and builds the summary", async () => {
    const owner = await actor(db, "owner");
    const c = (await ws.workspaceContacts(db, owner)).find((x) => x.firstName === "Abodunrin")!;
    expect(c.leadStatus).toBeNull();
    await logActivity(db, owner, { type: "call", subject: "Outbound call", outcome: "No answer", contactId: c.id });
    const r = await ws.contactRecord(db, owner, c.id);
    expect(r.c.leadStatus).toBe("attempted");
    expect(r.summary.lines.join(" ")).toMatch(/call today/);
    expect(r.summary.next).toMatch(/Assign an owner/); // this prospect has no owner
  });

  it("bulk edits and soft deletes can be undone", async () => {
    const owner = await actor(db, "owner");
    const ids = (await ws.workspaceContacts(db, owner)).filter((x) => !x.companyId).slice(0, 2).map((x) => x.id);
    expect(await ws.bulkUpdateContacts(db, owner, ids, { leadStatus: "open" })).toBe(2);
    await expect(ws.deleteContacts(db, owner, ids, "")).rejects.toThrow(/reason/);
    await ws.deleteContacts(db, owner, ids, "Test duplicate");
    expect((await ws.workspaceContacts(db, owner)).some((x) => ids.includes(x.id))).toBe(false);
    await ws.restoreContacts(db, owner, ids);
    expect((await ws.workspaceContacts(db, owner)).filter((x) => ids.includes(x.id)).every((x) => x.leadStatus === "open")).toBe(true);
  });
});

describe("product catalogue", () => {
  it("sales managers add products with unique codes; others can only view", async () => {
    const mgr = await actor(db, "sales.manager");
    const emeka = await actor(db, "emeka");
    const p = await products.createProduct(db, mgr, { code: "afq hms", name: "Afrilinq HMS — Hospital Management", kind: "product", currency: "NGN", listPrice: "12,000,000", category: "Other" });
    expect(p.code).toBe("AFQ-HMS");
    await expect(products.createProduct(db, mgr, { code: "AFQ-HMS", name: "Dupe", kind: "product", currency: "NGN" })).rejects.toThrow(/already used/);
    await expect(products.createProduct(db, emeka, { code: "X-1", name: "Nope", kind: "product", currency: "NGN" })).rejects.toThrow();
    expect((await products.listProducts(db, emeka, { q: "HMS" })).length).toBe(1);
    await expect(products.setProductActive(db, mgr, p.id, false, "")).rejects.toThrow(/reason/);
    await products.setProductActive(db, mgr, p.id, false, "Replaced by a newer edition");
    expect((await products.listProducts(db, emeka, { q: "HMS" })).length).toBe(0);
    expect((await products.listProducts(db, emeka, { q: "HMS", status: "retired" })).length).toBe(1);
  });
});
