import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-pattern assertions for the token page premium surface pass (issue
// #455) — matching tests/token-page-view-ui.test.ts's own established
// approach (this repo's Vitest suite runs with no jsdom, so interactive
// client components/CSS Modules are covered by reading source text rather
// than a rendered DOM).

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `expected a rule for ${selector}`).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

// A few classes (`.swapPanel`, `.chartPlaceholder`, `.statsPanel`,
// `.feePanel`, `.activityPanel`) get an early mobile `order:`-only rule from
// the grid-ordering section, plus a later rule carrying their actual visual
// chrome — this finds that later, styling rule specifically.
function lastRuleBody(css: string, selector: string): string {
  const start = css.lastIndexOf(`${selector} {`);
  expect(start, `expected a rule for ${selector}`).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("token page premium surface — shared recipes defined once (issue #455)", () => {
  it("defines every design-token custom property exactly once, on .page", async () => {
    const css = await source("components/token-page/token-page.module.css");
    for (const token of [
      "--tp-panel-bg",
      "--tp-panel-shadow",
      "--tp-well-bg",
      "--tp-well-shadow",
      "--tp-raised-bg",
      "--tp-raised-shadow",
      "--tp-chip-active-bg",
      "--tp-chip-active-shadow",
      "--tp-chip-active-text-shadow",
      "--tp-mono",
      "--tp-heading",
      "--tp-sans",
      "--tp-lime",
      "--tp-red",
      "--tp-mint",
      "--tp-on-lime",
    ]) {
      const occurrences = css.split(`${token}:`).length - 1;
      expect(occurrences, `expected ${token} to be declared exactly once`).toBe(1);
    }
  });

  it("the master panel recipe carries a 3-stop gradient and the three-shadow stack (inset highlight, hairline, layered drop shadow)", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const pageRule = css.slice(css.indexOf(".page {"), css.indexOf("\n}\n", css.indexOf(".page {")));
    expect(pageRule).toContain(
      "--tp-panel-bg: linear-gradient(180deg, rgba(24, 28, 25, 0.99) 0%, rgba(15, 18, 16, 0.99) 34%, rgba(9, 11, 10, 0.99) 100%);",
    );
    expect(pageRule).toContain(
      "--tp-panel-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.07) inset, 0 0 0 1px rgba(0, 0, 0, 0.5), 0 30px 70px -24px rgba(0, 0, 0, 0.8);",
    );

    const panelSurface = ruleBody(css, ".panelSurface");
    expect(panelSurface).toContain("background: var(--tp-panel-bg);");
    expect(panelSurface).toContain("box-shadow: var(--tp-panel-shadow);");
  });

  it("every major panel class composes the master panel recipe instead of redeclaring flat borders/backgrounds", async () => {
    const css = await source("components/token-page/token-page.module.css");
    for (const selector of [".headerBand", ".panel"]) {
      const rule = ruleBody(css, selector);
      expect(rule, `expected ${selector} to compose panelSurface`).toContain("composes: panelSurface;");
    }
    // `.activityPanel` and `.chartPlaceholder` also get an early mobile
    // `order:`-only rule from the grid-ordering section — their visual
    // chrome (and the `composes` line) lives in a later rule.
    for (const selector of [".activityPanel", ".chartPlaceholder"]) {
      const rule = lastRuleBody(css, selector);
      expect(rule, `expected ${selector} to compose panelSurface`).toContain("composes: panelSurface;");
    }
  });

  it("inset wells (YOU PAY / YOU RECEIVE / holder breakdown) compose the inset-well recipe, whose own shadow is an inset shadow", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const insetWell = ruleBody(css, ".insetWell");
    expect(insetWell).toContain("box-shadow: var(--tp-well-shadow);");
    expect(insetWell).toContain("background: var(--tp-well-bg);");

    const pageRule = css.slice(css.indexOf(".page {"), css.indexOf("\n}\n", css.indexOf(".page {")));
    expect(pageRule).toMatch(/--tp-well-shadow:.*inset/);

    for (const selector of [".fieldBox", ".holderBreakdown"]) {
      const rule = ruleBody(css, selector);
      expect(rule, `expected ${selector} to compose insetWell`).toContain("composes: insetWell;");
    }
  });

  it("raised micro-buttons (back link, swap-arrow bead) compose the raised recipe", async () => {
    const css = await source("components/token-page/token-page.module.css");
    for (const selector of [".backLink", ".swapDividerIcon"]) {
      const rule = ruleBody(css, selector);
      expect(rule, `expected ${selector} to compose raisedMicroButton`).toContain("composes: raisedMicroButton;");
    }
  });

  it("the shared chip active state carries border, tint background, inset+glow shadow and text-shadow together", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const chipActive = ruleBody(css, ".chipActive");
    expect(chipActive).toContain("border: var(--tp-chip-active-border);");
    expect(chipActive).toContain("background: var(--tp-chip-active-bg);");
    expect(chipActive).toContain("box-shadow: var(--tp-chip-active-shadow);");
    expect(chipActive).toContain("text-shadow: var(--tp-chip-active-text-shadow);");
    expect(chipActive).toContain("color: var(--tp-lime);");

    const pageRule = css.slice(css.indexOf(".page {"), css.indexOf("\n}\n", css.indexOf(".page {")));
    expect(pageRule).toMatch(/--tp-chip-active-shadow:.*inset.*rgba\(198, 245, 62/);

    // Consumers that reuse the chip recipe via `composes` instead of
    // redeclaring it: chart timeframe rail, chart volume toggle, and the
    // Stats/Audit segment + slippage chips (via the dedicated
    // `.pillButtonChipActive` alias, since those two share `.pillButton`'s
    // >=44px sizing rather than `.chipBase`'s own).
    for (const selector of [".chartIntervalButtonActive", ".chartVolumeToggleActive", ".pillButtonChipActive"]) {
      const rule = ruleBody(css, selector);
      expect(rule, `expected ${selector} to compose chipActive`).toContain("composes: chipActive;");
    }
  });
});

describe("token page premium surface — CTAs are solid lime, never a gradient (issue #455 rule 1, site-wide)", () => {
  it("every CTA/withdraw class uses a solid #c6f53e background with no gradient anywhere in its own rule", async () => {
    const css = await source("components/token-page/token-page.module.css");
    for (const selector of [".tradeButton", ".feeWithdrawButton", ".terminalFallbackLink", ".chatComposerSend"]) {
      const rule = ruleBody(css, selector);
      expect(rule, `expected ${selector} to use the solid lime CTA background`).toContain("background: var(--tp-lime);");
      expect(rule, `expected ${selector} to use on-lime text`).toContain("color: var(--tp-on-lime);");
      expect(rule.toLowerCase(), `expected ${selector} to never use a gradient`).not.toContain("gradient");
    }
  });

  it("Buy and Sell CTAs share the identical solid-lime treatment — Sell no longer gets a distinct red/ghost scheme", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const rule = ruleBody(css, ".tradeButtonBuy,\n.tradeButtonSell");
    expect(rule).toContain("background: var(--tp-lime);");
    expect(rule).toContain("color: var(--tp-on-lime);");
    expect(css).not.toContain("rgba(255, 95, 86");
  });

  it("--tp-lime resolves to the exact design value everywhere a CTA references it", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const pageRule = css.slice(css.indexOf(".page {"), css.indexOf("\n}\n", css.indexOf(".page {")));
    expect(pageRule).toContain("--tp-lime: #c6f53e;");
    expect(pageRule).toContain("--tp-on-lime: #071008;");
  });
});

describe("token page premium surface — fonts (issue #455)", () => {
  it("routes body/button text through Inter, headings/big figures through Archivo Black, and labels/numbers through IBM Plex Mono, all already loaded app-wide", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const pageRule = css.slice(css.indexOf(".page {"), css.indexOf("\n}\n", css.indexOf(".page {")));
    expect(pageRule).toContain('--tp-sans: Inter, system-ui, sans-serif;');
    expect(pageRule).toContain('--tp-heading: "Archivo Black", Inter, sans-serif;');
    expect(pageRule).toContain('--tp-mono: "IBM Plex Mono", monospace;');
    // No stray old-font literals left anywhere in the module.
    expect(css).not.toContain("JetBrains Mono");
  });

  it("this route's own font link requests exactly Inter + Archivo Black + IBM Plex Mono — the same families app/globals.css already loads app-wide — introducing no new font dependency", async () => {
    const layout = await source("app/token/layout.tsx");
    expect(layout).toContain("family=Archivo+Black");
    expect(layout).toContain("family=Inter:wght@400;500;600;700;800");
    expect(layout).toContain("family=IBM+Plex+Mono:wght@400;500;600;700;800");
    expect(layout).not.toContain("family=Archivo:wght");
    expect(layout).not.toContain("JetBrains");
  });
});

describe("token page premium surface — chart options (issue #455 section 7)", () => {
  it("grid lines use the stated horizontal/vertical opacities, never the same flat value for both", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('horzLines: { color: "rgba(255, 255, 255, 0.045)" }');
    expect(component).toContain('vertLines: { color: "rgba(255, 255, 255, 0.035)" }');
  });

  it("candles are lime up / red (#e2564b) down — no longer a grey down candle", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('const UP_COLOR = "#c6f53e";');
    expect(component).toContain('const DOWN_COLOR = "#e2564b";');
  });

  it("MA50 is white (design: 'MA20 lime, MA50 white'), MA20 stays lime", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain('const MA20_COLOR = "rgba(198, 245, 62, 0.85)";');
    expect(component).toContain('const MA50_COLOR = "rgba(255, 255, 255, 0.34)";');
  });

  it("the crosshair is dashed at 0.35 opacity on both axes", async () => {
    const component = await source("components/token-page/token-trade-chart.tsx");
    expect(component).toContain("crosshair: {");
    expect(component).toContain('color: "rgba(255, 255, 255, 0.35)"');
    expect(component).toContain("style: LineStyle.Dashed");
  });
});

describe("token page premium surface — prefers-reduced-motion (issue #455 rule)", () => {
  it("disables the LIVE dot pulse and chip/segment/tab transitions, placed after the mobile-first .grid rule and every layout breakpoint", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const reducedMotionStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(reducedMotionStart).toBeGreaterThan(-1);

    const gridIndex = css.indexOf(".grid {");
    expect(gridIndex).toBeGreaterThan(-1);
    expect(gridIndex).toBeLessThan(reducedMotionStart);

    const reducedMotionEnd = css.indexOf("\n}\n", reducedMotionStart);
    const block = css.slice(reducedMotionStart, reducedMotionEnd);
    expect(block).toContain(".liveDot {\n    animation: none;");
    expect(block).toContain("transition: none;");
    expect(block).toContain(".chipBase,");
  });

  it("stays out of the way of the mobile-first layout test's own 'first @media' scan", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const gridIndex = css.indexOf(".grid {");
    const firstMediaIndex = css.indexOf("@media");
    expect(gridIndex).toBeGreaterThan(-1);
    expect(gridIndex).toBeLessThan(firstMediaIndex);
  });
});
