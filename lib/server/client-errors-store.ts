import { getPostgresPool } from "@/lib/server/postgres";

// Data-only store for client-side crash reports (issue #353). Origin/rate-limit
// checks and sanitisation happen in the API route before recordError is
// called. Grouping is by exact (message, route_path) — both are already
// sanitised/truncated before they reach here, so the same underlying crash
// produces a stable group key across occurrences.

export type ClientErrorInput = {
  message: string;
  stack: string | null;
  routePath: string;
  walletAddress: string | null;
  userAgent: string | null;
  viewportWidth: number | null;
  buildId: string | null;
};

export type ClientErrorGroup = {
  message: string;
  routePath: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  distinctWallets: number;
  representativeStack: string | null;
  buildId: string | null;
};

export type ClientErrorsSnapshot = {
  status: "ready" | "unavailable";
  message: string;
  groups: ClientErrorGroup[];
};

export type ResolveGroupResult = "resolved" | "not_found";

export interface ClientErrorStore {
  recordError(input: ClientErrorInput): Promise<void>;
  /** Unresolved groups only — a group reappears once a fresh occurrence lands after it was resolved. */
  listGroups(limit?: number): Promise<ClientErrorsSnapshot>;
  resolveGroup(message: string, routePath: string): Promise<ResolveGroupResult>;
  /** Groups whose very first occurrence ever fell within the window — used by the System Health "at a glance" check. */
  countNewGroupsSince(since: Date): Promise<number>;
}

export class ClientErrorStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for client-error reporting.");
    this.name = "ClientErrorStoreUnavailableError";
  }
}

const unconfiguredStore: ClientErrorStore = {
  async recordError() {
    throw new ClientErrorStoreUnavailableError();
  },
  async listGroups() {
    return { status: "unavailable", message: "DATABASE_URL is not configured.", groups: [] };
  },
  async resolveGroup() {
    throw new ClientErrorStoreUnavailableError();
  },
  async countNewGroupsSince() {
    return 0;
  },
};

let testStore: ClientErrorStore | null = null;
let productionStore: ClientErrorStore | null = null;
let productionDatabaseUrl = "";

export function setClientErrorStoreForTests(store: ClientErrorStore): void {
  testStore = store;
}

export function resetClientErrorStoreForTests(): void {
  testStore = null;
}

export function getClientErrorStore(): ClientErrorStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresClientErrorStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type GroupRow = {
  message: string;
  route_path: string;
  occurrence_count: number | string;
  first_seen: Date | string;
  last_seen: Date | string;
  distinct_wallets: number | string;
  representative_stack: string | null;
  build_id: string | null;
};

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function groupFromRow(row: GroupRow): ClientErrorGroup {
  return {
    message: row.message,
    routePath: row.route_path,
    occurrenceCount: Number(row.occurrence_count),
    firstSeen: asIso(row.first_seen),
    lastSeen: asIso(row.last_seen),
    distinctWallets: Number(row.distinct_wallets),
    representativeStack: row.representative_stack,
    buildId: row.build_id,
  };
}

export function createPostgresClientErrorStore(databaseUrl: string): ClientErrorStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async recordError(input: ClientErrorInput): Promise<void> {
      await pool.query(
        `INSERT INTO client_errors (message, stack, route_path, wallet_address, user_agent, viewport_width, build_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.message,
          input.stack,
          input.routePath,
          input.walletAddress,
          input.userAgent,
          input.viewportWidth,
          input.buildId,
        ],
      );
    },

    async listGroups(limit = 100): Promise<ClientErrorsSnapshot> {
      try {
        const result = await pool.query<GroupRow>(
          `SELECT g.message, g.route_path, g.occurrence_count, g.first_seen, g.last_seen, g.distinct_wallets,
                  rep.stack AS representative_stack, rep.build_id
             FROM (
               SELECT message, route_path,
                      COUNT(*)::int AS occurrence_count,
                      MIN(created_at) AS first_seen,
                      MAX(created_at) AS last_seen,
                      COUNT(DISTINCT wallet_address) FILTER (WHERE wallet_address IS NOT NULL)::int AS distinct_wallets
                 FROM client_errors
                GROUP BY message, route_path
             ) g
             LEFT JOIN client_error_resolutions r
               ON r.message = g.message AND r.route_path = g.route_path
             JOIN LATERAL (
               SELECT stack, build_id
                 FROM client_errors ce
                WHERE ce.message = g.message AND ce.route_path = g.route_path
                ORDER BY created_at DESC
                LIMIT 1
             ) rep ON true
            WHERE r.resolved_at IS NULL OR g.last_seen > r.resolved_at
            ORDER BY g.occurrence_count DESC, g.last_seen DESC
            LIMIT $1`,
          [limit],
        );
        return {
          status: "ready",
          message: "Live client-error groups from Postgres.",
          groups: result.rows.map(groupFromRow),
        };
      } catch {
        return {
          status: "unavailable",
          message: "Client error data could not be loaded. Apply migration 021_client_errors.sql and try again.",
          groups: [],
        };
      }
    },

    async resolveGroup(message: string, routePath: string): Promise<ResolveGroupResult> {
      const existing = await pool.query(
        `SELECT 1 FROM client_errors WHERE message = $1 AND route_path = $2 LIMIT 1`,
        [message, routePath],
      );
      if (existing.rows.length === 0) return "not_found";

      await pool.query(
        `INSERT INTO client_error_resolutions (message, route_path, resolved_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (message, route_path) DO UPDATE SET resolved_at = EXCLUDED.resolved_at`,
        [message, routePath],
      );
      return "resolved";
    },

    async countNewGroupsSince(since: Date): Promise<number> {
      const result = await pool.query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM (
           SELECT message, route_path FROM client_errors
            GROUP BY message, route_path
           HAVING MIN(created_at) >= $1
         ) AS new_groups`,
        [since],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
  };
}
