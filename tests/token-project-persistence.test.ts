import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteProjectFromStorage,
  loadProjectFromStorage,
  saveProjectToStorage,
} from "@/lib/token-project-persistence";
import { getProjectBlob } from "@/lib/token-project-db";
import {
  parseSavedTokenProjects,
  TOKEN_STUDIO_PROJECTS_STORAGE_KEY,
  toIndexEntry,
} from "@/lib/token-project-storage";
import type { TokenProject } from "@/lib/types";
import { createFakeIndexedDB, type FakeIndexedDBFactory } from "./fake-indexeddb-test-helper";
import { createFakeLocalStorage, type FakeLocalStorage } from "./fake-local-storage-test-helper";

const DB_NAME = "hoodlums-token-studio";
const STORE_NAME = "project-blobs";

function makeProject(overrides: Partial<TokenProject> = {}): TokenProject {
  return {
    id: "project-1",
    createdAt: "2026-08-06T07:00:00.000Z",
    updatedAt: "2026-08-06T07:15:00.000Z",
    status: "draft",
    chain: "robinhood",
    name: "Big Generated Site",
    ticker: "BIG",
    description: "A token whose generated site is large enough to blow localStorage's quota.",
    supply: "1000000000",
    decimals: 18,
    websiteSlug: "big-generated-site",
    contractAddress: "",
    xHandle: "",
    telegram: "",
    heroImage: "data:image/png;base64," + "A".repeat(2000),
    theme: "hoodlums",
    generatedSiteHtml: "<!doctype html><html><body>" + "x".repeat(5000) + "</body></html>",
    generatedSiteVersion: 1,
    ...overrides,
  };
}

let fakeIndexedDB: FakeIndexedDBFactory;
let fakeLocalStorage: FakeLocalStorage;

beforeEach(() => {
  fakeIndexedDB = createFakeIndexedDB();
  fakeLocalStorage = createFakeLocalStorage();
  vi.stubGlobal("indexedDB", fakeIndexedDB);
  vi.stubGlobal("localStorage", fakeLocalStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving a project (issue #307)", () => {
  it("succeeds: writes the heavy blob to IndexedDB and the lightweight index to localStorage", async () => {
    const project = makeProject();

    const outcome = await saveProjectToStorage(project, []);

    expect(outcome.success).toBe(true);
    if (!outcome.success) throw new Error("expected success");
    expect(outcome.index).toEqual([toIndexEntry(project)]);

    const storedIndex = parseSavedTokenProjects(fakeLocalStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY));
    expect(storedIndex).toEqual([toIndexEntry(project)]);
    // The heavy fields must never reach localStorage.
    expect(fakeLocalStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY)).not.toContain("data:image/png");
    expect(fakeLocalStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY)).not.toContain("<!doctype html>");

    await expect(getProjectBlob(project.id)).resolves.toEqual({
      heroImage: project.heroImage,
      generatedSiteHtml: project.generatedSiteHtml,
    });
  });

  it("fails clearly when the IndexedDB write fails, and never touches the index (no ghost row)", async () => {
    const project = makeProject();
    fakeIndexedDB.failNextOperation(
      DB_NAME,
      STORE_NAME,
      Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" }),
    );

    const outcome = await saveProjectToStorage(project, []);

    expect(outcome.success).toBe(false);
    if (outcome.success) throw new Error("expected failure");
    expect(outcome.error).toContain("QuotaExceededError");

    expect(fakeLocalStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY)).toBeNull();
  });

  // The quota-exceeded path required by the issue: the artwork/HTML blob
  // write to IndexedDB succeeds (that's the whole point of moving it out of
  // localStorage), but the small localStorage index write can still fail
  // (e.g. localStorage itself is completely full, or disabled in a private
  // browsing mode). That failure must not leave an orphaned "Saved
  // launches" row with no index entry.
  it("fails clearly when the localStorage index write hits its quota, and rolls back the IndexedDB blob it just wrote", async () => {
    const project = makeProject();
    fakeLocalStorage.failNextSetItemWith = Object.assign(new Error("QuotaExceededError"), {
      name: "QuotaExceededError",
    });

    const outcome = await saveProjectToStorage(project, []);

    expect(outcome.success).toBe(false);
    if (outcome.success) throw new Error("expected failure");
    expect(outcome.error).toContain("QuotaExceededError");

    expect(fakeLocalStorage.getItem(TOKEN_STUDIO_PROJECTS_STORAGE_KEY)).toBeNull();
    // No orphaned blob left behind for a project that isn't in the index.
    await expect(getProjectBlob(project.id)).resolves.toBeNull();
  });

  it("replaces an existing entry with the same id instead of duplicating it", async () => {
    const project = makeProject();
    const first = await saveProjectToStorage(project, []);
    if (!first.success) throw new Error("expected success");

    const updated = { ...project, name: "Renamed", updatedAt: "2026-08-06T08:00:00.000Z" };
    const second = await saveProjectToStorage(updated, first.index);
    if (!second.success) throw new Error("expected success");

    expect(second.index).toHaveLength(1);
    expect(second.index[0].name).toBe("Renamed");
  });
});

describe("loading a project (issue #307)", () => {
  it("round-trips: a saved project reopens with the exact same HTML and artwork", async () => {
    const project = makeProject();
    const saved = await saveProjectToStorage(project, []);
    if (!saved.success) throw new Error("expected success");

    const loaded = await loadProjectFromStorage(saved.index[0]);

    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error("expected success");
    expect(loaded.project).toEqual(project);
  });

  it("surfaces a clear error instead of silently returning an empty project when IndexedDB read fails", async () => {
    const project = makeProject();
    const saved = await saveProjectToStorage(project, []);
    if (!saved.success) throw new Error("expected success");

    fakeIndexedDB.failNextOperation(DB_NAME, STORE_NAME, new Error("Local database read failed"));

    const loaded = await loadProjectFromStorage(saved.index[0]);

    expect(loaded.success).toBe(false);
    if (loaded.success) throw new Error("expected failure");
    expect(loaded.error).toContain("Local database read failed");
  });
});

describe("deleting a project (issue #307)", () => {
  it("removes the project from the index and its blob from IndexedDB", async () => {
    const project = makeProject();
    const saved = await saveProjectToStorage(project, []);
    if (!saved.success) throw new Error("expected success");

    const outcome = await deleteProjectFromStorage(project.id, saved.index);

    expect(outcome.success).toBe(true);
    if (!outcome.success) throw new Error("expected success");
    expect(outcome.index).toEqual([]);
    await expect(getProjectBlob(project.id)).resolves.toBeNull();
  });

  it("surfaces a clear error when the index write fails instead of pretending it worked", async () => {
    const project = makeProject();
    const saved = await saveProjectToStorage(project, []);
    if (!saved.success) throw new Error("expected success");

    fakeLocalStorage.failNextSetItemWith = new Error("Storage unavailable");
    const outcome = await deleteProjectFromStorage(project.id, saved.index);

    expect(outcome.success).toBe(false);
    if (outcome.success) throw new Error("expected failure");
    expect(outcome.error).toContain("Storage unavailable");
  });
});
