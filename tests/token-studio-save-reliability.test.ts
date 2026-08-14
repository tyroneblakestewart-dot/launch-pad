import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function studioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

function blockBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

// Root cause of issue #307: `persist()` wrote the full generated HTML plus
// artwork straight into a single localStorage key with no try/catch, so a
// quota-exceeded write threw, was swallowed, and the UI still behaved as if
// the save had succeeded — leaving a "Saved launches" row with nothing
// behind it. These tests pin the fix: every save path is awaited,
// error-handled, and never reports success without the heavy data actually
// landing in IndexedDB first.
describe("token studio save reliability (issue #307)", () => {
  it("imports the IndexedDB-backed blob store instead of writing heavy fields to localStorage", async () => {
    const studio = await studioSource();

    expect(studio).toContain(
      'import { deleteProjectBlob, getProjectBlob, putProjectBlob } from "@/lib/token-project-db"',
    );
    expect(studio).toContain("SavedProjectIndexEntry");
  });

  it("makes saveProject async and awaits the IndexedDB write before persisting the index", async () => {
    const studio = await studioSource();
    const saveBlock = blockBetween(studio, "async function saveProject(", "function startNewProject");

    expect(saveBlock).toContain("try {");
    expect(saveBlock).toContain("await putProjectBlob({");
    expect(saveBlock.indexOf("await putProjectBlob({")).toBeLessThan(
      saveBlock.indexOf("persist(nextProjects);"),
    );
    expect(saveBlock).toContain("} catch (error) {");
  });

  it("never marks a save successful, updates the index, or shows the saved notice when the blob write fails", async () => {
    const studio = await studioSource();
    const saveBlock = blockBetween(studio, "async function saveProject(", "function startNewProject");

    const catchStart = saveBlock.indexOf("} catch (error) {");
    const catchEnd = saveBlock.indexOf("setProject(saved);", catchStart);
    const catchBlock = saveBlock.slice(catchStart, catchEnd);

    expect(catchBlock).toContain("could not be saved");
    expect(catchBlock).toContain("Nothing was added to Saved launches");
    expect(catchBlock).toContain("success: false");
    expect(catchBlock).toContain("return false;");
    // The failure branch must never call persist() or report success — a
    // ghost "Saved launches" row is exactly the bug this issue fixes.
    expect(catchBlock).not.toContain("persist(nextProjects)");
    expect(catchBlock).not.toContain("success: true");
  });

  it("awaits saveProject before showing the launch summary", async () => {
    const studio = await studioSource();

    expect(studio).toContain("async function prepareLaunch() {");
    expect(studio).toContain('if (!(await saveProject("prepared"))) return;');
  });

  it("makes deleteProject async and awaits removing the blob before dropping the index entry", async () => {
    const studio = await studioSource();
    const deleteBlock = blockBetween(
      studio,
      "async function deleteProject(id: string) {",
      "async function loadProject(",
    );

    expect(deleteBlock).toContain("await deleteProjectBlob(id);");
  });

  it("makes loadProject async, restores the heavy fields from IndexedDB, and surfaces a clear error instead of crashing", async () => {
    const studio = await studioSource();
    const loadBlock = blockBetween(
      studio,
      "async function loadProject(entry: SavedProjectIndexEntry) {",
      "async function handleImage",
    );

    expect(loadBlock).toContain("const blob = await getProjectBlob(entry.id);");
    expect(loadBlock).toContain("} catch (error) {");
    expect(loadBlock).toContain("could not be opened");
  });

  it("migrates legacy localStorage data into IndexedDB on load instead of showing entries that won't open", async () => {
    const studio = await studioSource();
    const mountEffectBlock = blockBetween(
      studio,
      "async function loadSavedProjects() {",
      "loadSavedProjects();",
    );

    expect(mountEffectBlock).toContain("migrateLegacySavedProjects(raw)");
    expect(mountEffectBlock).toContain("await Promise.all(blobs.map((blob) => putProjectBlob(blob)");
    expect(mountEffectBlock).toContain(
      "localStorage.setItem(STORAGE_KEY, serialiseSavedProjectIndex(index));",
    );
    expect(mountEffectBlock).toContain("droppedCount");
  });

  it("never writes heroImage or generatedSiteHtml directly into the localStorage index", async () => {
    const studio = await studioSource();

    expect(studio).toContain(
      "const { heroImage: _heroImage, generatedSiteHtml: _html, ...indexEntry } = saved;",
    );
    expect(studio).toContain("function persist(nextProjects: SavedProjectIndexEntry[]) {");
  });
});
