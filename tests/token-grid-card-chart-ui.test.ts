import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// interactive client components/hooks are covered by source-pattern
// assertions — matching tests/token-trades-hook-ui.test.ts's precedent —
// rather than a rendered DOM.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("useGridTokenTrades (issue #436)", () => {
  it("reuses GET /api/token-trades — the same route the token page polls — rather than a second trade-reading path, marked with the additive grid rate-limit-bucket query param (issue #453 area 1)", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain("`/api/token-trades?curve=${curveRef.current}&source=grid`");
  });

  it("dedupes a focus + visibilitychange event pair into one in-flight request per card instead of two concurrent ones (issue #453 area 1)", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain("const inFlightRef = useRef(false);");
    expect(hook).toContain("if (inFlightRef.current) return;");
    expect(hook).toContain("inFlightRef.current = true;");
    const loadStart = hook.indexOf("const load = useCallback(async () => {");
    const loadEnd = hook.indexOf("}, []);", loadStart);
    const loadBody = hook.slice(loadStart, loadEnd);
    expect(loadBody).toContain("} finally {\n      inFlightRef.current = false;\n    }");
  });

  it("polls at a much slower ~60s cadence than the token page's 12s fast path", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain("POLL_INTERVAL_MS = 60_000");
  });

  it("never fetches or starts a timer while inactive (off screen)", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    const firstLoadEffect = hook.indexOf("if (!active) return;\n    void load();");
    const timerEffect = hook.indexOf("if (!active) return;\n    let timer");
    expect(firstLoadEffect).toBeGreaterThan(-1);
    expect(timerEffect).toBeGreaterThan(-1);
  });

  it("degrades quietly on a route failure (including a 429) instead of surfacing an error", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain("if (!response.ok) return;");
    expect(hook).toContain("catch {");
  });

  it("follows the issue #403 live-refresh pattern: visible-tab timer, focus/visibilitychange refetch, cleanup", async () => {
    const hook = await source("lib/use-grid-token-trades.ts");
    expect(hook).toContain('document.visibilityState === "visible"');
    expect(hook).toContain("window.setInterval(() => void load(), POLL_INTERVAL_MS)");
    expect(hook).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.addEventListener("focus", handleBecameVisible)');
    expect(hook).toContain('document.removeEventListener("visibilitychange", handleBecameVisible)');
    expect(hook).toContain('window.removeEventListener("focus", handleBecameVisible)');
  });
});

describe("useInView (issue #436)", () => {
  it("uses IntersectionObserver with an SSR/unsupported-browser guard, following hoodlums-social-showcase.tsx's pattern", async () => {
    const hook = await source("lib/use-in-view.ts");
    expect(hook).toContain('"use client"');
    expect(hook).toContain('typeof IntersectionObserver === "undefined"');
    expect(hook).toContain("observer.disconnect()");
  });
});

describe("TokenGridCardChart (issue #440)", () => {
  it("reads trades only through useGridTokenTrades, gated on useInView's inView flag", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain('import { useGridTokenTrades } from "@/lib/use-grid-token-trades"');
    expect(component).toContain('import { useInView } from "@/lib/use-in-view"');
    expect(component).toContain("useGridTokenTrades(curveAddress, inView)");
  });

  it("builds the mini and preview candles from one shared pure buildCandleGeometry call, and never instantiates a chart library per card", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('import { buildCandleGeometry, CANDLE_CHART_HEIGHT, CANDLE_CHART_WIDTH } from "@/lib/token-candle-geometry"');
    const buildCalls = component.match(/buildCandleGeometry\(/g) ?? [];
    expect(buildCalls).toHaveLength(1);
    expect(component).not.toMatch(/from ["']lightweight-charts["']/);
    expect(component).toContain("styles.candleOverlay");
    expect(component).toContain("styles.preview");
  });

  it("renders nothing over the art when there are no trades — no flat line, no empty box", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain("{candles.hasData && (");
    expect(component).toContain("<div className={styles.candleOverlay}");
  });

  it("marks both chart SVGs decorative rather than double-announcing data to screen readers", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    const ariaHiddenCount = component.match(/aria-hidden="true"/g) ?? [];
    expect(ariaHiddenCount.length).toBeGreaterThanOrEqual(2);
  });

  it("measures the enclosing card anchor (not a prop) to clamp the floating preview inside the viewport", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('import { computePreviewPosition, PREVIEW_HEIGHT, PREVIEW_WIDTH } from "@/lib/token-grid-preview-position"');
    expect(component).toContain('artNode?.closest("a")');
    expect(component).toContain("computePreviewPosition({");
    expect(component).toContain('preview.style.setProperty("--preview-left"');
    expect(component).toContain('preview.style.setProperty("--preview-top"');
  });

  it("positions the preview via mouseenter/focusin listeners on the anchor, cleaned up on leave/unmount", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('anchor.addEventListener("mouseenter", handleEnter)');
    expect(component).toContain('anchor.addEventListener("focusin", handleEnter)');
    expect(component).toContain('anchor.addEventListener("mouseleave", handleLeave)');
    expect(component).toContain('anchor.addEventListener("focusout", handleLeave)');
    expect(component).toContain('anchor.removeEventListener("mouseenter", handleEnter)');
    expect(component).toContain('anchor.removeEventListener("focusin", handleEnter)');
  });

  it("shows current price, percent change and time span in the floating preview", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain("formatNativeAmount(candles.lastPrice)");
    expect(component).toContain("styles.previewPrice");
    expect(component).toContain("sinceLabel");
  });
});

describe("HoodlumsTokenGrid card chart wiring (issue #436/#440)", () => {
  it("renders TokenGridCardChart per card instead of a static initial-letter block", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('import { TokenGridCardChart } from "./token-grid-card-chart"');
    expect(component).toContain("<TokenGridCardChart");
    expect(component).toContain("tokenName={launch.tokenName}");
    expect(component).toContain("curveAddress={launch.curveAddress}");
  });

  it("passes the recorded artwork thumbnail through to the card chart (issue #438)", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain("artworkThumbnail={launch.artworkThumbnail}");
  });

  it("still maps each tab to the correct token_launches filter (unchanged from issue #412)", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('new: "all"');
    expect(component).toContain('bonding: "bonding"');
    expect(component).toContain('graduated: "graduated"');
  });

  it("still links each card to its published site when linked, or the trade page otherwise (unchanged from issue #412)", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain("launch.siteSlug");
    expect(component).toContain("/token/robinhood/${launch.tokenAddress}");
  });
});

describe("Grid card square art region (issue #440)", () => {
  it("scales the art region with the card's width via aspect-ratio + height: auto, not a fixed strip height", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.art\s*\{[^}]*aspect-ratio:\s*1 \/ 1;/);
    expect(css).toMatch(/\.art\s*\{[^}]*height:\s*auto;/);
  });

  it("never overrides the square art region at any grid breakpoint, so taller cards can't break the columns", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    const breakpointBlocks = css.split(/@media \(max-width: \d+px\) \{/).slice(1);
    for (const block of breakpointBlocks) {
      expect(block).not.toMatch(/\.art\s*\{/);
    }
    // Columns stay `fr`-based so uniform square card heights never fight the track sizing.
    expect(css).toMatch(/\.grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
  });
});

describe("Grid card candle overlay (issue #440)", () => {
  it("occupies roughly the lower 40% of the art region over a soft dark bottom-up gradient", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.candleOverlay\s*\{[^}]*height:\s*40%;/);
    expect(css).toMatch(/\.candleOverlay\s*\{[^}]*background:\s*linear-gradient\(to top,/);
  });

  it("colours up/down consistent with the site's existing candlestick chart green/red", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain(".sparklineUp {\n  color: #91f0b6;\n}");
    expect(css).toContain(".sparklineDown {\n  color: #ff5f56;\n}");
  });
});

describe("Grid card floating preview (issue #440)", () => {
  it("is fixed-positioned via computed CSS custom properties, larger than the card thumbnail, and raised above sibling cards on z-index", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.preview\s*\{[^}]*position:\s*fixed;/);
    expect(css).toMatch(/\.preview\s*\{[^}]*left:\s*var\(--preview-left, 50%\);/);
    expect(css).toMatch(/\.preview\s*\{[^}]*top:\s*var\(--preview-top, 50%\);/);
    expect(css).toMatch(/\.preview\s*\{[^}]*z-index:\s*30;/);
    expect(css).toMatch(/\.preview\s*\{[^}]*width:\s*300px;/);
  });

  it("never lets the floating preview intercept the card's click-through navigation, in any state", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.preview\s*\{[^}]*pointer-events:\s*none;/);
  });

  it("expands on hover only for pointer devices, and on keyboard focus regardless of pointer type", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain(".card:focus .preview,\n.card:focus-within .preview {");
    expect(css).toContain("@media (hover: hover) and (pointer: fine) {");
    expect(css).toContain(".card:hover .preview {");
  });

  it("gives touch/coarse-pointer devices no hover state at all — the mini candles are the only chart they see", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    const hoverBlockIndex = css.indexOf("@media (hover: hover) and (pointer: fine) {");
    expect(hoverBlockIndex).toBeGreaterThan(-1);
    const block = css.slice(hoverBlockIndex, hoverBlockIndex + 120);
    expect(block).toContain(".card:hover .preview");
  });

  it("respects prefers-reduced-motion for the hover expansion transition", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {");
    const reducedMotionIndex = css.indexOf("@media (prefers-reduced-motion: reduce) {");
    const block = css.slice(reducedMotionIndex, reducedMotionIndex + 200);
    expect(block).toContain(".preview");
    expect(block).toContain("transition: none;");
  });
});

describe("Grid card metadata hierarchy (issue #440)", () => {
  it("makes the market cap the boldest/largest number on the card", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    const cardCapMatch = css.match(/\.cardCap\s*\{[^}]*font:\s*800 (\d+)px/);
    const cardNameMatch = css.match(/\.cardName\s*\{[^}]*font:\s*800 (\d+)px/);
    expect(cardCapMatch).not.toBeNull();
    expect(cardNameMatch).not.toBeNull();
    const capSize = Number(cardCapMatch?.[1]);
    const nameSize = Number(cardNameMatch?.[1]);
    expect(capSize).toBeGreaterThan(nameSize);
  });

  it("keeps the ticker visually secondary to the name", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.cardTicker\s*\{[^}]*color:\s*var\(--text-label\);/);
  });
});
