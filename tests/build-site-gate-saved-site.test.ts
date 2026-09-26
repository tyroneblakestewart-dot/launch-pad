// Owner report, 13 Sep 2026: with a generated site already saved, the Build
// 02 button still read "GENERATE …" and another tap made a whole new (paid,
// for bespoke) design — wasteful and confusing. Once a site is saved the
// gate's primary action is OPEN GENERATED SITE, and making another design is
// an explicit, separately-labelled choice. Verified in headless Chromium
// against the real studio with a seeded saved project (18 checks at 1400px
// and 390px); these pins keep the contract in source.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

const gate = source("components/build-site-gate.tsx");

describe("Build 02 gate with a generated site already saved", () => {
  it("reads the studio's own saved-site panel as the one source of truth, and opens through its Reopen button", () => {
    expect(gate).toContain('const SAVED_SITE_PANEL_SELECTOR = ".preview-panel .site-preview-reopen";');
    expect(gate).toContain('const REOPEN_BUTTON_SELECTOR = ".reopen-generated-site-button";');
    expect(gate).toContain("return Boolean(document.querySelector(SAVED_SITE_PANEL_SELECTOR));");
    expect(gate).toContain("document.querySelector<HTMLButtonElement>(REOPEN_BUTTON_SELECTOR)?.click();");
    // Those are the studio's real class names, rendered exactly when generatedSiteHtml is set.
    const studio = source("components/token-studio.tsx");
    expect(studio).toContain("{project.generatedSiteHtml && (");
    expect(studio).toContain('<div className="site-preview-placeholder site-preview-reopen">');
    expect(studio).toContain('className="reopen-generated-site-button"');
    expect(studio).toContain("onClick={() => reopenGeneratedSite(project)}");
  });

  it("the primary button opens the saved site and only ever generates when nothing is saved", () => {
    expect(gate).toContain('button?.addEventListener("click", () => (savedSite ? openSavedSite() : startGeneration("free")));');
    expect(gate).toContain('button.textContent = generating\n          ? generatingMode === "bespoke"\n            ? "GENERATING BESPOKE SITE…"\n            : "ANALYSING ARTWORK…"\n          : "OPEN GENERATED SITE";');
    // Shown and enabled in saved mode regardless of the plan's free-generator flag or field readiness.
    expect(gate).toContain("if (savedSite) {\n        button.hidden = false;\n        button.disabled = generating;");
    // The bespoke generator button and its hint step aside; a saved-site hint takes over.
    expect(gate).toContain("if (secondaryButton) secondaryButton.hidden = true;\n        if (secondaryHint) secondaryHint.hidden = true;");
    expect(gate).toContain("if (savedHint) savedHint.hidden = !savedSite || generating;");
    expect(gate).toContain("Nothing new is generated unless you choose a different design below.");
  });

  it("regeneration is its own labelled row, one link per generator the plan offers, gated on readiness, hidden while generating", () => {
    expect(gate).toContain('<span class="build-site-regenerate-label">Want a different design?</span>');
    expect(gate).toContain('<button class="build-site-regenerate-free" type="button">Regenerate from artwork · free</button>');
    expect(gate).toContain(
      '<button class="build-site-regenerate-bespoke" type="button">Generate a new bespoke design · uses one of your paid designs</button>',
    );
    expect(gate).toContain('regenerateFree?.addEventListener("click", () => startGeneration("free"));');
    expect(gate).toContain('regenerateBespoke?.addEventListener("click", () => startGeneration("bespoke"));');
    expect(gate).toContain("if (regenerateRow) regenerateRow.hidden = !savedSite || generating;");
    expect(gate).toContain("regenerateFree.hidden = !fields.freeGenerator;\n        regenerateFree.disabled = !ready || generating;");
    expect(gate).toContain("regenerateBespoke.hidden = !fields.bespokeGenerator;\n        regenerateBespoke.disabled = !ready || generating;");
    // startGeneration gates on readiness itself now, since the primary button is enabled as the opener.
    expect(gate).toContain("if (!lastReady || generating) return;");
    expect(gate).not.toContain("if (button?.disabled || generating) return;");
    // Still exactly one dispatch call site, shared by every generator control.
    expect((gate.match(/window\.dispatchEvent\(new CustomEvent\("launchpad:generate-site"/g) || []).length).toBe(1);
  });

  it("a site appearing or disappearing counts as a real state change for the focus-aware poll", () => {
    expect(gate).toContain("const savedSiteNow = detectSavedSite();");
    expect(gate).toContain("const savedSiteFlipped = savedSiteNow !== savedSite;");
    expect(gate).toContain(
      "if (fromPoll && !readinessFlipped && !savedSiteFlipped && isBuilderTextInputFocused(elements.panel)) return;",
    );
    expect(gate).toContain('gate?.classList.toggle("saved-site", savedSite);');
  });

  it("the OPEN button wears the solid CTA in both stylesheets, including the studio-consistency overrides that outrank the gate's own", () => {
    expect(gate).toContain(".build-site-gate.saved-site .build-site-button:not(:disabled) {");
    expect(gate).toContain(".build-site-saved-hint[hidden], .build-site-regenerate[hidden],\n      .build-site-regenerate-free[hidden], .build-site-regenerate-bespoke[hidden] { display: none; }");
    expect(gate).toContain("@media (pointer: coarse) { .build-site-regenerate button { min-height: 44px; } }");
    const consistency = source("app/hoodlums-studio-consistency.css");
    // The "unlocked" outline rule is !important at #id specificity; the saved-site rule must match it or the button reads as an outline chip.
    expect(consistency).toContain("#launch-studio .build-site-gate.unlocked .build-site-button {");
    expect(consistency).toContain(
      "#launch-studio .build-site-gate.saved-site .build-site-button:not(:disabled) {\n  border-style: solid !important;\n  border-color: transparent !important;\n  color: #071008 !important;\n  background: var(--hoodlums-green) !important;",
    );
    expect(consistency).toContain("#launch-studio .build-site-regenerate button {");
  });

  it("the premium controller keeps relabelling only the bespoke generator button, which saved mode hides", () => {
    const premium = source("components/bespoke-site-premium-controller.tsx");
    expect(premium).toContain('".build-site-secondary-button"');
    expect(premium).not.toContain("build-site-regenerate");
    expect(premium).not.toContain("build-site-button\"");
  });
});
