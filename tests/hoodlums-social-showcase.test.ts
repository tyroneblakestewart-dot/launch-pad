import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SOCIAL_SHOWCASE_CTA_LABEL,
  SOCIAL_SHOWCASE_MASCOT_SCENES,
  SOCIAL_SHOWCASE_SLIDES,
  clampShowcaseIndex,
  nextShowcaseIndex,
  swipeDeltaToStep,
} from "@/lib/social-showcase";
import {
  OPEN_WORKSPACE_REQUEST_EVENT,
  requestWorkspaceOpen,
  type OpenWorkspaceRequestDetail,
} from "@/lib/workspace-open-request";

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("AI Social Studio showcase content (issue #278)", () => {
  it("ships exactly the three approved slides in order", () => {
    expect(SOCIAL_SHOWCASE_SLIDES.map((slide) => slide.title)).toEqual([
      "Your voice, on autopilot",
      "Your mascot, everywhere",
      "You stay in control",
    ]);
  });

  it("references the four approved mascot scene image slots", () => {
    expect(SOCIAL_SHOWCASE_MASCOT_SCENES).toEqual([
      { label: "Beach", src: "/showcase/mascot-beach.png" },
      { label: "Celebrating", src: "/showcase/mascot-celebrating.png" },
      { label: "Trading desk", src: "/showcase/mascot-trading.png" },
      { label: "Space", src: "/showcase/mascot-space.png" },
    ]);
  });

  it("uses the approved Pro CTA copy", () => {
    expect(SOCIAL_SHOWCASE_CTA_LABEL).toBe("Get started with Pro — $50/month");
  });
});

describe("AI Social Studio showcase carousel logic", () => {
  it("wraps forward through all three slides", () => {
    expect(nextShowcaseIndex(0, 3)).toBe(1);
    expect(nextShowcaseIndex(1, 3)).toBe(2);
    expect(nextShowcaseIndex(2, 3)).toBe(0);
  });

  it("clamps dot-navigation indexes into range in both directions", () => {
    expect(clampShowcaseIndex(-1, 3)).toBe(2);
    expect(clampShowcaseIndex(3, 3)).toBe(0);
    expect(clampShowcaseIndex(1, 3)).toBe(1);
  });

  it("only registers a swipe once it clears the threshold, and picks direction from the sign", () => {
    expect(swipeDeltaToStep(-10)).toBe(0);
    expect(swipeDeltaToStep(10)).toBe(0);
    expect(swipeDeltaToStep(-41)).toBe(1);
    expect(swipeDeltaToStep(41)).toBe(-1);
  });
});

describe("AI Social Studio showcase wiring", () => {
  it("sits at the bottom of the homepage, directly after the plans section", async () => {
    const home = await source("components", "hoodlums-market-home.tsx");

    expect(home).toContain("HoodlumsSocialShowcase");
    expect(home.indexOf("<HoodlumsPlansSection")).toBeLessThan(
      home.indexOf("<HoodlumsSocialShowcase"),
    );
  });

  it("wires its CTA into the same Pro-plan preselect flow as the homepage plan cards", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain('requestWorkspaceOpen("new", "pro")');
    expect(component).toContain("SOCIAL_SHOWCASE_CTA_LABEL");

    const target = new EventTarget();
    let received: OpenWorkspaceRequestDetail | null = null;
    target.addEventListener(OPEN_WORKSPACE_REQUEST_EVENT, (event) => {
      received = (event as CustomEvent<OpenWorkspaceRequestDetail>).detail;
    });
    requestWorkspaceOpen("new", "pro", target);
    expect(received).toEqual({ action: "new", launchPath: "pro" });
  });

  it("auto-advances on a timer and exposes dot navigation", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain("SOCIAL_SHOWCASE_AUTO_ADVANCE_MS");
    expect(component).toContain("window.setInterval");
    expect(component).toContain("window.clearInterval");
    expect(component).toContain("prefers-reduced-motion: reduce");
    expect(component).toContain('role="tablist"');
    expect(component).toContain("goToSlide(dotIndex)");
  });

  it("handles mobile swipe gestures via touch handlers", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain("onTouchStart={handleTouchStart}");
    expect(component).toContain("onTouchEnd={handleTouchEnd}");
    expect(component).toContain("swipeDeltaToStep");
  });

  it("renders labelled placeholder frames for mascot scenes until real artwork lands", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain("onError={() => setFailed(true)}");
    expect(component).toContain("mascotPlaceholder");
  });

  it("keeps the section background transparent so it blends into the shared ambient glow", async () => {
    const css = await source("components", "hoodlums-social-showcase.module.css");

    expect(css).not.toMatch(/\.section\s*{[^}]*background:/);
    expect(css).toContain("transparent");
  });

  it("clears the fixed mobile bottom nav pill with the same safe spacing as the plans section", async () => {
    const css = await source("components", "hoodlums-social-showcase.module.css");

    expect(css).toContain("padding-bottom: 126px;");
  });
});
