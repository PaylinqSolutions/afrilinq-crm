import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import * as docs from "@/server/services/documents";

let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);

describe("totals", () => {
  it("applies line discounts then VAT", () => {
    expect(docs.computeTotals([{ productId: null, description: "A", quantity: 2, unitPrice: 1000, discountPct: 10 }], 7.5)).toEqual({ subtotal: 1800, discountTotal: 200, tax: 135, total: 1935 });
  });
});

describe("SLA agreement", () => {
  it("is generated from the customer's SLA policy, sent, opened and signed online", async () => {
    const mgr = await actor(db, "sales.manager");
    const [co] = await db.select().from(s.companies).where(eq(s.companies.lifecycle, "customer")).limit(1);
    const d = await docs.createDocument(db, mgr, { type: "sla", companyId: co.id });
    expect(d.number).toMatch(/^SLA-\d{4}-\d{4}$/);
    expect(d.sla?.targets.map((t) => t.priority)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(d.sections.length).toBeGreaterThan(10);
    expect(await docs.publicDocument(db, d.shareToken)).toBeNull(); // drafts aren't visible to clients
    if (!d.contactId) { const [c] = await db.select().from(s.contacts).where(eq(s.contacts.companyId, co.id)).limit(1); await docs.updateDocument(db, mgr, d.id, { contactId: c.id }, d.updatedAt.toISOString()); }
    await docs.sendDocument(db, mgr, d.id);
    const view = await docs.publicDocument(db, d.shareToken);
    expect(view?.d.status).toBe("viewed");
    await expect(docs.publicAccept(db, d.shareToken, { name: "Ab", title: "", agree: true }, "1.2.3.4")).rejects.toThrow(/full name/);
    await expect(docs.publicAccept(db, d.shareToken, { name: "Kunle Oyewole", title: "GM", agree: false }, "1.2.3.4")).rejects.toThrow(/authorised/);
    await docs.publicAccept(db, d.shareToken, { name: "Kunle Oyewole", title: "GM", agree: true }, "1.2.3.4");
    const [after] = await db.select().from(s.clientDocuments).where(eq(s.clientDocuments.id, d.id));
    expect(after.status).toBe("accepted");
    expect(after.signatureIp).toBe("1.2.3.4");
    await expect(docs.updateDocument(db, mgr, d.id, { title: "x" }, after.updatedAt.toISOString())).rejects.toThrow(/can't be edited/);
    const log = await db.select().from(s.activities).where(and(eq(s.activities.companyId, co.id), eq(s.activities.subject, `SLA agreement ${d.number} signed online by Kunle Oyewole`)));
    expect(log.length).toBe(1); // shows on the customer's timeline
  });

  it("a returned signed copy is attached to the customer's files", async () => {
    const mgr = await actor(db, "sales.manager");
    const [co] = await db.select().from(s.companies).where(eq(s.companies.lifecycle, "customer")).limit(1);
    const d = await docs.createDocument(db, mgr, { type: "sla", companyId: co.id });
    const pdf = new File([Buffer.from("%PDF-1.4 signed")], "signed.pdf", { type: "application/pdf" });
    await docs.attachSignedCopy(db, mgr, d.id, pdf, { name: "Kunle Oyewole", title: "GM" });
    const [after] = await db.select().from(s.clientDocuments).where(eq(s.clientDocuments.id, d.id));
    expect(after.status).toBe("accepted");
    const [f] = await db.select().from(s.files).where(eq(s.files.id, after.signedFileId!));
    expect(f.companyId).toBe(co.id);
    expect(f.filename).toContain(d.number);
  });
});

describe("quotes, invoices and payments", () => {
  it("quote from a deal → accepted → invoice → part payment → paid", async () => {
    const mgr = await actor(db, "sales.manager");
    const fin = await actor(db, "finance");
    const [dp] = await db.select().from(s.dealProducts).limit(1);
    const [deal] = await db.select().from(s.deals).where(eq(s.deals.id, dp.dealId));
    const q = await docs.createDocument(db, mgr, { type: "quote", companyId: deal.companyId, dealId: deal.id });
    expect(q.lines.length).toBeGreaterThan(0);
    expect(q.taxRate).toBe(7.5);
    expect(q.total).toBeCloseTo(q.subtotal * 1.075, 1);
    await expect(docs.duplicateDocument(db, fin, q.id, "invoice")).rejects.toThrow(/accepted quotes/);
    await docs.sendDocument(db, mgr, q.id);
    await docs.publicAccept(db, q.shareToken, { name: "Buyer Person", title: "CFO", agree: true }, null);
    const inv = await docs.duplicateDocument(db, fin, q.id, "invoice");
    expect(inv.type).toBe("invoice");
    expect(inv.sourceId).toBe(q.id);
    expect(inv.total).toBe(q.total);
    await expect(docs.recordPayment(db, fin, inv.id, { amount: 100, method: "bank_transfer", reference: null, paidOn: "2026-10-26", notes: null })).rejects.toThrow(/Send the invoice/);
    await docs.sendDocument(db, fin, inv.id);
    await expect(docs.recordPayment(db, fin, inv.id, { amount: inv.total + 1, method: "bank_transfer", reference: null, paidOn: "2026-10-26", notes: null })).rejects.toThrow(/more than/);
    expect(await docs.recordPayment(db, fin, inv.id, { amount: 1000, method: "bank_transfer", reference: "TRF1", paidOn: "2026-10-26", notes: null })).toBe("part_paid");
    expect(await docs.recordPayment(db, fin, inv.id, { amount: inv.total - 1000, method: "card", reference: "CARD2", paidOn: "2026-10-27", notes: null })).toBe("paid");
    await expect(docs.voidDocument(db, fin, inv.id, "mistake")).rejects.toThrow(/payments recorded/);
    expect((await docs.listPayments(db, fin)).filter((p) => p.documentId === inv.id).length).toBe(2);
  });

  it("only finance-type roles can invoice; sales reps can quote", async () => {
    const emeka = await actor(db, "emeka");
    const [co] = await db.select().from(s.companies).where(eq(s.companies.ownerId, emeka.id)).limit(1);
    await expect(docs.createDocument(db, emeka, { type: "invoice", companyId: co.id })).rejects.toThrow();
    const q = await docs.createDocument(db, emeka, { type: "quote", companyId: co.id });
    expect(q.type).toBe("quote");
  });
});
