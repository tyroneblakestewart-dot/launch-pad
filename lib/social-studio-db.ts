// Per-project AI Social Studio storage (voice profile, mascot reference
// image + visual DNA, and the manual publish queue with any attached
// artwork). These can carry large data-URL images, so — same as
// lib/token-project-db.ts (issue #307) — they live only in IndexedDB, never
// in localStorage or long-lived React state (CLAUDE.md rule 7).

import {
  DEFAULT_POSTING_CADENCE,
  DEFAULT_QUEUE_TARGET,
  EMPTY_SOCIAL_STUDIO_RECORD,
  MAX_QUEUE_TARGET,
  type PostingCadence,
  type SocialStudioProjectRecord,
} from "@/lib/social-studio-types";

function normaliseQueueTarget(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_QUEUE_TARGET;
  return Math.min(MAX_QUEUE_TARGET, Math.max(1, Math.round(value)));
}

/** Falls back to the default cadence for a missing or unrecognised stored value (e.g. a pre-#358 record). */
function normalisePostingCadence(value: unknown): PostingCadence {
  return value === "conservative" || value === "active" ? value : DEFAULT_POSTING_CADENCE;
}

function normaliseDirectionBrief(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

const DATABASE_NAME = "hoodlums-social-studio";
const DATABASE_VERSION = 1;
const STORE_NAME = "project-records";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local storage database is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local storage database."));
    request.onblocked = () => reject(new Error("The local storage database is blocked by another open tab."));
  });
}

async function runInStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("Local storage database request failed."));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("Local storage database transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Local storage database transaction was aborted."));
    });
  } finally {
    db.close();
  }
}

/**
 * Merges a raw stored record over the current default shape so that fields
 * added in a later release (e.g. issue #348's sampleLineFeedback) are
 * present with their default on records persisted before that release,
 * and defensively coerces fields that must be arrays back to `[]` if they
 * are missing or corrupted. Migrate-on-read, not just on write, so no
 * caller has to remember this every time the record shape grows.
 *
 * queueTarget (issue #352) is coerced the same way: a missing, non-numeric
 * or out-of-range value (including records saved before this field existed)
 * falls back to DEFAULT_QUEUE_TARGET rather than rejecting the record.
 *
 * postingCadence and directionBrief (issue #358) follow the same pattern: a
 * missing/unrecognised cadence falls back to DEFAULT_POSTING_CADENCE, and a
 * non-string brief falls back to "" (which changes nothing about
 * generation), rather than either rejecting the record.
 */
function normaliseSocialStudioRecord(
  raw: SocialStudioProjectRecord | null | undefined,
): SocialStudioProjectRecord {
  const merged: SocialStudioProjectRecord = { ...EMPTY_SOCIAL_STUDIO_RECORD, ...raw };
  return {
    ...merged,
    voiceExamples: Array.isArray(merged.voiceExamples) ? merged.voiceExamples : [],
    queue: Array.isArray(merged.queue) ? merged.queue : [],
    sampleLineFeedback: Array.isArray(merged.sampleLineFeedback) ? merged.sampleLineFeedback : [],
    queueTarget: normaliseQueueTarget(merged.queueTarget),
    postingCadence: normalisePostingCadence(merged.postingCadence),
    directionBrief: normaliseDirectionBrief(merged.directionBrief),
  };
}

export async function getSocialStudioRecord(projectId: string): Promise<SocialStudioProjectRecord> {
  const result = await runInStore<SocialStudioProjectRecord | undefined>("readonly", (store) => store.get(projectId));
  return normaliseSocialStudioRecord(result);
}

export async function putSocialStudioRecord(projectId: string, record: SocialStudioProjectRecord): Promise<void> {
  await runInStore("readwrite", (store) => store.put(record, projectId));
}

export async function deleteSocialStudioRecord(projectId: string): Promise<void> {
  await runInStore("readwrite", (store) => store.delete(projectId));
}
