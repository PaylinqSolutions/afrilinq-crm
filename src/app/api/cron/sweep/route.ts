import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { runAllSweeps } from "@/server/services/sweep";

/** For external schedulers: `Authorization: Bearer $CRON_SECRET`. Disabled when CRON_SECRET is unset. */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret)))
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json(await runAllSweeps(await getDb()));
}
