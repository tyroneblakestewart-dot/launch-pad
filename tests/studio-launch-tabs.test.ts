import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function readStudioFiles() {
  const workspace = await readFile(
    path.join(ROOT, "components", "token-studio-workspace.tsx"),
    "utf8",
  );
  const studio = await readFile(path.join(ROOT, "components", "token-studio.tsx"), "utf8");
  const css = await readFile(
    path.join(ROOT, "components", "token-studio-workspace.module.css"),
    "utf8",
  );
  return { workspace, studio, css };
}

describe("Studio launch-management tabs", () => {
  it("keeps token setup and basic Prepare Launch together in Create Token", async () => {
    const { workspace, studio } = await readStudioFiles();

    expect(workspace).toContain('id: "create", label: "Create Token"');
    expect(workspace).toContain("Token setup and the basic Prepare Launch checks live together here.");
    expect(workspace).toContain("<TokenStudio />");
    expect(studio).toContain("Token setup");
    expect(studio).toContain("Prepare launch");
  });

  it("adds accessible Create Token, Launched Tokens and Bonding Curve tabs", async () => {
    const { workspace, css } = await readStudioFiles();

    expect(workspace).toContain('label: "Create Token"');
    expect(workspace).toContain('label: "Launched Tokens"');
    expect(workspace).toContain('label: "Bonding Curve"');
    expect(workspace).toContain('role="tablist"');
    expect(workspace).toContain('role="tab"');
    expect(workspace).toContain('role="tabpanel"');
    expect(workspace).toContain("aria-selected={activeTab === tab.id}");
    expect(css).toContain(".studioTabs");
    expect(css).toContain(".activeTab");
  });

  it("shows only launched projects that have a recorded contract or mint", async () => {
    const { workspace } = await readStudioFiles();

    expect(workspace).toContain('project.status === "launched"');
    expect(workspace).toContain("project.contractAddress.trim().length > 0");
    expect(workspace).toContain("Open explorer ↗");
    expect(workspace).toContain("Use in Bonding Curve");
    expect(workspace).toContain('?cluster=devnet');
  });

  it("provides a browser-only testnet curve planner without a transaction action", async () => {
    const { workspace, css } = await readStudioFiles();

    expect(workspace).toContain("hoodlums-testnet-bonding-curve-plans-v1");
    expect(workspace).toContain("Supply allocated to curve");
    expect(workspace).toContain("Graduation target");
    expect(workspace).toContain("Starting virtual liquidity");
    expect(workspace).toContain("Save testnet curve plan");
    expect(workspace).toContain("Planning only — no bonding-curve contract or transaction is connected yet.");
    expect(workspace).toContain("10_000n");
    expect(workspace).not.toContain("eth_sendTransaction");
    expect(workspace).not.toContain("signAndSendTransaction");
    expect(css).toContain(".curveLayout");
    expect(css).toContain(".saveCurveButton:disabled");
    expect(css).toContain("@media (max-width: 700px)");
  });
});
