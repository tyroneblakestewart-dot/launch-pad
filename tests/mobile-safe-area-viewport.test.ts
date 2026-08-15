import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

// Issue #327 problem 2: the mobile full-screen preview extends its control
// bar padding into env(safe-area-inset-*), which only resolves against a
// non-zero value once the page opts in to viewport-fit=cover. Without this,
// every env(safe-area-inset-*) reference in the codebase silently resolves
// to 0.
describe("root viewport opts in to safe-area insets (issue #327 problem 2)", () => {
  it("declares viewport-fit: cover via the Next.js viewport export", async () => {
    const layout = await readFile(path.join(ROOT, "app", "layout.tsx"), "utf8");

    expect(layout).toContain("export const viewport: Viewport = {");
    expect(layout).toContain('viewportFit: "cover"');
  });
});
