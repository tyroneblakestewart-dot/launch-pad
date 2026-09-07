import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GRID_CANDLE_DOWN_COLOR, GRID_CANDLE_UP_COLOR } from "@/lib/token-grid-candle-chart";

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

  it("draws thin/slim candlesticks from a single pure buildGridCandleChart call, never a chart library or a floating preview (owner direction, 7 Sep 2026)", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('import { buildGridCandleChart, GRID_CANDLE_CHART_HEIGHT, GRID_CANDLE_CHART_WIDTH } from "@/lib/token-grid-candle-chart"');
    expect(component.match(/buildGridCandleChart\(/g) ?? []).toHaveLength(1);
    expect(component).not.toMatch(/from ["']lightweight-charts["']/);
    expect(component).not.toContain("styles.preview");
    expect(component).not.toContain("computePreviewPosition");
    expect(component).toContain("{chart.bars.map((bar, index) => (");
    expect(component).toContain('className={bar.tone === "up" ? styles.candleUp : styles.candleDown}');
    expect(component).toContain("<line");
    expect(component).toContain("<rect");
  });

  it("renders nothing over the art when there are no trades — no candles, no empty box", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain("{chart.hasData && (");
    expect(component).toContain('<div className={styles.candleOverlay} aria-hidden="true">');
  });

  it("staggers each candle's grow-in by its index via an inline animation-delay, capped so a card with many bars never waits long", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain('style={{ animationDelay: `${Math.min(index * 20, 300)}ms` }}');
  });

  it("shows a real market cap (newest spot price × recorded supply) that remounts — and so flashes — on change, and a change pill plus launch age", async () => {
    const component = await source("components/token-grid-card-chart.tsx");
    expect(component).toContain("formatGridMarketCap(computeGridMarketCapNative(chart.lastPrice, wholeTokenSupply))");
    // Flash only on a genuine change after first paint: the figure is keyed by a change count, never by its label.
    expect(component).toContain("const flashKey = useMarketCapFlash(marketCap);");
    expect(component).toContain("if (previous.current !== null && previous.current !== marketCap) {");
    expect(component).toContain("<b key={flashKey} className={flashKey > 0 ? `${styles.cardCap} ${styles.cardCapFlash}` : styles.cardCap}>");
    expect(component).toContain("buildGridChangePill(chart.changePercent)");
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

describe("HoodlumsTokenGrid six-across wiring", () => {
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

  it("shows twelve cards per tab (two rows of six) and folds the rest behind Show more, a row at a time, resetting on a tab switch", async () => {
    const component = await source("components/hoodlums-token-grid.tsx");
    expect(component).toContain('import { GRID_COLUMNS, GRID_PAGE_SIZE } from "@/lib/token-grid-card-model"');
    expect(component).toContain("useState(GRID_PAGE_SIZE)");
    expect(component).toContain("launches.slice(0, visibleCount)");
    expect(component).toContain("setVisibleCount(GRID_PAGE_SIZE);\n  }, [tab]);");
    expect(component).toContain("styles.showMore");
    expect(component).toContain("Show {Math.min(hiddenCount, GRID_COLUMNS)} more");
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
    // Six across on desktop, three on tablets, two on phones (pump.fun's density).
    expect(css).toMatch(/\.grid\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/);
    expect(css).toContain("@media (max-width: 1099px) {\n  .grid {\n    grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(css).toContain("@media (max-width: 700px) {\n  .grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));");
  });

  it("lays the candlesticks over the lower half of the art on a bottom-up wash, glowing, with a grow-in that respects reduced motion", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/\.candleOverlay\s*\{[^}]*height:\s*52%;/);
    expect(css).toMatch(/\.candleOverlay\s*\{[^}]*background:\s*linear-gradient\(to top,/);
    expect(css).toMatch(/\.candleWick\s*\{[^}]*stroke:\s*currentColor;/);
    expect(css).toMatch(/\.candleBody\s*\{[^}]*fill:\s*currentColor;/);
    expect(css).toContain("filter: drop-shadow(0 0 3px currentColor);");
    expect(css).toMatch(/animation:\s*candleGrow/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
    expect(reduced).toContain(".candleUp,\n  .candleDown {\n    animation: none;");
    expect(reduced).toContain(".cardCapFlash {\n    animation: none;");
  });

  it("grows the chart a little on hover, only on a device with real hover, clipped by the art frame — never a floating preview (owner direction, 7 Sep 2026: \"expand, not too much, like pump.fun\")", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.card:hover \.candleOverlay \{\s*transform: scaleY\(1\.16\);/);
    expect(css).toMatch(/\.candleOverlay\s*\{[^}]*transition:\s*transform 0\.22s ease;/);
    expect(css).not.toContain(".preview {");
    expect(css).not.toContain("floating");
  });

  it("colours candles lime up and the design's grey down — the token page's ruling — never red", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).toContain(".candleUp {\n  color: var(--accent-lime);\n}");
    expect(css).toContain(".candleDown {\n  color: var(--accent-down);\n}");
    expect(css).not.toContain("#ff5f56");
    expect(css).not.toContain("#91f0b6");
    expect(GRID_CANDLE_UP_COLOR).toBe("#c6f53e");
    expect(GRID_CANDLE_DOWN_COLOR).toBe("#8d918c");
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

  it("has no floating hover preview — the candle overlay itself is the only chart layer, growing in place", async () => {
    const css = await source("components/hoodlums-token-grid.module.css");
    expect(css).not.toContain(".preview {");
    expect(css).toContain(".candleOverlay {");
  });
});

describe("Trending banner (the moving strip across the top)", () => {
  it("renders the Dexscreener Solana feed as a seamless right-to-left ticker: the list twice, the copy hidden from assistive tech, sliding by half its width", async () => {
    const component = await source("components/robinhood-trending-panel.tsx");
    const css = await source("components/robinhood-trending-panel.module.css");
    expect(component).toContain('{renderItems("a")}');
    expect(component).toContain('{renderItems("b")}');
    expect(component).toContain('aria-hidden={copy === "b" ? "true" : undefined}');
    expect(component).toContain('tabIndex={copy === "b" ? -1 : undefined}');
    expect(component).toContain("formatGridMarketCapUsd(token.marketCapUsd)");
    expect(component).toContain("buildGridChangePill(token.priceChangePercent, 0)");
    expect(component).not.toContain("<aside");
    expect(css).toMatch(/\.track\s*\{[^}]*animation:\s*ticker/);
    expect(css).toContain("transform: translateX(-50%);");
    expect(css).toContain(".viewport:hover .track {\n    animation-play-state: paused;");
    // Reduced motion: no animation, an ordinary horizontal scroll instead.
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {"));
    expect(reduced).toContain(".track {\n    animation: none;");
    expect(reduced).toContain("overflow-x: auto;");
  });

  it("keeps the full Dexscreener disclaimer available (as the strip's tooltip) while showing only a short note inline", async () => {
    const component = await source("components/robinhood-trending-panel.tsx");
    expect(component).toContain("Not Hoodlums launches. Not financial advice. Refreshes every 60s.");
    expect(component).toContain("via Dexscreener · 60s");
  });

  it("never draws a candle chart for third-party tokens — the feed carries no trade series", async () => {
    const component = await source("components/robinhood-trending-panel.tsx");
    expect(component).not.toContain("buildGridCandleChart");
    expect(component).not.toContain("useGridTokenTrades");
  });
});

describe("Graduating row (the bottom six panels)", () => {
  it("renders GRADUATING_PANEL_COUNT pump.fun tokens as cards in the same six tracks, with rank and progress badges, and never hides the section", async () => {
    const component = await source("components/hoodlums-graduating-row.tsx");
    const css = await source("components/hoodlums-graduating-row.module.css");
    expect(component).toContain('import { GRADUATING_PANEL_COUNT } from "@/lib/token-grid-card-model"');
    expect(component).toContain("tokens.slice(0, GRADUATING_PANEL_COUNT)");
    expect(component).toContain("<GraduatingCard key={token.address} token={token} rank={index + 1} />");
    expect(component).toContain("styles.progressBadge");
    expect(component).toContain("#{rank}");
    expect(component).not.toContain("return null;");
    expect(component).toContain("Graduating feed unavailable right now");
    expect(component).not.toContain("swipeDeltaToStep");
    expect(component).not.toContain("TOKENS_PER_PAGE");
    expect(css).toMatch(/\.track\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.art\s*\{[^}]*aspect-ratio:\s*1 \/ 1;/);
    expect(css).toContain("@media (max-width: 1099px) {\n  .track {\n    grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(css).toContain("@media (max-width: 700px) {\n  .track {\n    grid-template-columns: repeat(2, minmax(0, 1fr));");
  });
});

describe("Homepage layout", () => {
  it("runs the trending banner across the very top, then one full-width column: hero, six-across grid, graduating row", async () => {
    const component = await source("components/hoodlums-market-home.tsx");
    const css = await source("components/hoodlums-market-home.module.css");
    const banner = component.indexOf("<RobinhoodTrendingPanel />");
    const topbar = component.indexOf("<header className={styles.topbar}>");
    const grid = component.indexOf("<HoodlumsTokenGrid");
    const graduating = component.indexOf("<HoodlumsGraduatingRow />");
    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(topbar);
    expect(topbar).toBeLessThan(grid);
    expect(grid).toBeLessThan(graduating);
    expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).not.toContain("256px");
  });
});
