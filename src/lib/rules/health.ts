import type { HealthComponent } from "@/db/schema";

export type HealthWeights = {
  onboarding: number; tickets: number; overdue: number; training: number; engagement: number; satisfaction: number;
};
export type HealthConfig = { weights: HealthWeights; atRiskBelow: number; watchBelow: number; engagementStaleDays: number };

export const DEFAULT_HEALTH: HealthConfig = {
  weights: { onboarding: 20, tickets: 25, overdue: 15, training: 15, engagement: 15, satisfaction: 10 },
  atRiskBelow: 50, watchBelow: 70, engagementStaleDays: 30,
};

export type HealthInput = {
  onboardingProgress: number | null; // 0-100, null = no active onboarding
  onboardingRisk: string | null;
  openP1P2: number; openOther: number; slaBreaches90d: number;
  overdueActions: number;
  trainingRequired: number; trainingCompleted: number;
  daysSinceLastContact: number | null;
  avgCsat: number | null; // 1-5
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Explainable score: each component is 0–100 with a human-readable reason, combined by configured weights. */
export function computeHealth(i: HealthInput, cfg: HealthConfig = DEFAULT_HEALTH) {
  const w = cfg.weights;
  const comps: HealthComponent[] = [];

  if (i.onboardingProgress === null) {
    comps.push({ key: "onboarding", label: "Onboarding", score: 100, weight: w.onboarding, detail: "No active onboarding project" });
  } else {
    const penalty = i.onboardingRisk === "high" ? 40 : i.onboardingRisk === "medium" ? 15 : 0;
    comps.push({
      key: "onboarding", label: "Onboarding", score: clamp(i.onboardingProgress - penalty + 20), weight: w.onboarding,
      detail: `${i.onboardingProgress}% complete, ${i.onboardingRisk ?? "low"} risk`,
    });
  }
  comps.push({
    key: "tickets", label: "Support load", weight: w.tickets,
    score: clamp(100 - i.openP1P2 * 35 - i.openOther * 8 - i.slaBreaches90d * 10),
    detail: `${i.openP1P2} open P1/P2, ${i.openOther} other open, ${i.slaBreaches90d} SLA breach(es) in 90 days`,
  });
  comps.push({
    key: "overdue", label: "Overdue actions", weight: w.overdue, score: clamp(100 - i.overdueActions * 20),
    detail: `${i.overdueActions} overdue task(s) or milestone(s)`,
  });
  comps.push({
    key: "training", label: "Training completion", weight: w.training,
    score: i.trainingRequired ? clamp((i.trainingCompleted / i.trainingRequired) * 100) : 100,
    detail: i.trainingRequired ? `${i.trainingCompleted}/${i.trainingRequired} required participants trained` : "No required training recorded",
  });
  const d = i.daysSinceLastContact;
  comps.push({
    key: "engagement", label: "Engagement recency", weight: w.engagement,
    score: d === null ? 30 : clamp(100 - Math.max(0, d - 7) * (70 / cfg.engagementStaleDays)),
    detail: d === null ? "No logged contact" : `Last meaningful contact ${d} day(s) ago`,
  });
  comps.push({
    key: "satisfaction", label: "Satisfaction (CSAT)", weight: w.satisfaction,
    score: i.avgCsat === null ? 70 : clamp(((i.avgCsat - 1) / 4) * 100),
    detail: i.avgCsat === null ? "No CSAT responses yet (neutral 70 used)" : `Average CSAT ${i.avgCsat.toFixed(1)} / 5`,
  });

  const totalW = comps.reduce((s, c) => s + c.weight, 0) || 1;
  const score = clamp(comps.reduce((s, c) => s + c.score * c.weight, 0) / totalW);
  const status = score < cfg.atRiskBelow ? "at_risk" : score < cfg.watchBelow ? "watch" : "healthy";
  return { score, status, components: comps };
}

export const healthLabel = (s: string) => (s === "at_risk" ? "At Risk" : s === "watch" ? "Watch" : "Healthy");
