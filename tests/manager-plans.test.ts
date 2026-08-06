import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_PATH_OPTIONS,
  PRO_BUNDLE_OPTION,
} from "@/lib/launch-paths";
import {
  PRO_BUNDLE_FEATURES,
  planPriceForBilling,
  proBundlePlanPriceForBilling,
} from "@/lib/plans-section";
import { RESERVED_SLUGS } from "@/lib/slug";
import { findPageDefinition } from "@/lib/page-content-registry";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("Manager plan pricing", () => {
  it("formats the Pro Bundle price to match Pro's plan-card price format", () => {
    expect(PRO_BUNDLE_OPTION.price).toBe("$120/month · up to 3 tokens");
    expect(proBundlePlanPriceForBilling("monthly")).toBe("$120/month · up to 3 tokens");
    expect(proBundlePlanPriceForBilling("upfront")).toBe("$288 / 3 months · up to 3 tokens");
  });

  it("keeps the approved Pro price on the Manager page in sync with the homepage plan", () => {
    const pro = LAUNCH_PATH_OPTIONS.find((option) => option.id === "pro");
    expect(pro).toBeDefined();
    expect(planPriceForBilling(pro!, "monthly")).toBe("$50/month · per token");
    expect(planPriceForBilling(pro!, "upfront")).toBe("$120 / 3 months · per token");
  });

  it("keeps the approved Pro Bundle feature list intact", () => {
    expect(PRO_BUNDLE_FEATURES).toEqual(PRO_BUNDLE_OPTION.bullets);
    expect(PRO_BUNDLE_FEATURES).toContain("Everything in Pro for each of your 3 tokens");
    expect(PRO_BUNDLE_FEATURES).toContain(
      "20% off when you pay 3 months upfront ($288 instead of $360)",
    );
  });
});

describe("Manager page markup", () => {
  it("renders exactly two matching plan cards — Pro and Pro Bundle — reusing the homepage plan-card styles", async () => {
    const component = await source("components/manager-plans.tsx");

    expect(component).toContain('from "./hoodlums-plans-section.module.css"');
    expect(component).toContain('data-launch-path="pro"');
    expect(component).toContain('data-launch-path="pro-bundle"');
    expect(component).toContain("planStyles.planCard");
    expect(component).toContain("Get started with Pro");
    expect(component).toContain("Get Pro Bundle");
  });

  it("presets Pro and Pro Bundle as separate shared chooser paths", async () => {
    const component = await source("components/manager-plans.tsx");

    expect(component).toContain('storeLaunchPathPreset("pro")');
    expect(component).toContain('storeLaunchPathPreset("pro-bundle")');
    expect(component).not.toContain('onClick={() => storeLaunchPathPreset("pro")}\n            >\n              Get Pro Bundle');
  });

  it("does not show Bond, Bond + Site, or Bond + Pro Site on the Manager page", async () => {
    const component = await source("components/manager-plans.tsx");

    expect(component).not.toContain("Bond + Site");
    expect(component).not.toContain("Bond + Pro Site");
    expect(component).not.toContain('id === "bond"');
    expect(component).toContain('LAUNCH_PATH_OPTIONS.find((option) => option.id === "pro")');
  });

  it("shares one billing toggle across both cards", async () => {
    const component = await source("components/manager-plans.tsx");

    expect(component).toContain('useState<PlansBilling>("monthly")');
    expect(component).toContain("planPriceForBilling(proOption, billing)");
    expect(component).toContain("proBundlePlanPriceForBilling(billing)");
    expect(component).toContain("PLANS_BILLING_OPTIONS.map");
  });

  it("stacks the two cards on mobile and places them side by side from 720px", async () => {
    const css = await source("components/manager-plans.module.css");

    expect(css).toContain(".grid {\n  display: grid;\n  grid-template-columns: 1fr;");
    expect(css).toContain("@media (min-width: 720px)");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
  });
});

describe("Manager nav entry", () => {
  it("points the Manager tab at /manager and keeps Providers reachable but hidden", async () => {
    const navigation = await source("components/app-navigation.tsx");

    expect(navigation).toContain('href: "/manager", label: "Manager"');
    expect(navigation).toContain('href: "/providers", label: "Providers"');

    const providersEntry = navigation.slice(
      navigation.indexOf('href: "/providers"'),
      navigation.indexOf('href: "/allocations"'),
    );
    expect(providersEntry).toContain("hidden: true");

    const allocationsEntry = navigation.slice(
      navigation.indexOf('href: "/allocations"'),
      navigation.indexOf('href: "/liquidity-lab"'),
    );
    expect(allocationsEntry).toContain("hidden: true");
  });

  it("filters hidden items out of VISIBLE_NAV_ITEMS without removing them from NAV_ITEMS", async () => {
    const navigation = await source("components/app-navigation.tsx");

    expect(navigation).toContain('NAV_ITEMS.filter((item) => !("testnetOnly" in item && item.testnetOnly))');
    expect(navigation).toContain('.filter((item) => !("hidden" in item && item.hidden))');
  });

  it("reserves the manager slug so no public site can collide with the new route", () => {
    expect(RESERVED_SLUGS.has("manager")).toBe(true);
  });
});

describe("Manager page CMS registration", () => {
  it("registers the manager page with default header copy", () => {
    const page = findPageDefinition("manager");
    expect(page).toBeDefined();
    expect(page?.route).toBe("/manager");

    const defaults = Object.fromEntries((page?.elements ?? []).map((element) => [element.id, element.defaultValue]));
    expect(defaults.header_title).toBe("Grow your token after launch.");
  });
});
