import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteProjectBlob, getProjectBlob, putProjectBlob } from "@/lib/token-project-db";
import { createFakeIndexedDB, type FakeIndexedDBFactory } from "./fake-indexeddb-test-helper";

const DB_NAME = "hoodlums-token-studio";
const STORE_NAME = "project-blobs";

let fakeIndexedDB: FakeIndexedDBFactory;

beforeEach(() => {
  fakeIndexedDB = createFakeIndexedDB();
  vi.stubGlobal("indexedDB", fakeIndexedDB);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("per-project IndexedDB blob store (issue #307)", () => {
  it("round-trips a project's artwork and generated site HTML through put and get", async () => {
    await putProjectBlob("project-1", {
      heroImage: "data:image/png;base64,AAAA",
      generatedSiteHtml: "<!doctype html><html><body>hi</body></html>",
    });

    await expect(getProjectBlob("project-1")).resolves.toEqual({
      heroImage: "data:image/png;base64,AAAA",
      generatedSiteHtml: "<!doctype html><html><body>hi</body></html>",
    });
  });

  it("returns null for a project with no stored blob", async () => {
    await expect(getProjectBlob("never-saved")).resolves.toBeNull();
  });

  it("deletes a stored blob", async () => {
    await putProjectBlob("project-2", { heroImage: "art", generatedSiteHtml: null });
    await deleteProjectBlob("project-2");
    await expect(getProjectBlob("project-2")).resolves.toBeNull();
  });

  it("overwrites an existing blob for the same project id", async () => {
    await putProjectBlob("project-3", { heroImage: "old-art", generatedSiteHtml: null });
    await putProjectBlob("project-3", {
      heroImage: "new-art",
      generatedSiteHtml: "<html>v2</html>",
    });

    await expect(getProjectBlob("project-3")).resolves.toEqual({
      heroImage: "new-art",
      generatedSiteHtml: "<html>v2</html>",
    });
  });

  it("rejects with a clear error when the write fails, e.g. the quota-exceeded path", async () => {
    const quotaError = Object.assign(new Error("QuotaExceededError"), {
      name: "QuotaExceededError",
    });
    fakeIndexedDB.failNextOperation(DB_NAME, STORE_NAME, quotaError);

    await expect(
      putProjectBlob("project-4", {
        heroImage: "big-art",
        generatedSiteHtml: "<html>huge</html>",
      }),
    ).rejects.toThrow("QuotaExceededError");

    // The failed write must not leave a partial/garbage entry behind.
    await expect(getProjectBlob("project-4")).resolves.toBeNull();
  });

  it("rejects reads and writes when IndexedDB itself is unavailable in this browser", async () => {
    vi.stubGlobal("indexedDB", undefined);

    await expect(getProjectBlob("any")).rejects.toThrow("not available");
    await expect(putProjectBlob("any", { heroImage: "", generatedSiteHtml: null })).rejects.toThrow(
      "not available",
    );
  });
});
