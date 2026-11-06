/**
 * Relative date ranges for filters ("This quarter so far", "Next 30 days", …), computed from a
 * YYYY-MM-DD "today" in the organisation's time zone. Ranges are inclusive [start, end] date keys.
 * Fiscal periods use a configurable fiscal-year start month (default January).
 */
export type DateRange = { start: string; end: string };
export type Preset = { key: string; label: string; hint: string; group: string; range: (today: string, fyStartMonth: number) => DateRange };

const p2 = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
const parse = (k: string) => new Date(`${k}T00:00:00Z`);
const add = (k: string, days: number) => { const d = parse(k); d.setUTCDate(d.getUTCDate() + days); return key(d); };
const ymd = (y: number, m: number, d: number) => key(new Date(Date.UTC(y, m, d))); // m is 0-based, overflow-safe
const weekStart = (k: string) => { const d = parse(k); const dow = (d.getUTCDay() + 6) % 7; return add(k, -dow); }; // Monday
function monthRange(k: string, offset: number): DateRange { const d = parse(k); const y = d.getUTCFullYear(), m = d.getUTCMonth() + offset; return { start: ymd(y, m, 1), end: ymd(y, m + 1, 0) }; }
function quarterRange(k: string, offset: number, startMonth = 0): DateRange {
  const d = parse(k); const rel = (d.getUTCMonth() - startMonth + 12) % 12; const qStart = d.getUTCMonth() - (rel % 3) + offset * 3;
  return { start: ymd(d.getUTCFullYear(), qStart, 1), end: ymd(d.getUTCFullYear(), qStart + 3, 0) };
}
function yearRange(k: string, offset: number, startMonth = 0): DateRange {
  const d = parse(k); const y = d.getUTCFullYear() - (d.getUTCMonth() < startMonth ? 1 : 0) + offset;
  return { start: ymd(y, startMonth, 1), end: ymd(y + 1, startMonth, 0) };
}
const soFar = (r: DateRange, today: string): DateRange => ({ start: r.start, end: today });

export const DATE_PRESETS: Preset[] = [
  { key: "today", label: "Today", hint: "All of today", group: "Day", range: (t) => ({ start: t, end: t }) },
  { key: "yesterday", label: "Yesterday", hint: "The previous day", group: "Day", range: (t) => ({ start: add(t, -1), end: add(t, -1) }) },
  { key: "tomorrow", label: "Tomorrow", hint: "The next day", group: "Day", range: (t) => ({ start: add(t, 1), end: add(t, 1) }) },
  { key: "this_week", label: "This week", hint: "Monday to Sunday of the current week", group: "Week", range: (t) => ({ start: weekStart(t), end: add(weekStart(t), 6) }) },
  { key: "this_week_so_far", label: "This week so far", hint: "The current week up to today", group: "Week", range: (t) => ({ start: weekStart(t), end: t }) },
  { key: "last_week", label: "Last week", hint: "The previous calendar week", group: "Week", range: (t) => ({ start: add(weekStart(t), -7), end: add(weekStart(t), -1) }) },
  { key: "next_week", label: "Next week", hint: "The next calendar week", group: "Week", range: (t) => ({ start: add(weekStart(t), 7), end: add(weekStart(t), 13) }) },
  { key: "this_month", label: "This month", hint: "The current calendar month", group: "Month", range: (t) => monthRange(t, 0) },
  { key: "this_month_so_far", label: "This month so far", hint: "The current month up to today", group: "Month", range: (t) => soFar(monthRange(t, 0), t) },
  { key: "last_month", label: "Last month", hint: "The previous calendar month", group: "Month", range: (t) => monthRange(t, -1) },
  { key: "next_month", label: "Next month", hint: "The next calendar month", group: "Month", range: (t) => monthRange(t, 1) },
  { key: "this_quarter", label: "This quarter", hint: "The current calendar quarter", group: "Quarter", range: (t) => quarterRange(t, 0) },
  { key: "this_quarter_so_far", label: "This quarter so far", hint: "The current quarter up to today", group: "Quarter", range: (t) => soFar(quarterRange(t, 0), t) },
  { key: "last_quarter", label: "Last quarter", hint: "The previous full quarter", group: "Quarter", range: (t) => quarterRange(t, -1) },
  { key: "next_quarter", label: "Next quarter", hint: "The next full quarter", group: "Quarter", range: (t) => quarterRange(t, 1) },
  { key: "this_fiscal_quarter", label: "This fiscal quarter", hint: "The current fiscal quarter", group: "Fiscal", range: (t, fy) => quarterRange(t, 0, fy) },
  { key: "last_fiscal_quarter", label: "Last fiscal quarter", hint: "The previous fiscal quarter", group: "Fiscal", range: (t, fy) => quarterRange(t, -1, fy) },
  { key: "next_fiscal_quarter", label: "Next fiscal quarter", hint: "The next fiscal quarter", group: "Fiscal", range: (t, fy) => quarterRange(t, 1, fy) },
  { key: "this_year", label: "This year", hint: "The current calendar year", group: "Year", range: (t) => yearRange(t, 0) },
  { key: "this_year_so_far", label: "This year so far", hint: "The current year up to today", group: "Year", range: (t) => soFar(yearRange(t, 0), t) },
  { key: "last_year", label: "Last year", hint: "The previous calendar year", group: "Year", range: (t) => yearRange(t, -1) },
  { key: "next_year", label: "Next year", hint: "The next calendar year", group: "Year", range: (t) => yearRange(t, 1) },
  { key: "this_fiscal_year", label: "This fiscal year", hint: "The current fiscal year", group: "Fiscal", range: (t, fy) => yearRange(t, 0, fy) },
  { key: "last_fiscal_year", label: "Last fiscal year", hint: "The previous fiscal year", group: "Fiscal", range: (t, fy) => yearRange(t, -1, fy) },
  ...[7, 14, 30, 60, 90, 180, 365].map((n) => ({ key: `last_${n}`, label: `Last ${n} days`, hint: `The ${n} days before today`, group: "Rolling", range: (t: string) => ({ start: add(t, -n), end: add(t, -1) }) })),
  ...[7, 14, 30, 60, 90].map((n) => ({ key: `next_${n}`, label: `Next ${n} days`, hint: `The ${n} days after today`, group: "Rolling", range: (t: string) => ({ start: add(t, 1), end: add(t, n) }) })),
];

export type DateFilter = { op: "is" | "before" | "after" | "between" | "known" | "unknown" | "overdue"; preset?: string; from?: string; to?: string };

export function describeDateFilter(f: DateFilter | null) {
  if (!f) return "";
  if (f.op === "is") return DATE_PRESETS.find((p) => p.key === f.preset)?.label ?? "";
  if (f.op === "before") return `before ${f.from}`;
  if (f.op === "after") return `after ${f.from}`;
  if (f.op === "between") return `${f.from} → ${f.to}`;
  if (f.op === "overdue") return "in the past";
  return f.op === "known" ? "is known" : "is unknown";
}

/** Does the date (ISO string or YYYY-MM-DD) satisfy the filter? */
export function matchDate(value: string | null | undefined, f: DateFilter | null, today: string, fyStartMonth = 0) {
  if (!f) return true;
  if (f.op === "known") return !!value;
  if (f.op === "unknown") return !value;
  if (!value) return false;
  const d = value.slice(0, 10);
  if (f.op === "overdue") return d < today;
  if (f.op === "before") return !!f.from && d < f.from;
  if (f.op === "after") return !!f.from && d > f.from;
  if (f.op === "between") return !!f.from && !!f.to && d >= f.from && d <= f.to;
  const p = DATE_PRESETS.find((x) => x.key === f.preset);
  if (!p) return true;
  const r = p.range(today, fyStartMonth);
  return d >= r.start && d <= r.end;
}
