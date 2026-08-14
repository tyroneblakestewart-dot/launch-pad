import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrateLegacySavedProjects,
  parseSavedProjectIndex,
  serialiseSavedProjectIndex,
  type SavedProjectIndexEntry,
} from "@/lib/token-project-storage";
import type { TokenProject } from "@/lib/types";

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

const PARTIAL_LAUNCH: TokenProject = {
  id: "saved-launch-1",
  createdAt: "2026-08-06T07:00:00.000Z",
  updatedAt: "2026-08-06T07:15:00.000Z",
  status: "draft",
  chain: "robinhood",
  name: "Sherwood Cat",
  ticker: "SWCAT",
  description: "A half-finished community token story saved before launch.",
  supply: "777000000",
  decimals: 18,
  websiteSlug: "sherwood-cat",
  contractAddress: "",
  xHandle: "@sherwoodcat",
  telegram: "t.me/sherwoodcat",
  heroImage: "data:image/webp;base64,U0FWRURfQVJUV09SSw==",
  theme: "hoodlums",
  siteSections: {
    about: true,
    tokenomics: true,
    howToBuy: false,
  },
  generatedSiteHtml: "<!doctype html><html><body>saved preview</body></html>",
  generatedSiteVersion: 2,
  launchPath: "bond-pro-site",
};

const PARTIAL_LAUNCH_INDEX_ENTRY: SavedProjectIndexEntry = (() => {
  const { heroImage: _heroImage, generatedSiteHtml: _html, ...rest } = PARTIAL_LAUNCH;
  return rest;
})();

describe("Saved launches", () => {
  it("renders a deliberate empty state with the requested copy and dark muted styling", async () => {
    const workspace = await source("components", "token-studio-workspace.tsx");
    const css = await source("components", "token-studio-workspace.module.css");

    expect(workspace).toContain("No saved launches");
    expect(workspace).toContain('className={styles.savedLaunchEmpty}');
    expect(css).toContain(".savedLaunchEmpty {");
    expect(css).toContain("color: #667169;");
    expect(css).toContain("background: #080c09;");
  });

  // The localStorage index intentionally no longer carries the two fields
  // that can exceed the ~5MB quota (issue #307) — everything else still
  // round-trips exactly.
  it("round-trips every field except the heavy generated-site data through the lightweight localStorage index", () => {
    const raw = serialiseSavedProjectIndex([PARTIAL_LAUNCH_INDEX_ENTRY]);
    const restored = parseSavedProjectIndex(raw);

    expect(restored).toEqual([PARTIAL_LAUNCH_INDEX_ENTRY]);
    expect(Object.keys(restored[0]).sort()).toEqual(
      Object.keys(PARTIAL_LAUNCH_INDEX_ENTRY).sort(),
    );
    expect(raw).not.toContain("heroImage");
    expect(raw).not.toContain("generatedSiteHtml");
    expect(raw).not.toContain(PARTIAL_LAUNCH.heroImage);
    expect(raw).not.toContain("saved preview");
  });

  // Roadmap and FAQ were removed entirely from the free-site sections
  // (issue #303), not just defaulted off. A project saved before that
  // change may still have `siteSections.roadmap` / `.faq` in browser
  // storage; parsing must not drop the project or crash on the stale
  // fields, since storage is a plain JSON passthrough and the fields are
  // simply ignored by every current reader (see FREE_SITE_SECTION_KEYS).
  it("keeps a legacy project with stale roadmap/faq site-section flags intact", () => {
    const legacyRaw = JSON.stringify([
      {
        ...PARTIAL_LAUNCH_INDEX_ENTRY,
        siteSections: { about: true, tokenomics: true, howToBuy: false, roadmap: true, faq: true },
      },
    ]);

    const restored = parseSavedProjectIndex(legacyRaw);

    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(PARTIAL_LAUNCH.id);
    expect(restored[0].siteSections).toEqual({
      about: true,
      tokenomics: true,
      howToBuy: false,
      roadmap: true,
      faq: true,
    });
  });

  // The bug this issue fixes: a full TokenProject (heroImage + generated
  // HTML inline) is exactly what earlier builds wrote straight into
  // localStorage. Migration must recover both the lightweight index entry
  // and the heavy blob so it can be moved into IndexedDB, and the
  // re-serialised index must never carry the heavy data forward.
  it("moves legacy heroImage/generatedSiteHtml out of localStorage and into an IndexedDB-ready blob", () => {
    const legacyRaw = JSON.stringify([PARTIAL_LAUNCH]);
    const { index, blobs, droppedCount } = migrateLegacySavedProjects(legacyRaw);

    expect(droppedCount).toBe(0);
    expect(blobs).toEqual([
      {
        id: PARTIAL_LAUNCH.id,
        heroImage: PARTIAL_LAUNCH.heroImage,
        generatedSiteHtml: PARTIAL_LAUNCH.generatedSiteHtml,
        generatedSiteVersion: PARTIAL_LAUNCH.generatedSiteVersion,
      },
    ]);
    expect(index).toHaveLength(1);
    expect(index[0]).not.toHaveProperty("heroImage");
    expect(index[0]).not.toHaveProperty("generatedSiteHtml");
    expect(index[0].id).toBe(PARTIAL_LAUNCH.id);

    const reserialised = serialiseSavedProjectIndex(index);
    expect(reserialised).not.toContain(PARTIAL_LAUNCH.heroImage);
    expect(reserialised).not.toContain("saved preview");
  });

  // A single malformed row must never hide every other saved launch — it is
  // dropped and counted so the studio can tell the user, while every
  // recoverable entry still loads.
  it("drops unrecoverable rows during migration without losing the rest of the batch", () => {
    const legacyRaw = JSON.stringify([PARTIAL_LAUNCH, { not: "a project" }, null, "oops", 42]);
    const { index, droppedCount } = migrateLegacySavedProjects(legacyRaw);

    expect(index).toHaveLength(1);
    expect(index[0].id).toBe(PARTIAL_LAUNCH.id);
    expect(droppedCount).toBe(4);
  });

  it("is idempotent so it can safely run on every load", () => {
    const first = migrateLegacySavedProjects(JSON.stringify([PARTIAL_LAUNCH]));
    const second = migrateLegacySavedProjects(serialiseSavedProjectIndex(first.index));

    expect(second.blobs).toEqual([]);
    expect(second.droppedCount).toBe(0);
    expect(second.index).toEqual(first.index);
  });

  it("throws on a payload that isn't a parseable array, so the caller can show a clear notice", () => {
    expect(() => migrateLegacySavedProjects("not-json")).toThrow();
    expect(() => migrateLegacySavedProjects("{}")).toThrow();
  });

  it("keeps the complete project object as the save and restore source of truth", async () => {
    const studio = await source("components", "token-studio.tsx");

    const saveStart = studio.indexOf("function saveProject(");
    const saveEnd = studio.indexOf("function startNewProject", saveStart);
    const saveBlock = studio.slice(saveStart, saveEnd);
    expect(saveBlock).toContain("const saved: TokenProject = {");
    expect(saveBlock).toContain("...project,");
    expect(saveBlock).toContain("persist(nextProjects);");

    const loadStart = studio.indexOf("async function loadProject(entry: SavedProjectIndexEntry) {");
    const loadEnd = studio.indexOf("async function handleImage", loadStart);
    const loadBlock = studio.slice(loadStart, loadEnd);
    expect(loadBlock).toContain("setProject(saved);");
    expect(loadBlock).toContain("reopenGeneratedSite(saved);");

    for (const field of [
      "name",
      "ticker",
      "description",
      "supply",
      "decimals",
      "websiteSlug",
      "heroImage",
      "xHandle",
      "telegram",
      "contractAddress",
    ]) {
      expect(studio).toContain(`project.${field}`);
    }
    expect(studio).toContain("project.launchPath");
    expect(studio).toContain("project.siteSections");
  });

  it("discards transient flow UI before opening a saved launch", async () => {
    const workspace = await source("components", "token-studio-workspace.tsx");

    const resumeStart = workspace.indexOf("function openSavedLaunches() {");
    const resumeEnd = workspace.indexOf("function saveAndClose", resumeStart);
    const resumeBlock = workspace.slice(resumeStart, resumeEnd);

    expect(resumeBlock).toContain("parseSavedProjectIndex(");
    expect(resumeBlock).toContain("setStudioInstanceKey((current) => current + 1);");
    expect(resumeBlock).toContain('setPendingAction("saved");');
    expect(workspace).toContain("key={studioInstanceKey}");
    expect(workspace).toContain("<TokenStudio />");
  });

  it("handles missing or corrupt local storage as an empty vault", () => {
    expect(parseSavedProjectIndex(null)).toEqual([]);
    expect(parseSavedProjectIndex("not-json")).toEqual([]);
    expect(parseSavedProjectIndex("{}")).toEqual([]);
  });
});
