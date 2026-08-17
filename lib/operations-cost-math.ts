// Pure UTC period-boundary and fixed-cost-proration helpers for the
// Operations cost/margin cockpit (issue #368). Kept dependency-free (no
// Postgres, no env reads) so every rule here is directly unit testable and
// safe to import from both server aggregation code and tests.

export type DateRange = { start: Date; end: Date };

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function utcDayBounds(date: Date): DateRange {
  const start = utcDayStart(date);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return { start, end };
}

export function utcMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function utcMonthBounds(date: Date): DateRange {
  const start = utcMonthStart(date);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

/** The UTC calendar month immediately before the one containing `date`. */
export function previousUtcMonthBounds(date: Date): DateRange {
  const end = utcMonthStart(date);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return { start, end };
}

function secondsBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / 1000);
}

export function secondsInUtcMonth(date: Date): number {
  const { start, end } = utcMonthBounds(date);
  return secondsBetween(start, end);
}

export function elapsedSecondsToday(now: Date): number {
  return secondsBetween(utcDayStart(now), now);
}

export function elapsedSecondsInUtcMonth(now: Date): number {
  return secondsBetween(utcMonthStart(now), now);
}

export type FixedCostCadence = "monthly" | "annual";

/** Annual entries divide evenly by 12; monthly entries pass through unchanged. */
export function monthlyEquivalentUsd(amountUsd: number, cadence: FixedCostCadence): number {
  return cadence === "annual" ? amountUsd / 12 : amountUsd;
}

/**
 * Today's accrued share of a total monthly-equivalent fixed-cost pool, at a
 * constant per-second rate across the whole current UTC month (not scaled by
 * which day of the month `now` falls on).
 */
export function proratedFixedCostForTodaySoFar(monthlyEquivalentTotalUsd: number, now: Date): number {
  const secondsInMonth = secondsInUtcMonth(now);
  if (secondsInMonth <= 0) return 0;
  return (monthlyEquivalentTotalUsd / secondsInMonth) * elapsedSecondsToday(now);
}

/** This UTC calendar month's accrued share of a total monthly-equivalent fixed-cost pool, so far. */
export function proratedFixedCostForThisMonthSoFar(monthlyEquivalentTotalUsd: number, now: Date): number {
  const secondsInMonth = secondsInUtcMonth(now);
  if (secondsInMonth <= 0) return 0;
  return (monthlyEquivalentTotalUsd / secondsInMonth) * elapsedSecondsInUtcMonth(now);
}

/** A completed past month accrues its full monthly-equivalent total, never prorated. */
export function fixedCostForLastMonth(monthlyEquivalentTotalUsd: number): number {
  return monthlyEquivalentTotalUsd;
}

/** null when there is no revenue to divide by, so the UI never implies a 0%/negative margin means "no revenue". */
export function computeMarginPercent(revenueUsd: number, totalCostUsd: number): number | null {
  if (revenueUsd <= 0) return null;
  return ((revenueUsd - totalCostUsd) / revenueUsd) * 100;
}
