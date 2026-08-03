import { createPublicClient, http } from "viem";
import { getBondingCurveAddress, HOODLUMS_BONDING_CURVE_READ_ABI } from "@/lib/bonding-curve-config";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getFactoryAddress, HOODLUMS_TOKEN_FACTORY_ABI } from "@/lib/factory-config";
import { resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { getPostgresPool } from "@/lib/server/postgres";

export type SystemHealthStatus = "green" | "amber" | "red";

export type SystemHealthCheck = {
  id: "website-generation" | "database" | "contracts" | "deployment" | "subscribers";
  label: string;
  status: SystemHealthStatus;
  message: string;
};

export const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Reports whether an AI generation provider is configured, without ever
 * spending money on a real OpenAI/gateway call — this check may be polled
 * repeatedly from the dashboard, so it must stay free.
 *
 * `requestOidcToken` must be threaded through from the incoming admin
 * request (`getVercelOidcToken(request)`). In production, generation
 * authenticates via the automatic per-request `x-vercel-oidc-token` header,
 * not a `VERCEL_OIDC_TOKEN` environment variable — checking `env` alone
 * reported "not configured" even while real generation requests succeeded.
 */
export function checkWebsiteGenerationHealth(
  env: Record<string, string | undefined> = process.env,
  requestOidcToken = "",
): SystemHealthCheck {
  const id = "website-generation" as const;
  const label = "Website generation";
  try {
    const runtime = resolveAIResponsesRuntime(env, requestOidcToken);
    if (!runtime) {
      return { id, label, status: "amber", message: "No AI generation provider is configured." };
    }
    return { id, label, status: "green", message: `Ready via ${runtime.source} (${runtime.model}).` };
  } catch {
    return { id, label, status: "red", message: "Website generation health check failed unexpectedly." };
  }
}

export type DatabasePing = () => Promise<unknown>;

export async function checkDatabaseHealth(deps: {
  databaseUrl?: string;
  ping?: DatabasePing;
} = {}): Promise<SystemHealthCheck> {
  const id = "database" as const;
  const label = "Database";
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: "DATABASE_URL is not configured." };
  }
  const ping = deps.ping ?? (() => getPostgresPool(databaseUrl).query("SELECT 1"));
  try {
    await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Database health check timed out.");
    return { id, label, status: "green", message: "Postgres connection is alive." };
  } catch {
    return { id, label, status: "red", message: "Postgres connection failed." };
  }
}

export type ContractReader = () => Promise<unknown>;

export async function checkContractsHealth(deps: {
  chainId?: number;
  rpcUrl?: string;
  factoryAddress?: `0x${string}` | undefined;
  bondingCurveAddress?: `0x${string}` | undefined;
  readFactory?: ContractReader;
  readBondingCurve?: ContractReader;
} = {}): Promise<SystemHealthCheck> {
  const id = "contracts" as const;
  const label = "On-chain contracts";
  try {
    const chainId = deps.chainId ?? ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL;
    const factoryAddress = deps.factoryAddress ?? getFactoryAddress(chainId);
    const bondingCurveAddress = deps.bondingCurveAddress ?? getBondingCurveAddress(chainId);

    const targets: Array<{ name: string; read: ContractReader }> = [];

    if (deps.readFactory) {
      targets.push({ name: "factory", read: deps.readFactory });
    } else if (factoryAddress) {
      targets.push({
        name: "factory",
        read: () =>
          contractsClient(chainId, deps.rpcUrl).readContract({
            address: factoryAddress,
            abi: HOODLUMS_TOKEN_FACTORY_ABI,
            functionName: "owner",
          }),
      });
    }

    if (deps.readBondingCurve) {
      targets.push({ name: "bonding curve", read: deps.readBondingCurve });
    } else if (bondingCurveAddress) {
      targets.push({
        name: "bonding curve",
        read: () =>
          contractsClient(chainId, deps.rpcUrl).readContract({
            address: bondingCurveAddress,
            abi: HOODLUMS_BONDING_CURVE_READ_ABI,
            functionName: "funded",
          }),
      });
    }

    if (targets.length === 0) {
      return {
        id,
        label,
        status: "amber",
        message: "No factory or bonding curve address is configured for this chain.",
      };
    }

    const outcomes = await Promise.all(
      targets.map(async (target) => {
        try {
          await withTimeout(target.read(), HEALTH_CHECK_TIMEOUT_MS, "timed out");
          return { name: target.name, ok: true };
        } catch {
          return { name: target.name, ok: false };
        }
      }),
    );

    const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.name);
    const healthy = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.name);

    if (failed.length === 0) {
      return { id, label, status: "green", message: `${healthy.join(" and ")} responded to a read call.` };
    }
    if (healthy.length === 0) {
      return { id, label, status: "red", message: `${failed.join(" and ")} did not respond to a read call.` };
    }
    return {
      id,
      label,
      status: "amber",
      message: `${failed.join(" and ")} did not respond; ${healthy.join(" and ")} is healthy.`,
    };
  } catch {
    return { id, label, status: "red", message: "On-chain contracts health check failed unexpectedly." };
  }
}

export function contractsClient(chainId: number, rpcUrl: string | undefined) {
  const resolvedRpcUrl = rpcUrl ?? ROBINHOOD_TESTNET.rpcUrls[0];
  return createPublicClient({
    chain: {
      id: chainId,
      name: "Robinhood Chain Testnet",
      nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
      rpcUrls: { default: { http: [resolvedRpcUrl] } },
    },
    transport: http(resolvedRpcUrl),
  });
}

/**
 * Reports whether the current server process is a healthy deployment. If
 * this code is executing at all, the process serving the request is up; the
 * check's job is to flag when production is missing the Vercel deployment
 * metadata it should always have.
 */
export function checkDeploymentHealth(
  env: Record<string, string | undefined> = process.env,
): SystemHealthCheck {
  const id = "deployment" as const;
  const label = "Deployment";
  try {
    if (env.NODE_ENV !== "production") {
      return { id, label, status: "green", message: "Local development server is running." };
    }
    const vercelEnv = env.VERCEL_ENV?.trim();
    if (!vercelEnv) {
      return {
        id,
        label,
        status: "red",
        message: "Production runtime is missing Vercel deployment metadata (VERCEL_ENV unset).",
      };
    }
    const commit = env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7);
    return {
      id,
      label,
      status: "green",
      message: commit ? `Live on ${vercelEnv} (commit ${commit}).` : `Live on ${vercelEnv}.`,
    };
  } catch {
    return { id, label, status: "red", message: "Deployment health check failed unexpectedly." };
  }
}

export type SubscribersPing = () => Promise<unknown>;

/** Reports whether the `subscriptions` table backing the admin Subscribers section is reachable. */
export async function checkSubscribersHealth(deps: {
  databaseUrl?: string;
  ping?: SubscribersPing;
} = {}): Promise<SystemHealthCheck> {
  const id = "subscribers" as const;
  const label = "Subscribers";
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl && !deps.ping) {
    return { id, label, status: "amber", message: "DATABASE_URL is not configured." };
  }
  const ping = deps.ping ?? (() => getPostgresPool(databaseUrl).query("SELECT 1 FROM subscriptions LIMIT 1"));
  try {
    await withTimeout(ping(), HEALTH_CHECK_TIMEOUT_MS, "Subscribers table health check timed out.");
    return { id, label, status: "green", message: "The subscriptions table is reachable." };
  } catch {
    return {
      id,
      label,
      status: "red",
      message: "The subscriptions table is not reachable. Apply migration 007_subscriptions.sql.",
    };
  }
}

export type SystemHealthDeps = {
  env?: Record<string, string | undefined>;
  requestOidcToken?: string;
  database?: Parameters<typeof checkDatabaseHealth>[0];
  contracts?: Parameters<typeof checkContractsHealth>[0];
  subscribers?: Parameters<typeof checkSubscribersHealth>[0];
};

/**
 * Runs every check concurrently. Each check function fully contains its own
 * failures (never rejects), so one failing/slow check can never take down
 * the others or the response as a whole.
 */
export async function getSystemHealth(deps: SystemHealthDeps = {}): Promise<SystemHealthCheck[]> {
  const [websiteGeneration, database, contracts, deployment, subscribers] = await Promise.all([
    checkWebsiteGenerationHealth(deps.env, deps.requestOidcToken),
    checkDatabaseHealth(deps.database),
    checkContractsHealth(deps.contracts),
    checkDeploymentHealth(deps.env),
    checkSubscribersHealth(deps.subscribers),
  ]);
  return [websiteGeneration, database, contracts, deployment, subscribers];
}
