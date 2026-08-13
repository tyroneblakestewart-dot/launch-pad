import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSavedTokenProjects,
  serialiseSavedTokenProjects,
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

  it("round-trips every TokenProject field for a partially completed launch", () => {
    const raw = serialiseSavedTokenProjects([PARTIAL_LAUNCH]);
    const restored = parseSavedTokenProjects(raw);

    expect(restored).toEqual([PARTIAL_LAUNCH]);
    expect(Object.keys(restored[0]).sort()).toEqual(Object.keys(PARTIAL_LAUNCH).sort());
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
        ...PARTIAL_LAUNCH,
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

  it("keeps the complete project object as the save and restore source of truth", async () => {
    const studio = await source("components", "token-studio.tsx");

    const saveStart = studio.indexOf("function saveProject(");
    const saveEnd = studio.indexOf("function startNewProject", saveStart);
    const saveBlock = studio.slice(saveStart, saveEnd);
    expect(saveBlock).toContain("const saved: TokenProject = {");
    expect(saveBlock).toContain("...project,");
    expect(saveBlock).toContain("persist(nextProjects);");

    const loadStart = studio.indexOf("function loadProject(saved: TokenProject) {");
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
