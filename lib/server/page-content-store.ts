import type { PoolClient } from "pg";
import type { PageContentElementType } from "@/lib/page-content-registry";
import { getPostgresPool } from "@/lib/server/postgres";

export type PageContentEntry = {
  pageId: string;
  elementId: string;
  elementType: PageContentElementType;
  draftValue: string;
  hasDraft: boolean;
  draftUpdatedAt: string | null;
  draftUpdatedBy: string | null;
  publishedValue: string;
  hasPublished: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
};

export type SaveDraftInput = {
  pageId: string;
  elementId: string;
  elementType: PageContentElementType;
  value: string;
  actor: string;
  now?: Date;
};

export type PublishInput = {
  pageId: string;
  elementId: string;
  actor: string;
  now?: Date;
};

export type PublishResult = {
  entry: PageContentEntry;
  hadPublishedBefore: boolean;
  previousPublishedValue: string;
};

export class NoDraftPendingError extends Error {
  constructor(pageId: string, elementId: string) {
    super(`No draft is pending for ${pageId}/${elementId}.`);
    this.name = "NoDraftPendingError";
  }
}

export interface PageContentStore {
  listPage(pageId: string): Promise<PageContentEntry[]>;
  saveDraft(input: SaveDraftInput): Promise<PageContentEntry>;
  discardDraft(input: { pageId: string; elementId: string }): Promise<PageContentEntry | null>;
  publish(input: PublishInput): Promise<PublishResult>;
  publishAllDrafts(input: { pageId: string; actor: string; now?: Date }): Promise<PublishResult[]>;
}

export class PageContentStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is required for the durable page content registry.");
    this.name = "PageContentStoreUnavailableError";
  }
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function emptyEntry(pageId: string, elementId: string, elementType: PageContentElementType): PageContentEntry {
  return {
    pageId,
    elementId,
    elementType,
    draftValue: "",
    hasDraft: false,
    draftUpdatedAt: null,
    draftUpdatedBy: null,
    publishedValue: "",
    hasPublished: false,
    publishedAt: null,
    publishedBy: null,
  };
}

type MemoryState = Map<string, PageContentEntry>;

function memoryKey(pageId: string, elementId: string): string {
  return `${pageId}::${elementId}`;
}

export function createMemoryPageContentState(): MemoryState {
  return new Map();
}

/** Test-only store. Multiple instances can share one state to model separate serverless functions. */
export function createMemoryPageContentStore(
  state: MemoryState = createMemoryPageContentState(),
): PageContentStore {
  return {
    async listPage(pageId) {
      return [...state.values()].filter((entry) => entry.pageId === pageId);
    },

    async saveDraft(input) {
      const now = input.now || new Date();
      const key = memoryKey(input.pageId, input.elementId);
      const existing = state.get(key) || emptyEntry(input.pageId, input.elementId, input.elementType);
      const updated: PageContentEntry = {
        ...existing,
        elementType: input.elementType,
        draftValue: input.value,
        hasDraft: true,
        draftUpdatedAt: now.toISOString(),
        draftUpdatedBy: input.actor,
      };
      state.set(key, updated);
      return updated;
    },

    async discardDraft(input) {
      const key = memoryKey(input.pageId, input.elementId);
      const existing = state.get(key);
      if (!existing) return null;
      const updated: PageContentEntry = { ...existing, draftValue: "", hasDraft: false };
      state.set(key, updated);
      return updated;
    },

    async publish(input) {
      const now = input.now || new Date();
      const key = memoryKey(input.pageId, input.elementId);
      const existing = state.get(key);
      if (!existing || !existing.hasDraft) {
        throw new NoDraftPendingError(input.pageId, input.elementId);
      }
      const hadPublishedBefore = existing.hasPublished;
      const previousPublishedValue = existing.publishedValue;
      const updated: PageContentEntry = {
        ...existing,
        publishedValue: existing.draftValue,
        hasPublished: true,
        publishedAt: now.toISOString(),
        publishedBy: input.actor,
        hasDraft: false,
      };
      state.set(key, updated);
      return { entry: updated, hadPublishedBefore, previousPublishedValue };
    },

    async publishAllDrafts(input) {
      const now = input.now || new Date();
      const results: PublishResult[] = [];
      for (const entry of [...state.values()].filter((row) => row.pageId === input.pageId && row.hasDraft)) {
        const hadPublishedBefore = entry.hasPublished;
        const previousPublishedValue = entry.publishedValue;
        const updated: PageContentEntry = {
          ...entry,
          publishedValue: entry.draftValue,
          hasPublished: true,
          publishedAt: now.toISOString(),
          publishedBy: input.actor,
          hasDraft: false,
        };
        state.set(memoryKey(entry.pageId, entry.elementId), updated);
        results.push({ entry: updated, hadPublishedBefore, previousPublishedValue });
      }
      return results;
    },
  };
}

type EntryRow = {
  page_id: string;
  element_id: string;
  element_type: string;
  draft_value: string;
  has_draft: boolean;
  draft_updated_at: Date | string | null;
  draft_updated_by: string | null;
  published_value: string;
  has_published: boolean;
  published_at: Date | string | null;
  published_by: string | null;
};

function entryFromRow(row: EntryRow): PageContentEntry {
  return {
    pageId: row.page_id,
    elementId: row.element_id,
    elementType: row.element_type as PageContentElementType,
    draftValue: row.draft_value,
    hasDraft: row.has_draft,
    draftUpdatedAt: asIso(row.draft_updated_at),
    draftUpdatedBy: row.draft_updated_by,
    publishedValue: row.published_value,
    hasPublished: row.has_published,
    publishedAt: asIso(row.published_at),
    publishedBy: row.published_by,
  };
}

const ENTRY_COLUMNS =
  "page_id, element_id, element_type, draft_value, has_draft, draft_updated_at, draft_updated_by, published_value, has_published, published_at, published_by";

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

export function createPostgresPageContentStore(databaseUrl: string): PageContentStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async listPage(pageId) {
      const result = await pool.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM page_content_entries WHERE page_id = $1`,
        [pageId],
      );
      return result.rows.map(entryFromRow);
    },

    async saveDraft(input) {
      const now = input.now || new Date();
      const result = await pool.query<EntryRow>(
        `INSERT INTO page_content_entries (
           page_id, element_id, element_type, draft_value, has_draft, draft_updated_at, draft_updated_by
         ) VALUES ($1, $2, $3, $4, TRUE, $5, $6)
         ON CONFLICT (page_id, element_id) DO UPDATE
           SET element_type = EXCLUDED.element_type,
               draft_value = EXCLUDED.draft_value,
               has_draft = TRUE,
               draft_updated_at = EXCLUDED.draft_updated_at,
               draft_updated_by = EXCLUDED.draft_updated_by,
               updated_at = NOW()
         RETURNING ${ENTRY_COLUMNS}`,
        [input.pageId, input.elementId, input.elementType, input.value, now, input.actor],
      );
      return entryFromRow(result.rows[0]);
    },

    async discardDraft(input) {
      const result = await pool.query<EntryRow>(
        `UPDATE page_content_entries
           SET draft_value = '', has_draft = FALSE, updated_at = NOW()
         WHERE page_id = $1 AND element_id = $2
         RETURNING ${ENTRY_COLUMNS}`,
        [input.pageId, input.elementId],
      );
      return result.rows[0] ? entryFromRow(result.rows[0]) : null;
    },

    async publish(input) {
      const now = input.now || new Date();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM page_content_entries
            WHERE page_id = $1 AND element_id = $2
            FOR UPDATE`,
          [input.pageId, input.elementId],
        );
        const row = existing.rows[0];
        if (!row || !row.has_draft) {
          await rollback(client);
          throw new NoDraftPendingError(input.pageId, input.elementId);
        }
        const before = entryFromRow(row);
        const updated = await client.query<EntryRow>(
          `UPDATE page_content_entries
             SET published_value = draft_value,
                 has_published = TRUE,
                 published_at = $3,
                 published_by = $4,
                 has_draft = FALSE,
                 updated_at = $3
           WHERE page_id = $1 AND element_id = $2
           RETURNING ${ENTRY_COLUMNS}`,
          [input.pageId, input.elementId, now, input.actor],
        );
        await client.query("COMMIT");
        return {
          entry: entryFromRow(updated.rows[0]),
          hadPublishedBefore: before.hasPublished,
          previousPublishedValue: before.publishedValue,
        };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async publishAllDrafts(input) {
      const now = input.now || new Date();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const pending = await client.query<EntryRow>(
          `SELECT ${ENTRY_COLUMNS} FROM page_content_entries
            WHERE page_id = $1 AND has_draft = TRUE
            FOR UPDATE`,
          [input.pageId],
        );
        const results: PublishResult[] = [];
        for (const row of pending.rows) {
          const before = entryFromRow(row);
          const updated = await client.query<EntryRow>(
            `UPDATE page_content_entries
               SET published_value = draft_value,
                   has_published = TRUE,
                   published_at = $3,
                   published_by = $4,
                   has_draft = FALSE,
                   updated_at = $3
             WHERE page_id = $1 AND element_id = $2
             RETURNING ${ENTRY_COLUMNS}`,
            [input.pageId, before.elementId, now, input.actor],
          );
          results.push({
            entry: entryFromRow(updated.rows[0]),
            hadPublishedBefore: before.hasPublished,
            previousPublishedValue: before.publishedValue,
          });
        }
        await client.query("COMMIT");
        return results;
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

const unconfiguredStore: PageContentStore = {
  async listPage() {
    throw new PageContentStoreUnavailableError();
  },
  async saveDraft() {
    throw new PageContentStoreUnavailableError();
  },
  async discardDraft() {
    throw new PageContentStoreUnavailableError();
  },
  async publish() {
    throw new PageContentStoreUnavailableError();
  },
  async publishAllDrafts() {
    throw new PageContentStoreUnavailableError();
  },
};

let testStore: PageContentStore | null = null;
let productionStore: PageContentStore | null = null;
let productionDatabaseUrl = "";

export function setPageContentStoreForTests(store: PageContentStore): void {
  testStore = store;
}

export function resetPageContentStoreForTests(): void {
  testStore = null;
}

export function getPageContentStore(): PageContentStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresPageContentStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}
