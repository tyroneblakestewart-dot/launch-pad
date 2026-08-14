import { afterEach, describe, expect, it } from "vitest";
import { deleteProjectBlob, getProjectBlob, putProjectBlob } from "@/lib/token-project-db";

type FakeRequest = {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  result: unknown;
  error: Error | null;
};

function makeRequest(): FakeRequest {
  return { onsuccess: null, onerror: null, result: undefined, error: null };
}

/**
 * Minimal in-memory stand-in for the one object store `lib/token-project-db.ts`
 * actually uses (single-key-path put/get/delete inside one transaction each).
 * `failNextWrite` lets a test simulate a write failure — e.g. a Safari
 * quota-exceeded error — the same way a full disk would surface it.
 */
function installFakeIndexedDb(options: { failNextWrite?: boolean } = {}) {
  const store = new Map<string, unknown>();
  let failNextWrite = options.failNextWrite ?? false;

  const fakeIndexedDb = {
    open() {
      const request = makeRequest() as FakeRequest & {
        onupgradeneeded: (() => void) | null;
        onblocked: (() => void) | null;
      };
      request.onupgradeneeded = null;
      request.onblocked = null;

      queueMicrotask(() => {
        const db = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => undefined,
          close: () => undefined,
          transaction: () => {
            const tx: {
              oncomplete: (() => void) | null;
              onerror: (() => void) | null;
              onabort: (() => void) | null;
              objectStore: () => unknown;
            } = { oncomplete: null, onerror: null, onabort: null, objectStore: () => undefined };

            const objectStore = {
              put(value: { id: string }) {
                const req = makeRequest();
                queueMicrotask(() => {
                  if (failNextWrite) {
                    failNextWrite = false;
                    tx.onerror?.();
                    return;
                  }
                  store.set(value.id, value);
                  req.result = value;
                  req.onsuccess?.();
                  queueMicrotask(() => tx.oncomplete?.());
                });
                return req;
              },
              get(id: string) {
                const req = makeRequest();
                queueMicrotask(() => {
                  req.result = store.get(id) ?? undefined;
                  req.onsuccess?.();
                });
                return req;
              },
              delete(id: string) {
                const req = makeRequest();
                queueMicrotask(() => {
                  store.delete(id);
                  req.onsuccess?.();
                  queueMicrotask(() => tx.oncomplete?.());
                });
                return req;
              },
            };
            tx.objectStore = () => objectStore;
            return tx;
          },
        };
        request.result = db;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });

      return request;
    },
  };

  (globalThis as Record<string, unknown>).indexedDB = fakeIndexedDb;
  return store;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).indexedDB;
});

describe("token project IndexedDB store (issue #307)", () => {
  it("rejects with a clear error instead of throwing or hanging when IndexedDB is unavailable", async () => {
    delete (globalThis as Record<string, unknown>).indexedDB;

    await expect(
      putProjectBlob({ id: "p1", heroImage: "", generatedSiteHtml: null, generatedSiteVersion: null }),
    ).rejects.toThrow(/local site storage|IndexedDB/i);
  });

  it("round-trips a saved project's heavy data through put/get/delete", async () => {
    installFakeIndexedDb();

    const blob = {
      id: "p1",
      heroImage: "data:image/webp;base64,AAAA",
      generatedSiteHtml: "<!doctype html><html><body>hi</body></html>",
      generatedSiteVersion: 3,
    };

    await putProjectBlob(blob);
    await expect(getProjectBlob("p1")).resolves.toEqual(blob);

    await deleteProjectBlob("p1");
    await expect(getProjectBlob("p1")).resolves.toBeNull();
  });

  it("resolves null for a project that was never saved", async () => {
    installFakeIndexedDb();
    await expect(getProjectBlob("never-saved")).resolves.toBeNull();
  });

  // The core failure mode from issue #307: a write that fails (quota
  // exceeded, browser storage disabled, etc.) must reject instead of
  // silently doing nothing, and must not leave a half-written record behind.
  it("surfaces a failed write (e.g. quota exceeded) as a rejected promise instead of silently succeeding", async () => {
    installFakeIndexedDb({ failNextWrite: true });

    await expect(
      putProjectBlob({
        id: "p1",
        heroImage: "data:image/webp;base64,AAAA",
        generatedSiteHtml: "<html>too big</html>",
        generatedSiteVersion: 1,
      }),
    ).rejects.toBeTruthy();

    await expect(getProjectBlob("p1")).resolves.toBeNull();
  });
});
