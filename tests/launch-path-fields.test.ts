// Plan-aware Token setup (owner direction, 6 Sep 2026): the form shows only
// what the chosen plan needs — just a token, a token + free site, or a token +
// paid site — so it is less confusing. One pure module decides; the React
// form and the DOM-driven Build 02 gate both read it.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STUDIO_FIELD_PLAN_ATTRIBUTE,
  offersWebsiteBuild,
  studioFieldsForLaunchPath,
} from "@/lib/launch-path-fields";

async function source(relative: string): Promise<string> {
  return readFile(path.join(process.cwd(), relative), "utf8");
}

describe("studioFieldsForLaunchPath", () => {
  it("bond is the token only — no website fields, no generator", () => {
    const fields = studioFieldsForLaunchPath("bond");
    expect(fields).toEqual({
      websitePath: false,
      freeSiteSections: false,
      freeGenerator: false,
      bespokeGenerator: false,
    });
    expect(offersWebsiteBuild(fields)).toBe(false);
  });

  it("bond-site is the free site: path, sections and the free generator, nothing bespoke", () => {
    const fields = studioFieldsForLaunchPath("bond-site");
    expect(fields).toEqual({
      websitePath: true,
      freeSiteSections: true,
      freeGenerator: true,
      bespokeGenerator: false,
    });
    expect(offersWebsiteBuild(fields)).toBe(true);
  });

  it("bond-pro-site is the paid site: path and the bespoke generator, no free picker", () => {
    const fields = studioFieldsForLaunchPath("bond-pro-site");
    expect(fields).toEqual({
      websitePath: true,
      freeSiteSections: false,
      freeGenerator: false,
      bespokeGenerator: true,
    });
  });

  it("Social Studio subscriptions buy no website, so a token under them gets the free set", () => {
    expect(studioFieldsForLaunchPath("pro")).toEqual(studioFieldsForLaunchPath("bond-site"));
    expect(studioFieldsForLaunchPath("pro-bundle")).toEqual(studioFieldsForLaunchPath("bond-site"));
  });

  it("shows everything until a plan is chosen, and for anything it does not recognise", () => {
    for (const value of [null, undefined, "", "mystery"]) {
      expect(studioFieldsForLaunchPath(value)).toEqual({
        websitePath: true,
        freeSiteSections: true,
          freeGenerator: true,
        bespokeGenerator: true,
      });
    }
  });
});

describe("the studio form and the Build 02 gate read the same plan", () => {
  it("stamps the plan on the builder panel and renders the website path and free sections only when the plan has them", async () => {
    const studio = await source("components/token-studio.tsx");
    expect(studio).toContain("const studioFields = studioFieldsForLaunchPath(project.launchPath);");
    expect(studio).toContain("{...{ [STUDIO_FIELD_PLAN_ATTRIBUTE]: project.launchPath ?? undefined }}");
    expect(studio).toContain('{studioFields.websitePath && (\n            <label>\n              <span className="field-label">Website path</span>');
    expect(studio).toContain('{studioFields.freeSiteSections && (\n          <div className="field-group">\n            <span className="field-label">Free site sections</span>');
    // The empty preview is plan-aware too: a token-only plan says so instead of "generate a website above".
    expect(studio).toContain("{!project.generatedSiteHtml && offersWebsiteBuild(studioFields) && (");
    expect(studio).toContain("{!project.generatedSiteHtml && !offersWebsiteBuild(studioFields) && (");
    expect(studio).toContain("No website in this plan");
    expect(STUDIO_FIELD_PLAN_ATTRIBUTE).toBe("data-launch-path");
  });

  it("hides each generator and the whole gate per plan, and never locks a token-only preview", async () => {
    const gate = await source("components/build-site-gate.tsx");
    expect(gate).toContain("return studioFieldsForLaunchPath(panel.getAttribute(STUDIO_FIELD_PLAN_ATTRIBUTE));");
    expect(gate).toContain("gate.hidden = !showBuild;");
    expect(gate).toContain('gate.classList.toggle("bespoke-only", fields.bespokeGenerator && !fields.freeGenerator);');
    expect(gate).toContain("if (button) button.hidden = !fields.freeGenerator;");
    expect(gate).toContain("if (secondaryButton) secondaryButton.hidden = !fields.bespokeGenerator;");
    expect(gate).toContain('elements.previewPanel.classList.toggle("site-builder-locked", !unlocked && showBuild);');
    expect(gate).toContain("overlay.hidden = unlocked || !showBuild;");
    // A URL typed under a paid plan never reaches the free generator once the plan changes.
    // Hidden controls must actually disappear, and the lone bespoke button takes the CTA recipe.
    expect(gate).toContain(".build-site-gate[hidden] { display: none; }");
    expect(gate).toContain(".build-site-button[hidden], .build-site-hint[hidden],\n      .build-site-secondary-button[hidden], .build-site-secondary-hint[hidden] { display: none; }");
    expect(gate).toContain(".build-site-gate.bespoke-only .build-site-secondary-button:not(:disabled) {\n        color: var(--cta-color, #071008);");
  });
});
