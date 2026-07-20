import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Studio workspace simplicity", () => {
  it("keeps token setup and Prepare Launch in one workspace without extra management tabs", async () => {
    const workspace = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.tsx"),
      "utf8",
    );
    const studio = await readFile(
      path.join(ROOT, "components", "token-studio.tsx"),
      "utf8",
    );
    const css = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.module.css"),
      "utf8",
    );

    expect(workspace).toContain("Create new token");
    expect(workspace).toContain("Open saved launches");
    expect(workspace).toContain("<TokenStudio />");
    expect(studio).toContain("Token setup");
    expect(studio).toContain("Prepare launch");

    expect(workspace).not.toContain("Launched Tokens");
    expect(workspace).not.toContain("Bonding Curve");
    expect(workspace).not.toContain('role=\"tablist\"');
    expect(css).not.toContain(".studioTabs");
    expect(css).not.toContain(".curveLayout");
  });
});
