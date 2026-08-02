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
  | "admin-logout";

export type AdminActivityItem = {
  id: string;
  kind: AdminActivityKind;
  serviceKey: AdminServiceKey | null;
  message: string;
  createdAt: string;
};

export type AdminHealthStatus = "green" | "amber" | "red";

export type AdminHealthCheck = {
  id: "website-generation" | "database" | "contracts" | "deployment";
  label: string;
  status: AdminHealthStatus;
  message: string;
};

export type AdminSiteStats = {
  status: "ready" | "unavailable";
  total: number;
  live: number;
  draft: number;
  message: string;
};

export type AdminMoneySnapshot = {
  status: "ready" | "unavailable";
  chainLabel: string;
  launchFee: string;
  launchCount: string;
  feeRecipient: string;
  feeRecipientBalance: string;
  message: string;
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

export function isAdminServiceKey(value: unknown): value is AdminServiceKey {
  return (
    typeof value === "string" &&
    ADMIN_SERVICE_DEFINITIONS.some((definition) => definition.key === value)
  );
}

export function adminServiceDefinition(key: AdminServiceKey) {
  return ADMIN_SERVICE_DEFINITIONS.find((definition) => definition.key === key)!;
}
