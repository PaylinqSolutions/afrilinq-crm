"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { login, destroySession, acceptInvitation } from "@/server/auth-core";
import { AppError } from "@/server/errors";
import { SESSION_COOKIE, setSessionCookie, clientIp } from "@/server/session";
import type { ActionResult } from "@/server/action";

export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const db = await getDb();
  try {
    const s = await login(db, String(fd.get("email") ?? ""), String(fd.get("password") ?? ""), await clientIp());
    await setSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, at: Date.now() };
    throw e;
  }
  const next = String(fd.get("next") ?? "/");
  // Same-site paths only. Browsers read "\" as "/" and drop tabs/newlines, so "/\evil.com" or "/\t/evil.com" would leave the site.
  redirect(/^\/(?!\/)[^\\\s]*$/.test(next) ? next : "/");
}

export async function logoutAction() {
  const db = await getDb();
  const jar = await cookies();
  await destroySession(db, jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function acceptInviteAction(token: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const db = await getDb();
  if (fd.get("password") !== fd.get("confirm")) return { ok: false, message: "Passwords do not match.", fieldErrors: { confirm: "Passwords do not match." }, at: Date.now() };
  try {
    const s = await acceptInvitation(db, token, String(fd.get("password") ?? ""), String(fd.get("name") ?? "").trim());
    await setSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors, at: Date.now() };
    throw e;
  }
  redirect("/");
}
