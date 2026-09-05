// Per-token daily mascot-image usage (owner decision, 5 Sep 2026: two a day,
// blocked at the cap). Follows lib/server/social-project-slots-store.ts's
// shape: interface + unconfigured fallback that fails closed + test seam +
// Postgres implementation whose reserve is a single atomic upsert, so two
// concurrent taps can never both squeeze past the limit.

import { getPostgresPool } from "@/lib/server/postgres";

export type ReserveMascotImageResult = { allowed: true; usedToday: number } | { allowed: false; usedToday: number };

export interface MascotImageUsageStore {
  /** Images already counted for this wallet + project on this UTC day. */
  usage(walletAddress: string, projectId: string, day: string): Promise<number>;
  /** Atomically counts one more image if the day's count is below `limit`. */
  reserve(walletAddress: string, projectId: string, day: string, limit: number): Promise<ReserveMascotImageResult>;
  /** Gives one back when the paid generation failed after reserving. Never below zero. */
  release(walletAddress: string, projectId: string, day: string): Promise<void>;
}

export class MascotImageUsageStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for the mascot-image daily allowance.");
    this.name = "MascotImageUsageStoreUnavailableError";
  }
}

const unconfiguredStore: MascotImageUsageStore = {
  async usage() {
    throw new MascotImageUsageStoreUnavailableError();
  },
  async reserve() {
    throw new MascotImageUsageStoreUnavailableError();
  },
  async release() {
    throw new MascotImageUsageStoreUnavailableError();
  },
};

function key(walletAddress: string, projectId: string, day: string): string {
  return `${walletAddress.toLowerCase()}|${projectId}|${day}`;
}

/** In-memory store for tests and local runs — same contract, no Postgres. */
export function createMemoryMascotImageUsageStore(): MascotImageUsageStore {
  const counts = new Map<string, number>();
  return {
    async usage(walletAddress, projectId, day) {
      return counts.get(key(walletAddress, projectId, day)) ?? 0;
    },
    async reserve(walletAddress, projectId, day, limit) {
      const k = key(walletAddress, projectId, day);
      const current = counts.get(k) ?? 0;
      if (current >= limit) return { allowed: false, usedToday: current };
      counts.set(k, current + 1);
      return { allowed: true, usedToday: current + 1 };
    },
    async release(walletAddress, projectId, day) {
      const k = key(walletAddress, projectId, day);
      counts.set(k, Math.max(0, (counts.get(k) ?? 0) - 1));
    },
  };
}

let testStore: MascotImageUsageStore | null = null;
let productionStore: MascotImageUsageStore | null = null;
let productionDatabaseUrl = "";

export function setMascotImageUsageStoreForTests(store: MascotImageUsageStore): void {
  testStore = store;
}

export function resetMascotImageUsageStoreForTests(): void {
  testStore = null;
}

export function getMascotImageUsageStore(): MascotImageUsageStore {
  if (testStore) return testStore;
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresMascotImageUsageStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

export function createPostgresMascotImageUsageStore(databaseUrl: string): MascotImageUsageStore {
  const pool = getPostgresPool(databaseUrl);
  return {
    async usage(walletAddress, projectId, day) {
      const result = await pool.query<{ image_count: number | string }>(
        `SELECT image_count FROM social_mascot_image_usage
          WHERE wallet_address = LOWER($1) AND project_id = $2 AND used_on = $3::date`,
        [walletAddress, projectId, day],
      );
      return Number(result.rows[0]?.image_count ?? 0);
    },
    async reserve(walletAddress, projectId, day, limit) {
      // One statement: insert the day's first image, or add one only while the
      // count is still under the limit. No row back means the cap held.
      const result = await pool.query<{ image_count: number | string }>(
        `INSERT INTO social_mascot_image_usage (wallet_address, project_id, used_on, image_count)
         VALUES (LOWER($1), $2, $3::date, 1)
         ON CONFLICT (wallet_address, project_id, used_on) DO UPDATE
           SET image_count = social_mascot_image_usage.image_count + 1, updated_at = NOW()
           WHERE social_mascot_image_usage.image_count < $4
         RETURNING image_count`,
        [walletAddress, projectId, day, limit],
      );
      const row = result.rows[0];
      if (row) return { allowed: true, usedToday: Number(row.image_count) };
      return { allowed: false, usedToday: await this.usage(walletAddress, projectId, day) };
    },
    async release(walletAddress, projectId, day) {
      await pool.query(
        `UPDATE social_mascot_image_usage
            SET image_count = GREATEST(image_count - 1, 0), updated_at = NOW()
          WHERE wallet_address = LOWER($1) AND project_id = $2 AND used_on = $3::date`,
        [walletAddress, projectId, day],
      );
    },
  };
}
