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
  it("ships exactly the four approved slides in order", () => {
    expect(SOCIAL_SHOWCASE_SLIDES.map((slide) => slide.title)).toEqual([
      "Your voice, on autopilot",
      "Your mascot, everywhere",
      "Plan the month in minutes",
      "You stay in control",
    ]);
    expect(SOCIAL_SHOWCASE_SLIDES.map((slide) => slide.step)).toEqual([
      "Step 01",
      "Step 02",
      "Step 03",
      "Step 04",
    ]);
    expect(SOCIAL_SHOWCASE_SLIDES.map((slide) => slide.id)).toEqual([
      "voice",
      "mascot",
      "calendar",
      "control",
    ]);
  });

  it("gives the new calendar slide the approved copy", () => {
    const calendar = SOCIAL_SHOWCASE_SLIDES.find((slide) => slide.id === "calendar");

    expect(calendar?.body).toBe(
      "Tap a day, drop an idea, done. The AI writes the post and the artwork, publishes on time — never during quiet hours.",
    );
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
  it("wraps forward through all slides for an arbitrary slide count", () => {
    expect(nextShowcaseIndex(0, 4)).toBe(1);
    expect(nextShowcaseIndex(1, 4)).toBe(2);
    expect(nextShowcaseIndex(2, 4)).toBe(3);
    expect(nextShowcaseIndex(3, 4)).toBe(0);
  });

  it("clamps dot-navigation indexes into range in both directions", () => {
    expect(clampShowcaseIndex(-1, 4)).toBe(3);
    expect(clampShowcaseIndex(4, 4)).toBe(0);
    expect(clampShowcaseIndex(1, 4)).toBe(1);
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

  // Issue #323 part 2: auto-advancing while scrolled off screen still moved
  // the page's total layout height on the showcase's own clock, contributing
  // to the scroll-anchoring jumps reported on iPhone. Pausing while off
  // screen removes that background clock; a stacked, always-mounted visual
  // layer per slide removes the height change itself.
  it("pauses auto-advance while scrolled off screen via IntersectionObserver", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain("new IntersectionObserver");
    expect(component).toContain("setIsVisible(entry.isIntersecting)");
    expect(component).toContain("observer.disconnect()");
    expect(component).toContain("if (!isVisible) return;");
    expect(component.indexOf("if (!isVisible) return;")).toBeLessThan(
      component.indexOf("window.setInterval"),
    );
  });

  it("keeps every slide's visual mounted in one stacked grid cell so rotating slides can never change the section's layout height", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");
    const css = await source("components", "hoodlums-social-showcase.module.css");

    expect(component).toContain("SOCIAL_SHOWCASE_SLIDES.map((visualSlide, index) => {");
    expect(component).toContain("const active = index === activeIndex;");
    expect(component).toContain("styles.visualLayerHidden");
    expect(component).toContain('aria-hidden={active ? undefined : true}');

    expect(css).toMatch(/\.visualLayer\s*{[^}]*grid-area:\s*1\s*\/\s*1;/s);
    expect(css).toMatch(/\.visualLayerHidden\s*{[^}]*visibility:\s*hidden;/s);
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

  it("maps every slide id, including the new calendar slide, to a visual", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");
    const slideVisualsStart = component.indexOf("const SLIDE_VISUALS");
    const slideVisualsEnd = component.indexOf("export function HoodlumsSocialShowcase");
    const slideVisualsSource = component.slice(slideVisualsStart, slideVisualsEnd);

    expect(slideVisualsSource).toContain("voice: VoiceSlideVisual");
    expect(slideVisualsSource).toContain("mascot: MascotSlideVisual");
    expect(slideVisualsSource).toContain("calendar: CalendarSlideVisual");
    expect(slideVisualsSource).toContain("control: ControlSlideVisual");
  });

  it("recreates the Social Studio app shell as a shared decorative mini app window", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain('aria-hidden="true"');
    expect(component).toContain("appWindowTabs");
    expect(component).toContain("appWindowSidebar");
    expect(component).toMatch(/label:\s*"Setup"/);
    expect(component).toMatch(/label:\s*"Calendar"/);
    expect(component).toMatch(/label:\s*"Queue"/);
    expect(component).toMatch(/label:\s*"Rules"/);

    // Real, already-shipped assets only — no new image files.
    expect(component).toContain('src="/hoodlums-wordmark.svg"');
    expect(component).toContain('src="/hoodlums-social-wordmark.png"');
  });

  it("recreates the Setup tab as a mockup on slide 1 with the selling moments enlarged and readable", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain('activeTab="setup"');
    expect(component).toContain("Teach the AI your voice");
    expect(component).toContain("Example posts");
    expect(component).toContain("gm gm — another day, another chart to stare at. $ALLEY");
    expect(component).toContain("340 of you didn&apos;t sell. respect. that&apos;s the whole post.");
    expect(component).toContain("AI learning your voice — 14 / 20 posts analysed");
    expect(component).toContain("traitChip");
    expect((component.match(/styles\.traitChip\b/g) ?? []).length).toBeGreaterThanOrEqual(3);

    expect(component).toContain("Voice preview");
    expect(component).toContain('src="/showcase/mascot-trading.png"');
  });

  it("adds a Plan the month in minutes calendar mockup on the new slide 3", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain('activeTab="calendar"');
    expect(component).toContain("function CalendarSlideVisual");
    expect(component).toContain("calGrid");
    expect(component).toContain("calDaySel");
    expect(component).toContain("calDayMark");
    expect(component).toContain("addToOptionActive");
    expect(component).toContain("AI makes it");
    expect(component).toContain("Schedule it");
  });

  it("recreates the control surface as a mockup on slide 4 with the four approved controls", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    expect(component).toContain('activeTab="rules"');
    expect(component).toContain("modeToggleMini");
    expect(component).toContain("modeToggleMiniActive");
    expect(component).toContain("Approve first");

    expect(component).toContain("queueCard");
    expect(component).toContain("queuedApprove");
    expect(component).toContain("queuedEdit");

    expect(component).toContain("bannedChips");
    expect(component).toContain("guaranteed");
    expect(component).toContain("to the moon");
    expect(component).toContain("financial advice");

    expect(component).toContain("quietRow");
    expect(component).toContain('src="/showcase/mascot-celebrating.png"');
  });

  it("keeps the mini app-window recreations non-interactive with no focusable elements", async () => {
    const component = await source("components", "hoodlums-social-showcase.tsx");

    const appWindowStart = component.indexOf("function AppWindowFrame");
    const appWindowEnd = component.indexOf("const SLIDE_VISUALS");
    const appWindowSource = component.slice(appWindowStart, appWindowEnd);

    expect(appWindowStart).toBeGreaterThan(-1);
    expect(appWindowEnd).toBeGreaterThan(appWindowStart);
    expect(appWindowSource).not.toMatch(/<button|<input|<a\s|<textarea|tabIndex/);
  });

  it("stacks the mockup above the slide copy on phones and splits side by side on desktop", async () => {
    const css = await source("components", "hoodlums-social-showcase.module.css");

    expect(css).toMatch(/@media \(max-width: 640px\)\s*{[^]*?\.cols\s*{\s*grid-template-columns: 1fr;/s);
    expect(css).toMatch(/@media \(min-width: 900px\)\s*{[^]*?grid-template-areas:\s*\n\s*"visual step"/);
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
