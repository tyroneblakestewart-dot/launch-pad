import type {
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/lib/subscription-lifecycle";

export const ADMIN_ACCOUNT_SECTIONS = [
  "timeline",
  "payments",
  "reminders",
  "tokens",
  "sites",
  "hoodchat",
  "reports",
] as const;

export type AdminAccountSectionId = (typeof ADMIN_ACCOUNT_SECTIONS)[number];

export type AdminAccountSearchItem = {
  walletAddress: string;
  telegramUsername: string | null;
  tier: string | null;
  status: SubscriptionStatus | "active" | "free";
  paidUntil: string | null;
  paymentCount: number;
  siteCount: number;
};

export type AdminAccountSearchResponse = {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: AdminAccountSearchItem[];
};

export type AdminAccountSummary = {
  walletAddress: string;
  exists: boolean;
  subscription: {
    plan: SubscriptionPlan | null;
    tier: string | null;
    status: SubscriptionStatus;
    active: boolean;
    paidFrom: string | null;
    paidUntil: string | null;
    daysRemaining: number;
    lastPaymentAsset: string | null;
    lastPaymentAmount: string | null;
  };
  telegram: {
    linked: boolean;
    username: string | null;
    userId: string | null;
    chatId: string | null;
    linkedAt: string | null;
  };
  counts: {
    payments: number;
    reminders: number;
    tokensLaunched: number;
    sitesPublished: number;
    hoodchatMessages: number;
    tokenChatMessages: number;
    reportedMessages: number;
    reportsAgainst: number;
    hiddenMessages: number;
  };
};

export type AdminAccountRecord = {
  id: string;
  kind:
    | "subscription"
    | "payment"
    | "reminder"
    | "token"
    | "site"
    | "hoodchat"
    | "token-chat"
    | "report";
  title: string;
  detail: string;
  occurredAt: string;
  transactionHash: string | null;
  metadata: Array<{ label: string; value: string }>;
};

export type AdminAccountSectionResponse = {
  walletAddress: string;
  section: AdminAccountSectionId;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: AdminAccountRecord[];
};

export function isAdminAccountSectionId(value: unknown): value is AdminAccountSectionId {
  return (
    typeof value === "string" &&
    (ADMIN_ACCOUNT_SECTIONS as readonly string[]).includes(value)
  );
}
