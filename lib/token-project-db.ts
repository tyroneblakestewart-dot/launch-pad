/**
 * Per-project heavy-data store (issue #307). `generatedSiteHtml` and
 * `heroImage` easily exceed the ~5MB localStorage quota once a site has been
 * generated, so they never touch localStorage — only this per-project
 * IndexedDB record does. localStorage keeps just the lightweight index (see
 * `lib/token-project-storage.ts`).
 */

const DATABASE_NAME = "hoodlums-token-studio";
const DATABASE_VERSION = 1;
const STORE_NAME = "project-blobs";

export type ProjectBlob = {
  id: string;
  heroImage: string;
  generatedSiteHtml: string | null;
  generatedSiteVersion: number | null;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("This browser has no local site storage available (IndexedDB is disabled)."),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not open local site storage."));
    request.onblocked = () =>
      reject(new Error("Local site storage is blocked by another open tab."));
  });
}

export async function putProjectBlob(blob: ProjectBlob): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error("Could not save the generated site locally."));
      tx.onabort = () =>
        reject(tx.error || new Error("Saving the generated site was interrupted."));
    });
  } finally {
    db.close();
  }
}

export async function getProjectBlob(id: string): Promise<ProjectBlob | null> {
  const db = await openDatabase();
  try {
    return await new Promise<ProjectBlob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as ProjectBlob | undefined) ?? null);
      request.onerror = () =>
        reject(request.error || new Error("Could not read the generated site."));
    });
  } finally {
    db.close();
  }
}

export async function deleteProjectBlob(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error("Could not remove the stored site."));
      tx.onabort = () =>
        reject(tx.error || new Error("Removing the stored site was interrupted."));
    });
  } finally {
    db.close();
  }
}
