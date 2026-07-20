import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("provider launch desk controls", () => {
  it("removes the unnecessary header and provider selector buttons from the page", async () => {
    const page = await readFile(path.join(ROOT, "app", "providers", "page.tsx"), "utf8");

    expect(page).toContain("main > header > div:last-child,");
    expect(page).toContain("main > ol + section");
    expect(page).toContain("display: none !important;");
  });

  it("keeps the provider launch form and verification workflow available", async () => {
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
