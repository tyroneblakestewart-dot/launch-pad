import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { calculateProjectWorkspaceScrollTop } from "@/components/token-studio-workspace";

const ROOT = process.cwd();

describe("create token flow", () => {
  it("positions the create-token workspace below the sticky mobile header", () => {
    expect(calculateProjectWorkspaceScrollTop(500, 300, 72)).toBe(728);
    expect(calculateProjectWorkspaceScrollTop(20, 0, 72)).toBe(0);
    expect(calculateProjectWorkspaceScrollTop(250, 100, 0)).toBe(350);
  });

  it("opens the native blank-token form without reloading or showing the projects modal", async () => {
    const page = await readFile(path.join(ROOT, "app", "page.tsx"), "utf8");
    const workspace = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.tsx"),
      "utf8",
    );
    const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
    const combined = `${page}\n${workspace}\n${studio}`;

    expect(page).not.toContain("NewTokenController");
    expect(combined).not.toContain("window.location.reload()");
    expect(combined).not.toContain("launchpad-pending-new-project");
    expect(combined).not.toContain("sessionStorage");
    expect(workspace).toContain('findStudioButton(action === "new" ? "new token" : "projects")');
    expect(workspace).toContain('if (action === "new")');
    expect(workspace).toContain("window.requestAnimationFrame(focusNewProjectEditor)");
    expect(studio).toContain("function startNewProject()");
    expect(studio).toContain("setProject(makeProject())");
    expect(studio).toContain('<button className="primary-button compact" onClick={startNewProject}>');
    expect(studio).toContain('<button className="primary-button full-width" onClick={startNewProject}>');
  });

  it("keeps the required landing position and focus without allowing Safari to move the page", async () => {
    const workspace = await readFile(
      path.join(ROOT, "components", "token-studio-workspace.tsx"),
      "utf8",
    );

    expect(workspace).toContain('document.getElementById("launch-studio")');
    expect(workspace).toContain('a[aria-label="HOODLUMS home"]');
    expect(workspace).toContain('input[placeholder="Hoodlums"]');
    expect(workspace).toContain("focus({ preventScroll: true })");
    expect(workspace).not.toContain('panel?.scrollIntoView({ behavior: "smooth", block: "start" })');
  });
});
