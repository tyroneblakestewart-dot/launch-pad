import { getPostgresPool } from "@/lib/server/postgres";
import { SOCIAL_PROJECT_SLOT_RELEASE_COOLDOWN_DAYS } from "@/lib/social-project-slots";

// Durable Pro / Pro Bundle project-slot registry (issue #407). Mirrors
// lib/server/social-connections-store.ts's shape: interface + unconfigured
// fallback + test-injectable singleton + Postgres implementation.
//
// project_id is a client-generated billing guardrail identifier (the
// browser's own local project key), not cryptographic proof that two
// requests describe the same token — see db/migrations/028_social_project_slots.sql.
//
// ensureSlot serializes the read-count-then-insert sequence per wallet with
// a Postgres session/transaction advisory lock (pg_advisory_xact_lock,
// auto-released at COMMIT/ROLLBACK) rather than row locking, since a brand
// new registration has no existing row to lock — this is what makes
// concurrent claims from the same wallet race-safe under serverless
// concurrency.

const SEVEN_DAY_COOLDOWN_MS = SOCIAL_PROJECT_SLOT_RELEASE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export type SocialProjectSlot = {
  id: string;
  walletAddress: string;
  projectId: string;
  displayName: string;
  registeredAt: string;
};

export type EnsureSocialProjectSlotInput = {
  walletAddress: string;
  projectId: string;
  displayName: string;
  limit: number;
};

export type EnsureSocialProjectSlotResult =
  | { status: "existing"; slot: SocialProjectSlot; activeCount: number; limit: number }
  | { status: "registered"; slot: SocialProjectSlot; activeCount: number; limit: number }
  | { status: "limit_reached"; activeCount: number; limit: number; slots: SocialProjectSlot[] };

export type ReleaseSocialProjectSlotByUserInput = {
  walletAddress: string;
  projectId: string;
  now?: Date;
};

export type ReleaseSocialProjectSlotResult =
  | { status: "ok"; releasedAt: string; nextReleaseAllowedAt: string }
  | { status: "not_found" }
  | { status: "cooldown"; nextReleaseAllowedAt: string };

export type ReleaseSocialProjectSlotByAdminInput = {
  walletAddress: string;
  projectId: string;
  now?: Date;
};

export type ReleaseSocialProjectSlotByAdminResult =
  | { status: "ok"; releasedAt: string }
  | { status: "not_found" };

export interface SocialProjectSlotsStore {
  listActive(walletAddress: string): Promise<SocialProjectSlot[]>;
  ensureSlot(input: EnsureSocialProjectSlotInput): Promise<EnsureSocialProjectSlotResult>;
  releaseByUser(input: ReleaseSocialProjectSlotByUserInput): Promise<ReleaseSocialProjectSlotResult>;
  releaseByAdmin(input: ReleaseSocialProjectSlotByAdminInput): Promise<ReleaseSocialProjectSlotByAdminResult>;
}

export class SocialProjectSlotsStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for the AI Social Studio project-slot registry.");
    this.name = "SocialProjectSlotsStoreUnavailableError";
  }
}

const unconfiguredStore: SocialProjectSlotsStore = {
  async listActive() {
    return [];
  },
  async ensureSlot() {
    throw new SocialProjectSlotsStoreUnavailableError();
  },
  async releaseByUser() {
    throw new SocialProjectSlotsStoreUnavailableError();
  },
  async releaseByAdmin() {
    throw new SocialProjectSlotsStoreUnavailableError();
  },
};

let testStore: SocialProjectSlotsStore | null = null;
let productionStore: SocialProjectSlotsStore | null = null;
let productionDatabaseUrl = "";

export function setSocialProjectSlotsStoreForTests(store: SocialProjectSlotsStore): void {
  testStore = store;
}

export function resetSocialProjectSlotsStoreForTests(): void {
  testStore = null;
}

export function getSocialProjectSlotsStore(): SocialProjectSlotsStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresSocialProjectSlotsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type SlotRow = {
  id: string;
  wallet_address: string;
  project_id: string;
  display_name: string;
  registered_at: Date | string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function slotFromRow(row: SlotRow): SocialProjectSlot {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    projectId: row.project_id,
    displayName: row.display_name,
    registeredAt: asDate(row.registered_at).toISOString(),
  };
}

const SLOT_COLUMNS = "id, wallet_address, project_id, display_name, registered_at";

export function createPostgresSocialProjectSlotsStore(databaseUrl: string): SocialProjectSlotsStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async listActive(walletAddress) {
      const result = await pool.query<SlotRow>(
        `SELECT ${SLOT_COLUMNS} FROM social_project_slots
          WHERE LOWER(wallet_address) = LOWER($1) AND released_at IS NULL
          ORDER BY registered_at ASC`,
        [walletAddress],
      );
      return result.rows.map(slotFromRow);
    },

    async ensureSlot({ walletAddress, projectId, displayName, limit }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serializes the count-then-insert sequence per wallet so two
        // concurrent requests from the same wallet can never both observe
        // room for one more slot and both insert.
        await client.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))", [walletAddress]);

        const existingResult = await client.query<SlotRow>(
          `SELECT ${SLOT_COLUMNS} FROM social_project_slots
            WHERE LOWER(wallet_address) = LOWER($1) AND project_id = $2 AND released_at IS NULL
            LIMIT 1`,
          [walletAddress, projectId],
        );
        const existingRow = existingResult.rows[0];
        if (existingRow) {
          const countResult = await client.query<{ count: number | string }>(
            `SELECT COUNT(*)::int AS count FROM social_project_slots
              WHERE LOWER(wallet_address) = LOWER($1) AND released_at IS NULL`,
            [walletAddress],
          );
          await client.query("COMMIT");
          return {
            status: "existing",
            slot: slotFromRow(existingRow),
            activeCount: Number(countResult.rows[0]?.count ?? 0),
            limit,
          };
        }

        const countResult = await client.query<{ count: number | string }>(
          `SELECT COUNT(*)::int AS count FROM social_project_slots
            WHERE LOWER(wallet_address) = LOWER($1) AND released_at IS NULL`,
          [walletAddress],
        );
        const activeCount = Number(countResult.rows[0]?.count ?? 0);
        if (activeCount >= limit) {
          const slotsResult = await client.query<SlotRow>(
            `SELECT ${SLOT_COLUMNS} FROM social_project_slots
              WHERE LOWER(wallet_address) = LOWER($1) AND released_at IS NULL
              ORDER BY registered_at ASC`,
            [walletAddress],
          );
          await client.query("COMMIT");
          return { status: "limit_reached", activeCount, limit, slots: slotsResult.rows.map(slotFromRow) };
        }

        const insertResult = await client.query<SlotRow>(
          `INSERT INTO social_project_slots (wallet_address, project_id, display_name)
           VALUES ($1, $2, $3)
           RETURNING ${SLOT_COLUMNS}`,
          [walletAddress, projectId, displayName],
        );
        await client.query("COMMIT");
        const row = insertResult.rows[0];
        if (!row) throw new Error("The project slot could not be registered.");
        return { status: "registered", slot: slotFromRow(row), activeCount: activeCount + 1, limit };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async releaseByUser({ walletAddress, projectId, now = new Date() }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))", [walletAddress]);

        const cooldownResult = await client.query<{ released_at: Date | string }>(
          `SELECT released_at FROM social_project_slots
            WHERE LOWER(wallet_address) = LOWER($1) AND released_by = 'user'
            ORDER BY released_at DESC
            LIMIT 1`,
          [walletAddress],
        );
        const lastUserRelease = cooldownResult.rows[0]?.released_at ? asDate(cooldownResult.rows[0].released_at) : null;
        if (lastUserRelease) {
          const nextAllowed = new Date(lastUserRelease.getTime() + SEVEN_DAY_COOLDOWN_MS);
          if (nextAllowed.getTime() > now.getTime()) {
            await client.query("COMMIT");
            return { status: "cooldown", nextReleaseAllowedAt: nextAllowed.toISOString() };
          }
        }

        const slotResult = await client.query<SlotRow>(
          `SELECT ${SLOT_COLUMNS} FROM social_project_slots
            WHERE LOWER(wallet_address) = LOWER($1) AND project_id = $2 AND released_at IS NULL
            LIMIT 1
            FOR UPDATE`,
          [walletAddress, projectId],
        );
        const row = slotResult.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return { status: "not_found" };
        }

        const updateResult = await client.query<{ released_at: Date | string }>(
          `UPDATE social_project_slots SET released_at = $2, released_by = 'user'
            WHERE id = $1
            RETURNING released_at`,
          [row.id, now],
        );
        await client.query("COMMIT");
        const releasedAt = asDate(updateResult.rows[0]!.released_at);
        return {
          status: "ok",
          releasedAt: releasedAt.toISOString(),
          nextReleaseAllowedAt: new Date(releasedAt.getTime() + SEVEN_DAY_COOLDOWN_MS).toISOString(),
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async releaseByAdmin({ walletAddress, projectId, now = new Date() }) {
      // A single atomic UPDATE ... WHERE released_at IS NULL is already
      // race-safe without an advisory lock; released_by = 'admin' never
      // starts or extends the user cooldown (see the migration comment).
      const result = await pool.query<{ id: string; released_at: Date | string }>(
        `UPDATE social_project_slots SET released_at = $3, released_by = 'admin'
          WHERE LOWER(wallet_address) = LOWER($1) AND project_id = $2 AND released_at IS NULL
          RETURNING id, released_at`,
        [walletAddress, projectId, now],
      );
      const row = result.rows[0];
      if (!row) return { status: "not_found" };
      return { status: "ok", releasedAt: asDate(row.released_at).toISOString() };
    },
  };
}
