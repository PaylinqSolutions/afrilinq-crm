import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db";
import { notifications, roles, userRoles, users } from "@/db/schema";

export type NotificationInput = { kind: string; title: string; body?: string; link?: string; dedupeKey?: string };

export async function notifyUsers(db: Executor, userIds: (string | null | undefined)[], n: NotificationInput) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  const rows = await db.insert(notifications)
    .values(ids.map((userId) => ({ userId, ...n, dedupeKey: n.dedupeKey ?? null })))
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length;
}

export async function usersWithRole(db: Executor, roleKeys: string[]) {
  const rows = await db.selectDistinct({ id: users.id }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(inArray(roles.key, roleKeys), eq(users.active, true)));
  return rows.map((r) => r.id);
}

export async function notifyRoles(db: Executor, roleKeys: string[], n: NotificationInput) {
  return notifyUsers(db, await usersWithRole(db, roleKeys), n);
}
