"use server";

import { act, all, bool, num, optional, str, type ActionResult } from "@/server/action";
import { assertCan } from "@/server/actor";
import * as admin from "@/server/services/admin";
import { runAllSweeps } from "@/server/services/sweep";
import { testIntegration } from "@/server/services/integrations";
import { TICKET_STATUSES } from "@/lib/rules/tickets";
import type { SlaTarget } from "@/db/schema";

type A = ActionResult | null;

export async function runSweepAction(_: A, __: FormData) {
  return act(async (actor, db) => {
    assertCan(actor, "tickets.approve_escalation", "admin.sla", "admin.workflows");
    const r = await runAllSweeps(db);
    return `Checked ${r.sla.checked} open ticket(s): ${r.sla.warnings} warning(s), ${r.sla.escalations} escalation(s), ${r.sla.breaches} breach(es). Automations: ${r.automation.overdueTasks} overdue task(s), ${r.automation.staleDeals} stale deal(s), ${r.automation.projects} project(s) re-scored.`;
  }, ["/tickets", "/"]);
}

export async function inviteAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    const r = await admin.inviteUser(db, actor, { email: str(fd, "email"), name: str(fd, "name"), roleId: str(fd, "roleId"), teamId: optional(fd, "teamId") });
    return { message: `Invitation created. Email delivery is not configured — share this one-time link securely: ${r.url}`, data: { url: r.url } };
  }, ["/settings/users"]);
}
export async function revokeInviteAction(id: string) {
  return act(async (actor, db) => { await admin.revokeInvitation(db, actor, id); return "Invitation revoked."; }, ["/settings/users"]);
}
export async function setUserRolesAction(userId: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    await admin.setUserRoles(db, actor, userId, all(fd, "roleIds"));
    await admin.updateUser(db, actor, userId, { teamId: optional(fd, "teamId"), managerId: optional(fd, "managerId"), title: optional(fd, "title"), active: bool(fd, "active") });
    return "User updated (audit-logged).";
  }, ["/settings/users"]);
}
export async function createTeamAction(_: A, fd: FormData) {
  return act(async (actor, db) => { await admin.createTeam(db, actor, str(fd, "name"), str(fd, "kind")); return "Team created."; }, ["/settings/users"]);
}
export async function setRolePermsAction(roleId: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await admin.setRolePermissions(db, actor, roleId, all(fd, "perm")); return "Permissions saved (audit-logged)."; }, ["/settings/roles"]);
}
export async function updateStageAction(stageId: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    await admin.updateStage(db, actor, stageId, { name: str(fd, "name"), probability: num(fd, "probability") ?? 0, requiredFields: all(fd, "requiredFields"), entryCriteria: optional(fd, "entryCriteria"), exitCriteria: optional(fd, "exitCriteria"), staleAfterDays: num(fd, "staleAfterDays") ?? 14 });
    return "Stage saved.";
  }, ["/settings/pipelines", "/deals"]);
}
export async function updateSlaAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => {
    const targets: Record<string, SlaTarget> = {};
    for (const p of ["P1", "P2", "P3", "P4"]) targets[p] = {
      firstResponseMins: num(fd, `${p}_fr`) ?? 0, resolutionMins: num(fd, `${p}_res`) ?? 0, updateMins: num(fd, `${p}_upd`) ?? 0,
      businessHours: bool(fd, `${p}_bh`), warnAtPct: num(fd, `${p}_warn`) ?? 50, escalateAtPct: num(fd, `${p}_esc`) ?? 75,
    };
    await admin.updateSlaPolicy(db, actor, id, {
      name: str(fd, "name"), description: optional(fd, "description"), active: bool(fd, "active"), automatedAckCountsAsResponse: bool(fd, "automatedAck"),
      pauseStatuses: all(fd, "pauseStatuses").filter((s) => TICKET_STATUSES.some((t) => t.key === s)),
      calendar: { timezone: str(fd, "timezone"), start: str(fd, "start"), end: str(fd, "end"), workdays: all(fd, "workdays").map(Number), holidays: str(fd, "holidays").split(/[\s,]+/).filter(Boolean) },
      targets,
    }, optional(fd, "_version"));
    return "SLA policy saved. New and recalculated tickets use these targets.";
  }, ["/settings/sla", "/tickets"]);
}
export async function updateSettingsAction(_: A, fd: FormData) {
  return act(async (actor, db) => {
    const { getSettings } = await import("@/server/settings");
    const cur = await getSettings(db);
    await admin.updateAppSettings(db, actor, {
      orgName: str(fd, "orgName") || cur.orgName, timezone: str(fd, "timezone") || cur.timezone, currency: str(fd, "currency") || cur.currency,
      currencies: str(fd, "currencies").split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase()),
      staleDealDays: num(fd, "staleDealDays") ?? cur.staleDealDays, idleLeadDays: num(fd, "idleLeadDays") ?? cur.idleLeadDays, idleLeadEscalateDays: num(fd, "idleLeadEscalateDays") ?? cur.idleLeadEscalateDays,
      discountApprovalThreshold: num(fd, "discountApprovalThreshold") ?? cur.discountApprovalThreshold, renewalNoticeDays: num(fd, "renewalNoticeDays") ?? cur.renewalNoticeDays,
      goLiveTrainingWindowDays: num(fd, "goLiveTrainingWindowDays") ?? cur.goLiveTrainingWindowDays, csatOnClose: bool(fd, "csatOnClose"),
      monthlySalesTarget: num(fd, "monthlySalesTarget") ?? cur.monthlySalesTarget, duplicateWindowDays: num(fd, "duplicateWindowDays") ?? cur.duplicateWindowDays,
      health: {
        weights: { onboarding: num(fd, "w_onboarding") ?? 20, tickets: num(fd, "w_tickets") ?? 25, overdue: num(fd, "w_overdue") ?? 15, training: num(fd, "w_training") ?? 15, engagement: num(fd, "w_engagement") ?? 15, satisfaction: num(fd, "w_satisfaction") ?? 10 },
        atRiskBelow: num(fd, "atRiskBelow") ?? 50, watchBelow: num(fd, "watchBelow") ?? 70, engagementStaleDays: num(fd, "engagementStaleDays") ?? 30,
      },
      ticketRouting: { ...cur.ticketRouting, autoAssign: bool(fd, "autoAssign"), defaultTeam: str(fd, "defaultTeam") || cur.ticketRouting.defaultTeam },
      billing: Object.fromEntries(Object.entries(cur.billing).map(([k, v]) => {
        const raw = fd.get(`billing_${k}`);
        if (raw === null) return [k, v];
        return [k, typeof v === "number" ? (Number(String(raw).replace(/,/g, "")) || 0) : String(raw).trim()];
      })) as typeof cur.billing,
    });
    return "Settings saved (audit-logged).";
  }, ["/settings", "/"]);
}
export async function addCustomFieldAction(_: A, fd: FormData) {
  return act(async (actor, db) => { await admin.addCustomField(db, actor, { entityType: str(fd, "entityType"), label: str(fd, "label"), fieldType: str(fd, "fieldType"), options: str(fd, "options").split(",").map((o) => o.trim()).filter(Boolean), required: bool(fd, "required") }); return "Custom field added."; }, ["/settings/fields"]);
}
export async function deleteCustomFieldAction(id: string) {
  return act(async (actor, db) => { await admin.deleteCustomField(db, actor, id); return "Custom field removed."; }, ["/settings/fields"]);
}
export async function updateRuleAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await admin.updateRule(db, actor, id, { enabled: bool(fd, "enabled"), name: str(fd, "name"), conditionsJson: str(fd, "conditions"), actionsJson: str(fd, "actions") }); return "Rule saved."; }, ["/settings/workflows"]);
}
export async function retryRunAction(runId: string) {
  return act(async (actor, db) => { const r = await admin.retryWorkflowRun(db, actor, runId); return { ok: r.ok, message: r.message }; }, ["/settings/workflows"]);
}
export async function testIntegrationAction(kind: string) {
  return act(async (actor, db) => { const r = await testIntegration(db, actor, kind); return { ok: r.status === "connected", message: r.result }; }, ["/settings/integrations"]);
}
export async function saveTemplateAction(id: string | null, _: A, fd: FormData) {
  return act(async (actor, db) => {
    // One task per line: Title | stage_key | offset days | milestone(y/n) | customer(y/n) | depends on line number
    const tasks = str(fd, "tasks").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0]).map((p) => ({
      title: p[0], stageKey: p[1] || "configuration", offsetDays: Number(p[2]) || 0, isMilestone: /^y/i.test(p[3] ?? ""), customerResponsibility: /^y/i.test(p[4] ?? ""), dependsOnPosition: p[5] ? Number(p[5]) : null,
    }));
    await admin.saveTemplate(db, actor, id, { name: str(fd, "name"), productId: optional(fd, "productId"), segment: optional(fd, "segment"), durationDays: num(fd, "durationDays") ?? 30, description: optional(fd, "description"), tasks });
    return "Template saved.";
  }, ["/settings/templates"]);
}
