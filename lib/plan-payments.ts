import type { LaunchPath } from "@/lib/types";
import {
  isSubscriptionBillingPeriod,
  isSubscriptionPlan,
  subscriptionPurchaseDefinition,
  type SubscriptionBillingPeriod,
  type SubscriptionStatus,
} from "@/lib/subscription-lifecycle";

export const PAID_LAUNCH_PATHS = [
  "bond-pro-site",
  "pro",
  "pro-bundle",
] as const satisfies readonly LaunchPath[];

export type PaidLaunchPath = (typeof PAID_LAUNCH_PATHS)[number];
export type PaymentSubscriptionTier = "bond_pro_site" | "pro" | "pro_bundle";
export type PaymentKind = "one_off" | "subscription";
export type PaymentDestination = "builder" | "subscription-confirmation";
export type PaymentAsset = "ETH" | "USDT";
export type PaymentBillingPeriod = "one_off" | SubscriptionBillingPeriod;

export type PlanPaymentDefinition = {
  id: PaidLaunchPath;
  label: string;
  kind: PaymentKind;
  subscriptionTier: PaymentSubscriptionTier;
  destination: PaymentDestination;
  nativeAmountWeiEnvironmentKey?: "HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI";
};

export const PLAN_PAYMENT_DEFINITIONS: Record<PaidLaunchPath, PlanPaymentDefinition> = {
  "bond-pro-site": {
    id: "bond-pro-site",
    label: "Bond + Pro Site",
    kind: "one_off",
    subscriptionTier: "bond_pro_site",
    destination: "builder",
    nativeAmountWeiEnvironmentKey: "HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI",
  },
  pro: {
    id: "pro",
    label: "Pro",
    kind: "subscription",
    subscriptionTier: "pro",
    destination: "subscription-confirmation",
  },
  "pro-bundle": {
    id: "pro-bundle",
    label: "Pro Bundle",
    kind: "subscription",
    subscriptionTier: "pro_bundle",
    destination: "subscription-confirmation",
  },
};

export type PlanPaymentQuote = {
  plan: PaidLaunchPath;
  label: string;
  billingPeriod: PaymentBillingPeriod;
  subscriptionDays: number | null;
  usdCents: number;
  asset: PaymentAsset;
  amountAtomic: `0x${string}`;
  amountDisplay: string;
  treasuryAddress: `0x${string}`;
  tokenAddress: `0x${string}` | null;
  tokenDecimals: number | null;
  transactionTo: `0x${string}`;
  transactionValue: `0x${string}`;
  transactionData: `0x${string}`;
  chainId: number;
  chainIdHex: `0x${string}`;
  chainName: string;
  rpcUrl: string;
  explorerBaseUrl: string;
};

export type PlanPaymentVerification = {
  verified: true;
  plan: PaidLaunchPath;
  billingPeriod: PaymentBillingPeriod;
  walletAddress: `0x${string}`;
  transactionHash: `0x${string}`;
  asset: PaymentAsset;
  amountDisplay: string;
  amountEth: string | null;
  usdCents: number;
  paidFrom: string | null;
  paidUntil: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  destination: PaymentDestination;
  alreadyRecorded: boolean;
  telegramLinkUrl: string | null;
};

export function isPaidLaunchPath(value: unknown): value is PaidLaunchPath {
  return (
    typeof value === "string" &&
    (PAID_LAUNCH_PATHS as readonly string[]).includes(value)
  );
}

export function planPaymentDefinition(plan: PaidLaunchPath): PlanPaymentDefinition {
  return PLAN_PAYMENT_DEFINITIONS[plan];
}

export function resolvePaymentBillingPeriod(
  plan: PaidLaunchPath,
  value: unknown,
): PaymentBillingPeriod {
  if (!isSubscriptionPlan(plan)) return "one_off";
  return isSubscriptionBillingPeriod(value) ? value : "monthly";
}

export function paymentCatalogPrice(
  plan: PaidLaunchPath,
  billingPeriod: PaymentBillingPeriod,
): { usdCents: number; subscriptionDays: number | null } {
  if (plan === "bond-pro-site") return { usdCents: 1_000, subscriptionDays: null };
  const period = billingPeriod === "upfront" ? "upfront" : "monthly";
  const purchase = subscriptionPurchaseDefinition(plan, period);
  return { usdCents: purchase.usdCents, subscriptionDays: purchase.windowDays };
}

export function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}
