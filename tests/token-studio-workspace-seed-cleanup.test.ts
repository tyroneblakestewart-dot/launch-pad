import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function readWorkspaceSource() {
  return readFile(path.join(ROOT, "components", "token-studio-workspace.tsx"), "utf8");
}

describe("token studio workspace no longer force-seeds the operator's launch", () => {
  it("has no seeding function, seeded record constant or classifier left in the component", async () => {
    const workspace = await readWorkspaceSource();

    expect(workspace).not.toContain("seedHoodlumsLaunch");
    expect(workspace).not.toContain("HOODLUMS_LAUNCH");
    expect(workspace).not.toContain("HOODLUMS_CONTRACT");
    expect(workspace).not.toContain("isHoodlumsRecord");
  });

  it("only ever removes the seeded record on mount, and never writes it back", async () => {
    const workspace = await readWorkspaceSource();

    expect(workspace).toContain(
      'import { removeSeededHoodlumsLaunch } from "@/lib/hoodlums-seed-cleanup"',
    );
    expect(workspace).toContain("function cleanUpSeededHoodlumsLaunch() {");

    const cleanupBlock = workspace.slice(
      workspace.indexOf("function cleanUpSeededHoodlumsLaunch"),
      workspace.indexOf("function findStudioButton"),
    );
    expect(cleanupBlock).toContain("removeSeededHoodlumsLaunch(parsed)");
    expect(cleanupBlock).not.toContain("localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))");
    expect(cleanupBlock).not.toMatch(/setItem\(STORAGE_KEY,\s*JSON\.stringify\(\s*\[/);
  });

  it("calls the cleanup exactly once, from the mount effect", async () => {
    const workspace = await readWorkspaceSource();

    const invocations = workspace.match(/cleanUpSeededHoodlumsLaunch\(\);/g) || [];
    expect(invocations.length).toBe(1);

    const mountEffect = workspace.slice(
      workspace.indexOf("export function TokenStudioWorkspace"),
      workspace.indexOf("onProjectSaveResult"),
    );
    expect(mountEffect).toContain("useEffect(() => {\n    cleanUpSeededHoodlumsLaunch();\n  }, []);");
  });

  it("does not call any seeding/cleanup function from openWorkspace or openSavedLaunches", async () => {
    const workspace = await readWorkspaceSource();

    const openWorkspaceBlock = workspace.slice(
      workspace.indexOf("function openWorkspace"),
      workspace.indexOf("function openSavedLaunches"),
    );
    const openSavedLaunchesBlock = workspace.slice(
      workspace.indexOf("function openSavedLaunches"),
      workspace.indexOf("function saveAndClose"),
    );

    expect(openWorkspaceBlock).not.toContain("cleanUpSeededHoodlumsLaunch");
    expect(openWorkspaceBlock).not.toContain("localStorage");
    expect(openSavedLaunchesBlock).not.toContain("cleanUpSeededHoodlumsLaunch");
    expect(openSavedLaunchesBlock).not.toContain("localStorage");
  });
});
