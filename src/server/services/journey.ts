import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  clientDocuments, companies, contacts, customerHealthSnapshots, dealContacts, dealProducts, deals, handoverRecords, leads, onboardingProjects, pipelineStages, products, renewals, tickets,
  trainingParticipants, trainingPrograms, trainingSessions,
} from "@/db/schema";
import { stageLabel } from "@/lib/rules/onboarding";
import { OPEN_STATUSES } from "@/lib/rules/tickets";
import { type Actor, can } from "../actor";

export type StepStatus = "done" | "current" | "attention" | "todo" | "skipped";
export type JourneyStep = { key: string; label: string; status: StepStatus; detail: string; href?: string };

const fmt = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Where a customer is in the Afrilinq lifecycle, step by step, each linked to the record that proves it:
 * Lead → Opportunity → Won → Handover → Onboarding → Training → Live → Customer success.
 */
export async function customerJourney(db: DB, companyId: string): Promise<JourneyStep[]> {
  const [co] = await db.select({ lifecycle: companies.lifecycle, createdAt: companies.createdAt }).from(companies).where(eq(companies.id, companyId));
  if (!co) return [];
  const [lead] = await db.select({ id: leads.id, name: leads.name, convertedAt: leads.convertedAt }).from(leads).where(eq(leads.convertedCompanyId, companyId)).orderBy(asc(leads.convertedAt)).limit(1);
  const ds = await db.select({ id: deals.id, name: deals.name, isWon: pipelineStages.isWon, isLost: pipelineStages.isLost, stage: pipelineStages.name, closedAt: deals.closedAt })
    .from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)).where(and(eq(deals.companyId, companyId), isNull(deals.deletedAt))).orderBy(desc(deals.updatedAt));
  const won = ds.filter((d) => d.isWon).sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));
  const open = ds.filter((d) => !d.isWon && !d.isLost);
  const [ho] = await db.select({ id: handoverRecords.id, status: handoverRecords.status, completeness: handoverRecords.completeness }).from(handoverRecords)
    .where(eq(handoverRecords.companyId, companyId)).orderBy(desc(handoverRecords.updatedAt)).limit(1);
  const [proj] = await db.select().from(onboardingProjects).where(eq(onboardingProjects.companyId, companyId)).orderBy(desc(onboardingProjects.createdAt)).limit(1);
  const sessions = await db.select({ id: trainingSessions.id, status: trainingSessions.status, required: trainingPrograms.requiredForGoLive }).from(trainingSessions)
    .innerJoin(trainingPrograms, eq(trainingPrograms.id, trainingSessions.programId)).where(eq(trainingSessions.companyId, companyId));
  const parts = sessions.length ? await db.select({ completed: trainingParticipants.completed, attendance: trainingParticipants.attendance }).from(trainingParticipants).where(inArray(trainingParticipants.sessionId, sessions.map((s) => s.id))) : [];
  const [health] = await db.select({ status: customerHealthSnapshots.status, score: customerHealthSnapshots.score }).from(customerHealthSnapshots).where(eq(customerHealthSnapshots.companyId, companyId)).orderBy(desc(customerHealthSnapshots.computedAt)).limit(1);
  const [renewal] = await db.select({ date: renewals.renewalDate }).from(renewals).where(and(eq(renewals.companyId, companyId), inArray(renewals.status, ["upcoming", "in_progress"]))).orderBy(asc(renewals.renewalDate)).limit(1);
  const [openT] = await db.select({ n: sql<number>`count(*)::int`, high: sql<number>`count(*) filter (where ${tickets.priority} in ('P1','P2'))::int` }).from(tickets)
    .where(and(eq(tickets.companyId, companyId), inArray(tickets.status, OPEN_STATUSES), isNull(tickets.deletedAt)));

  const steps: JourneyStep[] = [];
  steps.push(lead ? { key: "lead", label: "Lead", status: "done", detail: `Converted from “${lead.name}” on ${fmt(lead.convertedAt)}`, href: `/leads/${lead.id}` }
    : { key: "lead", label: "Lead", status: "skipped", detail: "Added directly, not from a lead" });
  steps.push(won.length ? { key: "deal", label: "Opportunity", status: "done", detail: `${ds.length} deal${ds.length === 1 ? "" : "s"}${open.length ? `, ${open.length} still open` : ""}`, href: `/companies/${companyId}#deals` }
    : open.length ? { key: "deal", label: "Opportunity", status: "current", detail: `${open[0].name} — ${open[0].stage}`, href: `/deals/${open[0].id}` }
      : { key: "deal", label: "Opportunity", status: ds.length ? "attention" : "todo", detail: ds.length ? "All deals lost" : "No deal yet" });
  steps.push(won.length ? { key: "won", label: "Closed won", status: "done", detail: `${won[0].name}${won[0].closedAt ? ` on ${fmt(won[0].closedAt)}` : ""}`, href: `/deals/${won[0].id}` }
    : { key: "won", label: "Closed won", status: "todo", detail: "Becomes a customer when a deal is won" });
  const hoDone = ho && ["Accepted by Onboarding", "In Onboarding", "Complete"].includes(ho.status);
  steps.push(!ho ? { key: "handover", label: "Handover", status: won.length ? "attention" : "todo", detail: won.length ? "Won but no handover yet" : "Created automatically when a deal is won" }
    : { key: "handover", label: "Handover", status: hoDone ? "done" : ho.status === "Changes Requested" ? "attention" : "current", detail: `${ho.status} · ${ho.completeness}% complete`, href: `/handovers/${ho.id}` });
  steps.push(!proj ? { key: "onboarding", label: "Onboarding", status: hoDone ? "attention" : "todo", detail: hoDone ? "Handover accepted but no project" : "Starts when Onboarding accepts the handover" }
    : { key: "onboarding", label: "Onboarding", status: proj.state === "completed" ? "done" : proj.state === "on_hold" || proj.riskLevel === "high" ? "attention" : "current",
      detail: proj.state === "completed" ? `Completed${proj.actualGoLive ? ` · live ${proj.actualGoLive}` : ""}` : `${stageLabel(proj.stage)} · ${proj.riskLevel} risk${proj.state === "on_hold" ? " · on hold" : ""}`, href: `/onboarding/${proj.id}` });
  const held = sessions.filter((s) => s.status === "completed").length, upcoming = sessions.filter((s) => ["scheduled", "rescheduled"].includes(s.status)).length;
  const completedPeople = parts.filter((p) => p.completed).length;
  steps.push(!sessions.length ? { key: "training", label: "Training", status: proj ? "attention" : "todo", detail: proj ? "No sessions scheduled yet" : "Scheduled during onboarding", href: proj ? `/training/sessions/new?company=${companyId}&project=${proj.id}` : undefined }
    : { key: "training", label: "Training", status: upcoming ? "current" : held && completedPeople ? "done" : "current", detail: `${held} held, ${upcoming} upcoming · ${completedPeople}/${parts.length} people completed`, href: `/companies/${companyId}/360?tab=training` });
  steps.push(proj?.actualGoLive ? { key: "live", label: "Live", status: "done", detail: `Went live ${proj.actualGoLive}` }
    : proj?.targetGoLive && proj.targetGoLive < new Date().toISOString().slice(0, 10) ? { key: "live", label: "Live", status: "attention", detail: `Target ${proj.targetGoLive} has passed`, href: `/onboarding/${proj.id}` }
      : { key: "live", label: "Live", status: "todo", detail: proj?.targetGoLive ? `Target ${proj.targetGoLive}` : "After onboarding" });
  const churned = co.lifecycle === "churned";
  steps.push(churned ? { key: "success", label: "Customer success", status: "attention", detail: "Churned", href: "/success" }
    : co.lifecycle !== "customer" ? { key: "success", label: "Customer success", status: "todo", detail: "Health tracking starts once they're a customer" }
      : { key: "success", label: "Customer success", status: health?.status === "at_risk" ? "attention" : health?.status === "healthy" ? "done" : "current",
        detail: [health ? `Health ${health.score}/100 (${health.status.replace(/_/g, " ")})` : "Health not scored yet", renewal ? `renews ${renewal.date}` : null, openT?.n ? `${openT.n} open ticket${openT.n === 1 ? "" : "s"}${openT.high ? `, ${openT.high} P1/P2` : ""}` : null].filter(Boolean).join(" · "), href: "/success" });
  return steps;
}

export type RelatedItem = { label: string; sub?: string | null; href: string };
export type RelatedGroup = { key: string; title: string; items: RelatedItem[]; more?: { label: string; href: string }; add?: { label: string; href: string } };
type Kind = "deal" | "ticket" | "onboarding" | "handover" | "session" | "program" | "participant" | "lead";

/** Every record connected to the one being viewed, grouped by module, filtered to the modules the viewer may open. */
export async function relatedFor(db: DB, actor: Actor, kind: Kind, id: string): Promise<{ companyId: string | null; groups: RelatedGroup[] }> {
  let companyId: string | null = null, contactIds: string[] = [], dealIds: string[] = [], productIds: string[] = [], projectIds: string[] = [], handoverIds: string[] = [];
  let ticketFilter: "company" | "deal" | "project" | "contact" = "company";
  if (kind === "deal") {
    const [d] = await db.select({ companyId: deals.companyId }).from(deals).where(eq(deals.id, id));
    companyId = d?.companyId ?? null; dealIds = [id]; ticketFilter = "deal";
    contactIds = (await db.select({ id: dealContacts.contactId }).from(dealContacts).where(eq(dealContacts.dealId, id))).map((x) => x.id);
    productIds = (await db.select({ id: dealProducts.productId }).from(dealProducts).where(eq(dealProducts.dealId, id))).map((x) => x.id);
    handoverIds = (await db.select({ id: handoverRecords.id }).from(handoverRecords).where(eq(handoverRecords.dealId, id))).map((x) => x.id);
    projectIds = (await db.select({ id: onboardingProjects.id }).from(onboardingProjects).where(eq(onboardingProjects.dealId, id))).map((x) => x.id);
  } else if (kind === "ticket") {
    const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
    companyId = t?.companyId ?? null; contactIds = t?.contactId ? [t.contactId] : []; dealIds = t?.dealId ? [t.dealId] : []; productIds = t?.productId ? [t.productId] : [];
    projectIds = t?.onboardingProjectId ? [t.onboardingProjectId] : []; ticketFilter = "company";
  } else if (kind === "onboarding" || kind === "handover") {
    const p = kind === "onboarding" ? (await db.select().from(onboardingProjects).where(eq(onboardingProjects.id, id)))[0]
      : (await db.select().from(onboardingProjects).where(eq(onboardingProjects.handoverId, id)))[0];
    const h = kind === "handover" ? (await db.select().from(handoverRecords).where(eq(handoverRecords.id, id)))[0] : p?.handoverId ? (await db.select().from(handoverRecords).where(eq(handoverRecords.id, p.handoverId)))[0] : undefined;
    companyId = p?.companyId ?? h?.companyId ?? null; projectIds = p ? [p.id] : []; handoverIds = h ? [h.id] : [];
    dealIds = [p?.dealId ?? h?.dealId].filter(Boolean) as string[];
    productIds = p?.productId ? [p.productId] : dealIds.length ? (await db.select({ id: dealProducts.productId }).from(dealProducts).where(inArray(dealProducts.dealId, dealIds))).map((x) => x.id) : [];
    if (dealIds.length) contactIds = (await db.select({ id: dealContacts.contactId }).from(dealContacts).where(inArray(dealContacts.dealId, dealIds))).map((x) => x.id);
    ticketFilter = p ? "project" : "company";
  } else if (kind === "session") {
    const [s] = await db.select({ s: trainingSessions, productId: trainingPrograms.productId }).from(trainingSessions).innerJoin(trainingPrograms, eq(trainingPrograms.id, trainingSessions.programId)).where(eq(trainingSessions.id, id));
    companyId = s?.s.companyId ?? null; projectIds = s?.s.onboardingProjectId ? [s.s.onboardingProjectId] : []; productIds = s?.productId ? [s.productId] : [];
    contactIds = (await db.select({ id: trainingParticipants.contactId }).from(trainingParticipants).where(eq(trainingParticipants.sessionId, id))).map((x) => x.id);
  } else if (kind === "participant") {
    const [p] = await db.select({ contactId: trainingParticipants.contactId, companyId: trainingSessions.companyId, projectId: trainingSessions.onboardingProjectId }).from(trainingParticipants)
      .innerJoin(trainingSessions, eq(trainingSessions.id, trainingParticipants.sessionId)).where(eq(trainingParticipants.id, id));
    companyId = p?.companyId ?? null; contactIds = p ? [p.contactId] : []; projectIds = p?.projectId ? [p.projectId] : []; ticketFilter = "contact";
  } else if (kind === "program") {
    const [p] = await db.select({ productId: trainingPrograms.productId }).from(trainingPrograms).where(eq(trainingPrograms.id, id));
    productIds = p?.productId ? [p.productId] : [];
  } else if (kind === "lead") {
    const [l] = await db.select().from(leads).where(eq(leads.id, id));
    companyId = l?.convertedCompanyId ?? null; contactIds = l?.convertedContactId ? [l.convertedContactId] : []; dealIds = l?.convertedDealId ? [l.convertedDealId] : [];
    productIds = l?.productInterestId ? [l.productInterestId] : [];
  }

  const groups: RelatedGroup[] = [];
  const accounts = can(actor, "accounts.view_all", "accounts.view_own");
  if (companyId && accounts) {
    const [c] = await db.select({ id: companies.id, name: companies.name, lifecycle: companies.lifecycle, city: companies.city }).from(companies).where(eq(companies.id, companyId));
    if (c) groups.push({ key: "company", title: "Company", items: [{ label: c.name, sub: [c.lifecycle, c.city].filter(Boolean).join(" · "), href: `/companies/${c.id}` }], more: { label: "Customer 360", href: `/companies/${c.id}/360` } });
  }
  if (accounts && (contactIds.length || companyId)) {
    const rows = await db.select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName, title: contacts.jobTitle, email: contacts.email }).from(contacts)
      .where(and(contactIds.length ? inArray(contacts.id, contactIds) : eq(contacts.companyId, companyId!), isNull(contacts.deletedAt))).limit(8);
    groups.push({ key: "contacts", title: contactIds.length ? "Contacts" : "Contacts at the company", items: rows.map((r) => ({ label: `${r.first} ${r.last}`, sub: r.title ?? r.email, href: `/contacts/${r.id}` })),
      add: companyId ? { label: "Add", href: `/contacts/new?company=${companyId}` } : undefined });
  }
  if (can(actor, "deals.view_all", "deals.view_own") && (dealIds.length || companyId)) {
    const rows = await db.select({ id: deals.id, name: deals.name, stage: pipelineStages.name, amount: deals.amount, currency: deals.currency }).from(deals).innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(and(dealIds.length ? inArray(deals.id, dealIds) : eq(deals.companyId, companyId!), isNull(deals.deletedAt))).orderBy(desc(deals.updatedAt)).limit(6);
    groups.push({ key: "deals", title: "Deals", items: rows.map((r) => ({ label: r.name, sub: `${r.stage}${r.amount ? ` · ${r.currency} ${Number(r.amount).toLocaleString("en-NG")}` : ""}`, href: `/deals/${r.id}` })) });
  }
  if (productIds.length) {
    const rows = await db.select({ id: products.id, name: products.name, code: products.code }).from(products).where(inArray(products.id, [...new Set(productIds)]));
    groups.push({ key: "products", title: "Products", items: rows.map((r) => ({ label: r.name, sub: r.code, href: `/products/${r.id}` })) });
  }
  if (can(actor, "handover.view") && (handoverIds.length || companyId)) {
    const rows = await db.select({ id: handoverRecords.id, status: handoverRecords.status, completeness: handoverRecords.completeness, deal: deals.name }).from(handoverRecords).innerJoin(deals, eq(deals.id, handoverRecords.dealId))
      .where(handoverIds.length ? inArray(handoverRecords.id, handoverIds) : eq(handoverRecords.companyId, companyId!)).limit(4);
    if (rows.length) groups.push({ key: "handover", title: "Handover", items: rows.map((r) => ({ label: r.deal, sub: `${r.status} · ${r.completeness}%`, href: `/handovers/${r.id}` })) });
  }
  if (can(actor, "onboarding.view", "handover.view") && (projectIds.length || companyId)) {
    const rows = await db.select({ id: onboardingProjects.id, name: onboardingProjects.name, stage: onboardingProjects.stage, risk: onboardingProjects.riskLevel }).from(onboardingProjects)
      .where(projectIds.length ? inArray(onboardingProjects.id, projectIds) : eq(onboardingProjects.companyId, companyId!)).limit(4);
    if (rows.length) groups.push({ key: "onboarding", title: "Onboarding", items: rows.map((r) => ({ label: r.name, sub: `${stageLabel(r.stage)} · ${r.risk} risk`, href: `/onboarding/${r.id}` })) });
  }
  if (can(actor, "training.view_all", "training.view_assigned") && (projectIds.length || companyId)) {
    const rows = await db.select({ id: trainingSessions.id, title: trainingSessions.title, status: trainingSessions.status, at: trainingSessions.startsAt }).from(trainingSessions)
      .where(projectIds.length ? or(inArray(trainingSessions.onboardingProjectId, projectIds), companyId ? eq(trainingSessions.companyId, companyId) : sql`false`) : eq(trainingSessions.companyId, companyId!))
      .orderBy(desc(trainingSessions.startsAt)).limit(5);
    if (rows.length || companyId) groups.push({ key: "training", title: "Training", items: rows.map((r) => ({ label: r.title, sub: `${r.status} · ${fmt(r.at)}`, href: `/training/sessions/${r.id}` })),
      add: companyId && can(actor, "training.manage") ? { label: "Schedule", href: `/training/sessions/new?company=${companyId}${projectIds[0] ? `&project=${projectIds[0]}` : ""}` } : undefined });
  }
  if (can(actor, "tickets.view_all", "tickets.view_team", "tickets.view_assigned", "tickets.view_escalated") && (companyId || contactIds.length)) {
    const cond = ticketFilter === "deal" ? or(eq(tickets.dealId, id), companyId ? eq(tickets.companyId, companyId) : sql`false`)
      : ticketFilter === "project" && projectIds.length ? or(inArray(tickets.onboardingProjectId, projectIds), companyId ? eq(tickets.companyId, companyId) : sql`false`)
        : ticketFilter === "contact" ? inArray(tickets.contactId, contactIds) : companyId ? eq(tickets.companyId, companyId) : inArray(tickets.contactId, contactIds);
    const rows = await db.select({ id: tickets.id, number: tickets.number, subject: tickets.subject, status: tickets.status, priority: tickets.priority }).from(tickets)
      .where(and(cond, isNull(tickets.deletedAt), kind === "ticket" ? sql`${tickets.id} <> ${id}` : undefined)).orderBy(desc(tickets.createdAt)).limit(5);
    const q = new URLSearchParams({ ...(companyId ? { company: companyId } : {}), ...(contactIds.length === 1 ? { contact: contactIds[0] } : {}), ...(kind === "deal" ? { deal: id } : {}), ...(projectIds[0] ? { project: projectIds[0] } : {}) });
    groups.push({ key: "tickets", title: kind === "ticket" ? "Other tickets" : "Tickets", items: rows.map((r) => ({ label: `#${r.number} ${r.subject}`, sub: `${r.priority} · ${r.status.replace(/_/g, " ")}`, href: `/tickets/${r.id}` })),
      add: can(actor, "tickets.create") ? { label: "Raise", href: `/tickets/new?${q}` } : undefined });
  }
  if (companyId && can(actor, "accounts.view_all", "accounts.view_own", "billing.manage")) {
    const rows = await db.select({ id: clientDocuments.id, number: clientDocuments.number, type: clientDocuments.type, status: clientDocuments.status, total: clientDocuments.total, currency: clientDocuments.currency })
      .from(clientDocuments).where(and(eq(clientDocuments.companyId, companyId), kind === "deal" ? eq(clientDocuments.dealId, id) : undefined)).orderBy(desc(clientDocuments.createdAt)).limit(6);
    const label: Record<string, string> = { sla: "SLA agreement", quote: "Quote", invoice: "Invoice" };
    const canQuote = can(actor, "deals.edit", "billing.manage"), canInvoice = can(actor, "billing.manage");
    if (rows.length || kind === "deal") groups.push({ key: "documents", title: "Quotes, invoices & agreements", items: rows.map((r) => ({ label: r.number, sub: `${label[r.type]} · ${r.status.replace(/_/g, " ")}${r.type !== "sla" ? ` · ${r.currency} ${Number(r.total).toLocaleString("en-NG")}` : ""}`, href: `/documents/${r.id}` })),
      add: kind === "deal" && (canQuote || canInvoice) ? { label: canQuote ? "Quote" : "Invoice", href: `/documents/new?type=${canQuote ? "quote" : "invoice"}&company=${companyId}&deal=${id}` } : undefined });
  }
  return { companyId, groups };
}
