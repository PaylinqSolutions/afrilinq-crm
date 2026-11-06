import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { sessions, users, invitations, userRoles } from "@/db/schema";
import { loadActor } from "./actor";
import { audit } from "./audit";
import { AppError, invalid } from "./errors";
import { rateLimit } from "./rate-limit";

const SESSION_DAYS = 7;

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string | null) {
  if (!stored?.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash, "base64");
  const got = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function validatePassword(p: string) {
  if (!p || p.length < 10) return "Use at least 10 characters.";
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return "Use letters and at least one number.";
  return null;
}

export async function createSession(db: DB, userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function actorFromToken(db: DB, token: string | undefined) {
  if (!token) return null;
  const [s] = await db.select().from(sessions).where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
  if (!s) return null;
  return loadActor(db, s.userId);
}

export async function destroySession(db: DB, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function login(db: DB, emailIn: string, password: string, ip: string) {
  const email = (emailIn ?? "").trim().toLowerCase();
  if (!rateLimit(`login:${ip}`, 20, 15 * 60000) || !rateLimit(`login:${email}`, 8, 15 * 60000))
    throw new AppError("rate_limited", "Too many sign-in attempts. Wait 15 minutes and try again.");
  const [u] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt)));
  // Same message for unknown email and wrong password.
  if (!u || !u.active || !verifyPassword(password ?? "", u.passwordHash)) throw invalid("Email or password is incorrect.");
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  return createSession(db, u.id);
}

export async function findInvitation(db: DB, token: string) {
  const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, sha256(token)));
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

export async function acceptInvitation(db: DB, token: string, password: string, name: string) {
  const inv = await findInvitation(db, token);
  if (!inv) throw invalid("This invitation is invalid, expired or already used. Ask an administrator for a new one.");
  const err = validatePassword(password);
  if (err) throw invalid("Choose a stronger password.", { password: err });
  const userId = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.email, inv.email));
    let id = existing?.id;
    if (existing) {
      await tx.update(users).set({ passwordHash: hashPassword(password), active: true, name: name || existing.name, teamId: inv.teamId ?? existing.teamId }).where(eq(users.id, existing.id));
    } else {
      id = (await tx.insert(users).values({ email: inv.email, name: name || inv.name, passwordHash: hashPassword(password), teamId: inv.teamId }).returning({ id: users.id }))[0].id;
    }
    await tx.insert(userRoles).values({ userId: id!, roleId: inv.roleId }).onConflictDoNothing();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    return id!;
  });
  const actor = await loadActor(db, userId);
  if (actor) await audit(db, actor, "user.invitation_accepted", "user", userId);
  return createSession(db, userId);
}
