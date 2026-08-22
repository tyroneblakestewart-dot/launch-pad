import type { SubscriptionPlan } from "@/lib/subscription-lifecycle";

// Single source of truth for the Pro / Pro Bundle AI Social Studio
// project-slot limits (issue #407's server-side billing gap). Pro owns one
// active token-project slot; Pro Bundle owns up to three. Both the server
// entitlement wrapper and the Studio UI import this instead of hardcoding
// the numbers separately.
export const SOCIAL_PROJECT_SLOT_LIMITS: Record<SubscriptionPlan, number> = {
  pro: 1,
  "pro-bundle": 3,
};

export function socialProjectSlotLimit(plan: SubscriptionPlan): number {
  return SOCIAL_PROJECT_SLOT_LIMITS[plan];
}

/** A user may release at most one plan slot every seven days (db/migrations/028_social_project_slots.sql). */
export const SOCIAL_PROJECT_SLOT_RELEASE_COOLDOWN_DAYS = 7;

// project_id/displayName are client-generated identifiers the browser
// already uses as its local project key and name — a billing guardrail, not
// cryptographic proof that two requests describe the same project. Bounds
// only mirror the migration's CHECK constraints; ownership is never
// cryptographically provable from the id alone.
export const SOCIAL_PROJECT_ID_MAX_LENGTH = 200;
export const SOCIAL_PROJECT_DISPLAY_NAME_MAX_LENGTH = 200;

export function normaliseSocialProjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SOCIAL_PROJECT_ID_MAX_LENGTH) return null;
  return trimmed;
}

export function normaliseSocialProjectDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, SOCIAL_PROJECT_DISPLAY_NAME_MAX_LENGTH);
}

/** Plain-English 403 copy naming the plan, its limit, and the upgrade/swap choices — never just "forbidden". */
export function socialProjectSlotLimitMessage(plan: SubscriptionPlan, limit: number): string {
  const planLabel = plan === "pro-bundle" ? "Pro Bundle" : "Pro";
  const projectWord = limit === 1 ? "project" : "projects";
  const upgradeHint =
    plan === "pro"
      ? "Upgrade to Pro Bundle for up to 3 active projects, or"
      : "Free up a slot, or";
  return (
    `Your ${planLabel} plan supports ${limit} active token ${projectWord} in AI Social Studio. ` +
    `${upgradeHint} use "Use this plan slot for a different project" to swap this project into your existing slot.`
  );
}

export function socialProjectSlotCooldownMessage(nextReleaseAllowedAt: string | null): string {
  const base = `You can release at most one project slot every ${SOCIAL_PROJECT_SLOT_RELEASE_COOLDOWN_DAYS} days.`;
  if (!nextReleaseAllowedAt) return base;
  const date = new Date(nextReleaseAllowedAt);
  if (Number.isNaN(date.getTime())) return base;
  return `${base} You can release another slot after ${date.toLocaleString()}.`;
}
