import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("desktop launch and bonding form layout", () => {
  it("adds a live desktop launch summary while retaining provider logic", async () => {
    const component = await source("components", "provider-launcher.tsx");
    const css = await source("components", "provider-launcher.module.css");

    expect(component).toContain("desktopTokenSummary");
    expect(component).toContain("desktopAdvancedToggle");
    expect(component).toContain("desktopPrimaryLaunch");
    expect(component).toContain("launchReady");
    expect(component).toContain("Provider-managed");
    expect(component).toContain("openProvider");
    expect(component).toContain("verifyLaunch");
    expect(component).toContain("openProviderForBuy");
    expect(component).toContain("ROBINHOOD_MAINNET");
    expect(component).not.toContain('document.createElement("iframe")');

    expect(css).toContain("@media (min-width: 901px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1.72fr) minmax(320px, .82fr)");
    expect(css).toContain(".mobileLaunchButton { display: none !important; }");
    expect(css).toContain("@media (max-width: 900px)");
  });

  it("keeps the existing mobile launch controls outside desktop-only hiding rules", async () => {
    const component = await source("components", "provider-launcher.tsx");
    const css = await source("components", "provider-launcher.module.css");

    expect(component).toContain("Copy launch pack");
    expect(component).toContain("Download artwork");
    expect(component).toContain("Continue straight to BUY TOKEN");
    expect(component).toContain("mobileLaunchButton");
    expect(css.indexOf(".desktopAdvancedField { display: none !important; }")).toBeGreaterThan(
      css.indexOf("@media (min-width: 901px)"),
    );
  });

  it("shows a truthful desktop bonding form and preserves the legacy mobile page", async () => {
    const page = await source("app", "(app)", "bonding-curve", "page.tsx");
    const css = await source("app", "(app)", "bonding-curve", "bonding-curve.module.css");

    expect(page).toContain("desktopWorkspace");
    expect(page).toContain("legacyLayout");
    expect(page).toContain("Bonding deployment not active yet");
    expect(page).toContain("100% of current supply");
    expect(page).toContain("60% treasury · 40% creator");
    expect(page).toContain("Contract merged · not deployed");
    expect(page).toContain("FLOW_STEPS.map");
    expect(page).not.toContain('document.createElement("iframe")');

    expect(css).toContain(".desktopWorkspace { display: none; }");
    expect(css).toContain("@media (min-width: 901px)");
    expect(css).toContain(".legacyLayout { display: none; }");
    expect(css).toContain("@media (max-width: 900px)");
  });
});
