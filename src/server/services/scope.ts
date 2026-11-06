import { and, eq, exists, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Executor } from "@/db";
import {
  companies, contacts, deals, leads, tickets, ticketEscalations, trainingSessions, handoverRecords, onboardingProjects,
} from "@/db/schema";
import { type Actor, can } from "../actor";

/**
 * Row-level scoping. Every list/detail query for a scoped entity must AND one of these conditions.
 * This is the server-side enforcement of "view own / view team / view all" permissions.
 */
const NONE = sql`false`;

export function leadScope(a: Actor): SQL | undefined {
  if (can(a, "leads.view_all")) return undefined;
  if (can(a, "leads.view_own")) return eq(leads.ownerId, a.id);
  return NONE;
}

export function dealScope(a: Actor): SQL | undefined {
  if (can(a, "deals.view_all")) return undefined;
  if (can(a, "deals.view_own")) return eq(deals.ownerId, a.id);
  return NONE;
}

export function companyScope(db: Executor, a: Actor): SQL | undefined {
  if (can(a, "accounts.view_all")) return undefined;
  if (can(a, "accounts.view_own")) {
    return or(
      eq(companies.ownerId, a.id), eq(companies.csmId, a.id),
      exists(db.select({ x: sql`1` }).from(deals).where(and(eq(deals.companyId, companies.id), eq(deals.ownerId, a.id)))),
    );
  }
  return NONE;
}

export function ticketScope(db: Executor, a: Actor): SQL | undefined {
  if (can(a, "tickets.view_all")) return undefined;
  const conds: (SQL | undefined)[] = [eq(tickets.createdBy, a.id)];
  if (can(a, "tickets.view_assigned")) conds.push(eq(tickets.ownerId, a.id));
  if (can(a, "tickets.view_team") && a.teamId) conds.push(eq(tickets.teamId, a.teamId));
  // Anyone a ticket is escalated to personally can open it (e.g. a sales rep asked about pricing).
  conds.push(exists(db.select({ x: sql`1` }).from(ticketEscalations).where(and(eq(ticketEscalations.ticketId, tickets.id), eq(ticketEscalations.assignedToId, a.id)))));
  if (can(a, "tickets.view_escalated") && a.teamId) {
    conds.push(exists(db.select({ x: sql`1` }).from(ticketEscalations).where(and(
      eq(ticketEscalations.ticketId, tickets.id), eq(ticketEscalations.assignedTeamId, a.teamId),
    ))));
  }
  return or(...conds);
}

export function trainingScope(a: Actor): SQL | undefined {
  if (can(a, "training.view_all")) return undefined;
  if (can(a, "training.view_assigned")) return eq(trainingSessions.facilitatorId, a.id);
  return NONE;
}

export function handoverScope(a: Actor): SQL | undefined {
  if (!can(a, "handover.view")) return NONE;
  if (can(a, "handover.review", "deals.view_all", "onboarding.view")) return undefined;
  return sql`${handoverRecords.dealId} in (select id from deals where owner_id = ${a.id})`;
}

export function onboardingScope(a: Actor): SQL | undefined {
  if (can(a, "onboarding.view")) return undefined;
  if (can(a, "handover.view")) return sql`${onboardingProjects.dealId} in (select id from deals where owner_id = ${a.id})`;
  return NONE;
}

/** Contacts the actor may see: everything, or those they own plus contacts at companies they work with. Needs a left join on companies. */
export function contactScope(db: Executor, a: Actor): SQL | undefined {
  if (can(a, "accounts.view_all")) return undefined;
  if (can(a, "accounts.view_own")) return or(eq(contacts.ownerId, a.id), and(isNotNull(contacts.companyId), companyScope(db, a)));
  return sql`false`;
}
