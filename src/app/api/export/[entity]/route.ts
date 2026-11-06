import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { getActor } from "@/server/session";
import { can } from "@/server/actor";
import { audit } from "@/server/audit";
import { listLeads, listDeals } from "@/server/services/sales";
import { listCompanies, listContacts } from "@/server/services/accounts";
import { listTickets } from "@/server/services/tickets";
import { ticketRef } from "@/lib/format";

const csv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r) => r.map((v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");

/** Permission-checked, scope-filtered CSV export. Every export is audit-logged. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!can(actor, "data.export")) return NextResponse.json({ error: "Export requires the data.export permission" }, { status: 403 });
  const { entity } = await params;
  const db = await getDb();
  const f = Object.fromEntries(req.nextUrl.searchParams.entries());
  let rows: (string | number | null | undefined)[][];
  if (entity === "leads") {
    const r = await listLeads(db, actor, { ...f, page: "1" });
    const all = (await Promise.all(Array.from({ length: Math.ceil(r.total / 25) }, (_, i) => listLeads(db, actor, { ...f, page: String(i + 1) })))).flatMap((x) => x.rows);
    rows = [["Lead", "Organisation", "Contact", "Status", "Source", "Owner", "Next action", "Created"], ...all.map((l) => [l.name, l.organization, l.contactName, l.status, l.source, l.ownerName, l.nextAction, l.createdAt.toISOString()])];
  } else if (entity === "deals") {
    const r = await listDeals(db, actor, f, true);
    rows = [["Deal", "Company", "Stage", "Value", "Currency", "Probability", "Expected close", "Owner"], ...r.rows.map((d) => [d.name, d.companyName, d.stageName, d.amount, d.currency, d.effectiveProbability, d.expectedCloseDate, d.ownerName])];
  } else if (entity === "companies") {
    const r = await listCompanies(db, actor, f, true);
    rows = [["Company", "Industry", "Segment", "Tier", "Lifecycle", "Region", "City", "Owner"], ...r.rows.map((c) => [c.name, c.industry, c.segment, c.tier, c.lifecycle, c.region, c.city, c.ownerName])];
  } else if (entity === "contacts") {
    const r = await listContacts(db, actor, f, true);
    rows = [["First name", "Last name", "Company", "Title", "Email", "Phone", "Roles"], ...r.rows.map((c) => [c.firstName, c.lastName, c.companyName, c.jobTitle, c.email, c.phone, c.contactRoles.join("; ")])];
  } else if (entity === "tickets") {
    const r = await listTickets(db, actor, f);
    rows = [["Ticket", "Subject", "Customer", "Priority", "Status", "Owner", "Created", "Resolved"], ...r.all.map((t) => [ticketRef(t.t.number), t.t.subject, t.companyName, t.t.priority, t.t.status, t.ownerName, t.t.createdAt.toISOString(), t.t.resolvedAt?.toISOString()])];
  } else return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  await audit(db, actor, "data.exported", "export", entity, { rows: { from: null, to: rows.length - 1 } }, JSON.stringify(f).slice(0, 300));
  return new NextResponse(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="afrilinq-${entity}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
