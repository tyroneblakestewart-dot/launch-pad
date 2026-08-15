// Per-project AI Social Studio storage (voice profile, mascot reference
// image + visual DNA, and the manual publish queue with any attached
// artwork). These can carry large data-URL images, so — same as
// lib/token-project-db.ts (issue #307) — they live only in IndexedDB, never
// in localStorage or long-lived React state (CLAUDE.md rule 7).

import { EMPTY_SOCIAL_STUDIO_RECORD, type SocialStudioProjectRecord } from "@/lib/social-studio-types";

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

export async function getSocialStudioRecord(projectId: string): Promise<SocialStudioProjectRecord> {
  const result = await runInStore<SocialStudioProjectRecord | undefined>("readonly", (store) => store.get(projectId));
  return result ?? EMPTY_SOCIAL_STUDIO_RECORD;
}

export async function putSocialStudioRecord(projectId: string, record: SocialStudioProjectRecord): Promise<void> {
  await runInStore("readwrite", (store) => store.put(record, projectId));
}

export async function deleteSocialStudioRecord(projectId: string): Promise<void> {
  await runInStore("readwrite", (store) => store.delete(projectId));
}
