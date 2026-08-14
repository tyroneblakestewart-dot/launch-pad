// Per-project heavy blob storage (artwork + generated site HTML). These
// fields routinely exceed the ~5MB localStorage quota, so they never touch
// localStorage — only this IndexedDB store does (issue #307).

const DATABASE_NAME = "hoodlums-token-studio";
const DATABASE_VERSION = 1;
const STORE_NAME = "project-blobs";

export type ProjectBlob = {
  heroImage: string;
  generatedSiteHtml: string | null;
};

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
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open the local storage database."));
    request.onblocked = () =>
      reject(new Error("The local storage database is blocked by another open tab."));
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

export async function putProjectBlob(id: string, blob: ProjectBlob): Promise<void> {
  await runInStore("readwrite", (store) => store.put(blob, id));
}

export async function getProjectBlob(id: string): Promise<ProjectBlob | null> {
  const result = await runInStore<ProjectBlob | undefined>("readonly", (store) => store.get(id));
  return result ?? null;
}

export async function deleteProjectBlob(id: string): Promise<void> {
  await runInStore("readwrite", (store) => store.delete(id));
}
