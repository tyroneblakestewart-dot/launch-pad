import { Pool } from "pg";

export const DEFAULT_DATABASE_POOL_MAX = 1;
export const DATABASE_POOL_IDLE_TIMEOUT_MS = 5_000;

type DatabasePoolEnvironment = {
  DATABASE_POOL_MAX?: string;
  [key: string]: string | undefined;
};

type GlobalWithPostgresPools = typeof globalThis & {
  __hoodlumsPostgresPools?: Map<string, Pool>;
};

function poolRegistry(): Map<string, Pool> {
  const globalScope = globalThis as GlobalWithPostgresPools;
  if (!globalScope.__hoodlumsPostgresPools) {
    globalScope.__hoodlumsPostgresPools = new Map();
  }
  return globalScope.__hoodlumsPostgresPools;
}

/**
 * Reads the per-instance pool ceiling. Serverless instances multiply this
 * number, so invalid, empty, zero, and negative values deliberately fall
 * back to one instead of throwing or creating an unbounded connection fanout.
 */
export function readDatabasePoolMax(
  env: DatabasePoolEnvironment = process.env,
): number {
  const raw = env.DATABASE_POOL_MAX?.trim();
  if (!raw) return DEFAULT_DATABASE_POOL_MAX;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DATABASE_POOL_MAX;
}

/**
 * Returns a small serverless-safe pool keyed by the exact DATABASE_URL. The
 * connection string is read only on the server and is never logged.
 *
 * Deployment contract after the August 2026 max-client incident:
 * - Vercel application traffic uses Supabase's Transaction pooler on 6543.
 * - Database migrations and maintenance use the Session pooler on 5432.
 * - Do not point Vercel at the direct db.<project-ref>.supabase.co host unless
 *   IPv4 connectivity has been deliberately purchased and verified.
 */
export function getPostgresPool(
  databaseUrl: string,
  env: DatabasePoolEnvironment = process.env,
): Pool {
  const pools = poolRegistry();
  const existing = pools.get(databaseUrl);
  if (existing) return existing;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: readDatabasePoolMax(env),
    // Transaction pooling does not benefit from holding an idle client for
    // long. Five seconds releases warm-instance sessions quickly while still
    // allowing a short burst of related queries to reuse the same client.
    idleTimeoutMillis: DATABASE_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  pools.set(databaseUrl, pool);
  return pool;
}

/** Clears only the warm-instance registry; pools used by these tests never connect. */
export function resetPostgresPoolsForTests(): void {
  poolRegistry().clear();
}
