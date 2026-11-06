/** Deletes the local embedded database and rebuilds it with demo data. Stop the dev server first. */
import fs from "node:fs";
import path from "node:path";
if (process.env.DATABASE_URL) { console.error("Refusing to reset: DATABASE_URL is set (hosted database)."); process.exit(1); }
const dir = path.resolve(process.env.PGLITE_DIR || "./.data/pglite");
fs.rmSync(dir, { recursive: true, force: true });
const { getDb } = await import("../src/db");
await getDb();
console.log(`Reset ${dir} and loaded demo data.`);
process.exit(0);
