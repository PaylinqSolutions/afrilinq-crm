import { describe, it, expect } from "vitest";
import { count } from "drizzle-orm";
import { seededDb } from "./helpers";
import * as s from "@/db/schema";

describe("seed", () => {
  it("builds a consistent demo dataset through the real services", async () => {
    const db = await seededDb();
    const [{ n: deals }] = await db.select({ n: count() }).from(s.deals);
    const [{ n: handovers }] = await db.select({ n: count() }).from(s.handoverRecords);
    const [{ n: tickets }] = await db.select({ n: count() }).from(s.tickets);
    expect(deals).toBeGreaterThan(10);
    expect(handovers).toBe(8);
    expect(tickets).toBeGreaterThan(8);
  }, 120000);
});
