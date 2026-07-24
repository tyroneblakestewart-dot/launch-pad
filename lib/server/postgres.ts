import { Pool } from "pg";

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
 * Returns a small serverless-safe pool keyed by the exact DATABASE_URL. The
 * connection string is read only on the server and is never logged.
 */
export function getPostgresPool(databaseUrl: string): Pool {
  const pools = poolRegistry();
  const existing = pools.get(databaseUrl);
  if (existing) return existing;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  pools.set(databaseUrl, pool);
  return pool;
}
