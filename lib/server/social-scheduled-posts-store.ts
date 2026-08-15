import { getPostgresPool } from "@/lib/server/postgres";
import { isSocialPlatform, type SocialPlatform } from "@/lib/server/social-connections-store";

// Durable, browser-independent approve-first posting queue for Social
// Studio Mode 1 (issue #335, "review & release"). A row only ever exists
// here once a wallet has explicitly approved it — approval IS the create,
// so "unapproved posts never send" holds by construction (see
// db/migrations/018_social_studio_connections.sql). Per-destination
// delivery state lives in social_post_destinations so X and Telegram
// retry/fail independently.

export type SocialPostStatus = "scheduled" | "sent" | "partially_sent" | "failed" | "canceled";
export type SocialDestinationStatus = "pending" | "sent" | "failed";

export type SocialPostDestination = {
  id: string;
  scheduledPostId: string;
  platform: SocialPlatform;
  status: SocialDestinationStatus;
  attemptCount: number;
  nextAttemptAt: string;
  externalPostId: string | null;
  errorMessage: string | null;
  sentAt: string | null;
};

export type SocialScheduledPost = {
  id: string;
  walletAddress: string;
  body: string;
  artworkDataUrl: string | null;
  status: SocialPostStatus;
  scheduledAt: string;
  approvedByWallet: string;
  approvedAt: string;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  destinations: SocialPostDestination[];
};

export type CreateScheduledPostInput = {
  walletAddress: string;
  body: string;
  artworkDataUrl: string | null;
  destinations: SocialPlatform[];
  scheduledAt: Date;
  approvedByWallet: string;
};

export type CancelScheduledPostResult =
  | { status: "canceled" }
  | { status: "not_found" }
  | { status: "not_cancelable" };

export type DueDestination = {
  destinationId: string;
  scheduledPostId: string;
  platform: SocialPlatform;
  walletAddress: string;
  body: string;
  artworkDataUrl: string | null;
  attemptCount: number;
};

export interface SocialScheduledPostsStore {
  create(input: CreateScheduledPostInput): Promise<SocialScheduledPost>;
  list(walletAddress: string, limit?: number): Promise<SocialScheduledPost[]>;
  get(id: string): Promise<SocialScheduledPost | null>;
  cancel(id: string, walletAddress: string): Promise<CancelScheduledPostResult>;
  listDueDestinations(now: Date, limit: number): Promise<DueDestination[]>;
  markDestinationSent(destinationId: string, externalPostId: string, now: Date): Promise<void>;
  markDestinationRetry(destinationId: string, errorMessage: string, nextAttemptAt: Date): Promise<void>;
  markDestinationFailedFinal(destinationId: string, errorMessage: string): Promise<void>;
  recomputePostStatus(scheduledPostId: string): Promise<void>;
}

export class SocialScheduledPostsStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for Social Studio scheduled posts.");
    this.name = "SocialScheduledPostsStoreUnavailableError";
  }
}

const unconfiguredStore: SocialScheduledPostsStore = {
  async create() {
    throw new SocialScheduledPostsStoreUnavailableError();
  },
  async list() {
    return [];
  },
  async get() {
    return null;
  },
  async cancel() {
    return { status: "not_found" };
  },
  async listDueDestinations() {
    return [];
  },
  async markDestinationSent() {},
  async markDestinationRetry() {},
  async markDestinationFailedFinal() {},
  async recomputePostStatus() {},
};

let testStore: SocialScheduledPostsStore | null = null;
let productionStore: SocialScheduledPostsStore | null = null;
let productionDatabaseUrl = "";

export function setSocialScheduledPostsStoreForTests(store: SocialScheduledPostsStore): void {
  testStore = store;
}

export function resetSocialScheduledPostsStoreForTests(): void {
  testStore = null;
}

export function getSocialScheduledPostsStore(): SocialScheduledPostsStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresSocialScheduledPostsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type PostRow = {
  id: string;
  wallet_address: string;
  body: string;
  artwork_data_url: string | null;
  status: string;
  scheduled_at: Date | string;
  approved_by_wallet: string;
  approved_at: Date | string;
  canceled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type DestinationRow = {
  id: string;
  scheduled_post_id: string;
  platform: string;
  status: string;
  attempt_count: number;
  next_attempt_at: Date | string;
  external_post_id: string | null;
  error_message: string | null;
  sent_at: Date | string | null;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asDateOrNull(value: Date | string | null): string | null {
  return value ? asDate(value).toISOString() : null;
}

function isPostStatus(value: string): value is SocialPostStatus {
  return ["scheduled", "sent", "partially_sent", "failed", "canceled"].includes(value);
}

function isDestinationStatus(value: string): value is SocialDestinationStatus {
  return value === "pending" || value === "sent" || value === "failed";
}

function destinationFromRow(row: DestinationRow): SocialPostDestination | null {
  if (!isSocialPlatform(row.platform) || !isDestinationStatus(row.status)) return null;
  return {
    id: row.id,
    scheduledPostId: row.scheduled_post_id,
    platform: row.platform,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: asDate(row.next_attempt_at).toISOString(),
    externalPostId: row.external_post_id,
    errorMessage: row.error_message,
    sentAt: asDateOrNull(row.sent_at),
  };
}

function postFromRow(row: PostRow, destinations: SocialPostDestination[]): SocialScheduledPost | null {
  if (!isPostStatus(row.status)) return null;
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    body: row.body,
    artworkDataUrl: row.artwork_data_url,
    status: row.status,
    scheduledAt: asDate(row.scheduled_at).toISOString(),
    approvedByWallet: row.approved_by_wallet,
    approvedAt: asDate(row.approved_at).toISOString(),
    canceledAt: asDateOrNull(row.canceled_at),
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
    destinations,
  };
}

const POST_COLUMNS = `id, wallet_address, body, artwork_data_url, status, scheduled_at,
  approved_by_wallet, approved_at, canceled_at, created_at, updated_at`;
const DESTINATION_COLUMNS = `id, scheduled_post_id, platform, status, attempt_count, next_attempt_at,
  external_post_id, error_message, sent_at`;

export function createPostgresSocialScheduledPostsStore(databaseUrl: string): SocialScheduledPostsStore {
  const pool = getPostgresPool(databaseUrl);

  async function destinationsForPosts(postIds: string[]): Promise<Map<string, SocialPostDestination[]>> {
    if (postIds.length === 0) return new Map();
    const result = await pool.query<DestinationRow>(
      `SELECT ${DESTINATION_COLUMNS} FROM social_post_destinations WHERE scheduled_post_id = ANY($1::uuid[]) ORDER BY platform`,
      [postIds],
    );
    const map = new Map<string, SocialPostDestination[]>();
    for (const row of result.rows) {
      const destination = destinationFromRow(row);
      if (!destination) continue;
      const list = map.get(destination.scheduledPostId) ?? [];
      list.push(destination);
      map.set(destination.scheduledPostId, list);
    }
    return map;
  }

  return {
    async create(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const postResult = await client.query<PostRow>(
          `INSERT INTO social_scheduled_posts (
             wallet_address, body, artwork_data_url, status, scheduled_at, approved_by_wallet
           ) VALUES ($1, $2, $3, 'scheduled', $4, $5)
           RETURNING ${POST_COLUMNS}`,
          [input.walletAddress, input.body, input.artworkDataUrl, input.scheduledAt, input.approvedByWallet],
        );
        const postRow = postResult.rows[0];
        if (!postRow) throw new Error("The scheduled post could not be created.");

        const destinationRows: DestinationRow[] = [];
        for (const platform of input.destinations) {
          const destinationResult = await client.query<DestinationRow>(
            `INSERT INTO social_post_destinations (scheduled_post_id, platform, next_attempt_at)
             VALUES ($1, $2, $3)
             RETURNING ${DESTINATION_COLUMNS}`,
            [postRow.id, platform, input.scheduledAt],
          );
          const destinationRow = destinationResult.rows[0];
          if (destinationRow) destinationRows.push(destinationRow);
        }

        await client.query("COMMIT");
        const destinations = destinationRows.map(destinationFromRow).filter((d): d is SocialPostDestination => d !== null);
        const post = postFromRow(postRow, destinations);
        if (!post) throw new Error("The scheduled post could not be mapped safely.");
        return post;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original database error.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async list(walletAddress, limit = 200) {
      const postsResult = await pool.query<PostRow>(
        `SELECT ${POST_COLUMNS} FROM social_scheduled_posts
          WHERE LOWER(wallet_address) = LOWER($1)
          ORDER BY created_at DESC LIMIT $2`,
        [walletAddress, limit],
      );
      const destinationsByPost = await destinationsForPosts(postsResult.rows.map((row) => row.id));
      return postsResult.rows
        .map((row) => postFromRow(row, destinationsByPost.get(row.id) ?? []))
        .filter((post): post is SocialScheduledPost => post !== null);
    },

    async get(id) {
      const postResult = await pool.query<PostRow>(`SELECT ${POST_COLUMNS} FROM social_scheduled_posts WHERE id = $1`, [id]);
      const row = postResult.rows[0];
      if (!row) return null;
      const destinationsByPost = await destinationsForPosts([id]);
      return postFromRow(row, destinationsByPost.get(id) ?? []);
    },

    async cancel(id, walletAddress) {
      const result = await pool.query<PostRow>(
        `UPDATE social_scheduled_posts
            SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND LOWER(wallet_address) = LOWER($2) AND status = 'scheduled'
          RETURNING ${POST_COLUMNS}`,
        [id, walletAddress],
      );
      if (result.rows[0]) return { status: "canceled" };
      const existing = await pool.query<{ status: string }>(`SELECT status FROM social_scheduled_posts WHERE id = $1 AND LOWER(wallet_address) = LOWER($2)`, [
        id,
        walletAddress,
      ]);
      return existing.rows[0] ? { status: "not_cancelable" } : { status: "not_found" };
    },

    async listDueDestinations(now, limit) {
      const result = await pool.query<{
        destination_id: string;
        scheduled_post_id: string;
        platform: string;
        wallet_address: string;
        body: string;
        artwork_data_url: string | null;
        attempt_count: number;
      }>(
        `SELECT d.id AS destination_id, d.scheduled_post_id, d.platform, p.wallet_address, p.body,
                p.artwork_data_url, d.attempt_count
           FROM social_post_destinations d
           JOIN social_scheduled_posts p ON p.id = d.scheduled_post_id
          WHERE d.status = 'pending'
            AND d.next_attempt_at <= $1
            AND p.status = 'scheduled'
          ORDER BY d.next_attempt_at ASC
          LIMIT $2`,
        [now, limit],
      );
      return result.rows
        .filter((row) => isSocialPlatform(row.platform))
        .map((row) => ({
          destinationId: row.destination_id,
          scheduledPostId: row.scheduled_post_id,
          platform: row.platform as SocialPlatform,
          walletAddress: row.wallet_address,
          body: row.body,
          artworkDataUrl: row.artwork_data_url,
          attemptCount: Number(row.attempt_count),
        }));
    },

    async markDestinationSent(destinationId, externalPostId, now) {
      await pool.query(
        `UPDATE social_post_destinations
            SET status = 'sent', external_post_id = $2, error_message = NULL, sent_at = $3, updated_at = NOW()
          WHERE id = $1`,
        [destinationId, externalPostId, now],
      );
    },

    async markDestinationRetry(destinationId, errorMessage, nextAttemptAt) {
      await pool.query(
        `UPDATE social_post_destinations
            SET attempt_count = attempt_count + 1, error_message = $2, next_attempt_at = $3, updated_at = NOW()
          WHERE id = $1`,
        [destinationId, errorMessage.slice(0, 1000), nextAttemptAt],
      );
    },

    async markDestinationFailedFinal(destinationId, errorMessage) {
      await pool.query(
        `UPDATE social_post_destinations
            SET status = 'failed', attempt_count = attempt_count + 1, error_message = $2, updated_at = NOW()
          WHERE id = $1`,
        [destinationId, errorMessage.slice(0, 1000)],
      );
    },

    async recomputePostStatus(scheduledPostId) {
      const result = await pool.query<{ status: string }>(
        `SELECT status FROM social_post_destinations WHERE scheduled_post_id = $1`,
        [scheduledPostId],
      );
      const statuses = result.rows.map((row) => row.status);
      if (statuses.length === 0 || statuses.some((status) => status === "pending")) return;

      const allSent = statuses.every((status) => status === "sent");
      const allFailed = statuses.every((status) => status === "failed");
      const nextStatus: SocialPostStatus = allSent ? "sent" : allFailed ? "failed" : "partially_sent";

      await pool.query(
        `UPDATE social_scheduled_posts
            SET status = $2, updated_at = NOW()
          WHERE id = $1 AND status NOT IN ('canceled')`,
        [scheduledPostId, nextStatus],
      );
    },
  };
}
