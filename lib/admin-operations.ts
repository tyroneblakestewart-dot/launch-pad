export const ADMIN_SERVICE_DEFINITIONS = [
  {
    key: "website-generation",
    label: "Website generation",
    description: "AI artwork analysis, site copy, styling and full-page generation.",
    affectedRoutes: "/api/generate-free-site, /api/generate-site-page, /api/generate-site-style",
  },
  {
    key: "public-publishing",
    label: "Public publishing",
    description: "Wallet challenges, publishing generated sites and changing site visibility.",
    affectedRoutes: "/api/publish/challenge, /api/publish, /api/publish/visibility",
  },
  {
    key: "market-feed",
    label: "Market feed",
    description: "The Robinhood Chain trending-token feed shown on Hoodlums pages.",
    affectedRoutes: "/api/trending-robinhood",
  },
  {
    key: "telegram-publishing",
    label: "Telegram publishing",
    description: "Owner-approved posts sent through the Telegram publishing endpoint.",
    affectedRoutes: "/api/social/telegram",
  },
  {
    key: "hoodchat",
    label: "Hoodchat",
    description: "Wallet-signed posting, reading and reporting on the main /hoodchat feed.",
    affectedRoutes: "/api/hoodchat/challenge, /api/hoodchat/messages, /api/hoodchat/report",
  },
  {
    key: "token-chat",
    label: "Token chat",
    description: "Wallet-signed posting, reading and reporting on the per-token Hoodchat tab.",
    affectedRoutes: "/api/token-chat/challenge, /api/token-chat/messages, /api/token-chat/report",
  },
] as const;

export type AdminServiceKey = (typeof ADMIN_SERVICE_DEFINITIONS)[number]["key"];

export type AdminServiceControl = {
  key: AdminServiceKey;
  label: string;
  description: string;
  affectedRoutes: string;
  isolated: boolean;
  reason: string;
  updatedAt: string;
};

export type AdminActivityKind =
  | "service-isolated"
  | "service-restored"
  | "admin-login-wallet"
  | "admin-login-password"
  | "admin-logout"
  | "page-content-published"
  | "payment-received";

export type AdminActivityItem = {
  id: string;
  kind: AdminActivityKind;
  serviceKey: AdminServiceKey | null;
  message: string;
  createdAt: string;
};

export type AdminHealthStatus = "green" | "amber" | "red";

export const SYSTEM_HEALTH_CHECK_IDS = [
  "website-generation",
  "database",
  "contracts",
  "deployment",
  "subscribers",
  "hoodchat",
  "token-chat",
] as const;

export type SystemHealthCheckId = (typeof SYSTEM_HEALTH_CHECK_IDS)[number];

export function isSystemHealthCheckId(value: unknown): value is SystemHealthCheckId {
  return typeof value === "string" && (SYSTEM_HEALTH_CHECK_IDS as readonly string[]).includes(value);
}

export type AdminHealthCheck = {
  id: SystemHealthCheckId;
  label: string;
  status: AdminHealthStatus;
  message: string;
};

export type AdminPipelineStage = {
  id: string;
  label: string;
  status: AdminHealthStatus;
  message: string;
  observedAt: string | null;
};

export type AdminServicePipeline = {
  id: SystemHealthCheckId;
  label: string;
  stages: AdminPipelineStage[];
};

export type AdminSiteStats = {
  status: "ready" | "unavailable";
  total: number;
  live: number;
  draft: number;
  message: string;
};

export type AdminRevenueEvent = {
  transactionHash: string;
  walletAddress: string;
  planId: "bond-pro-site" | "pro" | "pro-bundle";
  amountEth: string;
  amountUsdCents: number;
  paidUntil: string | null;
  confirmedAt: string;
};

export type AdminMoneySnapshot = {
  status: "ready" | "unavailable";
  chainLabel: string;
  launchFee: string;
  launchCount: string;
  feeRecipient: string;
  feeRecipientBalance: string;
  message: string;
  planRevenueStatus: "ready" | "unavailable";
  planRevenueUsdCents: number;
  planPaymentCount: number;
  recentPlanPayments: AdminRevenueEvent[];
  planRevenueMessage: string;
};

export type AdminOperationsIssue = {
  id: string;
  severity: "amber" | "red";
  title: string;
  message: string;
  source: "health" | "isolation" | "operations";
  serviceKey: AdminServiceKey | null;
};

export type AdminOperationsSnapshot = {
  checkedAt: string;
  health: AdminHealthCheck[];
  services: AdminServiceControl[];
  activity: AdminActivityItem[];
  sites: AdminSiteStats;
  activeAdminSessions: number | null;
  money: AdminMoneySnapshot;
  issues: AdminOperationsIssue[];
  sectionErrors: string[];
};

export const SUBSCRIBER_TIERS = [
  "free",
  "bond",
  "bond_site",
  "bond_pro_site",
  "pro",
  "pro_bundle",
] as const;

export type AdminSubscriberTier = (typeof SUBSCRIBER_TIERS)[number];

export const SUBSCRIBER_STATUSES = ["active", "expired", "free"] as const;

export type AdminSubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export const SUBSCRIBER_TIER_LABEL: Record<AdminSubscriberTier, string> = {
  free: "Free",
  bond: "Bond",
  bond_site: "Bond+Site",
  bond_pro_site: "Bond+Pro Site",
  pro: "Pro",
  pro_bundle: "Pro Bundle",
};

export type AdminSubscriberRow = {
  walletAddress: string;
  tier: AdminSubscriberTier;
  status: AdminSubscriberStatus;
  slugs: string[];
  xHandle: string | null;
  telegram: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  lastPaymentAmountEth: string | null;
  lastPaymentAt: string | null;
};

export type AdminSubscribersSnapshot = {
  status: "ready" | "unavailable";
  message: string;
  rows: AdminSubscriberRow[];
};

export function isAdminServiceKey(value: unknown): value is AdminServiceKey {
  return (
    typeof value === "string" &&
    ADMIN_SERVICE_DEFINITIONS.some((definition) => definition.key === value)
  );
}

export function adminServiceDefinition(key: AdminServiceKey) {
  return ADMIN_SERVICE_DEFINITIONS.find((definition) => definition.key === key)!;
}
