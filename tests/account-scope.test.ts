import { describe, it, expect, beforeAll } from "vitest";
import type { DB } from "@/db";
import { seededDb, actor } from "./helpers";
import * as sales from "@/server/services/sales";
import * as accounts from "@/server/services/accounts";
import * as cw from "@/server/services/contacts-workspace";

/**
 * Owning a deal on a company makes that company (and its contacts and files) visible to a view-own user.
 * These tests make sure a Sales Executive cannot use deal creation or lead conversion to reach accounts they can't see.
 */
let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);
let n = 0;
const lead = (v: Record<string, unknown>) => ({ source: "Referral", status: "New", nextAction: "Call", contactName: "Probe Person", email: `probe-${++n}@example.test`, ...v });

async function hiddenCompany() {
  const emeka = await actor(db, "emeka");
  const mgr = await actor(db, "sales.manager");
  const visible = new Set((await accounts.listCompanies(db, emeka, {}, true)).rows.map((c) => c.id));
  const hidden = (await accounts.listCompanies(db, mgr, {}, true)).rows.find((c) => !visible.has(c.id));
  expect(hidden, "seed should contain a company Emeka cannot see").toBeTruthy();
  return { emeka, mgr, hidden: hidden! };
}

describe("account scope cannot be widened by creating deals", () => {
  it("rejects a deal on a company the user cannot see", async () => {
    const { emeka, hidden } = await hiddenCompany();
    await expect(sales.createDeal(db, emeka, { name: "Probe", companyId: hidden.id, amount: "1000", currency: "NGN", forecastCategory: "pipeline", nextStep: "Call", nextStepDue: "2026-12-01", expectedCloseDate: "2026-12-01" }))
      .rejects.toThrow(/Choose a company/);
    await expect(accounts.getCompany(db, emeka, hidden.id)).rejects.toThrow();
  });

  it("rejects converting a lead onto a hidden company id", async () => {
    const { emeka, hidden } = await hiddenCompany();
    const l = await sales.createLead(db, emeka, lead({ name: "Probe by id" }));
    await expect(sales.convertLead(db, emeka, l.id, { companyId: hidden.id })).rejects.toThrow(/company you have access to/);
    await expect(accounts.getCompany(db, emeka, hidden.id)).rejects.toThrow();
  });

  it("treats the organisation name literally (no LIKE wildcards) and won't attach to a hidden company by name", async () => {
    const { emeka, hidden } = await hiddenCompany();
    const wildcard = await sales.createLead(db, emeka, lead({ name: "Probe wildcard", organization: "%" }));
    const r = await sales.convertLead(db, emeka, wildcard.id, {});
    expect(r.companyId).not.toBe(hidden.id);
    const byName = await sales.createLead(db, emeka, lead({ name: "Probe by name", organization: hidden.name.toUpperCase() }));
    await expect(sales.convertLead(db, emeka, byName.id, {})).rejects.toThrow(/isn't one of your accounts/);
    await expect(accounts.getCompany(db, emeka, hidden.id)).rejects.toThrow();
  });

  it("does not match a lead to a contact the user cannot see", async () => {
    const { emeka, mgr } = await hiddenCompany();
    const visible = new Set((await cw.workspaceContacts(db, emeka)).map((c) => c.id));
    const other = (await cw.workspaceContacts(db, mgr)).find((c) => c.email && !visible.has(c.id))!;
    expect(await sales.findMatchingContact(db, other.email, null, null, null, emeka)).toBeNull();
    expect((await sales.findMatchingContact(db, other.email, null, null, null, mgr))?.id).toBe(other.id);
  });

  it("still lets a manager convert onto any company", async () => {
    const { mgr, hidden } = await hiddenCompany();
    const l = await sales.createLead(db, mgr, lead({ name: "Manager convert" }));
    const r = await sales.convertLead(db, mgr, l.id, { companyId: hidden.id });
    expect(r.companyId).toBe(hidden.id);
  });
});
