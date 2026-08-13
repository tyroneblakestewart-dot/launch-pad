import { getPostgresPool } from "@/lib/server/postgres";

// Durable queue store for the dormant X outreach bot (issue #298). Mirrors
// lib/server/hoodchat-store.ts's shape: interface + unconfigured fallback +
// test-injectable singleton + Postgres implementation. Dedupe-forever
// (including dismissed rows) is enforced at the database level by the
// partial unique indexes in db/migrations/013_outreach.sql, not by an
// application-level pre-check, so it holds under concurrent cron runs.

export type OutreachTouch = "first" | "followup";
export type OutreachStatus = "pending" | "posted" | "dismissed" | "failed";

export function isOutreachStatus(value: unknown): value is OutreachStatus {
  return value === "pending" || value === "posted" || value === "dismissed" || value === "failed";
}

export type OutreachQueueItem = {
  id: string;
  touch: OutreachTouch;
  status: OutreachStatus;
  tokenMint: string;
  tokenName: string;
  tokenTicker: string;
  tokenArtworkUrl: string;
  tokenUrl: string;
  progressPercent: number;
  creatorXHandle: string | null;
  templateKey: string;
  body: string;
  errorMessage: string | null;
  xPostId: string | null;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
  dismissedAt: string | null;
};

export type InsertOutreachDraftInput = {
  touch: OutreachTouch;
  tokenMint: string;
  tokenName: string;
  tokenTicker: string;
  tokenArtworkUrl: string;
  tokenUrl: string;
  progressPercent: number;
  creatorXHandle: string | null;
  templateKey: string;
  body: string;
};

export type InsertOutreachDraftResult =
  | { status: "inserted"; item: OutreachQueueItem }
  | { status: "duplicate" }
  | { status: "cap_reached" };

export type OutreachTransitionResult =
  | { status: "updated"; item: OutreachQueueItem }
  | { status: "not_found" }
  | { status: "not_pending" };

export interface OutreachStore {
  /** Atomically checks the shared daily cap and inserts, or reports why it didn't. */
  insertDraftIfEligible(input: InsertOutreachDraftInput, dailyCap: number): Promise<InsertOutreachDraftResult>;
  countDraftsInsertedToday(now?: Date): Promise<number>;
  listItems(status: OutreachStatus | "all"): Promise<OutreachQueueItem[]>;
  getItem(id: string): Promise<OutreachQueueItem | null>;
  /** The template key most recently used for this touch type, so rotation never immediately repeats. */
  getLastTemplateKey(touch: OutreachTouch): Promise<string | null>;
  /** Mints with a posted first-touch draft at high progress, eligible for a one-time follow-up. */
  listFollowUpCandidateMints(minProgressPercent: number): Promise<string[]>;
  editDraft(id: string, body: string): Promise<OutreachTransitionResult>;
  dismissDraft(id: string): Promise<OutreachTransitionResult>;
  markPosted(id: string, xPostId: string): Promise<OutreachTransitionResult>;
  markFailed(id: string, errorMessage: string): Promise<OutreachTransitionResult>;
}

export class OutreachStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for outreach.");
    this.name = "OutreachStoreUnavailableError";
  }
}

const unconfiguredStore: OutreachStore = {
  async insertDraftIfEligible() {
    throw new OutreachStoreUnavailableError();
  },
  async countDraftsInsertedToday() {
    return 0;
  },
  async listItems() {
    return [];
  },
  async getItem() {
    return null;
  },
  async getLastTemplateKey() {
    return null;
  },
  async listFollowUpCandidateMints() {
    return [];
  },
  async editDraft() {
    throw new OutreachStoreUnavailableError();
  },
  async dismissDraft() {
    throw new OutreachStoreUnavailableError();
  },
  async markPosted() {
    throw new OutreachStoreUnavailableError();
  },
  async markFailed() {
    throw new OutreachStoreUnavailableError();
  },
};

let testStore: OutreachStore | null = null;
let productionStore: OutreachStore | null = null;
let productionDatabaseUrl = "";

export function setOutreachStoreForTests(store: OutreachStore): void {
  testStore = store;
}

export function resetOutreachStoreForTests(): void {
  testStore = null;
}

export function getOutreachStore(): OutreachStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresOutreachStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type QueueRow = {
  id: string;
  touch: string;
  status: string;
  token_mint: string;
  token_name: string;
  token_ticker: string;
  token_artwork_url: string;
  token_url: string;
  progress_percent: number | string;
  creator_x_handle: string | null;
  template_key: string;
  body: string;
  error_message: string | null;
  x_post_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  posted_at: Date | string | null;
  dismissed_at: Date | string | null;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asDateOrNull(value: Date | string | null): string | null {
  return value ? asDate(value).toISOString() : null;
}

function isOutreachTouch(value: string): value is OutreachTouch {
  return value === "first" || value === "followup";
}

function itemFromRow(row: QueueRow): OutreachQueueItem | null {
  if (!isOutreachTouch(row.touch) || !isOutreachStatus(row.status)) return null;
  return {
    id: row.id,
    touch: row.touch,
    status: row.status,
    tokenMint: row.token_mint,
    tokenName: row.token_name,
    tokenTicker: row.token_ticker,
    tokenArtworkUrl: row.token_artwork_url,
    tokenUrl: row.token_url,
    progressPercent: Number(row.progress_percent),
    creatorXHandle: row.creator_x_handle,
    templateKey: row.template_key,
    body: row.body,
    errorMessage: row.error_message,
    xPostId: row.x_post_id,
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
    postedAt: asDateOrNull(row.posted_at),
    dismissedAt: asDateOrNull(row.dismissed_at),
  };
}

const QUEUE_COLUMNS = `id, touch, status, token_mint, token_name, token_ticker, token_artwork_url, token_url,
  progress_percent, creator_x_handle, template_key, body, error_message, x_post_id,
  created_at, updated_at, posted_at, dismissed_at`;

async function rollback(client: { query: (text: string) => Promise<unknown> }): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

export function createPostgresOutreachStore(databaseUrl: string): OutreachStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async insertDraftIfEligible(input, dailyCap) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialises concurrent cron runs against the shared daily cap. The
        // per-mint/per-handle dedupe below is independently enforced by the
        // partial unique indexes + ON CONFLICT DO NOTHING and holds even
        // without this lock.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('hoodlums-outreach-daily-cap'))");

        const countResult = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
             FROM outreach_queue_items
            WHERE (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date`,
        );
        if (Number(countResult.rows[0]?.count ?? 0) >= dailyCap) {
          await client.query("COMMIT");
          return { status: "cap_reached" };
        }

        const inserted = await client.query<QueueRow>(
          `INSERT INTO outreach_queue_items (
             touch, token_mint, token_name, token_ticker, token_artwork_url, token_url,
             progress_percent, creator_x_handle, template_key, body
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT DO NOTHING
           RETURNING ${QUEUE_COLUMNS}`,
          [
            input.touch,
            input.tokenMint,
            input.tokenName,
            input.tokenTicker,
            input.tokenArtworkUrl,
            input.tokenUrl,
            input.progressPercent,
            input.creatorXHandle,
            input.templateKey,
            input.body,
          ],
        );
        await client.query("COMMIT");

        const row = inserted.rows[0];
        if (!row) return { status: "duplicate" };
        const item = itemFromRow(row);
        if (!item) throw new Error("The inserted outreach draft could not be mapped safely.");
        return { status: "inserted", item };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async countDraftsInsertedToday() {
      const result = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM outreach_queue_items
          WHERE (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date`,
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async listItems(status) {
      const result =
        status === "all"
          ? await pool.query<QueueRow>(`SELECT ${QUEUE_COLUMNS} FROM outreach_queue_items ORDER BY created_at DESC LIMIT 500`)
          : await pool.query<QueueRow>(
              `SELECT ${QUEUE_COLUMNS} FROM outreach_queue_items WHERE status = $1 ORDER BY created_at DESC LIMIT 500`,
              [status],
            );
      return result.rows.map(itemFromRow).filter((item): item is OutreachQueueItem => item !== null);
    },

    async getItem(id) {
      const result = await pool.query<QueueRow>(`SELECT ${QUEUE_COLUMNS} FROM outreach_queue_items WHERE id = $1`, [id]);
      const row = result.rows[0];
      return row ? itemFromRow(row) : null;
    },

    async getLastTemplateKey(touch) {
      const result = await pool.query<{ template_key: string }>(
        `SELECT template_key FROM outreach_queue_items WHERE touch = $1 ORDER BY created_at DESC LIMIT 1`,
        [touch],
      );
      return result.rows[0]?.template_key ?? null;
    },

    async listFollowUpCandidateMints(minProgressPercent) {
      const result = await pool.query<{ token_mint: string }>(
        `SELECT token_mint
           FROM outreach_queue_items
          WHERE touch = 'first'
            AND status = 'posted'
            AND progress_percent >= $1
            AND NOT EXISTS (
              SELECT 1 FROM outreach_queue_items AS followups
               WHERE followups.token_mint = outreach_queue_items.token_mint
                 AND followups.touch = 'followup'
            )`,
        [minProgressPercent],
      );
      return result.rows.map((row) => row.token_mint);
    },

    async editDraft(id, body) {
      const result = await pool.query<QueueRow>(
        `UPDATE outreach_queue_items
            SET body = $2, updated_at = NOW()
          WHERE id = $1 AND status = 'pending'
          RETURNING ${QUEUE_COLUMNS}`,
        [id, body],
      );
      const row = result.rows[0];
      if (row) {
        const item = itemFromRow(row);
        if (item) return { status: "updated", item };
      }
      const existing = await pool.query<{ status: string }>(`SELECT status FROM outreach_queue_items WHERE id = $1`, [id]);
      return existing.rows[0] ? { status: "not_pending" } : { status: "not_found" };
    },

    async dismissDraft(id) {
      const result = await pool.query<QueueRow>(
        `UPDATE outreach_queue_items
            SET status = 'dismissed', dismissed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'pending'
          RETURNING ${QUEUE_COLUMNS}`,
        [id],
      );
      const row = result.rows[0];
      if (row) {
        const item = itemFromRow(row);
        if (item) return { status: "updated", item };
      }
      const existing = await pool.query<{ status: string }>(`SELECT status FROM outreach_queue_items WHERE id = $1`, [id]);
      return existing.rows[0] ? { status: "not_pending" } : { status: "not_found" };
    },

    async markPosted(id, xPostId) {
      const result = await pool.query<QueueRow>(
        `UPDATE outreach_queue_items
            SET status = 'posted', x_post_id = $2, error_message = NULL, posted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'pending'
          RETURNING ${QUEUE_COLUMNS}`,
        [id, xPostId],
      );
      const row = result.rows[0];
      if (row) {
        const item = itemFromRow(row);
        if (item) return { status: "updated", item };
      }
      const existing = await pool.query<{ status: string }>(`SELECT status FROM outreach_queue_items WHERE id = $1`, [id]);
      return existing.rows[0] ? { status: "not_pending" } : { status: "not_found" };
    },

    async markFailed(id, errorMessage) {
      const result = await pool.query<QueueRow>(
        `UPDATE outreach_queue_items
            SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE id = $1 AND status = 'pending'
          RETURNING ${QUEUE_COLUMNS}`,
        [id, errorMessage.slice(0, 1000)],
      );
      const row = result.rows[0];
      if (row) {
        const item = itemFromRow(row);
        if (item) return { status: "updated", item };
      }
      const existing = await pool.query<{ status: string }>(`SELECT status FROM outreach_queue_items WHERE id = $1`, [id]);
      return existing.rows[0] ? { status: "not_pending" } : { status: "not_found" };
    },
  };
}
