import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/lib/server/postgres";

export type BespokeSiteChallengeRecord = {
  id: string;
  nonceHash: string;
  walletAddress: string;
  origin: string;
  projectHash: `0x${string}`;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

export type CreateBespokeSiteChallengeInput = {
  nonceHash: string;
  walletAddress: string;
  origin: string;
  projectHash: `0x${string}`;
  issuedAt: Date;
  expiresAt: Date;
};

export type ConsumeBespokeSiteChallengeInput = {
  challengeId: string;
  nonceHash: string;
  origin: string;
  projectHash: `0x${string}`;
  now: Date;
};

export type ConsumeBespokeSiteChallengeResult =
  | { status: "ok"; challenge: BespokeSiteChallengeRecord }
  | { status: "not-found" }
  | { status: "expired" }
  | { status: "replayed" }
  | { status: "mismatch" };

export interface BespokeSiteChallengeStore {
  create(input: CreateBespokeSiteChallengeInput): Promise<BespokeSiteChallengeRecord>;
  consume(input: ConsumeBespokeSiteChallengeInput): Promise<ConsumeBespokeSiteChallengeResult>;
}

type ChallengeRow = {
  id: string;
  nonce_hash: string;
  wallet_address: string;
  origin: string;
  project_hash: string;
  issued_at: Date | string;
  expires_at: Date | string;
  used_at: Date | string | null;
};

type QueryResult<T extends Record<string, unknown>> = {
  rows: T[];
  rowCount?: number | null;
};

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
};

type ClientLike = Queryable & { release(): void };
type PoolLike = Queryable & { connect(): Promise<ClientLike> };

const CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1_000;

export class BespokeSiteChallengeStoreUnavailableError extends Error {
  constructor(message = "DATABASE_URL is not configured for bespoke-site challenges.") {
    super(message);
    this.name = "BespokeSiteChallengeStoreUnavailableError";
  }
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function record(row: ChallengeRow): BespokeSiteChallengeRecord {
  return {
    id: row.id,
    nonceHash: row.nonce_hash.trim(),
    walletAddress: row.wallet_address.toLowerCase(),
    origin: row.origin,
    projectHash: row.project_hash.toLowerCase() as `0x${string}`,
    issuedAt: date(row.issued_at),
    expiresAt: date(row.expires_at),
    usedAt: row.used_at ? date(row.used_at) : null,
  };
}

async function rollback(client: ClientLike): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

function postgresStore(databaseUrl: string): BespokeSiteChallengeStore {
  const pool = getPostgresPool(databaseUrl) as unknown as PoolLike;

  return {
    async create(input) {
      // Challenge rows are authentication state, not an activity log. Keep
      // storage bounded by pruning records after their short recovery window.
      const cutoff = new Date(input.issuedAt.getTime() - CHALLENGE_RETENTION_MS);
      await pool
        .query(
          `DELETE FROM bespoke_site_challenges
            WHERE COALESCE(used_at, expires_at) < $1`,
          [cutoff],
        )
        .catch(() => undefined);

      const result = await pool.query<ChallengeRow>(
        `INSERT INTO bespoke_site_challenges (
           nonce_hash, wallet_address, origin, project_hash, issued_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, nonce_hash, wallet_address, origin, project_hash,
                   issued_at, expires_at, used_at`,
        [
          input.nonceHash,
          input.walletAddress.toLowerCase(),
          input.origin,
          input.projectHash.toLowerCase(),
          input.issuedAt,
          input.expiresAt,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("The bespoke-site challenge could not be recorded.");
      }
      return record(row);
    },

    async consume(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<ChallengeRow>(
          `SELECT id, nonce_hash, wallet_address, origin, project_hash,
                  issued_at, expires_at, used_at
             FROM bespoke_site_challenges
            WHERE id = $1
            FOR UPDATE`,
          [input.challengeId],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return { status: "not-found" };
        }
        const challenge = record(row);
        if (challenge.usedAt) {
          await client.query("COMMIT");
          return { status: "replayed" };
        }
        if (challenge.expiresAt.getTime() <= input.now.getTime()) {
          await client.query("COMMIT");
          return { status: "expired" };
        }
        if (
          challenge.nonceHash !== input.nonceHash ||
          challenge.origin !== input.origin ||
          challenge.projectHash !== input.projectHash.toLowerCase()
        ) {
          await client.query("COMMIT");
          return { status: "mismatch" };
        }

        await client.query(
          `UPDATE bespoke_site_challenges
              SET used_at = $2
            WHERE id = $1`,
          [input.challengeId, input.now],
        );
        await client.query("COMMIT");
        return {
          status: "ok",
          challenge: { ...challenge, usedAt: input.now },
        };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

/** Lightweight deterministic store for focused challenge/auth tests. */
export function createMemoryBespokeSiteChallengeStore(): BespokeSiteChallengeStore {
  const records = new Map<string, BespokeSiteChallengeRecord>();

  return {
    async create(input) {
      const challenge: BespokeSiteChallengeRecord = {
        id: randomUUID(),
        nonceHash: input.nonceHash,
        walletAddress: input.walletAddress.toLowerCase(),
        origin: input.origin,
        projectHash: input.projectHash.toLowerCase() as `0x${string}`,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        usedAt: null,
      };
      records.set(challenge.id, challenge);
      return { ...challenge };
    },

    async consume(input) {
      const challenge = records.get(input.challengeId);
      if (!challenge) return { status: "not-found" };
      if (challenge.usedAt) return { status: "replayed" };
      if (challenge.expiresAt.getTime() <= input.now.getTime()) {
        return { status: "expired" };
      }
      if (
        challenge.nonceHash !== input.nonceHash ||
        challenge.origin !== input.origin ||
        challenge.projectHash !== input.projectHash.toLowerCase()
      ) {
        return { status: "mismatch" };
      }
      challenge.usedAt = input.now;
      return { status: "ok", challenge: { ...challenge } };
    },
  };
}

const unavailableStore: BespokeSiteChallengeStore = {
  async create() {
    throw new BespokeSiteChallengeStoreUnavailableError();
  },
  async consume() {
    throw new BespokeSiteChallengeStoreUnavailableError();
  },
};

let testStore: BespokeSiteChallengeStore | null = null;
let productionStore: BespokeSiteChallengeStore | null = null;
let productionDatabaseUrl = "";

export function setBespokeSiteChallengeStoreForTests(
  store: BespokeSiteChallengeStore,
): void {
  testStore = store;
}

export function resetBespokeSiteChallengeStoreForTests(): void {
  testStore = null;
}

export function getBespokeSiteChallengeStore(): BespokeSiteChallengeStore {
  if (testStore) return testStore;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unavailableStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = postgresStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}
