import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_PATH_OPTIONS,
  PLAN_CHOOSER_OPTIONS,
  PRO_BUNDLE_OPTION,
} from "@/lib/launch-paths";
import {
  PLAN_FAQS,
  planPriceForBilling,
  proBundlePriceForBilling,
  togglePlanFaq,
} from "@/lib/plans-section";
import type { LaunchPath } from "@/lib/types";
import {
  OPEN_WORKSPACE_REQUEST_EVENT,
  requestWorkspaceOpen,
  type OpenWorkspaceRequestDetail,
} from "@/lib/workspace-open-request";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("approved homepage plans section", () => {
  it("renders after the token grid with the required anchors and approved sections", async () => {
    const home = await source("components/hoodlums-market-home.tsx");
    const plans = await source("components/hoodlums-plans-section.tsx");

    expect(home.indexOf("<HoodlumsTokenGrid")).toBeLessThan(
      home.indexOf("<HoodlumsPlansSection"),
    );
    expect(plans).toContain('id="plans"');
    expect(plans).toContain('id="pro-bundle"');
    expect(plans).toContain("PLANS · CHOOSE YOUR PATH");
    expect(plans).toContain("Five ways in");
    expect(plans).toContain("Questions, answered");
  });

  it("keeps four compact cards plus the shared fifth Pro Bundle card", async () => {
    const plans = await source("components/hoodlums-plans-section.tsx");

    expect(plans).toContain("LAUNCH_PATH_OPTIONS.map");
    expect(plans).toContain("data-launch-path={option.id}");
    expect(plans).toContain("Get started with {option.name}");
    expect(plans).toContain("openWorkspaceWithPlan(option.id)");
    expect(LAUNCH_PATH_OPTIONS).toHaveLength(4);
    expect(PLAN_CHOOSER_OPTIONS).toHaveLength(5);
    expect(plans).toContain("PRO_BUNDLE_OPTION.name");
    expect(plans).toContain("PRO_BUNDLE_OPTION.bullets.map");
    expect(plans).toContain("openWorkspaceWithPlan(PRO_BUNDLE_OPTION.id)");
  });

  it("stacks cards on mobile, expands to four columns, and provides a mobile sticky CTA", async () => {
    const css = await source("components/hoodlums-plans-section.module.css");

    expect(css).toContain(".planGrid {\n  display: grid;\n  grid-template-columns: 1fr;");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(css).toContain(".bundleCard {\n  position: relative;\n  display: grid;\n  grid-template-columns: 1fr;");
    expect(css).toContain(".mobileStickyCta {");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});

describe("plans interactions", () => {
  it("opens only one FAQ at a time and closes it when tapped again", () => {
    expect(PLAN_FAQS.length).toBeGreaterThan(1);
    expect(togglePlanFaq(0, 1)).toBe(1);
    expect(togglePlanFaq(1, 1)).toBe(-1);
    expect(togglePlanFaq(-1, 3)).toBe(3);
  });

  it("dispatches all five plans into the same chooser event", () => {
    for (const option of PLAN_CHOOSER_OPTIONS) {
      const target = new EventTarget();
      let received: OpenWorkspaceRequestDetail | null = null;
      target.addEventListener(OPEN_WORKSPACE_REQUEST_EVENT, (event) => {
        received = (event as CustomEvent<OpenWorkspaceRequestDetail>).detail;
      });

      requestWorkspaceOpen("new", option.id as LaunchPath, target);
      expect(received).toEqual({ action: "new", launchPath: option.id });
    }
  });

  it("uses the approved Pro and Pro Bundle prices", () => {
    const pro = LAUNCH_PATH_OPTIONS.find((option) => option.id === "pro");
    expect(pro).toBeDefined();
    expect(planPriceForBilling(pro!, "monthly")).toBe("$50/month · per token");
    expect(planPriceForBilling(pro!, "upfront")).toBe("$120 / 3 months · per token");
    expect(PRO_BUNDLE_OPTION.price).toBe("$120/month · up to 3 tokens");
    expect(proBundlePriceForBilling("monthly")).toEqual({
      price: "$120",
      period: "/month · USD",
      note: "Up to 3 tokens · 20% off paid 3 months upfront",
    });
    expect(proBundlePriceForBilling("upfront").price).toBe("$288");
  });
});
