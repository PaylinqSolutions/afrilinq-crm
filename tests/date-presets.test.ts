import { describe, it, expect } from "vitest";
import { DATE_PRESETS, matchDate } from "@/lib/date-presets";

const r = (k: string, today = "2026-10-26", fy = 0) => DATE_PRESETS.find((p) => p.key === k)!.range(today, fy);

describe("relative date ranges", () => {
  it("computes weeks from Monday", () => {
    expect(r("this_week")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // 26 Oct 2026 is a Monday
    expect(r("last_week")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(r("this_week", "2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // Sunday
  });
  it("computes months, quarters and years including year boundaries", () => {
    expect(r("last_month")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(r("next_month", "2026-12-15")).toEqual({ start: "2027-01-01", end: "2027-01-31" });
    expect(r("this_quarter")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(r("next_quarter")).toEqual({ start: "2027-01-01", end: "2027-03-31" });
    expect(r("last_quarter", "2026-02-10")).toEqual({ start: "2025-10-01", end: "2025-12-31" });
    expect(r("this_year_so_far")).toEqual({ start: "2026-01-01", end: "2026-10-26" });
  });
  it("supports a fiscal year starting in April", () => {
    expect(r("this_fiscal_year", "2026-02-10", 3)).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(r("this_fiscal_quarter", "2026-10-26", 3)).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(r("this_fiscal_quarter", "2026-05-02", 3)).toEqual({ start: "2026-04-01", end: "2026-06-30" });
  });
  it("matches operators", () => {
    expect(matchDate("2026-10-20T10:00:00Z", { op: "is", preset: "last_7" }, "2026-10-26")).toBe(true);
    expect(matchDate("2026-10-26", { op: "is", preset: "last_7" }, "2026-10-26")).toBe(false);
    expect(matchDate("2026-10-01", { op: "before", from: "2026-10-02" }, "2026-10-26")).toBe(true);
    expect(matchDate(null, { op: "unknown" }, "2026-10-26")).toBe(true);
    expect(matchDate("2026-10-25", { op: "overdue" }, "2026-10-26")).toBe(true);
    expect(matchDate("2026-11-05", { op: "between", from: "2026-11-01", to: "2026-11-30" }, "2026-10-26")).toBe(true);
  });
});
