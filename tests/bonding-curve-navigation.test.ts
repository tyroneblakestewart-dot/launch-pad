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

  it("lays out five mobile workflow controls", async () => {
    const navigationStyles = await source("components/app-navigation.module.css");
    expect(navigationStyles).toContain("grid-template-columns:repeat(5,minmax(0,1fr))");
  });

  it("keeps the new page truthful about its testnet status", async () => {
    const page = await source("app/bonding-curve/page.tsx");

    expect(page).toContain("ROBINHOOD CHAIN TESTNET · STEP 5");
    expect(page).toContain("FOUNDATION MERGED");
    expect(page).toContain("are not active yet");
    expect(page).toContain('href="/testnet"');
    expect(page).toContain('href="/liquidity-lab"');
  });
});
