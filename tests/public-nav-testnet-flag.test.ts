import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("public nav testnet-tools flag", () => {
  it("keeps all five workflow routes defined so pages stay reachable", async () => {
    const navigation = await source("components/app-navigation.tsx");

    expect(navigation).toContain('href: "/"');
    expect(navigation).toContain('href: "/providers"');
    expect(navigation).toContain('href: "/allocations"');
    expect(navigation).toContain('href: "/liquidity-lab"');
    expect(navigation).toContain('href: "/bonding-curve"');
  });

  it("marks liquidity lab and bonding curve as testnet-only", async () => {
    const navigation = await source("components/app-navigation.tsx");
    const liquidityEntry = navigation.slice(navigation.indexOf('href: "/liquidity-lab"'), navigation.indexOf('href: "/bonding-curve"'));
    const curveEntry = navigation.slice(navigation.indexOf('href: "/bonding-curve"'));

    expect(liquidityEntry).toContain("testnetOnly: true");
    expect(curveEntry.slice(0, curveEntry.indexOf("\n"))).toContain("testnetOnly: true");
  });

  it("gates testnet-only items and the sidebar note behind NEXT_PUBLIC_SHOW_TESTNET_TOOLS", async () => {
    const navigation = await source("components/app-navigation.tsx");

    expect(navigation).toContain(
      'const SHOW_TESTNET_TOOLS = process.env.NEXT_PUBLIC_SHOW_TESTNET_TOOLS === "true";'
    );
    expect(navigation).toContain("NAV_ITEMS.filter((item) => !(\"testnetOnly\" in item && item.testnetOnly))");

    const sidebarNoteIndex = navigation.indexOf("sidebarNote");
    const guardIndex = navigation.lastIndexOf("SHOW_TESTNET_TOOLS &&", sidebarNoteIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(sidebarNoteIndex);
  });

  it("renders desktop's workflow and utility groups, and the mobile pill, from the same filtered item list", async () => {
    // Issue #396: the desktop sidebar splits VISIBLE_NAV_ITEMS into a
    // numbered workflow list and a separate bottom-pinned utility group
    // (Support), while the mobile pill still renders the single flat list.
    const navigation = await source("components/app-navigation.tsx");

    expect(navigation).toContain(
      'const WORKFLOW_NAV_ITEMS = VISIBLE_NAV_ITEMS.filter((item) => !("utility" in item && item.utility));',
    );
    expect(navigation).toContain(
      'const UTILITY_NAV_ITEMS = VISIBLE_NAV_ITEMS.filter((item) => "utility" in item && item.utility);',
    );
    expect(navigation).toContain("WORKFLOW_NAV_ITEMS.map((item) => {");
    expect(navigation).toContain("UTILITY_NAV_ITEMS.map((item) => {");
    expect(navigation).toContain("{VISIBLE_NAV_ITEMS.map((item) => (");
    expect(navigation).not.toContain("{NAV_ITEMS.map(");
  });

  it("keeps the liquidity-lab and bonding-curve pages in place", async () => {
    const liquidityPage = await source("app/(app)/liquidity-lab/page.tsx");
    const curvePage = await source("app/(app)/bonding-curve/page.tsx");

    expect(liquidityPage.length).toBeGreaterThan(0);
    expect(curvePage.length).toBeGreaterThan(0);
  });
});
