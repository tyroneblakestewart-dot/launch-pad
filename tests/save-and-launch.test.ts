import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function studioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

// Issue #313 Part B: once a site is generated, "Save and launch" saves the
// project (reusing the same `saveProject` persistence path as "Save project"
// and "Prepare launch") and opens the "Launch prepared" summary modal in one
// step, but must never open that modal when the save reports failure.
describe("Save and launch", () => {
  it("only renders once a site has been generated", async () => {
    const source = await studioSource();
    const buttonIndex = source.indexOf('Save and launch');
    expect(buttonIndex).toBeGreaterThan(-1);

    const guardStart = source.lastIndexOf("{project.generatedSiteHtml &&", buttonIndex);
    expect(guardStart).toBeGreaterThan(-1);
    // Slice to the button TAG, not the label: the label comes after
    // onClick={saveAndLaunch}, whose closing brace made the original
    // assertion unpassable against any onClick at all.
    const tagStart = source.lastIndexOf("<button", buttonIndex);
    expect(tagStart).toBeGreaterThan(guardStart);
    expect(source.slice(guardStart, tagStart)).not.toContain("}");
  });

  it("reuses saveProject and only opens the launch summary modal on success", async () => {
    const source = await studioSource();
    const fnStart = source.indexOf("async function saveAndLaunch() {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf("\n  }", fnStart);
    const body = source.slice(fnStart, fnEnd);

    expect(body).toContain("if (!(await saveProject(");
    expect(body).toContain("return;");
    expect(body).toContain("setShowLaunchSummary(true);");

    // The early return must come before the modal is opened, so a failed
    // save can never open the launch window.
    expect(body.indexOf("return;")).toBeLessThan(body.indexOf("setShowLaunchSummary(true);"));

    // Must not duplicate saveProject's own slug validation / persistence —
    // it should be a thin wrapper, not a second implementation.
    expect(body).not.toContain("validateSlug(");
    expect(body).not.toContain("saveProjectToStorage(");
  });

  it("wires the button's onClick to saveAndLaunch, not directly to saveProject or prepareLaunch", async () => {
    const source = await studioSource();
    const buttonStart = source.indexOf("{project.generatedSiteHtml && (");
    const buttonEnd = source.indexOf(")}", buttonStart);
    const button = source.slice(buttonStart, buttonEnd);

    expect(button).toContain("onClick={saveAndLaunch}");
  });
});
