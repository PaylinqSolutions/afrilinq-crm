import { NextResponse } from "next/server";
import { and, asc, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { companies } from "@/db/schema";
import { getActor } from "@/server/session";
import { can } from "@/server/actor";
import { companyScope } from "@/server/services/scope";

/** Minimal company list (id + name) for pickers, limited to companies the user can see. */
export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!can(actor, "deals.edit", "tickets.create", "accounts.view_all", "accounts.view_own")) return NextResponse.json([], { status: 200 });
  const db = await getDb();
  const rows = await db.select({ id: companies.id, name: companies.name }).from(companies).where(and(isNull(companies.deletedAt), companyScope(db, actor))).orderBy(asc(companies.name));
  return NextResponse.json(rows, { headers: { "Cache-Control": "private, no-store" } });
}
