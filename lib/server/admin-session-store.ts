import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  ADMIN_NONCE_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  hashAdminSessionToken,
  type AdminChallenge,
} from "@/lib/server/admin-auth";
import { getPostgresPool } from "@/lib/server/postgres";

export type CreateAdminChallengeInput = {
  nonceHash: string;
  walletAddress: string;
  issuedAt: Date;
  expiresAt: Date;
};

export type CreateAdminSessionInput = {
  sessionTokenHash: string;
  expiresAt: Date;
};

export type ConsumeAdminChallengeInput = {
  challengeId: string;
  nonceHash: string;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
  now: Date;
};

export type AdminChallengeVerifier = (challenge: AdminChallenge) => Promise<boolean>;

export type ConsumeAdminChallengeResult =
  | { status: "authenticated"; expiresAt: Date }
  | { status: "challenge_not_found" }
  | { status: "challenge_expired" }
  | { status: "challenge_replayed" }
  | { status: "challenge_mismatch" }
  | { status: "invalid_signature" };

export interface AdminSessionStore {
  createChallenge(input: CreateAdminChallengeInput): Promise<AdminChallenge>;
  consumeChallengeAndCreateSession(
    input: ConsumeAdminChallengeInput,
    verifySignature: AdminChallengeVerifier,
  ): Promise<ConsumeAdminChallengeResult>;
  createSession(input: CreateAdminSessionInput): Promise<void>;
  isSessionValid(sessionTokenHash: string, now: Date): Promise<boolean>;
  destroySession(sessionTokenHash: string): Promise<void>;
}

export class AdminSessionStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is required for durable admin authentication.");
    this.name = "AdminSessionStoreUnavailableError";
  }
}

type AdminSessionRecord = { expiresAt: number };

export type MemoryAdminSessionState = {
  challenges: Map<string, AdminChallenge>;
  sessions: Map<string, AdminSessionRecord>;
};

export function createMemoryAdminSessionState(): MemoryAdminSessionState {
  return {
    challenges: new Map(),
    sessions: new Map(),
  };
}

function pruneExpiredChallenges(state: MemoryAdminSessionState, now: number): void {
  for (const [id, challenge] of state.challenges) {
    if (challenge.expiresAt.getTime() <= now) state.challenges.delete(id);
  }
}

function pruneExpiredSessions(state: MemoryAdminSessionState, now: number): void {
  for (const [hash, record] of state.sessions) {
    if (record.expiresAt <= now) state.sessions.delete(hash);
  }
}

/**
 * Test-only store. Multiple instances can share one state object to model
 * separate serverless functions talking to the same durable backing store.
 */
export function createMemoryAdminSessionStore(
  state: MemoryAdminSessionState = createMemoryAdminSessionState(),
): AdminSessionStore {
  return {
    async createChallenge(input) {
      pruneExpiredChallenges(state, input.issuedAt.getTime());
      const challenge: AdminChallenge = {
        id: randomUUID(),
        nonceHash: input.nonceHash,
        walletAddress: input.walletAddress,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        usedAt: null,
      };
      state.challenges.set(challenge.id, challenge);
      return challenge;
    },

    async consumeChallengeAndCreateSession(input, verifySignature) {
      const challenge = state.challenges.get(input.challengeId);
      if (!challenge) return { status: "challenge_not_found" };
      if (challenge.usedAt) return { status: "challenge_replayed" };
      if (challenge.expiresAt.getTime() <= input.now.getTime()) {
        return { status: "challenge_expired" };
      }
      if (challenge.nonceHash !== input.nonceHash) {
        return { status: "challenge_mismatch" };
      }
      if (!(await verifySignature(challenge))) {
        return { status: "invalid_signature" };
      }

      challenge.usedAt = input.now;
      state.sessions.set(input.sessionTokenHash, {
        expiresAt: input.sessionExpiresAt.getTime(),
      });
      return { status: "authenticated", expiresAt: input.sessionExpiresAt };
    },

    async createSession(input) {
      pruneExpiredSessions(
        state,
        input.expiresAt.getTime() - ADMIN_SESSION_TTL_MS,
      );
      state.sessions.set(input.sessionTokenHash, {
        expiresAt: input.expiresAt.getTime(),
      });
    },

    async isSessionValid(sessionTokenHash, now) {
      const record = state.sessions.get(sessionTokenHash);
      if (!record) return false;
      if (record.expiresAt <= now.getTime()) {
        state.sessions.delete(sessionTokenHash);
        return false;
      }
      return true;
    },

    async destroySession(sessionTokenHash) {
      state.sessions.delete(sessionTokenHash);
    },
  };
}

type AdminChallengeRow = {
  id: string;
  nonce_hash: string;
  wallet_address: string;
  issued_at: Date | string;
  expires_at: Date | string;
  used_at: Date | string | null;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function challengeFromRow(row: AdminChallengeRow): AdminChallenge {
  return {
    id: row.id,
    nonceHash: row.nonce_hash,
    walletAddress: row.wallet_address,
    issuedAt: asDate(row.issued_at),
    expiresAt: asDate(row.expires_at),
    usedAt: row.used_at ? asDate(row.used_at) : null,
  };
}

const CHALLENGE_COLUMNS =
  "id, nonce_hash, wallet_address, issued_at, expires_at, used_at";

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

export function createPostgresAdminSessionStore(
  databaseUrl: string,
): AdminSessionStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async createChallenge(input) {
      const result = await pool.query<AdminChallengeRow>(
        `INSERT INTO admin_login_challenges (
          nonce_hash, wallet_address, issued_at, expires_at
        ) VALUES ($1, $2, $3, $4)
        RETURNING ${CHALLENGE_COLUMNS}`,
        [input.nonceHash, input.walletAddress, input.issuedAt, input.expiresAt],
      );
      return challengeFromRow(result.rows[0]);
    },

    async consumeChallengeAndCreateSession(input, verifySignature) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<AdminChallengeRow>(
          `SELECT ${CHALLENGE_COLUMNS}
             FROM admin_login_challenges
            WHERE id = $1
            FOR UPDATE`,
          [input.challengeId],
        );
        const row = result.rows[0];
        if (!row) {
          await rollback(client);
          return { status: "challenge_not_found" };
        }

        const challenge = challengeFromRow(row);
        if (challenge.usedAt) {
          await rollback(client);
          return { status: "challenge_replayed" };
        }
        if (challenge.expiresAt.getTime() <= input.now.getTime()) {
          await rollback(client);
          return { status: "challenge_expired" };
        }
        if (challenge.nonceHash !== input.nonceHash) {
          await rollback(client);
          return { status: "challenge_mismatch" };
        }
        if (!(await verifySignature(challenge))) {
          await rollback(client);
          return { status: "invalid_signature" };
        }

        await client.query(
          "UPDATE admin_login_challenges SET used_at = $2 WHERE id = $1",
          [challenge.id, input.now],
        );
        await client.query(
          `INSERT INTO admin_sessions (session_token_hash, expires_at)
           VALUES ($1, $2)`,
          [input.sessionTokenHash, input.sessionExpiresAt],
        );
        await client.query("COMMIT");
        return { status: "authenticated", expiresAt: input.sessionExpiresAt };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async createSession(input) {
      await pool.query(
        `INSERT INTO admin_sessions (session_token_hash, expires_at)
         VALUES ($1, $2)`,
        [input.sessionTokenHash, input.expiresAt],
      );
    },

    async isSessionValid(sessionTokenHash, now) {
      const result = await pool.query<{ session_token_hash: string }>(
        `SELECT session_token_hash
           FROM admin_sessions
          WHERE session_token_hash = $1
            AND expires_at > $2
          LIMIT 1`,
        [sessionTokenHash, now],
      );
      return result.rows.length > 0;
    },

    async destroySession(sessionTokenHash) {
      await pool.query(
        "DELETE FROM admin_sessions WHERE session_token_hash = $1",
        [sessionTokenHash],
      );
    },
  };
}

const unconfiguredStore: AdminSessionStore = {
  async createChallenge() {
    throw new AdminSessionStoreUnavailableError();
  },
  async consumeChallengeAndCreateSession() {
    throw new AdminSessionStoreUnavailableError();
  },
  async createSession() {
    throw new AdminSessionStoreUnavailableError();
  },
  async isSessionValid() {
    throw new AdminSessionStoreUnavailableError();
  },
  async destroySession() {
    throw new AdminSessionStoreUnavailableError();
  },
};

let testStore: AdminSessionStore | null = null;
let productionStore: AdminSessionStore | null = null;
let productionDatabaseUrl = "";

export function setAdminSessionStoreForTests(store: AdminSessionStore): void {
  testStore = store;
}

export function resetAdminStoresForTests(): void {
  testStore = null;
}

export function getAdminSessionStore(): AdminSessionStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresAdminSessionStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

export async function createAdminChallenge(
  walletAddress: string,
  nonceHash: string,
  now = new Date(),
): Promise<AdminChallenge> {
  return getAdminSessionStore().createChallenge({
    walletAddress,
    nonceHash,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ADMIN_NONCE_TTL_MS),
  });
}

export async function consumeAdminChallengeAndCreateSession(
  input: {
    challengeId: string;
    nonceHash: string;
    sessionTokenHash: string;
    now?: Date;
  },
  verifySignature: AdminChallengeVerifier,
): Promise<ConsumeAdminChallengeResult> {
  const now = input.now ?? new Date();
  return getAdminSessionStore().consumeChallengeAndCreateSession(
    {
      challengeId: input.challengeId,
      nonceHash: input.nonceHash,
      sessionTokenHash: input.sessionTokenHash,
      now,
      sessionExpiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_MS),
    },
    verifySignature,
  );
}

export async function createAdminSession(
  sessionTokenHash: string,
  now = Date.now(),
): Promise<Date> {
  const expiresAt = new Date(now + ADMIN_SESSION_TTL_MS);
  await getAdminSessionStore().createSession({ sessionTokenHash, expiresAt });
  return expiresAt;
}

export async function isAdminSessionValid(
  sessionTokenHash: string,
  now = Date.now(),
): Promise<boolean> {
  return getAdminSessionStore().isSessionValid(sessionTokenHash, new Date(now));
}

export async function destroyAdminSession(
  sessionTokenHash: string,
): Promise<void> {
  await getAdminSessionStore().destroySession(sessionTokenHash);
}

/**
 * Shared fail-closed session check used by the `/admin` page gate and by
 * server-rendered public pages deciding whether to honour a CMS preview
 * request. Never throws — an unreachable session store (or an absent
 * migration) means "not authenticated", not a crash.
 */
export async function isAdminSessionTokenValid(
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  try {
    return await isAdminSessionValid(hashAdminSessionToken(token));
  } catch {
    return false;
  }
}
