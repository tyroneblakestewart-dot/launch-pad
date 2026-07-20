import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isProjectRecoveryButtonLabel } from "@/components/new-token-controller";

const ROOT = process.cwd();

describe("create token flow", () => {
  it("reopens either the mounted projects control or the closed saved-launches workspace", () => {
    expect(isProjectRecoveryButtonLabel("Projects 3")).toBe(true);
    expect(isProjectRecoveryButtonLabel("Projects")).toBe(true);
    expect(isProjectRecoveryButtonLabel("Open saved launches")).toBe(true);
  });

  it("does not restart token creation while recovering a pending project", () => {
    expect(isProjectRecoveryButtonLabel("Create new token")).toBe(false);
    expect(isProjectRecoveryButtonLabel("+ New token")).toBe(false);
    expect(isProjectRecoveryButtonLabel("+ Create another token")).toBe(false);
  });

  it("keeps the recovery controller wired to the current workspace labels", async () => {
    const page = await readFile(path.join(ROOT, "app", "page.tsx"), "utf8");
    const controller = await readFile(
      path.join(ROOT, "components", "new-token-controller.tsx"),
      "utf8",
    );
    const workspace = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.tsx"),
      "utf8",
    );

    expect(page).toContain("<NewTokenController />");
    expect(controller).toContain("isProjectRecoveryButtonLabel(buttonLabel(button))");
    expect(controller).toContain('sessionStorage.setItem(PENDING_PROJECT_KEY, blankProject.id)');
    expect(controller).toContain("window.location.reload()");
    expect(workspace).toContain("Create new token");
    expect(workspace).toContain("Open saved launches");
  });
});
