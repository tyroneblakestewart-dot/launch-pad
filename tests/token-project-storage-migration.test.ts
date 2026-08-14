import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectBlob } from "@/lib/token-project-db";
import { migrateLegacySavedProjects, serialiseSavedTokenProjects } from "@/lib/token-project-storage";
import type { TokenProject } from "@/lib/types";
import { createFakeIndexedDB, type FakeIndexedDBFactory } from "./fake-indexeddb-test-helper";

const DB_NAME = "hoodlums-token-studio";
const STORE_NAME = "project-blobs";

function makeLegacyProject(overrides: Partial<TokenProject> = {}): TokenProject {
  return {
    id: "legacy-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "draft",
    chain: "robinhood",
    name: "Legacy Token",
    ticker: "OLD",
    description: "Saved before the IndexedDB migration shipped.",
    supply: "1000000",
    decimals: 18,
    websiteSlug: "legacy-token",
    contractAddress: "",
    xHandle: "",
    telegram: "",
    heroImage: "data:image/png;base64,AAAA",
    theme: "hoodlums",
    generatedSiteHtml: "<!doctype html><html><body>legacy</body></html>",
    ...overrides,
  };
}

let fakeIndexedDB: FakeIndexedDBFactory;

beforeEach(() => {
  fakeIndexedDB = createFakeIndexedDB();
  vi.stubGlobal("indexedDB", fakeIndexedDB);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("migrating legacy oversized/broken localStorage entries (issue #307)", () => {
  it("returns an empty, untouched result for a fresh browser with nothing saved", async () => {
    const result = await migrateLegacySavedProjects(null);
    expect(result).toEqual({ index: [], migratedCount: 0, droppedCount: 0 });
  });

  it("moves a legacy project's inline artwork/HTML into IndexedDB and rewrites it as a lightweight index entry", async () => {
    const legacy = makeLegacyProject();
    const raw = JSON.stringify([legacy]);

    const result = await migrateLegacySavedProjects(raw);

    expect(result.migratedCount).toBe(1);
    expect(result.droppedCount).toBe(0);
    expect(result.index).toHaveLength(1);
    expect(result.index[0]).not.toHaveProperty("heroImage");
    expect(result.index[0]).not.toHaveProperty("generatedSiteHtml");
    expect(result.index[0].id).toBe(legacy.id);
    expect(result.index[0].name).toBe(legacy.name);

    await expect(getProjectBlob(legacy.id)).resolves.toEqual({
      heroImage: legacy.heroImage,
      generatedSiteHtml: legacy.generatedSiteHtml,
    });
  });

  it("drops entries that cannot be parsed as JSON at all, rather than hiding every other saved launch", async () => {
    const result = await migrateLegacySavedProjects("not-json-at-all{{{");
    expect(result).toEqual({ index: [], migratedCount: 0, droppedCount: 1 });
  });

  it("drops individual entries with no id while keeping the rest of the vault intact", async () => {
    const good = makeLegacyProject({ id: "good-1", heroImage: "", generatedSiteHtml: null });
    const raw = JSON.stringify([{ notAProject: true }, good]);

    const result = await migrateLegacySavedProjects(raw);

    expect(result.droppedCount).toBe(1);
    expect(result.migratedCount).toBe(0);
    expect(result.index).toHaveLength(1);
    expect(result.index[0].id).toBe("good-1");
  });

  it("drops a legacy row instead of keeping an unreachable one when the IndexedDB write fails", async () => {
    fakeIndexedDB.failNextOperation(DB_NAME, STORE_NAME, new Error("Local database write failed"));
    const legacy = makeLegacyProject();
    const raw = JSON.stringify([legacy]);

    const result = await migrateLegacySavedProjects(raw);

    expect(result.migratedCount).toBe(0);
    expect(result.droppedCount).toBe(1);
    expect(result.index).toEqual([]);
  });

  it("passes already-migrated (lightweight) entries straight through untouched", async () => {
    const legacy = makeLegacyProject();
    const first = await migrateLegacySavedProjects(JSON.stringify([legacy]));
    expect(first.migratedCount).toBe(1);

    const raw = serialiseSavedTokenProjects(first.index);
    const second = await migrateLegacySavedProjects(raw);

    expect(second).toEqual({ index: first.index, migratedCount: 0, droppedCount: 0 });
  });

  it("is idempotent: running it twice on the same legacy payload only migrates once and doesn't duplicate the blob", async () => {
    const legacy = makeLegacyProject();
    const raw = JSON.stringify([legacy]);

    await migrateLegacySavedProjects(raw);
    const second = await migrateLegacySavedProjects(raw);

    // Migrating the same raw legacy payload twice still recognises the
    // inline heavy data each time (the source hasn't been rewritten), so it
    // simply overwrites the same IndexedDB entry with identical data rather
    // than erroring or duplicating it.
    expect(second.index).toHaveLength(1);
    await expect(getProjectBlob(legacy.id)).resolves.toEqual({
      heroImage: legacy.heroImage,
      generatedSiteHtml: legacy.generatedSiteHtml,
    });
  });

  it("leaves a project with no artwork or generated site as a lightweight entry without writing an empty blob", async () => {
    const bare = makeLegacyProject({ heroImage: "", generatedSiteHtml: null });
    const result = await migrateLegacySavedProjects(JSON.stringify([bare]));

    expect(result.migratedCount).toBe(0);
    expect(result.index).toHaveLength(1);
    await expect(getProjectBlob(bare.id)).resolves.toBeNull();
  });
});
