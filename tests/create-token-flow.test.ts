import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  calculateProjectWorkspaceScrollTop,
  isProjectRecoveryButtonLabel,
} from "@/components/new-token-controller";

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

  it("positions the create-token workspace below the sticky mobile header", () => {
    expect(calculateProjectWorkspaceScrollTop(500, 300, 72)).toBe(728);
    expect(calculateProjectWorkspaceScrollTop(20, 0, 72)).toBe(0);
    expect(calculateProjectWorkspaceScrollTop(250, 100, 0)).toBe(350);
  });

  it("keeps the recovery controller wired to the current workspace labels and landing point", async () => {
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
    expect(page).toContain('id="launch-studio"');
    expect(controller).toContain("isProjectRecoveryButtonLabel(buttonLabel(button))");
    expect(controller).toContain('document.getElementById("launch-studio")');
    expect(controller).toContain('a[aria-label="HOODLUMS home"]');
    expect(controller).toContain("focus({ preventScroll: true })");
    expect(controller).not.toContain('panel?.scrollIntoView({ behavior: "smooth", block: "start" })');
    expect(controller).toContain('sessionStorage.setItem(PENDING_PROJECT_KEY, blankProject.id)');
    expect(controller).toContain("window.location.reload()");
    expect(workspace).toContain("Create new token");
    expect(workspace).toContain("Open saved launches");
  });
});
