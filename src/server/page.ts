import "server-only";
import { forbidden, notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireActor } from "./session";
import { getSettings } from "./settings";
import { AppError } from "./errors";
import { can, type Actor } from "./actor";
import type { Permission } from "@/lib/permissions";

export async function ctx() {
  const actor = await requireActor();
  const db = await getDb();
  const settings = await getSettings(db);
  return { actor, db, settings, tz: settings.timezone };
}

/** Record-level denials render 404 so record existence is not revealed. */
export async function load<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) notFound(); throw e; }
}

/** Module-level permission gate for pages: renders the 403 page. */
export function requirePerm(actor: Actor, ...anyOf: Permission[]) {
  if (!can(actor, ...anyOf)) forbidden();
}

export const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};
