import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEIGHT_REPORT_IGNORE_THRESHOLD_PX } from "@/components/full-website-generator";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

// Issue #323 part 2.4: the generated-page iframe used to reapply the scaled
// preview's layout on every reported height, however small, and could shrink
// the frame while a reader was mid-scroll — both contributed to the page
// jumping around under a reader. applyHeight must ignore small noise and
// refuse to shrink while the window is scrolling.
describe("generated-site preview height-report stability (issue #323 part 2.4)", () => {
  it("exports the ignore-threshold constant used to filter noisy height reports", () => {
    expect(HEIGHT_REPORT_IGNORE_THRESHOLD_PX).toBe(24);
  });

  it("ignores height changes smaller than the threshold", async () => {
    const generator = await generatorSource();
    const applyHeightStart = generator.indexOf("function applyHeight(nextReportedHeight: number) {");
    const applyHeightEnd = generator.indexOf("\n  }", applyHeightStart);
    const applyHeightBody = generator.slice(applyHeightStart, applyHeightEnd);

    expect(applyHeightBody).toContain(
      "if (Math.abs(delta) < HEIGHT_REPORT_IGNORE_THRESHOLD_PX) return;",
    );
  });

  it("refuses to shrink the frame while the window is mid-scroll", async () => {
    const generator = await generatorSource();
    const applyHeightStart = generator.indexOf("function applyHeight(nextReportedHeight: number) {");
    const applyHeightEnd = generator.indexOf("\n  }", applyHeightStart);
    const applyHeightBody = generator.slice(applyHeightStart, applyHeightEnd);

    expect(applyHeightBody).toContain("if (delta < 0 && isWindowScrolling) return;");
  });

  it("tracks window scroll activity and clears the listener on dispose", async () => {
    const generator = await generatorSource();

    expect(generator).toContain('window.addEventListener("scroll", onScrollActivity, { passive: true });');
    expect(generator).toContain('controlCleanups.push(() => {');
    expect(generator).toContain('window.removeEventListener("scroll", onScrollActivity);');
  });
});
