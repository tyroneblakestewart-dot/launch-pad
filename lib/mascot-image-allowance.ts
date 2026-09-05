// Pure day/allowance maths for the daily mascot-image cap, shared by the route
// (server) and the studio UI (client). UTC days, so the reset is the same
// instant for every user and matches the cost ledger's day boundaries.

import { MAX_MASCOT_IMAGES_PER_DAY } from "@/lib/social-studio-types";

export type MascotImageUsage = {
  usedToday: number;
  limit: number;
  /** ISO timestamp of the next UTC midnight — when the allowance resets. */
  resetsAt: string;
};

/** "2026-09-05" for any instant on that UTC day. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function nextUtcMidnightIso(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

export function buildMascotImageUsage(usedToday: number, now: Date = new Date(), limit: number = MAX_MASCOT_IMAGES_PER_DAY): MascotImageUsage {
  return { usedToday: Math.max(0, Math.floor(usedToday)), limit, resetsAt: nextUtcMidnightIso(now) };
}

export function isMascotImageAllowanceUsed(usage: MascotImageUsage | null | undefined): boolean {
  return Boolean(usage && usage.usedToday >= usage.limit);
}

/** "1/2 AI images" — the rail pill's text. */
export function describeMascotImageAllowance(usage: MascotImageUsage | null | undefined): string {
  if (!usage) return `0/${MAX_MASCOT_IMAGES_PER_DAY} AI images`;
  return `${Math.min(usage.usedToday, usage.limit)}/${usage.limit} AI images`;
}

/** The line under the Generate button. */
export function describeMascotImageAllowanceDetail(usage: MascotImageUsage | null | undefined): string {
  if (!usage) return `${MAX_MASCOT_IMAGES_PER_DAY} mascot images a day per token · resets at midnight UTC`;
  if (usage.usedToday >= usage.limit) return `${usage.limit}/${usage.limit} used today — resets at midnight UTC`;
  return `${usage.usedToday}/${usage.limit} mascot images used today · resets at midnight UTC`;
}
