import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPARKLINE_DOWN_COLOR, SPARKLINE_FLAT_COLOR, SPARKLINE_UP_COLOR } from "@/lib/token-sparkline";

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

describe("TokenGridCardChart — the pump.fun card (owner direction, 4 Sep 2026)", () => {
  it("reads trades only through useGridTokenTrades, gated on useInView's inView flag", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain('import { useGridTokenTrades } from "@/lib/use-grid-token-trades"');
    expect(component).toContain('import { useInView } from "@/lib/use-in-view"');
    expect(component).toContain("useGridTokenTrades(curveAddress, inView)");
  });

  it("draws one performance line from a single pure buildSparkline call, never candles, a chart library or a floating preview", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('import { buildSparkline, SPARKLINE_HEIGHT, SPARKLINE_WIDTH } from "@/lib/token-sparkline"');
    expect(component.match(/buildSparkline\(/g) ?? []).toHaveLength(1);
    expect(component).not.toMatch(/from ["']lightweight-charts["']/);
    expect(component).not.toContain("buildCandleGeometry");
    expect(component).not.toContain("styles.preview");
    expect(component).not.toContain("computePreviewPosition");
    expect(component).toContain('<path className={styles.sparkArea} d={sparkline.areaPath} />');
    expect(component).toContain("d={sparkline.linePath}");
  });

  it("renders nothing over the art when there are no trades — no flat line, no empty box", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain("{sparkline.hasData && (");
    expect(component).toContain("<div className={`${styles.sparkOverlay} ${tone}`} aria-hidden=\"true\">");
  });

  it("redraws the line only when the path actually changes, by keying it on the path", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain("key={sparkline.linePath}");
    expect(component).toContain("pathLength={100}");
  });

  it("shows a real market cap (newest spot price × recorded supply) that remounts — and so flashes — on change, and a change pill plus launch age", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain("formatGridMarketCap(computeGridMarketCapNative(sparkline.lastPrice, wholeTokenSupply))");
    // Flash only on a genuine change after first paint: the figure is keyed by a change count, never by its label.
    expect(component).toContain("const flashKey = useMarketCapFlash(marketCap);");
    expect(component).toContain("if (previous.current !== null && previous.current !== marketCap) {");
    expect(component).toContain("<b key={flashKey} className={flashKey > 0 ? `${styles.cardCap} ${styles.cardCapFlash}` : styles.cardCap}>");
    expect(component).toContain("buildGridChangePill(sparkline.changePercent)");
    expect(component).toContain("formatGridAge(launchedAt)");
    expect(component).toContain("MCAP");
  });

  it("keeps the artwork edge to edge with a letter-initial fallback, and marks the line decorative for screen readers", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('<img className={styles.artImage} src={artworkThumbnail} alt="" />');
    expect(component).toContain("<span className={styles.artInitial}>{letter}</span>");
    expect(component).toContain('aria-hidden="true"');
  });
});

describe("HoodlumsTokenGrid twelve-panel wiring", () => {
  it("renders TokenGridCardChart per card with the recorded artwork, supply, launch time and graduation figures", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('import { TokenGridCardChart } from "./token-grid-card-chart"');
    expect(component).toContain("<TokenGridCardChart");
    expect(component).toContain("tokenName={launch.tokenName}");
    expect(component).toContain("curveAddress={launch.curveAddress}");
    expect(component).toContain("artworkThumbnail={launch.artworkThumbnail}");
    expect(component).toContain("wholeTokenSupply={launch.wholeTokenSupply}");
    expect(component).toContain("launchedAt={launch.launchedAt}");
    expect(component).toContain("progressLabel={progressPercentLabel(launch)}");
  });

  it("shows eight cards per tab (two rows of four) and folds the rest behind Show more, resetting on a tab switch", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('import { GRID_PAGE_SIZE } from "@/lib/token-grid-card-model"');
    expect(component).toContain("useState(GRID_PAGE_SIZE)");
    expect(component).toContain("launches.slice(0, visibleCount)");
    expect(component).toContain("setVisibleCount(GRID_PAGE_SIZE);\n  }, [tab]);");
    expect(component).toContain("styles.showMore");
    expect(component).toContain("Show {Math.min(hiddenCount, GRID_PAGE_SIZE / 2)} more");
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

describe("Grid card styling", () => {
  it("scales the square art region with the card's width via aspect-ratio + height: auto, and never overrides it at a breakpoint", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.art\s*\{[^}]*aspect-ratio:\s*1 \/ 1;/);
    expect(css).toMatch(/\.art\s*\{[^}]*height:\s*auto;/);
    for (const block of css.split(/@media \(max-width: \d+px\) \{/).slice(1)) {
      expect(block).not.toMatch(/\.art\s*\{/);
    }
    expect(css).toMatch(/\.grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
  });

  it("lays the performance line over the lower half of the art on a bottom-up wash, with a draw-in that respects reduced motion", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.sparkOverlay\s*\{[^}]*height:\s*52%;/);
    expect(css).toMatch(/\.sparkOverlay\s*\{[^}]*background:\s*linear-gradient\(to top,/);
    expect(css).toMatch(/\.sparkLine\s*\{[^}]*stroke:\s*currentColor;/);
    expect(css).toMatch(/\.sparkLine\s*\{[^}]*animation:\s*sparkDraw/);
    expect(css).toMatch(/\.sparkArea\s*\{[^}]*fill:\s*currentColor;/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
    expect(reduced).toContain(".sparkLine {\n    animation: none;");
    expect(reduced).toContain(".cardCapFlash {\n    animation: none;");
  });

  it("colours the line lime up and the design's grey down — the token page's ruling — never red", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain(".sparklineUp {\n  color: var(--accent-lime);\n}");
    expect(css).toContain(".sparklineDown {\n  color: var(--accent-down);\n}");
    expect(css).not.toContain("#ff5f56");
    expect(css).not.toContain("#91f0b6");
    expect(SPARKLINE_UP_COLOR).toBe("#c6f53e");
    expect(SPARKLINE_DOWN_COLOR).toBe("#8d918c");
    expect(SPARKLINE_FLAT_COLOR).toBe("#6f746e");
  });

  it("flashes the market cap on change and keeps it the boldest number on the card, with the ticker secondary", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.cardCapFlash\s*\{[^}]*animation:\s*capFlash/);
    expect(css).not.toMatch(/\.cardCap\s*\{[^}]*animation:/);
    const capSize = Number(css.match(/\.cardCap\s*\{[^}]*font:\s*800 (\d+)px/)?.[1]);
    const nameSize = Number(css.match(/\.cardName\s*\{[^}]*font:\s*800 (\d+)px/)?.[1]);
    expect(capSize).toBeGreaterThan(nameSize);
    expect(css).toMatch(/\.cardTicker\s*\{[^}]*color:\s*var\(--text-label\);/);
  });

  it("has no floating hover preview or candle overlay left", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).not.toContain(".preview");
    expect(css).not.toContain(".candleOverlay");
  });
});

describe("Third-party trending row (the bottom four panels)", () => {
  it("renders the top four Dexscreener tokens as cards in the same four-column tracks, with rank, market cap and a lime/grey change pill", async () => {
    const component = await source("components/robinhood-trending-panel.tsx");
    const css = await source("components/robinhood-trending-panel.module.css");
    expect(component).toContain("tokens.slice(0, TRENDING_PANEL_COUNT)");
    expect(component).toContain("formatGridMarketCapUsd(token.marketCapUsd)");
    expect(component).toContain("buildGridChangePill(token.priceChangePercent, 0)");
    expect(component).toContain("#{token.rank}");
    expect(component).toContain('className={styles.panel}');
    expect(component).not.toContain("<aside");
    expect(css).toMatch(/\.row\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.art\s*\{[^}]*aspect-ratio:\s*1 \/ 1;/);
  });

  it("never draws a performance line for third-party tokens — the feed carries no trade series", async () => {
    const component = await source("components/robinhood-trending-panel.tsx");
    expect(component).not.toContain("buildSparkline");
    expect(component).not.toContain("useGridTokenTrades");
  });
});

describe("Homepage layout", () => {
  it("is one full-width column — the trending row sits under the token grid, not beside it", async () => {
    const component = await source("components/hoodlums-market-home.tsx");
    const css = await source("components/hoodlums-market-home.module.css");
    const grid = component.indexOf("<HoodlumsTokenGrid");
    const trending = component.indexOf("<RobinhoodTrendingPanel");
    const mainClose = component.indexOf("</div>", trending);
    expect(trending).toBeGreaterThan(grid);
    expect(mainClose).toBeGreaterThan(trending);
    expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).not.toContain("256px");
  });
});
