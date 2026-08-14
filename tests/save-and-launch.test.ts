import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function readStudioSource() {
  return readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
}

// Issue #313 Part B: once a site is generated, "Save and launch" saves the
// launch through the same durable saveProject persistence path used
// elsewhere in the studio, then opens the "Launch prepared" summary in one
// step — but only when the save actually succeeded.
describe("Save and launch", () => {
  it("reuses saveProject and only opens the launch summary when the save succeeds", async () => {
    const studio = await readStudioSource();

    expect(studio).toContain("async function saveAndLaunch() {");
    const fn = studio.slice(
      studio.indexOf("async function saveAndLaunch() {"),
      studio.indexOf("\n  }", studio.indexOf("async function saveAndLaunch() {")),
    );

    expect(fn).toContain('if (!(await saveProject("prepared"))) return;');
    expect(fn.indexOf('if (!(await saveProject("prepared"))) return;')).toBeLessThan(
      fn.indexOf("setShowLaunchSummary(true);"),
    );
    expect(fn).toContain("setShowLaunchSummary(true);");
  });

  it("only shows the button once a site has been generated", async () => {
    const studio = await readStudioSource();

    expect(studio).toContain("{project.generatedSiteHtml && (");
    const gated = studio.slice(
      studio.indexOf("{project.generatedSiteHtml && ("),
      studio.indexOf("{project.generatedSiteHtml && (") + 200,
    );
    expect(gated).toContain("onClick={saveAndLaunch}");
    expect(gated).toContain("Save and launch");
  });

  it("keeps the safe-mode wording in the launch summary modal unchanged", async () => {
    const studio = await readStudioSource();

    expect(studio).toContain("BLOCKED IN SAFE MODE");
    expect(studio).toContain(
      "Deployment isn&apos;t connected yet — this preview shows what your transaction will",
    );
  });
});
