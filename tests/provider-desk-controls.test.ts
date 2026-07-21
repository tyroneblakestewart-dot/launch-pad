import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("provider launch desk controls", () => {
  it("removes the unnecessary header, provider selectors and launch-provider button", async () => {
    const page = await readFile(path.join(ROOT, "app", "providers", "page.tsx"), "utf8");

    expect(page).toContain("main > header > div:last-child,");
    expect(page).toContain("main > ol + section,");
    expect(page).toContain('main label:has(input[type="file"]) + div > button:last-child');
    expect(page).toContain("display: none !important;");
    expect(page).toContain("grid-template-columns: repeat(2, minmax(0, 1fr)) !important;");
  });

  it("keeps the remaining launch-pack and verification workflow available", async () => {
    const page = await readFile(path.join(ROOT, "app", "providers", "page.tsx"), "utf8");
    const launcher = await readFile(
      path.join(ROOT, "components", "provider-launcher.tsx"),
      "utf8",
    );

    expect(page).toContain("<ProviderLauncher />");
    expect(launcher).toContain("Prepare launch data");
    expect(launcher).toContain("Verify and buy");
    expect(launcher).toContain("Copy launch pack");
    expect(launcher).toContain("Download artwork");
  });
});
