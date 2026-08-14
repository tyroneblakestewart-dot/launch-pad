import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SAVE_GENERATED_SITE_EVENT,
  SAVE_GENERATED_SITE_RESULT_EVENT,
} from "@/components/full-website-generator";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

async function studioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

// Issue #318: the branded generated-site overlay's control bar is
// "Publish draft · Full screen · Save preview · Close preview". Save preview
// must persist through the same durable local-storage path as the existing
// "Save project" button and report success/failure honestly.
describe("Save preview control (issue #318)", () => {
  it("exposes stable event names for the studio/overlay event bus", () => {
    expect(SAVE_GENERATED_SITE_EVENT).toBe("launchpad:save-generated-site");
    expect(SAVE_GENERATED_SITE_RESULT_EVENT).toBe("launchpad:save-generated-site-result");
  });

  it("adds the Save preview button between Full screen and Close preview", async () => {
    const generator = await generatorSource();

    expect(generator).toContain('saveButton.textContent = "Save preview";');
    expect(generator).toContain(
      "controls.append(publishStatus, publishButton, fullScreenButton, saveButton, closeButton);",
    );
  });

  it("asks the studio to save over the event bus and reflects the result on the shared status text", async () => {
    const generator = await generatorSource();

    const onSavePreviewStart = generator.indexOf("const onSavePreview = () => {");
    const onSavePreviewEnd = generator.indexOf("};", onSavePreviewStart) + 2;
    const onSavePreviewBody = generator.slice(onSavePreviewStart, onSavePreviewEnd);
    expect(onSavePreviewBody).toContain("saveButton.disabled = true;");
    expect(onSavePreviewBody).toContain("window.dispatchEvent(new CustomEvent(SAVE_GENERATED_SITE_EVENT));");

    const onResultStart = generator.indexOf("const onSavePreviewResult = (event: Event) => {");
    const onResultEnd = generator.indexOf("};", onResultStart) + 2;
    const onResultBody = generator.slice(onResultStart, onResultEnd);
    expect(onResultBody).toContain("saveButton.disabled = false;");
    expect(onResultBody).toContain("publishStatus.textContent = detail?.message");

    expect(generator).toContain(
      "window.addEventListener(SAVE_GENERATED_SITE_RESULT_EVENT, onSavePreviewResult);",
    );
    expect(generator).toContain(
      "window.removeEventListener(SAVE_GENERATED_SITE_RESULT_EVENT, onSavePreviewResult)",
    );
  });

  it("reuses the exact same durable saveProject persistence path as the Save project button", async () => {
    const studio = await studioSource();

    const listenerStart = studio.indexOf("function onSavePreviewRequest() {");
    const listenerEnd = studio.indexOf("\n    window.addEventListener(SAVE_GENERATED_SITE_EVENT", listenerStart);
    const listenerBody = studio.slice(listenerStart, listenerEnd);

    // Must call the same saveProject the "Save project" button uses, not a
    // second, parallel persistence path.
    expect(listenerBody).toContain("saveProject()");
    expect(listenerBody).not.toContain("saveProjectToStorage(");
    expect(listenerBody).toContain("new CustomEvent(SAVE_GENERATED_SITE_RESULT_EVENT");
    expect(listenerBody).toContain("success,");

    expect(studio).toContain("window.addEventListener(SAVE_GENERATED_SITE_EVENT, onSavePreviewRequest);");
    expect(studio).toContain("window.removeEventListener(SAVE_GENERATED_SITE_EVENT, onSavePreviewRequest);");
  });

  it("keeps saveProject returning a plain boolean so existing truthiness checks stay correct", async () => {
    const studio = await studioSource();

    // Regression guard: earlier drafts of this feature considered changing
    // saveProject's return type to carry a message, which would silently
    // break `if (!(await saveProject("prepared"))) return;` elsewhere since
    // an object is always truthy.
    expect(studio).toContain("async function saveProject(nextStatus: TokenProject[\"status\"] = project.status): Promise<boolean> {");
    expect(studio).toContain('if (!(await saveProject("prepared"))) return;');
  });
});
