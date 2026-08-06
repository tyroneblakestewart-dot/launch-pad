import type { PaidLaunchPath } from "@/lib/plan-payments";

export const SUBSCRIPTION_PLANS = ["pro", "pro-bundle"] as const satisfies readonly PaidLaunchPath[];
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_BILLING_PERIODS = ["monthly", "upfront"] as const;
export type SubscriptionBillingPeriod = (typeof SUBSCRIPTION_BILLING_PERIODS)[number];

export const SUBSCRIPTION_STATUSES = ["active", "expiring", "expired"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionReminderKind = "five_days" | "two_days" | "expiry";

export const SUBSCRIPTION_MONTHLY_DAYS = 32;
export const SUBSCRIPTION_UPFRONT_DAYS = 96;
export const SUBSCRIPTION_EXPIRING_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type SubscriptionPurchaseDefinition = {
  plan: SubscriptionPlan;
  billingPeriod: SubscriptionBillingPeriod;
  usdCents: number;
  windowDays: number;
};

export const SUBSCRIPTION_PURCHASES: Record<
  SubscriptionPlan,
  Record<SubscriptionBillingPeriod, SubscriptionPurchaseDefinition>
> = {
  pro: {
    monthly: { plan: "pro", billingPeriod: "monthly", usdCents: 5_000, windowDays: 32 },
    upfront: { plan: "pro", billingPeriod: "upfront", usdCents: 12_000, windowDays: 96 },
  },
  "pro-bundle": {
    monthly: { plan: "pro-bundle", billingPeriod: "monthly", usdCents: 12_000, windowDays: 32 },
    upfront: { plan: "pro-bundle", billingPeriod: "upfront", usdCents: 28_800, windowDays: 96 },
  },
};

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === "string" && (SUBSCRIPTION_PLANS as readonly string[]).includes(value);
}

export function isSubscriptionBillingPeriod(value: unknown): value is SubscriptionBillingPeriod {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_BILLING_PERIODS as readonly string[]).includes(value)
  );
}

export function subscriptionPurchaseDefinition(
  plan: SubscriptionPlan,
  billingPeriod: SubscriptionBillingPeriod,
): SubscriptionPurchaseDefinition {
  return SUBSCRIPTION_PURCHASES[plan][billingPeriod];
}

export function addSubscriptionDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * DAY_MS);
}

export function calculateSubscriptionWindow(input: {
  now: Date;
  currentPaidUntil: Date | null;
  billingPeriod: SubscriptionBillingPeriod;
}): { paidFrom: Date; paidUntil: Date; windowDays: number } {
  const windowDays = input.billingPeriod === "upfront"
    ? SUBSCRIPTION_UPFRONT_DAYS
    : SUBSCRIPTION_MONTHLY_DAYS;
  const paidFrom =
    input.currentPaidUntil && input.currentPaidUntil.getTime() > input.now.getTime()
      ? input.currentPaidUntil
      : input.now;
  return {
    paidFrom,
    paidUntil: addSubscriptionDays(paidFrom, windowDays),
    windowDays,
  };
}

export function subscriptionDaysRemaining(paidUntil: Date | string | null, now = new Date()): number {
  if (!paidUntil) return 0;
  const expiry = paidUntil instanceof Date ? paidUntil : new Date(paidUntil);
  const remaining = expiry.getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.ceil(remaining / DAY_MS);
}

export function subscriptionStatusAt(
  paidUntil: Date | string | null,
  now = new Date(),
): SubscriptionStatus {
  if (!paidUntil) return "expired";
  const expiry = paidUntil instanceof Date ? paidUntil : new Date(paidUntil);
  const remaining = expiry.getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) return "expired";
  return remaining <= SUBSCRIPTION_EXPIRING_DAYS * DAY_MS ? "expiring" : "active";
}

export function dueSubscriptionReminder(
  paidUntil: Date | string,
  now = new Date(),
): SubscriptionReminderKind | null {
  const remaining = subscriptionDaysRemaining(paidUntil, now);
  if (remaining === 5) return "five_days";
  if (remaining === 2) return "two_days";
  if (remaining === 0 && new Date(paidUntil).getTime() <= now.getTime()) return "expiry";
  return null;
}

export function subscriptionPlanLabel(plan: SubscriptionPlan): string {
  return plan === "pro-bundle" ? "Pro Bundle" : "Pro";
}
