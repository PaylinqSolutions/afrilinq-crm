/** Applies migrations (and seeds demo data when AUTO_SEED is not "false" and the DB is empty). */
import { getDb } from "../src/db";
await getDb();
console.log("Database ready.");
process.exit(0);
