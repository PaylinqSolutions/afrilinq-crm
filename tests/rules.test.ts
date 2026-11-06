import { describe, it, expect } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, computeDueDates, evaluateClock, zonedToUtc } from "@/lib/rules/sla";
import { classifyPriority, validateResolution, NOT_YET_KNOWN } from "@/lib/rules/tickets";
import { validateStageEntry, type DealForValidation } from "@/lib/rules/sales";
import { handoverCompleteness, missingHandoverFields, REQUIRED_HANDOVER_KEYS } from "@/lib/rules/handover";
import { assessOnboardingRisk } from "@/lib/rules/onboarding";
import { computeHealth } from "@/lib/rules/health";
import type { BusinessCalendar, SlaTarget } from "@/db/schema";

const lagos: BusinessCalendar = { timezone: "Africa/Lagos", workdays: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", holidays: ["2026-10-01"] };
const bh = (mins: number): SlaTarget => ({ firstResponseMins: 60, resolutionMins: mins, updateMins: 120, businessHours: true, warnAtPct: 50, escalateAtPct: 75 });

describe("SLA business hours (Africa/Lagos, UTC+1)", () => {
  it("converts Lagos wall-clock time to UTC", () => {
    expect(zonedToUtc(2026, 10, 26, 8, 0, "Africa/Lagos").toISOString()).toBe("2026-10-26T07:00:00.000Z");
  });
  it("adds minutes within the same business day", () => {
    const start = new Date("2026-10-26T09:00:00Z"); // Mon 10:00 Lagos
    expect(addBusinessMinutes(start, 60, lagos).toISOString()).toBe("2026-10-26T10:00:00.000Z");
  });
  it("rolls over the end of day into the next morning", () => {
    const start = new Date("2026-10-26T15:30:00Z"); // Mon 16:30 Lagos, 30 min left
    expect(addBusinessMinutes(start, 60, lagos).toISOString()).toBe("2026-10-27T07:30:00.000Z"); // Tue 08:30 Lagos
  });
  it("skips weekends", () => {
    const start = new Date("2026-10-30T15:00:00Z"); // Fri 16:00 Lagos
    expect(addBusinessMinutes(start, 120, lagos).toISOString()).toBe("2026-11-02T08:00:00.000Z"); // Mon 09:00 Lagos
  });
  it("skips configured public holidays", () => {
    const start = new Date("2026-09-30T15:00:00Z"); // Wed 16:00 Lagos; Thu 1 Oct is a holiday
    expect(addBusinessMinutes(start, 120, lagos).toISOString()).toBe("2026-10-02T08:00:00.000Z");
  });
  it("starts the clock at opening time for tickets raised out of hours", () => {
    const start = new Date("2026-10-25T20:00:00Z"); // Sun 21:00 Lagos
    expect(addBusinessMinutes(start, 240, lagos).toISOString()).toBe("2026-10-26T11:00:00.000Z"); // Mon 12:00 Lagos
  });
  it("counts business minutes between instants", () => {
    expect(businessMinutesBetween(new Date("2026-10-30T15:00:00Z"), new Date("2026-11-02T08:00:00Z"), lagos)).toBe(120);
  });
  it("respects a different timezone and business hours", () => {
    const nairobi: BusinessCalendar = { timezone: "Africa/Nairobi", workdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", holidays: [] };
    const start = new Date("2026-10-26T05:00:00Z"); // Mon 08:00 Nairobi (UTC+3), before opening
    expect(addBusinessMinutes(start, 60, nairobi).toISOString()).toBe("2026-10-26T07:00:00.000Z"); // 10:00 Nairobi
  });
  it("uses wall-clock minutes for 24x7 (P1) targets", () => {
    const p1: SlaTarget = { firstResponseMins: 15, resolutionMins: 60, updateMins: 30, businessHours: false, warnAtPct: 50, escalateAtPct: 75 };
    const created = new Date("2026-10-25T20:00:00Z"); // Sunday night
    expect(computeDueDates(created, p1, lagos).firstResponseDueAt.toISOString()).toBe("2026-10-25T20:15:00.000Z");
  });
  it("reports warning, escalate and breach states", () => {
    const t = bh(480);
    const start = new Date("2026-10-26T07:00:00Z");
    const due = addBusinessMinutes(start, 480, lagos);
    expect(evaluateClock("resolution", start, due, null, new Date("2026-10-26T11:30:00Z"), t, lagos, null).state).toBe("warning");
    expect(evaluateClock("resolution", start, due, null, new Date("2026-10-26T13:30:00Z"), t, lagos, null).state).toBe("escalate");
    expect(evaluateClock("resolution", start, due, null, new Date("2026-10-27T09:00:00Z"), t, lagos, null).state).toBe("breached");
    expect(evaluateClock("resolution", start, due, new Date("2026-10-26T10:00:00Z"), new Date(), t, lagos, null).state).toBe("met");
  });
});

describe("priority classification", () => {
  it("does not escalate on tone; uses impact × urgency", () => {
    expect(classifyPriority({ impact: "single_user", urgency: "low" })).toBe("P4");
    expect(classifyPriority({ impact: "single_user", urgency: "medium" })).toBe("P3");
    expect(classifyPriority({ impact: "single_user", urgency: "critical" })).toBe("P2");
    expect(classifyPriority({ impact: "widespread", urgency: "critical" })).toBe("P1");
  });
  it("caps P2 at P3 when a workaround exists", () => {
    expect(classifyPriority({ impact: "multiple_users", urgency: "high", workaroundAvailable: true })).toBe("P3");
  });
  it("forces P1 for security, data and outage incidents", () => {
    expect(classifyPriority({ impact: "minimal", urgency: "low", incidentType: "data_exposure" })).toBe("P1");
  });
});

describe("resolution rules", () => {
  it("rejects resolution without summary and category", () => {
    const e = validateResolution({ priority: "P3", isIncident: false });
    expect(e.resolutionSummary).toBeTruthy();
    expect(e.resolutionCode).toBeTruthy();
  });
  it("requires root cause or 'not yet known' + owner for high impact", () => {
    const base = { priority: "P1", isIncident: true, resolutionSummary: "Restarted failed queue worker", resolutionCode: "Workaround provided" };
    expect(validateResolution(base).rootCause).toBeTruthy();
    expect(validateResolution({ ...base, rootCause: NOT_YET_KNOWN }).rootCauseFollowUpOwnerId).toBeTruthy();
    expect(validateResolution({ ...base, rootCause: NOT_YET_KNOWN, rootCauseFollowUpOwnerId: "u1" })).toEqual({});
  });
});

describe("pipeline stage gates", () => {
  const deal: DealForValidation = {
    amount: 5_000_000, expectedCloseDate: "2026-11-30", primaryContactId: "c1", nextStep: "Send proposal", nextStepDue: "2026-10-30",
    competitor: null, contractReference: null, billingFrequency: null, startDate: null, lossReason: null,
    discountPct: 0, discountStatus: "none", productCount: 1,
  };
  const won = { name: "Closed Won", isWon: true, isLost: false, requiredFields: [] };
  const lost = { name: "Closed Lost", isWon: false, isLost: true, requiredFields: [] };
  it("blocks Closed Won without commercial fields", () => {
    const e = validateStageEntry(deal, won, 10);
    expect(Object.keys(e).sort()).toEqual(["billingFrequency", "contractReference", "startDate"]);
  });
  it("blocks Closed Won with an unapproved discount above threshold", () => {
    const e = validateStageEntry({ ...deal, contractReference: "MSA-1", billingFrequency: "Annually", startDate: "2026-11-01", discountPct: 15, discountStatus: "pending" }, won, 10);
    expect(Object.keys(e)).toEqual(["discountPct"]);
  });
  it("blocks Closed Lost without a loss reason, and only that", () => {
    expect(Object.keys(validateStageEntry({ ...deal, amount: null }, lost, 10))).toEqual(["lossReason"]);
  });
  it("requires next action on open stages", () => {
    const e = validateStageEntry({ ...deal, nextStep: null, nextStepDue: null }, { name: "Qualified", isWon: false, isLost: false, requiredFields: [] }, 10);
    expect(Object.keys(e).sort()).toEqual(["nextStep", "nextStepDue"]);
  });
});

describe("handover completeness", () => {
  it("scores required fields only", () => {
    expect(handoverCompleteness({})).toBe(0);
    const all = Object.fromEntries(REQUIRED_HANDOVER_KEYS.map((k) => [k, "x"]));
    expect(handoverCompleteness(all)).toBe(100);
    expect(missingHandoverFields({ ...all, risks: "  " })).toEqual(["risks"]);
  });
});

describe("onboarding risk", () => {
  it("flags training gaps close to go-live as high risk", () => {
    const r = assessOnboardingRisk({
      today: "2026-10-26", targetGoLive: "2026-11-02", state: "active", trainingGaps: 3, trainingWindowDays: 14,
      tasks: [{ status: "done", dueDate: "2026-10-01", isMilestone: true }, { status: "todo", dueDate: "2026-11-01", isMilestone: false }],
      blockers: [],
    });
    expect(r.level).toBe("high");
    expect(r.progress).toBe(50);
  });
  it("is low with nothing overdue", () => {
    expect(assessOnboardingRisk({ today: "2026-10-26", targetGoLive: "2026-12-30", state: "active", trainingGaps: 0, trainingWindowDays: 14, tasks: [], blockers: [] }).level).toBe("low");
  });
});

describe("customer health", () => {
  it("is explainable and flags at-risk accounts", () => {
    const h = computeHealth({ onboardingProgress: 30, onboardingRisk: "high", openP1P2: 2, openOther: 3, slaBreaches90d: 2, overdueActions: 4, trainingRequired: 10, trainingCompleted: 2, daysSinceLastContact: 45, avgCsat: 2 });
    expect(h.status).toBe("at_risk");
    expect(h.components).toHaveLength(6);
    expect(h.components.every((c) => c.detail.length > 0)).toBe(true);
  });
});
