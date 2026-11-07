import path from "node:path";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type DB = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;
export { schema };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

type DbState = { promise?: Promise<DB>; override?: DB };
const g = globalThis as unknown as { __afrilinqDb?: DbState };
const state: DbState = (g.__afrilinqDb ??= {});

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  let db: DB;
  if (url) {
    // Hosted Postgres (Supabase or any Postgres 14+). The postgres-js driver exposes the same
    // query builder API as the PGlite driver, so the rest of the app is driver-agnostic.
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: 10, prepare: false });
    const pgDb = drizzle(client, { schema });
    await migrate(pgDb, { migrationsFolder: MIGRATIONS });
    db = pgDb as unknown as DB;
  } else {
    const dir = path.resolve(process.env.PGLITE_DIR || "./.data/pglite");
    fs.mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS });
  }
  const { syncPermissions, seedIfEmpty, seedAdminIfEmpty } = await import("./seed");
  await syncPermissions(db);
  const isProd = process.env.NODE_ENV === "production";
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (isProd && adminEmail && adminPassword) {
    // Production with admin credentials: create only that Super Admin on an empty database.
    await seedAdminIfEmpty(db, { email: adminEmail, password: adminPassword, name: process.env.ADMIN_NAME });
  } else if ((process.env.AUTO_SEED ?? (isProd ? "false" : "true")) !== "false") {
    // Otherwise fall back to the demo data and demo sign-ins documented in the README.
    await seedIfEmpty(db);
  }
  return db;
}

export function getDb(): Promise<DB> {
  if (state.override) return Promise.resolve(state.override);
  if (!state.promise) {
    state.promise = connect().catch((err) => {
      state.promise = undefined;
      throw err;
    });
  }
  return state.promise;
}

/** Creates an isolated in-memory Postgres with all migrations applied. Used by tests. */
export async function createMemoryDb(): Promise<DB> {
  const db = drizzlePglite(new PGlite(), { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db;
}

export function setDbOverride(db: DB | undefined) {
  state.override = db;
}
