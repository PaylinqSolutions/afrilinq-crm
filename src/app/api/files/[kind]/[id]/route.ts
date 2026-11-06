import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getActor } from "@/server/session";
import { AppError } from "@/server/errors";
import { readFileForActor } from "@/server/services/files";

export async function GET(_: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { kind, id } = await params;
  if (kind !== "file" && kind !== "attachment") return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const f = await readFileForActor(await getDb(), actor, kind, id);
    return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${f.name.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
