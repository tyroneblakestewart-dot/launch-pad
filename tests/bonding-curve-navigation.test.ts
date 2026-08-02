import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("bonding curve workflow page", () => {
  it("adds the bonding curve after liquidity lab as step five", async () => {
    const navigation = await source("components/app-navigation.tsx");
    const liquidityIndex = navigation.indexOf('href: "/liquidity-lab"');
    const curveIndex = navigation.indexOf('href: "/bonding-curve"');

    expect(liquidityIndex).toBeGreaterThan(-1);
    expect(curveIndex).toBeGreaterThan(liquidityIndex);
    expect(navigation).toContain('label: "Bonding Curve"');
    expect(navigation).toContain('icon: "curve", step: "5"');
  });

  it("lays out the mobile workflow controls with a dynamic column count", async () => {
    const navigationStyles = await source("components/app-navigation.module.css");
    expect(navigationStyles).toContain("grid-template-columns:repeat(var(--nav-count,5),minmax(0,1fr))");
  });

  it("keeps the new page truthful about its testnet status", async () => {
    const page = await source("app/(app)/bonding-curve/page.tsx");

    expect(page).toContain("FOUNDATION MERGED");
    expect(page).toContain("are not active yet");
    // The hero eyebrow, next-milestone copy and CTA links are now
    // CMS-editable (see lib/page-content-registry.ts) instead of hardcoded
    // here, so the page renders them from resolved content.
    expect(page).toContain("content.hero_eyebrow");
    expect(page).toContain("content.primary_cta_link");
    expect(page).toContain("content.secondary_cta_link");
  });

  it("registers truthful default copy and links for the bonding-curve CMS elements", async () => {
    const { findPageDefinition } = await import("@/lib/page-content-registry");
    const page = findPageDefinition("bonding-curve");
    const defaults = Object.fromEntries(
      (page?.elements || []).map((element) => [element.id, element.defaultValue]),
    );

    expect(defaults.hero_eyebrow).toBe("ROBINHOOD CHAIN TESTNET · STEP 5");
    expect(defaults.primary_cta_link).toBe("/testnet");
    expect(defaults.secondary_cta_link).toBe("/liquidity-lab");
  });
});
