import { createMemoryDb, setDbOverride, type DB } from "@/db";
import { seed } from "@/db/seed";
import { loadActor } from "@/server/actor";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

let cached: DB | null = null;

/** Fresh in-memory Postgres with migrations and the demo seed (built once per test file). */
export async function seededDb() {
  if (cached) return cached;
  const db = await createMemoryDb();
  await seed(db);
  setDbOverride(db);
  cached = db;
  return db;
}

export async function actor(db: DB, handle: string) {
  const [u] = await db.select().from(users).where(eq(users.email, `${handle}@afrilinq.demo`));
  if (!u) throw new Error(`No demo user ${handle}`);
  return (await loadActor(db, u.id))!;
}
