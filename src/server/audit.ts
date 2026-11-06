import type { Executor } from "@/db";
import { auditLogs } from "@/db/schema";
import { type Actor, actorRef } from "./actor";

export type Changes = Record<string, { from: unknown; to: unknown }>;

export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>, fields?: (keyof T)[]): Changes {
  const out: Changes = {};
  for (const k of (fields ?? (Object.keys(after) as (keyof T)[]))) {
    if (!(k in after)) continue;
    const a = norm(before[k]);
    const b = norm(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k as string] = { from: a, to: b };
  }
  return out;
}

function norm(v: unknown) {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined || v === "") return null;
  return v;
}

export async function audit(
  db: Executor, actor: Actor, action: string, entityType: string, entityId: string,
  changes?: Changes | null, reason?: string | null,
) {
  await db.insert(auditLogs).values({
    actorId: actorRef(actor), actorLabel: actor.name, action, entityType, entityId,
    changes: changes && Object.keys(changes).length ? changes : null, reason: reason ?? null,
  });
}
