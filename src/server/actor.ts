import { eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db";
import { users, userRoles, roles, rolePermissions } from "@/db/schema";
import type { Permission } from "@/lib/permissions";
import { forbidden } from "./errors";

export type Actor = {
  id: string;
  name: string;
  email: string;
  teamId: string | null;
  roleKeys: string[];
  perms: Set<string>;
};

export async function loadActor(db: Executor, userId: string): Promise<Actor | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !u.active || u.deletedAt) return null;
  const rs = await db
    .select({ id: roles.id, key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const perms = rs.length
    ? await db.select({ key: rolePermissions.permissionKey }).from(rolePermissions)
        .where(inArray(rolePermissions.roleId, rs.map((r) => r.id)))
    : [];
  return {
    id: u.id, name: u.name, email: u.email, teamId: u.teamId,
    roleKeys: rs.map((r) => r.key), perms: new Set(perms.map((p) => p.key)),
  };
}

export function can(actor: Actor, ...anyOf: Permission[]): boolean {
  return anyOf.some((p) => actor.perms.has(p));
}

export function assertCan(actor: Actor, ...anyOf: Permission[]) {
  if (!can(actor, ...anyOf)) throw forbidden();
}

/** System actor used by scheduled sweeps and automations. Never used for user requests. */
export const SYSTEM_ACTOR: Actor = {
  id: "00000000-0000-0000-0000-000000000000", name: "Afrilinq Automation", email: "system@afrilinq.local",
  teamId: null, roleKeys: ["system"], perms: new Set(),
};
export const isSystem = (a: Actor) => a.id === SYSTEM_ACTOR.id;
export const actorRef = (a: Actor) => (isSystem(a) ? null : a.id);
