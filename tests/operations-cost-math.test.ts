import { describe, expect, it } from "vitest";
import {
  computeMarginPercent,
  elapsedSecondsInUtcMonth,
  elapsedSecondsToday,
  fixedCostForLastMonth,
  monthlyEquivalentUsd,
  previousUtcMonthBounds,
  proratedFixedCostForThisMonthSoFar,
  proratedFixedCostForTodaySoFar,
  secondsInUtcMonth,
  utcDayBounds,
  utcMonthBounds,
} from "@/lib/operations-cost-math";

describe("utcDayBounds / utcMonthBounds", () => {
  it("returns the inclusive UTC day start and exclusive next-day end", () => {
    const { start, end } = utcDayBounds(new Date("2026-03-15T13:45:00.000Z"));
    expect(start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
  });

  it("returns the inclusive UTC month start and exclusive next-month end", () => {
    const { start, end } = utcMonthBounds(new Date("2026-03-15T13:45:00.000Z"));
    expect(start.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("handles December -> January month rollover", () => {
    const { start, end } = utcMonthBounds(new Date("2026-12-25T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("previousUtcMonthBounds", () => {
  it("returns the prior calendar month", () => {
    const { start, end } = previousUtcMonthBounds(new Date("2026-03-15T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("handles January -> December rollover across a year boundary", () => {
    const { start, end } = previousUtcMonthBounds(new Date("2026-01-15T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("elapsedSecondsToday / elapsedSecondsInUtcMonth / secondsInUtcMonth", () => {
  it("computes elapsed seconds since UTC midnight today", () => {
    expect(elapsedSecondsToday(new Date("2026-03-15T01:00:00.000Z"))).toBe(3600);
  });

  it("computes elapsed seconds since the start of the UTC month", () => {
    // 14 full days + 1 hour into the 15th.
    expect(elapsedSecondsInUtcMonth(new Date("2026-03-15T01:00:00.000Z"))).toBe(14 * 86_400 + 3_600);
  });

  it("computes the exact number of seconds in a 31-day and a 28-day month", () => {
    expect(secondsInUtcMonth(new Date("2026-03-01T00:00:00.000Z"))).toBe(31 * 86_400);
    expect(secondsInUtcMonth(new Date("2026-02-01T00:00:00.000Z"))).toBe(28 * 86_400);
  });
});

describe("monthlyEquivalentUsd", () => {
  it("passes monthly amounts through unchanged", () => {
    expect(monthlyEquivalentUsd(20, "monthly")).toBe(20);
  });

  it("divides annual amounts by 12", () => {
    expect(monthlyEquivalentUsd(120, "annual")).toBe(10);
  });
});

describe("fixed-cost proration", () => {
  const now = new Date("2026-03-15T12:00:00.000Z"); // 31-day month, 14.5 days elapsed

  it("accrues today's share at a constant per-second rate across the whole month", () => {
    const monthlyEquivalentTotalUsd = 31; // $1/day if spread evenly across 31 days
    const secondsToday = elapsedSecondsToday(now);
    const expected = (monthlyEquivalentTotalUsd / (31 * 86_400)) * secondsToday;
    expect(proratedFixedCostForTodaySoFar(monthlyEquivalentTotalUsd, now)).toBeCloseTo(expected, 10);
    // At exactly noon, that's half a day's worth of the $1/day rate.
    expect(proratedFixedCostForTodaySoFar(monthlyEquivalentTotalUsd, now)).toBeCloseTo(0.5, 6);
  });

  it("accrues this month's share proportional to elapsed time in the month", () => {
    const monthlyEquivalentTotalUsd = 310;
    const result = proratedFixedCostForThisMonthSoFar(monthlyEquivalentTotalUsd, now);
    const expectedFraction = elapsedSecondsInUtcMonth(now) / secondsInUtcMonth(now);
    expect(result).toBeCloseTo(monthlyEquivalentTotalUsd * expectedFraction, 6);
  });

  it("returns 0 for both today and this-month proration at the exact start of the month", () => {
    const monthStart = new Date("2026-03-01T00:00:00.000Z");
    expect(proratedFixedCostForTodaySoFar(100, monthStart)).toBe(0);
    expect(proratedFixedCostForThisMonthSoFar(100, monthStart)).toBe(0);
  });

  it("returns the full monthly-equivalent total for a completed past month, never prorated", () => {
    expect(fixedCostForLastMonth(123.45)).toBe(123.45);
  });
});

describe("computeMarginPercent", () => {
  it("returns null when revenue is zero or negative, never a misleading percentage", () => {
    expect(computeMarginPercent(0, 50)).toBeNull();
    expect(computeMarginPercent(-10, 50)).toBeNull();
  });

  it("computes margin percentage from revenue and total cost", () => {
    expect(computeMarginPercent(100, 40)).toBeCloseTo(60, 6);
    expect(computeMarginPercent(100, 120)).toBeCloseTo(-20, 6);
  });
});
