import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function studioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

async function pageSource() {
  return readFile(path.join(ROOT, "app", "(app)", "page.tsx"), "utf8");
}

// Issue #318: the studio's inline preview panel used to render a hardcoded
// "heist" mock (root@...:~$ initiate_heist, JOIN THE HEIST, STEAL THE
// MEMES, THE LOOT/THE PLAN terminal cards, TAKE FROM THE RICH...) with the
// user's own artwork dropped into it. Closing the real generated-site
// overlay revealed that mock, which reads as "my site got replaced by this
// template". None of that markup may render as a preview again.
describe("the fake heist preview is gone (issue #318)", () => {
  it("never renders heist copy or markup in the studio", async () => {
    const studio = await studioSource();

    for (const heistText of [
      "initiate_heist",
      "JOIN THE HEIST",
      "STEAL THE MEMES",
      "THE LOOT",
      "THE PLAN",
      "THE HEIST",
      "TAKE FROM THE RICH",
      "matrix-rain",
      "hooded-placeholder",
      "graffiti-ticker",
      "roadmap-grid",
    ]) {
      expect(studio).not.toContain(heistText);
    }
  });

  it("shows an honest empty state before a site has been generated", async () => {
    const studio = await studioSource();

    expect(studio).toContain("site-preview-placeholder");
    expect(studio).toContain("Your generated site will appear here");
  });

  it("shows a Reopen generated site card, not the heist template, once a site exists", async () => {
    const studio = await studioSource();

    expect(studio).toContain("Your generated site is saved");
    expect(studio).toContain("{project.generatedSiteHtml && (");
    expect(studio).toContain("reopen-generated-site-button");
    expect(studio).toContain("onClick={() => reopenGeneratedSite(project)}");
    expect(studio).toContain("Reopen generated site");
  });

  it("retires the Dexscreener studio mount that only anchored inside the removed heist markup", async () => {
    const page = await pageSource();
    expect(page).not.toContain("DexscreenerSiteSection");
  });
});

// Issue #318 owner review found two real defects, both fixed here:
// (1) the backdrop was appended as a sibling of the container inside
// .site-preview, but the stylesheet's own "hide everything except the
// container/status" rule caught it too, so it rendered 0x0 with no dim
// behind the floating window; (2) the floating Account launcher wasn't in
// the hide-while-overlay-open chrome rules, so it painted on top of the
// overlay on mobile.
describe("the branded overlay window (issue #318)", () => {
  it("mounts a backdrop as a sibling of the container and never hides it via the container/status exception rule", async () => {
    const generator = await generatorSource();

    expect(generator).toContain('backdrop.className = "full-generated-page-backdrop"');
    expect(generator).toContain("site.append(backdrop, container);");
    expect(generator).toContain(
      ".site-preview.full-generated-page > :not(.full-generated-page-container):not(.full-generated-page-backdrop):not(.full-generated-page-status) { display: none !important; }",
    );
  });

  it("gives the backdrop a real fixed, dimmed layer sitting just behind the container's z-index", async () => {
    const generator = await generatorSource();
    const backdropRuleStart = generator.indexOf(".full-generated-page-backdrop {");
    const backdropRuleEnd = generator.indexOf("}", backdropRuleStart);
    const backdropRule = generator.slice(backdropRuleStart, backdropRuleEnd);

    expect(backdropRule).toContain("position: fixed;");
    expect(backdropRule).toContain("inset: 0;");
    expect(backdropRule).toContain("z-index: 2147482999;");

    const containerRuleStart = generator.indexOf(".full-generated-page-container {");
    const containerRuleEnd = generator.indexOf("}", containerRuleStart);
    const containerRule = generator.slice(containerRuleStart, containerRuleEnd);
    expect(containerRule).toContain("z-index: 2147483000;");
  });

  it("is a fixed, centred window by default — not just once full screen is toggled", async () => {
    const generator = await generatorSource();
    const containerRuleStart = generator.indexOf(".full-generated-page-container {");
    const containerRuleEnd = generator.indexOf("}", containerRuleStart);
    const containerRule = generator.slice(containerRuleStart, containerRuleEnd);

    expect(containerRule).toContain("position: fixed;");
    expect(containerRule).toContain("transform: translate(-50%, -50%);");
  });

  it("removes the backdrop element when the preview is disposed", async () => {
    const generator = await generatorSource();
    const disposeStart = generator.indexOf("function disposeRenderedPreview(");
    const disposeEnd = generator.indexOf("\n}\n", disposeStart);
    const disposeBody = generator.slice(disposeStart, disposeEnd);

    expect(disposeBody).toContain("preview.backdrop.remove();");
  });
});

// Issue #318: "Save preview" reuses the studio's own durable local
// (IndexedDB + localStorage) save path — the same one "Save project"
// already uses — instead of re-implementing persistence, and reports
// exactly what that save did via PROJECT_SAVE_RESULT_EVENT.
describe("Save preview (issue #318)", () => {
  it("adds Save preview to the control bar in the owner-specified order", async () => {
    const generator = await generatorSource();

    expect(generator).toContain('savePreviewButton.textContent = "Save preview";');
    expect(generator).toContain(
      "controls.append(publishStatus, publishButton, fullScreenButton, savePreviewButton, closeButton);",
    );
  });

  it("drives the existing Save project control rather than duplicating persistence logic", async () => {
    const generator = await generatorSource();

    expect(generator).toContain("function findStudioSaveButton(): HTMLButtonElement | null");
    expect(generator).toContain('.querySelectorAll<HTMLButtonElement>(".builder-panel button")');
    expect(generator).toContain('button.textContent?.trim().toLowerCase() === "save project"');
    expect(generator).toContain("saveButton.click();");
  });

  it("listens for the real save result and reports success/failure honestly, not an assumed success", async () => {
    const generator = await generatorSource();
    const onSaveStart = generator.indexOf("const onSavePreview = () => {");
    const onSaveEnd = generator.indexOf("\n  };", onSaveStart);
    const onSaveBody = generator.slice(onSaveStart, onSaveEnd);

    expect(generator).toContain(
      'import {\n  PROJECT_SAVE_RESULT_EVENT,\n  type ProjectSaveResultDetail,\n} from "@/lib/project-save-result";',
    );
    expect(onSaveBody).toContain("window.addEventListener(PROJECT_SAVE_RESULT_EVENT, onResult);");
    expect(onSaveBody).toContain("detail?.success");
    expect(onSaveBody).toContain('"Preview saved with this launch."');
    expect(onSaveBody).toContain(
      '"The preview could not be saved — check the notice above and try again."',
    );
    // Honest failure when the save control can't even be found, instead of
    // silently doing nothing.
    expect(onSaveBody).toContain("if (!saveButton) {");
  });

  it("cleans up any pending save-result listener when the preview is disposed", async () => {
    const generator = await generatorSource();

    expect(generator).toContain("controlCleanups.push(() => cleanupPendingSaveResult?.());");
  });
});
