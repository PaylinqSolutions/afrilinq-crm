import type { BusinessCalendar, SlaTarget } from "@/db/schema";

/**
 * Business-hours arithmetic in an arbitrary IANA time zone (default Africa/Lagos).
 * Works on wall-clock time via Intl, so it handles zones with DST as well as fixed offsets.
 */

type Parts = { y: number; m: number; d: number; hh: number; mm: number; weekday: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, tz: string): Parts & { ss: number } {
  const p: Record<string, string> = {};
  for (const x of formatter(tz).formatToParts(date)) p[x.type] = x.value;
  return {
    y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, weekday: WD[p.weekday],
  };
}

function offsetMs(date: Date, tz: string) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `tz` to a UTC instant. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (s: string) => s.split(":").map(Number) as [number, number];
export const localDateKey = (p: { y: number; m: number; d: number }) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

function nextDayStart(p: Parts, tz: string) {
  const n = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  return zonedToUtc(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, 0, tz);
}

function dayWindow(p: Parts, cal: BusinessCalendar): [Date, Date] | null {
  if (!cal.workdays.includes(p.weekday)) return null;
  if (cal.holidays.includes(localDateKey(p))) return null;
  const [sh, sm] = hm(cal.start);
  const [eh, em] = hm(cal.end);
  return [zonedToUtc(p.y, p.m, p.d, sh, sm, cal.timezone), zonedToUtc(p.y, p.m, p.d, eh, em, cal.timezone)];
}

export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  let remaining = minutes;
  let cursor = new Date(start);
  for (let guard = 0; guard < 800; guard++) {
    const p = zonedParts(cursor, cal.timezone);
    const win = dayWindow(p, cal);
    if (!win || cursor >= win[1]) { cursor = nextDayStart(p, cal.timezone); continue; }
    if (cursor < win[0]) cursor = win[0];
    const avail = (win[1].getTime() - cursor.getTime()) / 60000;
    if (remaining <= avail) return new Date(cursor.getTime() + remaining * 60000);
    remaining -= avail;
    cursor = nextDayStart(p, cal.timezone);
  }
  throw new Error("Business calendar has no working time in the next 800 days");
}

export function businessMinutesBetween(a: Date, b: Date, cal: BusinessCalendar): number {
  if (b <= a) return 0;
  let total = 0;
  let cursor = new Date(a);
  for (let guard = 0; guard < 2000 && cursor < b; guard++) {
    const p = zonedParts(cursor, cal.timezone);
    const win = dayWindow(p, cal);
    const next = nextDayStart(p, cal.timezone);
    if (win) {
      const s = Math.max(cursor.getTime(), win[0].getTime());
      const e = Math.min(b.getTime(), win[1].getTime());
      if (e > s) total += (e - s) / 60000;
    }
    cursor = next;
  }
  return Math.round(total);
}

export function addTargetMinutes(start: Date, minutes: number, target: Pick<SlaTarget, "businessHours">, cal: BusinessCalendar) {
  return target.businessHours ? addBusinessMinutes(start, minutes, cal) : new Date(start.getTime() + minutes * 60000);
}

export function elapsedTargetMinutes(a: Date, b: Date, target: Pick<SlaTarget, "businessHours">, cal: BusinessCalendar) {
  return target.businessHours ? businessMinutesBetween(a, b, cal) : Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

export function computeDueDates(createdAt: Date, target: SlaTarget, cal: BusinessCalendar) {
  return {
    firstResponseDueAt: addTargetMinutes(createdAt, target.firstResponseMins, target, cal),
    resolutionDueAt: addTargetMinutes(createdAt, target.resolutionMins, target, cal),
  };
}

export type SlaClockState = "met" | "breached" | "warning" | "escalate" | "ok" | "paused";

export type SlaClock = {
  metric: "first_response" | "resolution";
  dueAt: Date | null;
  completedAt: Date | null;
  state: SlaClockState;
  elapsedPct: number;
  remainingMins: number;
};

/**
 * Evaluates one SLA clock. `start` is when the clock began (ticket creation), `due` the current due date
 * (already extended for any pauses), `done` when the metric was satisfied.
 */
export function evaluateClock(
  metric: SlaClock["metric"], start: Date, due: Date | null, done: Date | null, now: Date,
  target: SlaTarget, cal: BusinessCalendar, pausedSince: Date | null,
): SlaClock {
  if (!due) return { metric, dueAt: null, completedAt: done, state: "ok", elapsedPct: 0, remainingMins: 0 };
  const total = Math.max(1, elapsedTargetMinutes(start, due, target, cal));
  const at = done ?? pausedSince ?? now;
  const used = elapsedTargetMinutes(start, at, target, cal);
  const elapsedPct = Math.round((used / total) * 100);
  const remainingMins = at < due ? elapsedTargetMinutes(at, due, target, cal) : -elapsedTargetMinutes(due, at, target, cal);
  let state: SlaClockState;
  if (done) state = done <= due ? "met" : "breached";
  else if (at >= due) state = "breached";
  else if (pausedSince) state = "paused";
  else if (elapsedPct >= target.escalateAtPct) state = "escalate";
  else if (elapsedPct >= target.warnAtPct) state = "warning";
  else state = "ok";
  return { metric, dueAt: due, completedAt: done, state, elapsedPct, remainingMins };
}

export function formatMinutes(mins: number): string {
  const neg = mins < 0;
  let m = Math.abs(Math.round(mins));
  const d = Math.floor(m / 1440); m -= d * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  const s = [d ? `${d}d` : "", h ? `${h}h` : "", !d && m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
  return neg ? `-${s}` : s;
}
