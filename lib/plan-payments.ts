import type { LaunchPath } from "@/lib/types";

export const PAID_LAUNCH_PATHS = [
  "bond-pro-site",
  "pro",
  "pro-bundle",
] as const satisfies readonly LaunchPath[];

export type PaidLaunchPath = (typeof PAID_LAUNCH_PATHS)[number];
export type PaymentSubscriptionTier = "bond_pro_site" | "pro" | "pro_bundle";
export type PaymentKind = "one_off" | "subscription";
export type PaymentDestination = "builder" | "subscription-confirmation";

export type PlanPaymentDefinition = {
  id: PaidLaunchPath;
  label: string;
  usdCents: number;
  kind: PaymentKind;
  subscriptionTier: PaymentSubscriptionTier;
  subscriptionDays: number | null;
  destination: PaymentDestination;
  amountWeiEnvironmentKey:
    | "HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI"
    | "HOODLUMS_PRO_AMOUNT_WEI"
    | "HOODLUMS_PRO_BUNDLE_AMOUNT_WEI";
};

export const PLAN_PAYMENT_DEFINITIONS: Record<PaidLaunchPath, PlanPaymentDefinition> = {
  "bond-pro-site": {
    id: "bond-pro-site",
    label: "Bond + Pro Site",
    usdCents: 1_000,
    kind: "one_off",
    subscriptionTier: "bond_pro_site",
    subscriptionDays: null,
    destination: "builder",
    amountWeiEnvironmentKey: "HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI",
  },
  pro: {
    id: "pro",
    label: "Pro",
    usdCents: 5_000,
    kind: "subscription",
    subscriptionTier: "pro",
    subscriptionDays: 30,
    destination: "subscription-confirmation",
    amountWeiEnvironmentKey: "HOODLUMS_PRO_AMOUNT_WEI",
  },
  "pro-bundle": {
    id: "pro-bundle",
    label: "Pro Bundle",
    usdCents: 12_000,
    kind: "subscription",
    subscriptionTier: "pro_bundle",
    subscriptionDays: 30,
    destination: "subscription-confirmation",
    amountWeiEnvironmentKey: "HOODLUMS_PRO_BUNDLE_AMOUNT_WEI",
  },
};

export type PlanPaymentQuote = {
  plan: PaidLaunchPath;
  label: string;
  usdCents: number;
  amountWei: `0x${string}`;
  amountEth: string;
  treasuryAddress: `0x${string}`;
  chainId: number;
  chainIdHex: `0x${string}`;
  chainName: string;
  rpcUrl: string;
  explorerBaseUrl: string;
};

export type PlanPaymentVerification = {
  verified: true;
  plan: PaidLaunchPath;
  walletAddress: `0x${string}`;
  transactionHash: `0x${string}`;
  amountEth: string;
  usdCents: number;
  paidUntil: string | null;
  destination: PaymentDestination;
  alreadyRecorded: boolean;
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

export function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}
