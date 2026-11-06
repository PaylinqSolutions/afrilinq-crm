import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_HEALTH, type HealthConfig } from "@/lib/rules/health";
import { setOrgTimezone } from "@/lib/format";

export type AppSettings = {
  orgName: string;
  timezone: string;
  currency: string;
  currencies: string[];
  locale: string;
  staleDealDays: number;
  idleLeadDays: number;
  idleLeadEscalateDays: number;
  discountApprovalThreshold: number;
  renewalNoticeDays: number;
  goLiveTrainingWindowDays: number;
  csatOnClose: boolean;
  resolvedAutoCloseDays: number;
  health: HealthConfig;
  ticketRouting: { autoAssign: boolean; defaultTeam: string; categoryTeam: Record<string, string>; tierTeam: Record<string, string> };
  duplicateWindowDays: number;
  monthlySalesTarget: number;
  billing: BillingDetails;
};
export type BillingDetails = {
  legalName: string; address: string; email: string; phone: string; rcNumber: string; tin: string; website: string;
  vatRate: number; paymentTermsDays: number; quoteValidityDays: number;
  bankName: string; accountName: string; accountNumber: string; footer: string; signatoryName: string; signatoryTitle: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  orgName: "Afrilinq Technologies",
  timezone: "Africa/Lagos",
  currency: "NGN",
  currencies: ["NGN", "USD", "GHS", "KES"],
  locale: "en-NG",
  staleDealDays: 14,
  idleLeadDays: 5,
  idleLeadEscalateDays: 10,
  discountApprovalThreshold: 10,
  renewalNoticeDays: 60,
  goLiveTrainingWindowDays: 14,
  csatOnClose: true,
  resolvedAutoCloseDays: 5,
  health: DEFAULT_HEALTH,
  ticketRouting: {
    autoAssign: true,
    defaultTeam: "Customer Support",
    categoryTeam: {
      "Integration": "Technical Support", "Performance & Availability": "Technical Support", "Functional Defect": "Technical Support",
      "Data & Reporting": "Technical Support",
    },
    tierTeam: {},
  },
  duplicateWindowDays: 14,
  monthlySalesTarget: 150_000_000,
  billing: {
    legalName: "Afrilinq Technologies Limited", address: "12 Admiralty Way, Lekki Phase 1, Lagos, Nigeria", email: "billing@afrilinq.example", phone: "+234 1 700 0000",
    rcNumber: "RC 0000000", tin: "00000000-0001", website: "afrilinq.example", vatRate: 7.5, paymentTermsDays: 14, quoteValidityDays: 30,
    bankName: "Example Bank Plc", accountName: "Afrilinq Technologies Limited", accountNumber: "0000000000",
    footer: "Thank you for your business. Please quote the invoice number as your payment reference.", signatoryName: "Head of Customer Success", signatoryTitle: "For Afrilinq Technologies Limited",
  },
};

export async function getSettings(db: Executor): Promise<AppSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "app"));
  const stored = (row?.value as Partial<AppSettings>) ?? {};
  const value = { ...DEFAULT_SETTINGS, ...stored, billing: { ...DEFAULT_SETTINGS.billing, ...(stored.billing ?? {}) } };
  setOrgTimezone(value.timezone);
  return value;
}

export async function saveSettings(db: Executor, value: AppSettings) {
  await db.insert(settings).values({ key: "app", value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
