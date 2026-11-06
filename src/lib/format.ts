export const DEFAULT_TZ = "Africa/Lagos";

export function fmtMoney(n: number | null | undefined, currency = "NGN", compact = false) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-NG", {
    style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard",
  }).format(n);
}

export function fmtDate(d: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function fmtDateTime(d: Date | string | null | undefined, tz = DEFAULT_TZ) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

export function fmtRelative(d: Date | string | null | undefined, now = new Date()) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const mins = Math.round((date.getTime() - now.getTime()) / 60000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const a = Math.abs(mins);
  if (a < 60) return rtf.format(mins, "minute");
  if (a < 1440) return rtf.format(Math.round(mins / 60), "hour");
  if (a < 43200) return rtf.format(Math.round(mins / 1440), "day");
  return rtf.format(Math.round(mins / 43200), "month");
}

/** YYYY-MM-DD for "today" in the given time zone. */
export function todayIn(tz = DEFAULT_TZ, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(dateKey: string, days: number) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const fullName = (c: { firstName: string; lastName: string } | null | undefined) => (c ? `${c.firstName} ${c.lastName}` : "—");
export const ticketRef = (n: number) => `AFL-${n}`;

let orgTz = DEFAULT_TZ;
/** Called whenever settings load so naive form datetimes are read in the organisation's time zone. */
export function setOrgTimezone(tz: string) { orgTz = tz; }
export const getOrgTimezone = () => orgTz;

function parts(d: Date, tz: string) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d)) p[x.type] = x.value;
  return p;
}
/** Date → "YYYY-MM-DDTHH:mm" in tz, for <input type="datetime-local">. */
export function toLocalInput(d: Date | null | undefined, tz = orgTz) {
  if (!d) return "";
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** "YYYY-MM-DDTHH:mm" interpreted in tz → Date. Strings with an explicit offset are parsed as-is. */
export function fromLocalInput(s: string, tz = orgTz): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return new Date(s);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = (t: number) => { const p = parts(new Date(t), tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t);
}
