import crypto from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DB, Executor } from "@/db";
import {
  activities, clientDocuments, companies, contacts, dealProducts, deals, documentPayments, files, pipelineStages, products, users,
  type DocLine, type DocSection, type SlaSnapshot,
} from "@/db/schema";
import { addDays, todayIn } from "@/lib/format";
import { TICKET_STATUSES } from "@/lib/rules/tickets";
import { type Actor, assertCan, can } from "../actor";
import { audit, diff } from "../audit";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { getSettings, type AppSettings } from "../settings";
import { companyScope } from "./scope";
import { policyForCompany } from "./tickets";
import { assertFresh, assertUpdated, sameVersion, type Version } from "../concurrency";

export type DocType = "sla" | "quote" | "invoice";
export const DOC_TYPES: Record<DocType, { label: string; noun: string; prefix: string; plural: string; nouns: string }> = {
  sla: { label: "SLA agreement", noun: "SLA agreement", prefix: "SLA", plural: "SLA agreements", nouns: "SLA agreements" },
  quote: { label: "Quote", noun: "quote", prefix: "QUO", plural: "Quotes", nouns: "quotes" },
  invoice: { label: "Invoice", noun: "invoice", prefix: "INV", plural: "Invoices", nouns: "invoices" },
};
export const PAYMENT_METHODS: Record<string, string> = { bank_transfer: "Bank transfer", card: "Card", pos: "POS", cash: "Cash", cheque: "Cheque", other: "Other" };

/** Status label shown to staff and clients; invoices past their due date show as overdue. */
export function docStatus(d: { type: string; status: string; dueDate: string | null; total: number; amountPaid: number }, today: string) {
  if (d.type === "invoice" && ["sent", "viewed", "part_paid"].includes(d.status) && d.dueDate && d.dueDate < today) return { key: "overdue", label: "Overdue", tone: "red" as const };
  if (d.type === "quote" && ["sent", "viewed"].includes(d.status) && d.dueDate && d.dueDate < today) return { key: "expired", label: "Expired", tone: "gray" as const };
  const map: Record<string, { label: string; tone: "gray" | "blue" | "violet" | "green" | "amber" | "red" }> = {
    draft: { label: "Draft", tone: "gray" }, sent: { label: "Sent", tone: "blue" }, viewed: { label: "Viewed by client", tone: "violet" },
    accepted: { label: d.type === "sla" ? "Signed" : "Accepted", tone: "green" }, declined: { label: "Declined", tone: "red" },
    part_paid: { label: "Part paid", tone: "amber" }, paid: { label: "Paid", tone: "green" }, void: { label: "Void", tone: "gray" },
  };
  return { key: d.status, ...(map[d.status] ?? { label: d.status, tone: "gray" as const }) };
}

/** Line totals: discount per line, VAT on the discounted subtotal. */
export function computeTotals(lines: DocLine[], taxRate: number) {
  const gross = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const discountTotal = lines.reduce((a, l) => a + (l.quantity * l.unitPrice * (l.discountPct || 0)) / 100, 0);
  const subtotal = gross - discountTotal;
  const tax = Math.round(subtotal * taxRate) / 100;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { subtotal: r(subtotal), discountTotal: r(discountTotal), tax: r(tax), total: r(subtotal + tax) };
}

function assertCanManage(actor: Actor, type: string) {
  if (type === "invoice") assertCan(actor, "billing.manage");
  else if (type === "quote") assertCan(actor, "deals.edit", "billing.manage");
  else assertCan(actor, "accounts.edit");
}
export const canManageType = (actor: Actor, type: string) => (type === "invoice" ? can(actor, "billing.manage") : type === "quote" ? can(actor, "deals.edit", "billing.manage") : can(actor, "accounts.edit"));

async function nextNumber(db: Executor, type: DocType, year: string) {
  const prefix = `${DOC_TYPES[type].prefix}-${year}-`;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(clientDocuments).where(ilike(clientDocuments.number, `${prefix}%`));
  return `${prefix}${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

const fmtMins = (m: number) => (m < 60 ? `${m} minutes` : m % 60 === 0 && m < 1440 ? `${m / 60} hour${m === 60 ? "" : "s"}` : m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : `${Math.round((m / 60) * 10) / 10} hours`);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A frozen copy of the customer's SLA policy, so the signed document never changes if the policy is edited later. */
export async function slaSnapshot(db: DB, companyId: string): Promise<SlaSnapshot> {
  const [co] = await db.select({ tier: companies.tier }).from(companies).where(eq(companies.id, companyId));
  const p = await policyForCompany(db, companyId);
  const won = await db.selectDistinct({ name: products.name }).from(dealProducts).innerJoin(deals, eq(deals.id, dealProducts.dealId)).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .innerJoin(products, eq(products.id, dealProducts.productId)).where(and(eq(deals.companyId, companyId), eq(pipelineStages.isWon, true), isNull(deals.deletedAt)));
  return {
    policyName: p.name, tier: co?.tier ?? "Standard", timezone: p.calendar.timezone, hours: `${p.calendar.start}–${p.calendar.end}`,
    workdays: p.calendar.workdays.map((d) => DAY_NAMES[d]).join(", "), holidays: p.calendar.holidays,
    targets: ["P1", "P2", "P3", "P4"].filter((k) => p.targets[k]).map((k) => ({
      priority: k, firstResponse: fmtMins(p.targets[k].firstResponseMins), resolution: fmtMins(p.targets[k].resolutionMins), updates: fmtMins(p.targets[k].updateMins),
      coverage: p.targets[k].businessHours ? "Business hours" : "24×7",
    })),
    products: won.map((w) => w.name),
  };
}

/** The standard SLA wording, prefilled for this customer. Every clause can be edited before sending. */
export function defaultSlaSections(companyName: string, s: AppSettings, snap: SlaSnapshot, termMonths: number): DocSection[] {
  const b = s.billing;
  const pausing = TICKET_STATUSES.filter((x) => x.key.startsWith("waiting_on_customer") || x.key === "waiting_on_third_party").map((x) => x.label).join(", ") || "Waiting on customer";
  return [
    { heading: "1. Parties and purpose", body: `This Service Level Agreement ("Agreement") is between ${b.legalName} ("Afrilinq") and ${companyName} ("the Customer"). It sets out the support Afrilinq provides for the services listed below, the response and resolution targets Afrilinq commits to, and what each party is responsible for.` },
    { heading: "2. Services covered", body: snap.products.length ? `This Agreement covers: ${snap.products.join("; ")}, including standard configuration, product updates and bug fixes released during the term.` : "This Agreement covers the Afrilinq products and services the Customer subscribes to, as set out in the Customer's order form." },
    { heading: "3. Term", body: `This Agreement starts on the effective date shown above and runs for ${termMonths} months. It renews for further ${termMonths}-month periods unless either party gives 30 days' written notice before the end of the current term.` },
    { heading: "4. Support hours and channels", body: `Support tier: ${snap.tier} (policy "${snap.policyName}"). Business hours are ${snap.hours}, ${snap.workdays} (${snap.timezone}), excluding public holidays. Report issues through the customer portal, by email to ${b.email}, or by phone on ${b.phone}. Critical (P1) issues are handled as shown in the table below.` },
    { heading: "5. Priority levels", body: "P1 — Critical: the service is down or a major function is unusable for most users, or there is a security or data issue. No workaround.\nP2 — High: a major function is impaired for many users, or a key process is blocked with no reasonable workaround.\nP3 — Medium: a function is impaired for some users, or a workaround exists.\nP4 — Low: how-to questions, minor defects, cosmetic issues and feature requests.\nAfrilinq sets the priority from the business impact and urgency described. If there is a documented workaround, the priority may be lowered." },
    { heading: "6. Response and resolution targets", body: "Afrilinq aims to meet the targets in the table below. Response means a person (not an automated acknowledgement) has started working on the issue. Resolution means the issue is fixed or a workaround is in place. Time is measured within the coverage hours shown, and the clock is paused while Afrilinq is waiting for information or action from the Customer (" + pausing + ")." },
    { heading: "7. Escalation", body: "If a target is at risk, the issue is escalated to the Support Lead, and where needed to engineering or management. The Customer may also ask for escalation by replying on the ticket or contacting their account manager. Escalated issues receive regular status updates until resolved, and the Customer is asked to confirm the resolution." },
    { heading: "8. Customer responsibilities", body: "The Customer will: nominate named contacts who are trained on the product; report issues with enough detail to reproduce them (steps, error messages, screenshots); give Afrilinq reasonable access and cooperation needed to investigate; keep their own devices, network and third-party systems in working order; and confirm resolutions or report if an issue persists." },
    { heading: "9. Maintenance", body: "Planned maintenance is scheduled outside business hours where possible, with at least 48 hours' notice. Emergency maintenance to protect security or stability may happen at short notice. Planned maintenance is not counted as downtime." },
    { heading: "10. Exclusions", body: "These targets do not apply to issues caused by: the Customer's own systems, networks or third-party providers; use outside the documentation or agreed configuration; unauthorised changes; events outside Afrilinq's reasonable control; or customisations not delivered by Afrilinq." },
    { heading: "11. Service reviews", body: "Afrilinq will review service performance with the Customer at least every quarter, including ticket volumes, targets met, open issues and planned improvements." },
    { heading: "12. Service credits", body: "Where Afrilinq misses the P1 resolution target more than twice in a calendar month, the Customer may request a service credit of 5% of that month's subscription fee, up to a maximum of 15% per month. Credits are the Customer's sole remedy for missed targets and must be requested within 30 days." },
    { heading: "13. General", body: "This Agreement forms part of the commercial agreement between the parties. If there is a conflict, the commercial agreement takes precedence. Changes must be agreed in writing by both parties." },
  ];
}
const DEFAULT_TERMS: Record<"quote" | "invoice", (s: AppSettings) => DocSection[]> = {
  quote: (s) => [
    { heading: "Validity", body: `This quote is valid until the date shown above. Prices exclude VAT unless stated; VAT is charged at ${s.billing.vatRate}%.` },
    { heading: "Payment", body: `Invoices are payable within ${s.billing.paymentTermsDays} days of issue unless otherwise agreed. Implementation work starts once the order is confirmed.` },
    { heading: "Acceptance", body: "Accept this quote online using the link provided, or sign and return a copy. Acceptance confirms the order on these terms." },
  ],
  invoice: (s) => [
    { heading: "Payment", body: `Payment is due by the date shown. Pay by bank transfer to ${s.billing.bankName}, account name ${s.billing.accountName}, account number ${s.billing.accountNumber}, quoting the invoice number as the reference.` },
    { heading: "Questions", body: `Contact ${s.billing.email} or ${s.billing.phone} about this invoice.` },
  ],
};

export type NewDocInput = { type: DocType; companyId: string; contactId?: string | null; dealId?: string | null; sourceId?: string | null };

/** Start a draft. Quotes and invoices copy the deal's product lines; invoices can copy an accepted quote; SLAs copy the customer's SLA policy. */
export async function createDocument(db: DB, actor: Actor, input: NewDocInput) {
  if (!DOC_TYPES[input.type]) throw invalid("Choose a document type.");
  assertCanManage(actor, input.type);
  const [co] = await db.select().from(companies).where(and(eq(companies.id, input.companyId), isNull(companies.deletedAt), companyScope(db, actor)));
  if (!co) throw invalid("Choose an existing company.", { companyId: "Required." });
  const s = await getSettings(db);
  const today = todayIn(s.timezone);
  let contactId = input.contactId ?? null;
  if (contactId) {
    const [c] = await db.select({ companyId: contacts.companyId }).from(contacts).where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt)));
    if (!c) throw invalid("That contact doesn't exist.", { contactId: "Not found." });
    if (c.companyId !== co.id) throw invalid("The contact must work at this company.", { contactId: "Different company." });
  }
  let lines: DocLine[] = [], currency = s.currency, dealId = input.dealId ?? null, title = "", sections: DocSection[] = [], sla: SlaSnapshot | null = null, dueDate: string | null = null, termMonths: number | null = null;
  const source = input.sourceId ? (await db.select().from(clientDocuments).where(eq(clientDocuments.id, input.sourceId)))[0] : undefined;
  if (input.sourceId && (!source || source.companyId !== co.id)) throw invalid("That quote belongs to a different customer.");
  if (dealId) {
    const [d] = await db.select().from(deals).where(and(eq(deals.id, dealId), isNull(deals.deletedAt)));
    if (!d || d.companyId !== co.id) throw invalid("The deal must belong to this company.", { dealId: "Different company." });
    currency = d.currency;
    contactId ??= d.primaryContactId;
    if (input.type !== "sla") lines = (await db.select({ productId: dealProducts.productId, name: products.name, quantity: dealProducts.quantity, unitPrice: dealProducts.unitPrice }).from(dealProducts)
      .innerJoin(products, eq(products.id, dealProducts.productId)).where(eq(dealProducts.dealId, dealId))).map((l) => ({ productId: l.productId, description: l.name, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: d.discountPct ?? 0 }));
  }
  if (source) { lines = source.lines; currency = source.currency; dealId ??= source.dealId; contactId ??= source.contactId; }
  contactId ??= (await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.companyId, co.id), isNull(contacts.deletedAt), sql`${contacts.contactRoles} ? 'decision_maker'`)).limit(1))[0]?.id ?? null;
  if (input.type === "sla") {
    sla = await slaSnapshot(db, co.id); termMonths = 12; dueDate = today;
    sections = defaultSlaSections(co.name, s, sla, termMonths); title = `Service Level Agreement — ${co.name}`;
  } else if (input.type === "quote") {
    sections = DEFAULT_TERMS.quote(s); dueDate = addDays(today, s.billing.quoteValidityDays); title = `Quote for ${co.name}`;
  } else {
    sections = DEFAULT_TERMS.invoice(s); dueDate = addDays(today, s.billing.paymentTermsDays); title = `Invoice for ${co.name}`;
  }
  const taxRate = input.type === "sla" ? 0 : s.billing.vatRate;
  const totals = computeTotals(lines, taxRate);
  const doc = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, input.type, today.slice(0, 4));
    const [row] = await tx.insert(clientDocuments).values({
      number, type: input.type, title, companyId: co.id, contactId, dealId, sourceId: source?.id ?? null, currency, lines, taxRate, ...totals,
      issueDate: today, dueDate, termMonths, sections, sla, shareToken: crypto.randomBytes(24).toString("base64url"), createdBy: actor.id,
    }).returning();
    await audit(tx, actor, "document.created", "document", row.id, { number: { from: null, to: number } }, source ? `From ${source.number}` : null);
    return row;
  });
  return doc;
}

async function requireDoc(db: Executor, actor: Actor, id: string) {
  const [row] = await db.select({ d: clientDocuments }).from(clientDocuments).innerJoin(companies, eq(companies.id, clientDocuments.companyId))
    .where(and(eq(clientDocuments.id, id), companyScope(db, actor)));
  if (!row) throw notFound("Document");
  return row.d;
}

export type DocPatch = Partial<{ title: string; contactId: string | null; currency: string; lines: DocLine[]; taxRate: number; issueDate: string; dueDate: string | null; termMonths: number | null; sections: DocSection[]; notes: string | null }>;

export async function updateDocument(db: DB, actor: Actor, id: string, patch: DocPatch, expected: Version) {
  const before = await requireDoc(db, actor, id);
  assertCanManage(actor, before.type);
  await assertFresh(db, actor, "document", id, before.updatedAt, expected, "document");
  if (!["draft", "sent", "viewed"].includes(before.status)) throw conflict(`This ${DOC_TYPES[before.type as DocType].label.toLowerCase()} is ${before.status} and can't be edited. Duplicate it instead.`);
  if (patch.title !== undefined && !patch.title.trim()) throw invalid("Give it a title.", { title: "Required." });
  const lines = patch.lines ?? before.lines;
  for (const [i, l] of lines.entries()) {
    if (!l.description?.trim()) throw invalid(`Line ${i + 1} needs a description.`, { lines: "Each line needs a description." });
    if (!(l.quantity > 0)) throw invalid(`Line ${i + 1}: quantity must be more than zero.`, { lines: "Quantity must be positive." });
    if (!(l.unitPrice >= 0)) throw invalid(`Line ${i + 1}: price can't be negative.`, { lines: "Price can't be negative." });
    if (l.discountPct < 0 || l.discountPct > 100) throw invalid(`Line ${i + 1}: discount must be 0–100%.`, { lines: "Discount 0–100%." });
  }
  if (patch.contactId) {
    const [c] = await db.select({ companyId: contacts.companyId }).from(contacts).where(eq(contacts.id, patch.contactId));
    if (c?.companyId !== before.companyId) throw invalid("The contact must work at this company.", { contactId: "Different company." });
  }
  const taxRate = patch.taxRate ?? before.taxRate;
  if (taxRate < 0 || taxRate > 50) throw invalid("VAT rate must be between 0 and 50%.", { taxRate: "Out of range." });
  const totals = before.type === "sla" ? {} : computeTotals(lines, taxRate);
  const rows = await db.update(clientDocuments).set({ ...patch, ...totals, updatedAt: new Date() })
    .where(and(eq(clientDocuments.id, id), sameVersion(clientDocuments.updatedAt, before.updatedAt))).returning();
  assertUpdated(rows, "document");
  await audit(db, actor, "document.updated", "document", id, diff(before as Record<string, unknown>, { ...patch, ...totals } as Record<string, unknown>, ["title", "total", "dueDate", "termMonths", "contactId", "taxRate"]));
  return rows[0];
}

async function logOnCompany(db: Executor, actorId: string | null, d: typeof clientDocuments.$inferSelect, subject: string, body?: string) {
  await db.insert(activities).values({ type: "note", subject, body: body ?? null, companyId: d.companyId, contactId: d.contactId, dealId: d.dealId, createdBy: actorId });
}

/** Mark as sent and return the client link. Email isn't configured, so staff send the link themselves (mailto is offered). */
export async function sendDocument(db: DB, actor: Actor, id: string) {
  const d = await requireDoc(db, actor, id);
  assertCanManage(actor, d.type);
  if (["accepted", "declined", "paid", "void"].includes(d.status)) throw conflict("This document is already finalised.");
  if (d.type !== "sla" && !d.lines.length) throw invalid("Add at least one line before sending.", { lines: "Required." });
  if (!d.contactId) throw invalid("Choose who it's for (a contact at the company) before sending.", { contactId: "Required." });
  const now = new Date();
  await db.update(clientDocuments).set({ status: d.status === "draft" ? "sent" : d.status, sentAt: d.sentAt ?? now, updatedAt: now }).where(eq(clientDocuments.id, id));
  await audit(db, actor, "document.sent", "document", id, { status: { from: d.status, to: "sent" } });
  await logOnCompany(db, actor.id, d, `${DOC_TYPES[d.type as DocType].label} ${d.number} sent to the customer`);
  return { token: d.shareToken };
}

/** The client's view (no login). The first open is recorded. */
export async function publicDocument(db: DB, token: string) {
  if (!token || token.length < 20) return null;
  const [d] = await db.select().from(clientDocuments).where(eq(clientDocuments.shareToken, token));
  if (!d || d.status === "draft") return null;
  if (d.status === "sent") {
    await db.update(clientDocuments).set({ status: "viewed", viewedAt: new Date() }).where(eq(clientDocuments.id, d.id));
    d.status = "viewed";
    if (d.createdBy) await notifyUsers(db, [d.createdBy], { kind: "document", title: `${d.number} was opened by the client`, link: `/documents/${d.id}`, dedupeKey: `doc-viewed:${d.id}` });
  }
  return documentBundle(db, d);
}

/** Everything needed to render a document. */
export async function documentBundle(db: Executor, d: typeof clientDocuments.$inferSelect) {
  const [company] = await db.select({ id: companies.id, name: companies.name, address: companies.address, city: companies.city, region: companies.region, phone: companies.phone, ownerId: companies.ownerId }).from(companies).where(eq(companies.id, d.companyId));
  const [contact] = d.contactId ? await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, jobTitle: contacts.jobTitle }).from(contacts).where(eq(contacts.id, d.contactId)) : [];
  const payments = d.type === "invoice" ? await db.select().from(documentPayments).where(eq(documentPayments.documentId, d.id)).orderBy(asc(documentPayments.paidOn)) : [];
  const s = await getSettings(db);
  return { d, company, contact: contact ?? null, payments, billing: s.billing, today: todayIn(s.timezone) };
}

/** Client accepts a quote or signs an SLA online (typed name as signature, with IP and time recorded). */
export async function publicAccept(db: DB, token: string, input: { name: string; title: string; agree: boolean }, ip: string | null) {
  const [d] = await db.select().from(clientDocuments).where(eq(clientDocuments.shareToken, token));
  if (!d || d.status === "draft") throw notFound("Document");
  if (d.type === "invoice") throw invalid("Invoices are paid, not accepted.");
  if (!["sent", "viewed"].includes(d.status)) throw conflict(`This document is already ${d.status}.`);
  if (d.type === "quote" && d.dueDate && d.dueDate < todayIn((await getSettings(db)).timezone)) throw conflict("This quote has expired. Ask us for an updated quote.");
  if (!input.name?.trim() || input.name.trim().length < 3) throw invalid("Type your full name to sign.", { name: "Required." });
  if (!input.agree) throw invalid("Tick the box to confirm you're authorised to accept.", { agree: "Required." });
  const now = new Date();
  await db.update(clientDocuments).set({ status: "accepted", decidedAt: now, signedByName: input.name.trim(), signedByTitle: input.title?.trim() || null, signatureMethod: "online", signatureIp: ip, updatedAt: now }).where(eq(clientDocuments.id, d.id));
  await logOnCompany(db, null, d, `${DOC_TYPES[d.type as DocType].label} ${d.number} ${d.type === "sla" ? "signed" : "accepted"} online by ${input.name.trim()}`, input.title || undefined);
  await notifyAboutDecision(db, d, `${d.number} ${d.type === "sla" ? "signed" : "accepted"} by ${input.name.trim()}`);
}
export async function publicDecline(db: DB, token: string, reason: string) {
  const [d] = await db.select().from(clientDocuments).where(eq(clientDocuments.shareToken, token));
  if (!d || d.status === "draft") throw notFound("Document");
  if (d.type === "invoice" || !["sent", "viewed"].includes(d.status)) throw conflict("This document can't be declined.");
  if (!reason?.trim()) throw invalid("Tell us why, so we can help.", { reason: "Required." });
  await db.update(clientDocuments).set({ status: "declined", decidedAt: new Date(), declineReason: reason.trim(), updatedAt: new Date() }).where(eq(clientDocuments.id, d.id));
  await logOnCompany(db, null, d, `${DOC_TYPES[d.type as DocType].label} ${d.number} declined by the client`, reason);
  await notifyAboutDecision(db, d, `${d.number} declined: ${reason.trim().slice(0, 80)}`);
}
async function notifyAboutDecision(db: DB, d: typeof clientDocuments.$inferSelect, title: string) {
  const [co] = await db.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, d.companyId));
  await notifyUsers(db, [d.createdBy, co?.ownerId], { kind: "document", title, link: `/documents/${d.id}`, dedupeKey: `doc-decided:${d.id}` });
}

/** The client returned a signed copy: attach it to the customer's record and mark the document signed/accepted. */
export async function attachSignedCopy(db: DB, actor: Actor, id: string, file: File, signer: { name: string; title: string | null }) {
  const d = await requireDoc(db, actor, id);
  assertCanManage(actor, d.type);
  if (d.type === "invoice") throw invalid("Use “Record payment” for invoices.");
  if (["void", "declined"].includes(d.status)) throw conflict(`This document is ${d.status}.`);
  if (!signer.name?.trim()) throw invalid("Who signed it?", { signedByName: "Required." });
  const { storeDocumentFile } = await import("./files");
  const f = await storeDocumentFile(db, actor, d.companyId, d.id, file, `${d.number} signed`);
  const now = new Date();
  await db.update(clientDocuments).set({ status: "accepted", signedFileId: f.id, signatureMethod: "uploaded", signedByName: signer.name.trim(), signedByTitle: signer.title, decidedAt: d.decidedAt ?? now, updatedAt: now }).where(eq(clientDocuments.id, id));
  await audit(db, actor, "document.signed_copy_attached", "document", id, { status: { from: d.status, to: "accepted" } }, f.filename);
  await logOnCompany(db, actor.id, d, `Signed copy of ${d.number} attached`, `Signed by ${signer.name}${signer.title ? `, ${signer.title}` : ""}. File: ${f.filename}`);
  return f;
}

export async function recordPayment(db: DB, actor: Actor, id: string, p: { amount: number; method: string; reference: string | null; paidOn: string; notes: string | null }) {
  assertCan(actor, "billing.manage");
  const d = await requireDoc(db, actor, id);
  if (d.type !== "invoice") throw invalid("Payments are recorded against invoices.");
  if (["draft", "void"].includes(d.status)) throw conflict(d.status === "draft" ? "Send the invoice before recording payments." : "This invoice is void.");
  if (!(p.amount > 0)) throw invalid("Enter the amount received.", { amount: "Must be more than zero." });
  if (!PAYMENT_METHODS[p.method]) throw invalid("Choose how it was paid.", { method: "Required." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn)) throw invalid("Enter the payment date.", { paidOn: "Required." });
  const outstanding = Math.round((d.total - d.amountPaid) * 100) / 100;
  if (p.amount > outstanding + 0.005) throw invalid(`That's more than the ${d.currency} ${outstanding.toLocaleString("en-NG")} outstanding.`, { amount: "More than the balance." });
  const paid = Math.round((d.amountPaid + p.amount) * 100) / 100;
  const status = paid >= d.total - 0.005 ? "paid" : "part_paid";
  await db.transaction(async (tx) => {
    await tx.insert(documentPayments).values({ documentId: id, amount: p.amount, method: p.method, reference: p.reference, paidOn: p.paidOn, notes: p.notes, recordedBy: actor.id });
    await tx.update(clientDocuments).set({ amountPaid: paid, status, updatedAt: new Date() }).where(eq(clientDocuments.id, id));
    await audit(tx, actor, "document.payment_recorded", "document", id, { amountPaid: { from: d.amountPaid, to: paid } }, `${PAYMENT_METHODS[p.method]} ${p.reference ?? ""}`.trim());
    await logOnCompany(tx, actor.id, d, `Payment of ${d.currency} ${p.amount.toLocaleString("en-NG")} received for ${d.number}`, status === "paid" ? "Invoice fully paid." : `Balance ${d.currency} ${(d.total - paid).toLocaleString("en-NG")}.`);
  });
  return status;
}

export async function voidDocument(db: DB, actor: Actor, id: string, reason: string) {
  const d = await requireDoc(db, actor, id);
  assertCanManage(actor, d.type);
  if (d.status === "void") throw conflict("Already void.");
  if (d.amountPaid > 0) throw conflict("This invoice has payments recorded. Contact finance to refund before voiding.");
  if (!reason?.trim()) throw invalid("Say why it's being voided.", { reason: "Required." });
  await db.update(clientDocuments).set({ status: "void", updatedAt: new Date() }).where(eq(clientDocuments.id, id));
  await audit(db, actor, "document.voided", "document", id, { status: { from: d.status, to: "void" } }, reason);
}

/** Copy an existing document into a new draft (e.g. a revised quote, or an invoice from an accepted quote). */
export async function duplicateDocument(db: DB, actor: Actor, id: string, asType?: DocType) {
  const d = await requireDoc(db, actor, id);
  const type = (asType ?? d.type) as DocType;
  if (type === "invoice" && d.type === "quote" && d.status !== "accepted") throw conflict("Only accepted quotes can be turned into invoices.");
  const doc = await createDocument(db, actor, { type, companyId: d.companyId, contactId: d.contactId, dealId: d.dealId, sourceId: type !== "sla" && d.type !== "sla" ? d.id : null });
  if (type === d.type) await db.update(clientDocuments).set({ lines: d.lines, sections: d.sections, taxRate: d.taxRate, termMonths: d.termMonths, title: `${d.title} (revised)`, subtotal: d.subtotal, discountTotal: d.discountTotal, tax: d.tax, total: d.total }).where(eq(clientDocuments.id, doc.id));
  return doc;
}

export async function getDocument(db: DB, actor: Actor, id: string) {
  const d = await requireDoc(db, actor, id);
  const bundle = await documentBundle(db, d);
  const [deal] = d.dealId ? await db.select({ id: deals.id, name: deals.name }).from(deals).where(eq(deals.id, d.dealId)) : [];
  const [source] = d.sourceId ? await db.select({ id: clientDocuments.id, number: clientDocuments.number }).from(clientDocuments).where(eq(clientDocuments.id, d.sourceId)) : [];
  const derived = await db.select({ id: clientDocuments.id, number: clientDocuments.number, type: clientDocuments.type, status: clientDocuments.status }).from(clientDocuments).where(eq(clientDocuments.sourceId, d.id));
  const [signedFile] = d.signedFileId ? await db.select({ id: files.id, filename: files.filename }).from(files).where(eq(files.id, d.signedFileId)) : [];
  const contactsAtCompany = await db.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email }).from(contacts).where(and(eq(contacts.companyId, d.companyId), isNull(contacts.deletedAt)));
  const [creator] = d.createdBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, d.createdBy)) : [];
  const productList = await db.select({ id: products.id, name: products.name, listPrice: products.listPrice }).from(products).where(eq(products.active, true)).orderBy(asc(products.name));
  return { ...bundle, deal: deal ?? null, source: source ?? null, derived, signedFile: signedFile ?? null, contactsAtCompany, createdByName: creator?.name ?? null, products: productList, canManage: canManageType(actor, d.type), canPay: can(actor, "billing.manage") };
}

export type DocFilters = { type?: string; status?: string; q?: string; companyId?: string };
export async function listDocuments(db: DB, actor: Actor, f: DocFilters = {}) {
  const conds: (SQL | undefined)[] = [companyScope(db, actor)];
  if (f.type) conds.push(eq(clientDocuments.type, f.type));
  if (f.companyId) conds.push(eq(clientDocuments.companyId, f.companyId));
  if (f.q) conds.push(or(ilike(clientDocuments.number, `%${f.q}%`), ilike(clientDocuments.title, `%${f.q}%`), ilike(companies.name, `%${f.q}%`)));
  if (f.status && !["overdue", "expired"].includes(f.status)) conds.push(eq(clientDocuments.status, f.status));
  const rows = await db.select({
    id: clientDocuments.id, number: clientDocuments.number, type: clientDocuments.type, status: clientDocuments.status, title: clientDocuments.title, total: clientDocuments.total,
    amountPaid: clientDocuments.amountPaid, currency: clientDocuments.currency, issueDate: clientDocuments.issueDate, dueDate: clientDocuments.dueDate, companyId: companies.id, companyName: companies.name,
    sentAt: clientDocuments.sentAt, decidedAt: clientDocuments.decidedAt, signedByName: clientDocuments.signedByName, contactId: clientDocuments.contactId,
  }).from(clientDocuments).innerJoin(companies, eq(companies.id, clientDocuments.companyId)).where(and(...conds)).orderBy(desc(clientDocuments.createdAt)).limit(500);
  const today = todayIn((await getSettings(db)).timezone);
  const withStatus = rows.map((r) => ({ ...r, view: docStatus(r, today) }));
  return f.status === "overdue" || f.status === "expired" ? withStatus.filter((r) => r.view.key === f.status) : withStatus;
}

export async function listPayments(db: DB, actor: Actor) {
  return db.select({ id: documentPayments.id, amount: documentPayments.amount, method: documentPayments.method, reference: documentPayments.reference, paidOn: documentPayments.paidOn,
    documentId: clientDocuments.id, number: clientDocuments.number, currency: clientDocuments.currency, companyId: companies.id, companyName: companies.name, recordedBy: users.name })
    .from(documentPayments).innerJoin(clientDocuments, eq(clientDocuments.id, documentPayments.documentId)).innerJoin(companies, eq(companies.id, clientDocuments.companyId))
    .leftJoin(users, eq(users.id, documentPayments.recordedBy)).where(companyScope(db, actor)).orderBy(desc(documentPayments.paidOn)).limit(500);
}

export { inArray, forbidden };
