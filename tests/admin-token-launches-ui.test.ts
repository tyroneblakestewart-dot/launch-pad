import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Admin Token Launches UI (Milestone A, issue #409, rule 10)", () => {
  it("is wired into the existing authenticated admin dashboard as an independent section", async () => {
    const dashboard = await source("components", "admin-dashboard.tsx");
    expect(dashboard).toContain('import { AdminTokenLaunchesSection }');
    expect(dashboard).toContain('{ id: "token-launches", label: "Launches" }');
    expect(dashboard).toContain('<AdminTokenLaunchesSection />');
    expect(dashboard).toContain('activeSection === "token-launches"');
  });

  it("reads from the admin-only listing endpoint", async () => {
    const component = await source("components", "admin-token-launches-section.tsx");
    expect(component).toContain('"/api/admin/token-launches"');
  });

  it("shows token identity, creator, curve address and graduation status per row", async () => {
    const component = await source("components", "admin-token-launches-section.tsx");
    expect(component).toContain("launch.tokenName");
    expect(component).toContain("launch.ticker");
    expect(component).toContain("launch.creatorWalletAddress");
    expect(component).toContain("launch.curveAddress");
    expect(component).toContain("launch.graduated");
  });

  it("mirrors the existing admin section CSS module's mobile breakpoint for the 390px iPhone viewport (CLAUDE.md rule 7)", async () => {
    const pagesCss = await source("components", "admin-pages-section.module.css");
    const sectionCss = await source("components", "admin-token-launches-section.module.css");
    const breakpoint = pagesCss.match(/@media \(max-width: (\d+)px\)/)?.[1];
    expect(breakpoint).toBeTruthy();
    expect(sectionCss).toContain(`@media (max-width: ${breakpoint}px)`);
  });
});
