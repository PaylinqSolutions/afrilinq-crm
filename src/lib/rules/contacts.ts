/** Contact pipeline vocabulary. Keys are stored; labels are what staff see. */
export const CONTACT_LEAD_STATUSES = [
  { key: "new", label: "New" }, { key: "open", label: "Open" }, { key: "in_progress", label: "In progress" }, { key: "open_deal", label: "Open deal" },
  { key: "attempted", label: "Attempted to contact" }, { key: "connected", label: "Connected" }, { key: "call_back", label: "Call back" },
  { key: "bad_timing", label: "Bad timing" }, { key: "has_solution", label: "Already has a solution" }, { key: "dropped_call", label: "Dropped call" },
  { key: "not_connected", label: "Not connected" }, { key: "not_interested", label: "Not interested" }, { key: "unqualified", label: "Unqualified" },
] as const;

export const LIFECYCLE_STAGES = [
  { key: "subscriber", label: "Subscriber" }, { key: "lead", label: "Lead" }, { key: "mql", label: "Marketing qualified lead" },
  { key: "sql", label: "Sales qualified lead" }, { key: "opportunity", label: "Opportunity" }, { key: "customer", label: "Customer" },
  { key: "evangelist", label: "Evangelist" }, { key: "other", label: "Other" },
] as const;

/** Suggested sources; staff can add new ones inline and they become selectable for everyone. */
export const DEFAULT_REFERRAL_SOURCES = ["Website", "Referral", "Cold call", "Trade show", "District meeting", "Partner", "Social media", "Webinar", "Walk-in"];

export const CALL_OUTCOMES = ["Busy", "Connected", "Left live message", "Left voicemail", "Meeting booked", "No answer", "Wrong number"];

export const leadStatusLabel = (k: string | null | undefined) => (k ? CONTACT_LEAD_STATUSES.find((s) => s.key === k)?.label ?? k : null);
export const lifecycleLabel = (k: string | null | undefined) => (k ? LIFECYCLE_STAGES.find((s) => s.key === k)?.label ?? k : null);

/** Normalises a phone number to international format for Nigeria-first data; returns null when it can't be a phone number. */
export function normalisePhone(raw: string, defaultCountry = "234"): { value: string; valid: boolean } {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return { value: "", valid: false };
  let n = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : digits.startsWith("0") ? defaultCountry + digits.slice(1) : digits.length === 10 && defaultCountry === "234" ? defaultCountry + digits : digits;
  n = n.replace(/\D/g, "");
  const valid = n.length >= 10 && n.length <= 15;
  if (n.startsWith("234") && n.length === 13) return { value: `+234-${n.slice(3, 6)}-${n.slice(6, 9)}-${n.slice(9)}`, valid };
  return { value: `+${n}`, valid };
}
