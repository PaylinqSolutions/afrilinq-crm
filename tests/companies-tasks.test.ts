import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { seededDb, actor } from "./helpers";
import { StaleError } from "@/server/concurrency";
import * as co from "@/server/services/companies-workspace";
import * as tw from "@/server/services/tasks-workspace";
import * as cw from "@/server/services/contacts-workspace";
import { completeTask, createTask, logActivity } from "@/server/services/activities";

let db: DB;
beforeAll(async () => { db = await seededDb(); }, 180000);

describe("companies workspace", () => {
  it("lists scoped companies with contact, deal and ticket counts", async () => {
    const owner = await actor(db, "owner");
    const emeka = await actor(db, "emeka");
    const all = await co.workspaceCompanies(db, owner);
    expect(all.length).toBeGreaterThan(5);
    expect(all.some((c) => c.contactCount > 0 && c.openDeals > 0)).toBe(true);
    expect((await co.workspaceCompanies(db, emeka)).length).toBeLessThan(all.length);
  });

  it("inline edits validate numbers, URLs and duplicate names, and detect conflicts", async () => {
    const owner = await actor(db, "owner");
    const [a, b] = await co.workspaceCompanies(db, owner);
    const v = a.updatedAt.toISOString();
    await expect(co.patchCompany(db, owner, a.id, { employees: "-3" }, v)).rejects.toThrow(/negative/);
    await expect(co.patchCompany(db, owner, a.id, { website: "not a url" }, v)).rejects.toThrow(/web address/);
    await expect(co.patchCompany(db, owner, a.id, { name: b.name.toUpperCase() }, v)).rejects.toThrow(/already has this name/);
    const row = await co.patchCompany(db, owner, a.id, { employees: "1,250", annualRevenue: "450000000", timeZone: "Africa/Lagos" }, v);
    expect(row.employees).toBe(1250);
    expect(await co.patchCompany(db, owner, a.id, { city: "Ikeja" }, v).catch((e) => e)).toBeInstanceOf(StaleError);
  });

  it("builds a record with contacts, summary and next best action", async () => {
    const owner = await actor(db, "owner");
    const c = (await co.workspaceCompanies(db, owner)).find((x) => x.lifecycle === "customer")!;
    const r = await co.companyRecord(db, owner, c.id);
    expect(r.contactsDetail.length).toBeGreaterThan(0);
    expect(r.summary.lines[0]).toContain(c.name);
    expect(r.summary.next.length).toBeGreaterThan(5);
  });
});

describe("tasks module stays in sync with records", () => {
  it("a task created on a contact shows in Tasks with its contact and company, and completing it there closes it on the record", async () => {
    const emeka = await actor(db, "emeka");
    const contact = (await cw.workspaceContacts(db, emeka)).find((c) => c.companyId)!;
    const t = await createTask(db, emeka, { title: "Send proposal", taskType: "email", relatedType: "contact", relatedId: contact.id, companyId: contact.companyId, dueAt: "2026-10-26T08:00" });
    const row = (await tw.workspaceTasks(db, emeka)).find((x) => x.id === t.id)!;
    expect(row.contactName).toBe(`${contact.firstName} ${contact.lastName}`);
    expect(row.companyName).toBe(contact.companyName);
    expect(row.taskType).toBe("email");
    await tw.patchTask(db, emeka, t.id, { stage: "completed" }, row.updatedAt.toISOString());
    const rec = await cw.contactRecord(db, emeka, contact.id);
    expect(rec.tasks.find((x) => x.id === t.id)?.status).toBe("done");
  });

  it("completing on the record updates the Tasks stage, and assignment/completion notify people", async () => {
    const mgr = await actor(db, "sales.manager");
    const emeka = await actor(db, "emeka");
    const t = await createTask(db, mgr, { title: "Call back Lekki CFO", taskType: "call", ownerId: emeka.id });
    const n1 = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, emeka.id), eq(s.notifications.kind, "task.assigned")));
    expect(n1.some((n) => n.title.includes("Call back Lekki CFO"))).toBe(true);
    await completeTask(db, emeka, t.id, "Spoke to her", false);
    const row = (await tw.workspaceTasks(db, mgr)).find((x) => x.id === t.id)!;
    expect(row.stage).toBe("completed");
    const n2 = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, mgr.id), eq(s.notifications.kind, "task.completed")));
    expect(n2.length).toBeGreaterThan(0);
  });

  it("follow-up tasks from logged activities carry a type and link back to the contact", async () => {
    const emeka = await actor(db, "emeka");
    const contact = (await cw.workspaceContacts(db, emeka))[0];
    await logActivity(db, emeka, { type: "call", subject: "Outbound call", outcome: "No answer", contactId: contact.id, followUpTitle: "Call: Follow up: try again", followUpDue: "2026-10-28T09:00" });
    const t = (await tw.workspaceTasks(db, emeka)).find((x) => x.title === "Follow up: try again")!;
    expect(t.taskType).toBe("call");
    expect(t.contactId).toBe(contact.id);
  });

  it("people outside a task can't see or edit it", async () => {
    const mgr = await actor(db, "sales.manager");
    const trainer = await actor(db, "trainer");
    const t = await createTask(db, mgr, { title: "Private manager task" });
    expect((await tw.workspaceTasks(db, trainer)).some((x) => x.id === t.id)).toBe(false);
    await expect(tw.patchTask(db, trainer, t.id, { stage: "completed" }, t.updatedAt.toISOString())).rejects.toThrow();
  });
});
