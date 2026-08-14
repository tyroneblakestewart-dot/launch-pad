import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSavedTokenProjects,
  serialiseSavedTokenProjects,
  toIndexEntry,
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

  // The localStorage index is deliberately lightweight (issue #307) — it
  // never carries heroImage or generatedSiteHtml, which routinely blow past
  // the ~5MB localStorage quota. Those two fields live in IndexedDB instead
  // (see tests/token-project-db.test.ts and
  // tests/token-project-persistence.test.ts) and are merged back in when a
  // saved launch is reopened.
  it("round-trips every lightweight index field for a partially completed launch, excluding heavy blob fields", () => {
    const indexEntry = toIndexEntry(PARTIAL_LAUNCH);
    const raw = serialiseSavedTokenProjects([indexEntry]);
    const restored = parseSavedTokenProjects(raw);

    expect(restored).toEqual([indexEntry]);
    expect(Object.keys(restored[0]).sort()).toEqual(Object.keys(indexEntry).sort());
    expect(restored[0]).not.toHaveProperty("heroImage");
    expect(restored[0]).not.toHaveProperty("generatedSiteHtml");
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
        ...toIndexEntry(PARTIAL_LAUNCH),
        siteSections: { about: true, tokenomics: true, howToBuy: false, roadmap: true, faq: true },
      },
    ]);

    const restored = parseSavedTokenProjects(legacyRaw);

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

  it("keeps the full project as the save and restore source of truth, via IndexedDB-backed helpers instead of a single localStorage blob", async () => {
    const studio = await source("components", "token-studio.tsx");

    const saveStart = studio.indexOf("async function saveProject(");
    const saveEnd = studio.indexOf("async function deleteProject", saveStart);
    const saveBlock = studio.slice(saveStart, saveEnd);
    expect(saveBlock).toContain("const saved: TokenProject = {");
    expect(saveBlock).toContain("...project,");
    expect(saveBlock).toContain("const outcome = await saveProjectToStorage(saved, projects);");
    expect(saveBlock).toContain("if (!outcome.success) {");
    expect(saveBlock).toContain("setNotice(outcome.error);");
    expect(saveBlock).toContain("setProjects(outcome.index);");

    const loadStart = studio.indexOf("async function loadProject(entry: SavedProjectIndexEntry) {");
    const loadEnd = studio.indexOf("async function handleImage", loadStart);
    const loadBlock = studio.slice(loadStart, loadEnd);
    expect(loadBlock).toContain("const outcome = await loadProjectFromStorage(entry);");
    expect(loadBlock).toContain("if (!outcome.success) {");
    expect(loadBlock).toContain("setProject(saved);");
    expect(loadBlock).toContain("reopenGeneratedSite(saved);");
    expect(loadBlock).toContain("const requiresPayment = isPaidLaunchPath(saved.launchPath);");
    expect(loadBlock).toContain("setShowPathChooser(requiresPayment);");
    expect(loadBlock).toContain("if (!requiresPayment) reopenGeneratedSite(saved);");

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

  it("keeps the full workspace and saved generated preview inert until paid resume is verified", async () => {
    const studio = await source("components", "token-studio.tsx");
    const workspaceStart = studio.indexOf('<section\n        className="workspace"');
    const workspaceEnd = studio.indexOf(">", workspaceStart);
    const workspaceOpeningTag = studio.slice(workspaceStart, workspaceEnd);

    expect(workspaceOpeningTag).toContain("aria-disabled={showPathChooser || undefined}");
    expect(workspaceOpeningTag).toContain("inert={showPathChooser || undefined}");
  });

  it("discards transient flow UI before opening a saved launch", async () => {
    const workspace = await source("components", "token-studio-workspace.tsx");

    const resumeStart = workspace.indexOf("function openSavedLaunches() {");
    const resumeEnd = workspace.indexOf("function saveAndClose", resumeStart);
    const resumeBlock = workspace.slice(resumeStart, resumeEnd);

    expect(resumeBlock).toContain("parseSavedTokenProjects(");
    expect(resumeBlock).toContain("setStudioInstanceKey((current) => current + 1);");
    expect(resumeBlock).toContain('setPendingAction("saved");');
    expect(workspace).toContain("key={studioInstanceKey}");
    expect(workspace).toContain("<TokenStudio />");
  });

  it("handles missing or corrupt local storage as an empty vault", () => {
    expect(parseSavedTokenProjects(null)).toEqual([]);
    expect(parseSavedTokenProjects("not-json")).toEqual([]);
    expect(parseSavedTokenProjects("{}" )).toEqual([]);
  });
});
