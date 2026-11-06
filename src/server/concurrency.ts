
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "@/db";
import { auditLogs } from "@/db/schema";
import { AppError } from "./errors";
import { type Actor } from "./actor";

/**
 * Optimistic concurrency control. Edit forms send the record's `updated_at` (the version they were
 * rendered from). A save is rejected if the record changed since, instead of silently overwriting
 * someone else's work. Comparison is at millisecond precision (what the browser round-trips).
 */
export type Version = string | null | undefined;

export class StaleError extends AppError {
  constructor(message: string, public changedBy: string | null, public changedAt: Date) {
    super("stale", message);
  }
}

function parse(v: Version) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

async function describeLastChange(db: Executor, entityType: string, entityId: string, actor: Actor, current: Date, loadedAt: number) {
  const [last] = await db.select({ who: auditLogs.actorLabel, whoId: auditLogs.actorId, action: auditLogs.action, changes: auditLogs.changes, at: auditLogs.createdAt })
    .from(auditLogs).where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId))).orderBy(desc(auditLogs.createdAt)).limit(1);
  // Only attribute the change when the latest audit entry is the change that bumped the version.
  if (!last || last.at.getTime() <= loadedAt || Math.abs(last.at.getTime() - current.getTime()) > 1500) return { who: null, detail: "" };
  const who = last.whoId === actor.id ? "You (in another tab or window)" : last.who ?? "Someone";
  const fields = last.changes ? Object.keys(last.changes).slice(0, 4).join(", ") : "";
  return { who, detail: fields ? ` (${fields})` : "" };
}

/** Throws StaleError when `expected` is given and the record has changed since it was loaded. */
export async function assertFresh(db: Executor, actor: Actor, entityType: string, entityId: string, current: Date, expected: Version, noun = "record") {
  const exp = parse(expected);
  if (exp === null || exp === current.getTime()) return;
  const { who, detail } = await describeLastChange(db, entityType, entityId, actor, current, exp);
  const mins = Math.max(0, Math.round((Date.now() - current.getTime()) / 60000));
  const when = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `at ${current.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  throw new StaleError(
    `${who ? `${who} changed this ${noun}` : `This ${noun} was updated`} ${when}${detail}. Your changes were not saved so nothing is overwritten — reload to see the latest version, then reapply your edits.`,
    who, current,
  );
}

/** WHERE condition that makes the UPDATE itself a compare-and-set, closing the race between check and write. */
export function sameVersion(col: PgColumn, current: Date): SQL {
  return sql`date_trunc('milliseconds', ${col}) = ${new Date(current.getTime()).toISOString()}::timestamptz`;
}

/** Use with `.returning()` on a guarded UPDATE: zero rows means another save won the race. */
export function assertUpdated(rows: unknown[], noun = "record") {
  if (!rows.length) throw new StaleError(`This ${noun} was changed by someone else while you were saving. Reload to see the latest version, then reapply your edits.`, null, new Date());
}

export const versionOf = (d: Date | null | undefined) => (d ? d.toISOString() : "");
