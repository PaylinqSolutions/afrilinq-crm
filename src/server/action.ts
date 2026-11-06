import "server-only";
import { revalidatePath } from "next/cache";
import { getDb, type DB } from "@/db";
import { AppError } from "./errors";
import { requireActor } from "./session";
import type { Actor } from "./actor";

export type ActionResult = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; at?: number; data?: Record<string, unknown> };

/**
 * Wraps a mutation: authenticates, runs the service (which enforces RBAC and validation),
 * maps domain errors to a form-friendly result and never leaks stack traces.
 */
export async function act(fn: (actor: Actor, db: DB) => Promise<string | Partial<ActionResult> | void>, revalidate: string[] = []): Promise<ActionResult> {
  const actor = await requireActor();
  const db = await getDb();
  try {
    const r = await fn(actor, db);
    for (const p of revalidate) revalidatePath(p, "layout");
    if (typeof r === "string") return { ok: true, message: r, at: Date.now() };
    return { ok: true, at: Date.now(), ...(r ?? {}) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message, fieldErrors: e.fieldErrors, at: Date.now(), ...(e.code === "stale" ? { data: { stale: true } } : {}) };
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error("[action] unexpected error:", (e as Error)?.message);
    return { ok: false, message: "Something went wrong. The error has been logged; please try again.", at: Date.now() };
  }
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optional = (fd: FormData, k: string) => str(fd, k) || null;
export const num = (fd: FormData, k: string) => { const v = str(fd, k).replace(/[, ]/g, ""); return v === "" ? null : Number(v); };
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const all = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
