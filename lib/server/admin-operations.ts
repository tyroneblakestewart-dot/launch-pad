import { createPublicClient, formatEther, http } from "viem";
import {
  type AdminHealthCheck,
  type AdminMoneySnapshot,
  type AdminOperationsIssue,
  type AdminOperationsSnapshot,
  type AdminServiceKey,
  type AdminSiteStats,
} from "@/lib/admin-operations";
import {
  ROBINHOOD_TESTNET,
  ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
} from "@/lib/chains";
import {
  getFactoryAddress,
  HOODLUMS_TOKEN_FACTORY_ABI,
} from "@/lib/factory-config";
import { getAdminOperationsStore } from "@/lib/server/admin-operations-store";
import { getPostgresPool } from "@/lib/server/postgres";
import { getSystemHealth } from "@/lib/server/system-health";

const OPERATIONS_TIMEOUT_MS = 6_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(timeoutMessage)),
      OPERATIONS_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getSiteStats(): Promise<AdminSiteStats> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) {
    return {
      status: "unavailable",
      total: 0,
      live: 0,
      draft: 0,
      message: "DATABASE_URL is not configured.",
    };
  }

  try {
    const result = await withTimeout(
      getPostgresPool(databaseUrl).query<{
        total: number | string;
        live: number | string;
        draft: number | string;
      }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE visibility = 'live')::int AS live,
           COUNT(*) FILTER (WHERE visibility = 'draft')::int AS draft
         FROM published_sites`,
      ),
      "Published-site statistics timed out.",
    );
    const row = result.rows[0];
    return {
      status: "ready",
      total: Number(row?.total || 0),
      live: Number(row?.live || 0),
      draft: Number(row?.draft || 0),
      message: "Live counts from Postgres.",
    };
  } catch {
    return {
      status: "unavailable",
      total: 0,
      live: 0,
      draft: 0,
      message: "Published-site statistics could not be loaded.",
    };
  }
}

async function getActiveAdminSessionCount(): Promise<number | null> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return null;
  try {
    const result = await withTimeout(
      getPostgresPool(databaseUrl).query<{ active: number | string }>(
        `SELECT COUNT(*)::int AS active
           FROM admin_sessions
          WHERE expires_at > NOW()`,
      ),
      "Admin-session count timed out.",
    );
    return Number(result.rows[0]?.active || 0);
  } catch {
    return null;
  }
}

async function getMoneySnapshot(): Promise<AdminMoneySnapshot> {
  const chainLabel = "Robinhood Chain Testnet";
  const factoryAddress = getFactoryAddress(
    ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  );
  if (!factoryAddress) {
    return {
      status: "unavailable",
      chainLabel,
      launchFee: "—",
      launchCount: "—",
      feeRecipient: "—",
      feeRecipientBalance: "—",
      message: "No factory address is configured for this chain.",
    };
  }

  try {
    const rpcUrl = ROBINHOOD_TESTNET.rpcUrls[0];
    const client = createPublicClient({
      chain: {
        id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
        name: chainLabel,
        nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
        rpcUrls: { default: { http: [rpcUrl] } },
      },
      transport: http(rpcUrl),
    });

    const [launchFee, launchCount, feeRecipient] = await withTimeout(
      Promise.all([
        client.readContract({
          address: factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "launchFee",
        }),
        client.readContract({
          address: factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "launchCount",
        }),
        client.readContract({
          address: factoryAddress,
          abi: HOODLUMS_TOKEN_FACTORY_ABI,
          functionName: "feeRecipient",
        }),
      ]),
      "Factory money snapshot timed out.",
    );
    const balance = await withTimeout(
      client.getBalance({ address: feeRecipient }),
      "Fee-recipient balance timed out.",
    );

    return {
      status: "ready",
      chainLabel,
      launchFee: `${formatEther(launchFee)} ${ROBINHOOD_TESTNET.nativeCurrency.symbol}`,
      launchCount: launchCount.toString(),
      feeRecipient,
      feeRecipientBalance: `${formatEther(balance)} ${ROBINHOOD_TESTNET.nativeCurrency.symbol}`,
      message:
        "Live factory values. The wallet balance is not an audited revenue total and may include unrelated funds.",
    };
  } catch {
    return {
      status: "unavailable",
      chainLabel,
      launchFee: "—",
      launchCount: "—",
      feeRecipient: factoryAddress,
      feeRecipientBalance: "—",
      message: "Live factory money data could not be read from the chain.",
    };
  }
}

function healthServiceKey(
  check: AdminHealthCheck,
): AdminServiceKey | null {
  return check.id === "website-generation" ? "website-generation" : null;
}

function buildIssues(input: {
  health: AdminHealthCheck[];
  services: AdminOperationsSnapshot["services"];
  money: AdminMoneySnapshot;
  sectionErrors: string[];
}): AdminOperationsIssue[] {
  const issues: AdminOperationsIssue[] = [];

  for (const check of input.health) {
    if (check.status === "green") continue;
    issues.push({
      id: `health:${check.id}`,
      severity: check.status,
      title: check.label,
      message: check.message,
      source: "health",
      serviceKey: healthServiceKey(check),
    });
  }

  for (const service of input.services) {
    if (!service.isolated) continue;
    issues.push({
      id: `isolation:${service.key}`,
      severity: "amber",
      title: `${service.label} is isolated`,
      message: service.reason || "This service has been manually isolated.",
      source: "isolation",
      serviceKey: service.key,
    });
  }

  if (input.money.status === "unavailable") {
    issues.push({
      id: "operations:money",
      severity: "amber",
      title: "Money data unavailable",
      message: input.money.message,
      source: "operations",
      serviceKey: null,
    });
  }

  input.sectionErrors.forEach((message, index) => {
    issues.push({
      id: `operations:${index}`,
      severity: "red",
      title: "Admin operations data unavailable",
      message,
      source: "operations",
      serviceKey: null,
    });
  });

  return issues;
}

export type AdminOperationsSnapshotDeps = {
  requestOidcToken?: string;
};

/**
 * Builds every admin section independently. A failure in activity, money or
 * service controls is returned as a section error instead of blanking the
 * rest of the dashboard.
 */
export async function getAdminOperationsSnapshot(
  deps: AdminOperationsSnapshotDeps = {},
): Promise<AdminOperationsSnapshot> {
  const store = getAdminOperationsStore();
  const [healthResult, servicesResult, activityResult, sitesResult, sessionsResult, moneyResult] =
    await Promise.allSettled([
      getSystemHealth({ requestOidcToken: deps.requestOidcToken }),
      store.listServiceControls(),
      store.listActivity(40),
      getSiteStats(),
      getActiveAdminSessionCount(),
      getMoneySnapshot(),
    ]);

  const sectionErrors: string[] = [];
  const health =
    healthResult.status === "fulfilled"
      ? (healthResult.value as AdminHealthCheck[])
      : [];
  if (healthResult.status === "rejected") {
    sectionErrors.push("System Health could not be loaded.");
  }

  const services =
    servicesResult.status === "fulfilled" ? servicesResult.value : [];
  if (servicesResult.status === "rejected") {
    sectionErrors.push(
      "Service isolation controls could not be loaded. Apply the latest database migration.",
    );
  }

  const activity =
    activityResult.status === "fulfilled" ? activityResult.value : [];
  if (activityResult.status === "rejected") {
    sectionErrors.push(
      "Admin activity could not be loaded. Apply the latest database migration.",
    );
  }

  const sites =
    sitesResult.status === "fulfilled"
      ? sitesResult.value
      : {
          status: "unavailable" as const,
          total: 0,
          live: 0,
          draft: 0,
          message: "Published-site statistics could not be loaded.",
        };
  const activeAdminSessions =
    sessionsResult.status === "fulfilled" ? sessionsResult.value : null;
  const money =
    moneyResult.status === "fulfilled"
      ? moneyResult.value
      : {
          status: "unavailable" as const,
          chainLabel: "Robinhood Chain Testnet",
          launchFee: "—",
          launchCount: "—",
          feeRecipient: "—",
          feeRecipientBalance: "—",
          message: "Money data could not be loaded.",
        };

  const issues = buildIssues({ health, services, money, sectionErrors });

  return {
    checkedAt: new Date().toISOString(),
    health,
    services,
    activity,
    sites,
    activeAdminSessions,
    money,
    issues,
    sectionErrors,
  };
}
