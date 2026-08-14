import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

async function studioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

async function globalsCss() {
  return readFile(path.join(ROOT, "app", "globals.css"), "utf8");
}

// Issue #318: closing the preview used to reveal a hardcoded "heist" mock
// (root@…:~$ initiate_heist, JOIN THE HEIST, STEAL THE MEMES, THE LOOT / THE
// PLAN terminal cards, TAKE FROM THE RICH…) that a user could easily mistake
// for their own generated site. The panel must now only ever show an honest
// empty state or a "Reopen generated site" card, and the real preview must
// open as one branded overlay window with a Publish draft / Full screen /
// Save preview / Close preview control bar.
describe("the generated-site overlay replaces the heist preview mock (issue #318)", () => {
  it("removes every trace of the heist markup from the studio", async () => {
    const studio = await studioSource();

    for (const heistString of [
      "initiate_heist",
      "JOIN THE HEIST",
      "STEAL THE MEMES",
      "THE LOOT",
      "THE PLAN",
      "THE HEIST",
      "TAKE FROM THE RICH",
      "GIVE TO THE MEMES",
      "matrix-rain",
      "hooded-placeholder",
      "graffiti-ticker",
    ]) {
      expect(studio).not.toContain(heistString);
    }
  });

  it("removes the now-dead heist CSS from globals.css", async () => {
    const css = await globalsCss();

    for (const heistSelector of [
      ".matrix-rain",
      ".preview-nav",
      ".hero-section",
      ".graffiti-ticker",
      ".hero-buttons",
      ".contract-strip",
      ".hero-art",
      ".spray-ring",
      ".hooded-placeholder",
      ".chain-stamp",
      ".ticker-tape",
      ".terminal-card",
      ".roadmap-grid",
      ".buy-section",
      ".social-row",
    ]) {
      expect(css).not.toContain(`${heistSelector} `);
      expect(css).not.toContain(`${heistSelector} {`);
    }
  });

  it("shows an honest empty state before a website is generated", async () => {
    const studio = await studioSource();

    expect(studio).toContain("{!project.generatedSiteHtml && (");
    expect(studio).toContain("Your generated site will appear here");
    expect(studio).toContain("site-preview-placeholder");
  });

  it("shows a Reopen generated site card, gated on a saved generation, instead of the heist template", async () => {
    const studio = await studioSource();

    expect(studio).toContain("{project.generatedSiteHtml && (");
    expect(studio).toContain("Your generated site is saved");
    expect(studio).toContain("reopen-generated-site-button");
    expect(studio).toContain("onClick={() => reopenGeneratedSite(project)}");
    expect(studio).toContain("Reopen generated site");
  });

  it("retires the DexscreenerSiteSection studio mount that only anchored inside the removed heist markup", async () => {
    const page = await readFile(path.join(ROOT, "app", "(app)", "page.tsx"), "utf8");
    expect(page).not.toContain("DexscreenerSiteSection");
  });
});

describe("the branded overlay window (issue #318)", () => {
  it("mounts the backdrop and container on document.body, not inside .site-preview (issue #320)", async () => {
    const generator = await generatorSource();

    expect(generator).toContain('backdrop.className = "full-generated-page-backdrop";');
    // Regression for the owner-reported positioning trap: .preview-panel
    // applies a `filter` while the build gate is locked, and a filtered
    // ancestor becomes the containing block for `position: fixed`
    // descendants — mounting outside .site-preview permanently escapes
    // that (and every other ancestor filter/transform/sticky trap).
    expect(generator).toContain("document.body.append(backdrop, container);");
    expect(generator).not.toContain("site.append(backdrop, container);");
    // Since the backdrop/container are no longer .site-preview children,
    // the hide-the-rest rule no longer needs exceptions for them — only
    // the status banner (which is still appended directly to .site-preview)
    // stays visible.
    expect(generator).toContain(
      ".site-preview.full-generated-page > :not(.full-generated-page-status) { display: none !important; }",
    );
    expect(generator).toContain(".full-generated-page-backdrop {");
    expect(generator).toContain("position: fixed;");
  });

  it("removes the backdrop on dispose alongside the container and frame", async () => {
    const generator = await generatorSource();
    const disposeStart = generator.indexOf("function disposeRenderedPreview(preview: RenderedPreview | null) {");
    const disposeEnd = generator.indexOf("}", generator.indexOf("preview.backdrop.remove();", disposeStart)) + 1;
    const disposeBody = generator.slice(disposeStart, disposeEnd);

    expect(disposeBody).toContain("preview.container.remove();");
    expect(disposeBody).toContain("preview.backdrop.remove();");
  });

  it("is a fixed, centred window by default — not embedded inline in the studio panel", async () => {
    const generator = await generatorSource();
    const containerRuleStart = generator.indexOf(".full-generated-page-container {");
    const containerRuleEnd = generator.indexOf("}", containerRuleStart);
    const containerRule = generator.slice(containerRuleStart, containerRuleEnd);

    expect(containerRule).toContain("position: fixed;");
    expect(containerRule).toContain("top: 50%;");
    expect(containerRule).toContain("left: 50%;");
    expect(containerRule).toContain("transform: translate(-50%, -50%);");
  });

  it("keeps exactly one iframe and toggles full screen on the existing container", async () => {
    const generator = await generatorSource();
    const iframeCreations = generator.match(/document\.createElement\("iframe"\)/g) || [];
    const toggleStart = generator.indexOf("const onToggleFullScreen = () => {");
    const toggleEnd = generator.indexOf("};", toggleStart) + 2;
    const toggleBody = generator.slice(toggleStart, toggleEnd);

    expect(iframeCreations).toHaveLength(1);
    expect(toggleBody).toContain('container.classList.toggle("full-generated-page-fullscreen")');
    expect(toggleBody).not.toContain('document.createElement("iframe")');
  });
});

describe("the overlay control bar order and Save preview wiring (issue #318)", () => {
  it("orders the control bar Publish draft · Full screen · Save preview · Close preview", async () => {
    const generator = await generatorSource();
    const appendIndex = generator.indexOf(
      "controls.append(publishStatus, publishButton, fullScreenButton, saveButton, closeButton);",
    );
    expect(appendIndex).toBeGreaterThan(-1);

    expect(generator).toContain('publishButton.textContent = "Publish draft";');
    expect(generator).toContain('fullScreenButton.textContent = "Full screen";');
    expect(generator).toContain('saveButton.textContent = "Save preview";');
    expect(generator).toContain('closeButton.textContent = "Close preview";');
  });

  it("drives Save preview through the studio's own Save project button, not a duplicate save path", async () => {
    const generator = await generatorSource();
    const onSaveStart = generator.indexOf("const onSavePreview = () => {");
    const onSaveEnd = generator.indexOf("const onPublishDraft = async () => {", onSaveStart);
    const onSaveBody = generator.slice(onSaveStart, onSaveEnd);

    expect(onSaveBody).toContain('findStudioButtonByLabel("save project")');
    expect(onSaveBody).toContain("studioSaveButton.click()");
    expect(onSaveBody).not.toContain("indexedDB");
    expect(onSaveBody).not.toContain("localStorage");
  });

  it("reports Save preview success and failure honestly from PROJECT_SAVE_RESULT_EVENT, not an assumed success", async () => {
    const generator = await generatorSource();

    expect(generator).toContain(
      'import { PROJECT_SAVE_RESULT_EVENT, type ProjectSaveResultDetail } from "@/lib/project-save-result";',
    );
    expect(generator).toContain("window.addEventListener(PROJECT_SAVE_RESULT_EVENT, pendingSaveResultListener);");
    expect(generator).toContain('detail?.success\n        ? "Preview saved."\n        : "The preview could not be saved."');
  });

  it("cleans up any pending save-result listener on dispose", async () => {
    const generator = await generatorSource();

    expect(generator).toContain("controlCleanups.push(clearPendingSaveResultListener);");
  });
});
