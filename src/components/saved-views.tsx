import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { savedViews } from "@/db/schema";
import { requireActor } from "@/server/session";
import { ActionForm, Submit } from "./forms";
import { saveViewAction } from "@/app/actions/crm";

export async function SavedViews({ entity, current }: { entity: string; current: string }) {
  const actor = await requireActor();
  const db = await getDb();
  const views = await db.select().from(savedViews).where(and(eq(savedViews.userId, actor.id), eq(savedViews.entity, entity)));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Saved views</span>
      {views.length === 0 && <span className="text-xs text-slate-500">None yet</span>}
      {views.map((v) => <Link key={v.id} href={`/${entity}${v.query}`} className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs hover:border-brand-500">{v.name}</Link>)}
      {current && (
        <ActionForm action={saveViewAction.bind(null, entity)} className="flex items-center gap-1" resetOnSuccess>
          <input type="hidden" name="query" value={current} />
          <label htmlFor={`sv-${entity}`} className="sr-only">View name</label>
          <input id={`sv-${entity}`} name="name" placeholder="Save current filters as…" className="w-48 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
          <Submit size="sm" variant="secondary">Save</Submit>
        </ActionForm>
      )}
    </div>
  );
}
