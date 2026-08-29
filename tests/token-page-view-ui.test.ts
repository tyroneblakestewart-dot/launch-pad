import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo's Vitest suite runs in a plain Node environment (no jsdom), so
// interactive client components are covered by source-pattern assertions —
// matching tests/bonding-curve-graduation-status-ui.test.ts — rather than a
// rendered DOM. Manual verification (including the required iPhone Safari
// check per CLAUDE.md) still has to happen in a real browser.

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("token page view composition (issue #443 part 1)", () => {
  it("is a server component composing the header band, left column and centre column", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).not.toContain('"use client"');
    expect(view).toContain("<TokenHeaderBand");
    expect(view).toContain("<TokenLeftColumn");
    expect(view).toContain("<TokenCenterColumn");
  });

  it("no longer renders a separate right column — About moved into the centre column's tabs", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).not.toContain("TokenRightColumn");
  });

  it("carries the plain marker class the CSS uses to null out AppNavigation's sidebar offset", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("token-page-full-screen");
  });

  it("passes the launch record through to the header band and derives factoryMinted for the left column", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("launch={launch}");
    expect(view).toContain("factoryMinted={Boolean(launch)}");
  });
});

describe("token page site chrome (issue #443 part 1 — full-screen route)", () => {
  it("no longer mounts the desktop AppNavigation sidebar on this route", async () => {
    const layout = await source("app/token/[chain]/[address]/layout.tsx");
    expect(layout).not.toContain("<AppNavigation");
    expect(layout).not.toContain("{ AppNavigation");
    expect(layout).not.toContain("{ AppNavigation, MobileBottomNavigation }");
  });

  it("still mounts AccountOverlayShell and MobileBottomNavigation", async () => {
    const layout = await source("app/token/[chain]/[address]/layout.tsx");
    expect(layout).toContain('import { AccountOverlayShell } from "@/components/account-overlay-shell"');
    expect(layout).toContain('import { MobileBottomNavigation } from "@/components/app-navigation"');
    expect(layout).toContain("<AccountOverlayShell />");
    expect(layout).toContain("<MobileBottomNavigation />");
  });

  it("does not pull in the rest of the studio shell (its global theme CSS, WalletProviderSelector, ambient glow)", async () => {
    const layout = await source("app/token/[chain]/[address]/layout.tsx");
    expect(layout).not.toContain('from "@/components/wallet-provider-selector"');
    expect(layout).not.toContain('"../ambient-glow.css"');
    expect(layout).not.toContain('"../globals.css"');
  });

  it("nulls out AppNavigation's desktop sidebar padding-left offset via a plain body:has() marker, since removing the JSX alone doesn't remove that shared CSS module's global rule", async () => {
    const css = await source("components/token-page/token-page.module.css");
    expect(css).toContain(":global(body:has(.token-page-full-screen))");
    expect(css).toContain("padding-left: 0 !important;");
  });
});

describe("token page header band (issue #443 part 1)", () => {
  it("is a client component reading its own independent curve status and trades", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain("useTokenCurveStatus(address, curveAddress, decimals)");
    expect(component).toContain("useTokenTrades(curveAddress)");
  });

  it("renders the back link, artwork tile, name/ticker, holders, launch age and chain badge", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain('href="/"');
    expect(component).toContain("styles.headerArtworkTile");
    expect(component).toContain("{displayName}");
    expect(component).toContain("{ticker}");
    expect(component).toContain("{holderCountLabel}");
    expect(component).toContain("LAUNCHED {launchAgeLabel}");
    expect(component).toContain("{chainInfo.shortLabel}");
  });

  it("shows the LIVE pill only while the curve reports bonding, never on load/error/graduated", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain('curveStatus.kind === "ready" && curveStatus.graduation.state === "bonding"');
    expect(component).toContain("{tradingOpen ? (");
  });

  it("shows the DROP ART affordance only for the confirmed on-chain creator with no artwork set, and is otherwise display-only", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain("account.toLowerCase() === curveStatus.creator.toLowerCase()");
    expect(component).toContain("const showDropArt = isCreator && !launch?.artworkThumbnail");
    const dropArtStart = component.indexOf("<button type=\"button\" className={styles.headerDropArt}>");
    expect(dropArtStart).toBeGreaterThan(-1);
    expect(component.slice(dropArtStart, dropArtStart + 120)).not.toContain("onClick");
  });

  it("reads the connected account passively (eth_accounts), never prompting a connect popup on load", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain('method: "eth_accounts"');
    expect(component).not.toContain('method: "eth_requestAccounts"');
  });

  it("toggles between price and mcap on click, with the label flipping to match", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain('const [mode, setMode] = useState<"price" | "mcap">("price")');
    expect(component).toContain('setMode((current) => (current === "price" ? "mcap" : "price"))');
    expect(component).toContain('"PRICE · TAP FOR MCAP"');
    expect(component).toContain('"MCAP · TAP FOR PRICE"');
  });

  it("derives price mode from the one shared tradePriceNativePerToken helper over the loaded trades, falling back to the curve's starting price before any trade exists", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain('import { tradePriceNativePerToken } from "@/lib/candle-bucketing"');
    expect(component).toContain("tradePriceNativePerToken(lastTrade, decimals)");
    expect(component).toContain("curveStatus.startingPriceNativePerToken");
  });

  it("derives market cap as last price times total supply, never a second price source", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain("curveStatus.totalSupplyRaw");
    expect(component).toContain("lastPrice * totalSupplyWhole");
  });

  it("renders the graduation block from graduationProgressBps/nativeReserve/remainingNativeToGraduate/graduationTarget via the shared pure formatters", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain(
      'import { formatGraduationRemainingLabel, formatGraduationSummary } from "@/lib/bonding-curve-status"',
    );
    expect(component).toContain("formatGraduationSummary(");
    expect(component).toContain("curveStatus.remainingToGraduateWei");
    expect(component).toContain("formatGraduationRemainingLabel(curveStatus.remainingToGraduateWei)");
  });

  it("always shows a Contract link chip, and a disabled Pool chip with an after-graduation note until liquidityPool is set", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain("Contract ↗");
    expect(component).toContain("chainInfo.explorerBaseUrl}${address}");
    expect(component).toContain("const poolAddress = curveStatus.kind === \"ready\" ? curveStatus.graduation.liquidityPool : null");
    expect(component).toContain("after graduation");
    expect(component).toContain("styles.headerLinkChipDisabled");
  });

  it("prefers the launch record's name/ticker over Blockscout market-stats data", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain("launch?.tokenName ||");
    expect(component).toContain("launch?.ticker ||");
  });
});

describe("token page left column (swap panel, unchanged internally) + Stats/Audit + creator fees", () => {
  it("no longer renders the old identity/stats-USD card — that content moved to the header band", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).not.toContain("styles.identityPanel");
    expect(component).not.toContain("styles.artwork");
    expect(component).not.toContain("styles.copyButton");
    expect(component).not.toContain("formatCompactUsd");
  });

  it("renders the new Stats/Audit panel inside the same sticky left column as swap and fees", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { TokenStatsAuditPanel } from "./token-stats-audit-panel"');
    const groupStart = component.indexOf("<div className={styles.leftGroup}>");
    const statsIndex = component.indexOf("<TokenStatsAuditPanel", groupStart);
    const feeIndex = component.indexOf("styles.feePanel}`}>", groupStart);
    expect(groupStart).toBeGreaterThan(-1);
    expect(statsIndex).toBeGreaterThan(groupStart);
    expect(statsIndex).toBeLessThan(feeIndex);
  });

  it("passes factoryMinted through to the Stats/Audit panel for the audit's verified/unverified treatment", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("factoryMinted={factoryMinted}");
    expect(component).toContain("factoryMinted: boolean;");
  });

  it("only activates live swap controls once the configured curve's own token() matches this page", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain('functionName: "token"');
    expect(component).toContain('(tokenAddress as string).toLowerCase() !== address.toLowerCase()');
    expect(component).toContain('{ kind: "wrong-token" }');
  });

  it("falls back to the referral trade-terminal links when no curve is configured or reading it fails", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("terminalFallback");
    expect(component).toContain("tradeLinks.map");
  });

  it("wires the Buy button to the bonding curve's buy() with a slippage-adjusted minimum output and deadline", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('functionName: "buy"');
    expect(component).toContain("applySlippageFloor(receiveRaw, slippageBps)");
    expect(component).toContain("Math.floor(Date.now() / 1000) + TRADE_DEADLINE_SECONDS");
    expect(component).toContain("value: grossWei");
  });

  it("approves the curve to pull tokens before calling sell() when allowance is insufficient", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('functionName: "allowance"');
    expect(component).toContain("if (allowance < tokensIn)");
    expect(component).toContain('functionName: "approve"');
    expect(component).toContain('functionName: "sell"');
  });

  it("still computes graduation state from the shared pure status module for its own not-graduated/graduated branch, even though the figures themselves now render in the header band", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("computeBondingCurveGraduationStatus({");
    expect(component).toContain('curveView.graduation.state !== "graduated"');
  });

  it("no longer renders a separate mobile sticky swap bar — the full panel is pulled inline via CSS order instead (issue #427)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).not.toContain("styles.mobileBar");
    expect(component).not.toContain("styles.mobileBuyButton");
    expect(component).not.toContain("styles.mobileSellButton");
  });

  it("marks the swap panel distinctly so CSS can reorder it for mobile (issue #427)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("`${styles.panel} ${styles.swapPanel}`");
  });

  it("connects a wallet the same way the testnet launcher does (shared injected-provider helper)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { getInjectedEvmProvider } from "@/lib/wallet-provider"');
    expect(component).toContain('method: "eth_requestAccounts"');
    expect(component).toContain('method: "wallet_switchEthereumChain"');
  });

  it("shows an honest 1% fee breakdown before every signature, from pure math for buys and an on-chain read for sells (issue #412 Part 2)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("tradingFee(parseEther(amount))");
    expect(component).toContain('functionName: "quoteSellFee"');
    expect(component).toContain("Trading fee (1%)");
  });

  it("shows the real fee note under the swap CTA, derived from the curve's fee constants rather than a hard-coded string (issue #443 part 1 item 6)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain(
      'import { formatFeeNote, shortenAddress } from "@/lib/token-page-format"',
    );
    expect(component).toContain("formatFeeNote(TRADING_FEE_BPS, PROTOCOL_FEE_SHARE_BPS, CREATOR_FEE_SHARE_BPS, false)");
    expect(component).toContain("formatFeeNote(TRADING_FEE_BPS, PROTOCOL_FEE_SHARE_BPS, CREATOR_FEE_SHARE_BPS, true)");
  });

  it("reads remainingNativeToGraduate() and displays it, and caps the buy MAX preset at the graduation target", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('functionName: "remainingNativeToGraduate"');
    expect(component).toContain("grossNativeInForExactNet(curveView.remainingToGraduateWei)");
  });

  it("blocks submitting a buy that would exceed the graduation target instead of letting it revert", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("buyNetFromGross(grossWei)");
    expect(component).toContain("netIn > curveView.remainingToGraduateWei");
  });

  it("replaces the swap form with an honest trading-closed panel once the curve reports graduated", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('curveView.kind === "ready" && curveView.graduation.state !== "graduated" ?');
    expect(component).toContain('curveView.kind === "ready" && curveView.graduation.state === "graduated" ?');
    expect(component).toContain("Trading closed");
    expect(component).toContain("View liquidity pool");
  });

  it("shows a creator fee panel with claimable balance and a withdraw button only for the confirmed on-chain creator", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('functionName: "creator"');
    expect(component).toContain('functionName: "claimableFees"');
    expect(component).toContain('functionName: "withdrawFees"');
    expect(component).toContain("account.toLowerCase() === curveView.creator.toLowerCase()");
    expect(component).toContain("{isCreator && curveView.kind === \"ready\" && (");
    expect(component).toContain("Withdraw fees");
  });
});

describe("token page trade UX correctness (issue #427)", () => {
  it("checks the receipt's own status instead of trusting waitForTransactionReceipt() to throw on a revert", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("const receipt = await publicClient.waitForTransactionReceipt({ hash });");
    expect(component).toContain('receipt.status === "reverted"');
    expect(component).toContain("describeRevertedTrade(hash)");
  });

  it("renders a distinct, non-muted error state for a reverted or thrown trade failure, separate from the informational status hint", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("const [tradeError, setTradeError] = useState");
    expect(component).toContain('styles.tradeErrorText');
    expect(component).toContain('role="alert"');
    expect(component).toContain("tradeError ? (");
  });

  it("clears the amount/quote and reports success only on a genuine (non-reverted) confirmation", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    const successBranchStart = component.indexOf('setStatusMessage("Trade confirmed.")');
    expect(successBranchStart).toBeGreaterThan(-1);
    expect(component).toContain('setAmount("");\n        setReceiveRaw(null);\n        setSellFeeRaw(null);');
  });

  it("refetches curve state and balances after every confirmed trade so MAX and the progress bar are never stale (issue #427 item 4b)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    const submitTradeStart = component.indexOf("async function submitTrade()");
    const submitTradeEnd = component.indexOf("const payTicker", submitTradeStart);
    expect(submitTradeStart).toBeGreaterThan(-1);
    expect(submitTradeEnd).toBeGreaterThan(submitTradeStart);
    const submitTrade = component.slice(submitTradeStart, submitTradeEnd);

    expect(submitTrade).toContain("void refreshBalances(account);");
    expect(submitTrade).toContain("if (curveAddress) void loadCurve(curveAddress);");
    const refetchIndex = submitTrade.indexOf("void refreshBalances(account);", submitTrade.indexOf("waitForTransactionReceipt({ hash });"));
    const branchIndex = submitTrade.indexOf('receipt.status === "reverted"');
    expect(refetchIndex).toBeGreaterThan(-1);
    expect(refetchIndex).toBeLessThan(branchIndex);
  });

  it("applies the same reverted/thrown-error handling to the creator fee withdraw flow", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("const [feeError, setFeeError] = useState");
    expect(component).toContain("setFeeError(describeRevertedTrade(hash))");
    expect(component).toContain("setFeeError(describeTradeSubmissionFailure(error))");
  });
});

describe("token page Stats/Audit panel (issue #443 part 1)", () => {
  it("is a client component sharing its own useTokenTrades poll, computed with the pure lib/token-trade-stats.ts helpers", async () => {
    const component = await source("components/token-page/token-stats-audit-panel.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain('import { useTokenTrades } from "@/lib/use-token-trades"');
    expect(component).toContain("computeTradeWindowStats(");
    expect(component).toContain("computeTotalFeesNative(");
  });

  it("defaults to the Stats tab and the 24H window", async () => {
    const component = await source("components/token-page/token-stats-audit-panel.tsx");
    expect(component).toContain('useState<StatsTab>("stats")');
    expect(component).toContain('useState<TradeStatsWindowKey>("24h")');
  });

  it("renders the four paired rows with split bars, filtered by the panel's own TF selector, distinct from the chart's own timeframe rail", async () => {
    const component = await source("components/token-page/token-stats-audit-panel.tsx");
    expect(component).toContain("PRICE CHANGE");
    expect(component).toContain("VOLUME");
    expect(component).toContain('"BUYS"');
    expect(component).toContain('"SELLS"');
    expect(component).toContain("BUY VOL");
    expect(component).toContain("SELL VOL");
    expect(component).toContain('"BUYERS"');
    expect(component).toContain('"SELLERS"');
    expect(component).toContain("styles.statsSplitBarTrack");
  });

  it("renders the collapsible HOLDER BREAKDOWN with holders/top10/dev/snipers/total-fees, snipers and top10/dev rendering em dashes in this part", async () => {
    const component = await source("components/token-page/token-stats-audit-panel.tsx");
    expect(component).toContain("HOLDER BREAKDOWN");
    expect(component).toContain("TOP 10 %");
    expect(component).toContain("DEV %");
    expect(component).toContain("SNIPERS % ⓘ");
    expect(component).toContain("Wallets that bought within the first 10 blocks after launch");
    expect(component).toContain("TOTAL FEES");
  });

  it("renders the audit checklist with a verified/unverified treatment driven by factoryMinted", async () => {
    const component = await source("components/token-page/token-stats-audit-panel.tsx");
    expect(component).toContain('"0% tax"');
    expect(component).toContain('"No mint function"');
    expect(component).toContain('"No owner"');
    expect(component).toContain('"LP locked at graduation"');
    expect(component).toContain("Guaranteed by the Hoodlums factory contract");
    expect(component).toContain("styles.auditRowUnverified");
  });
});

describe("token page centre column (chart + activity)", () => {
  it("no longer embeds the Dexscreener chart — it can't index this chain and only ever showed a broken-chart message (issue #427)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).not.toContain("PublicDexscreenerSection");
    expect(component).not.toContain("public-dexscreener-section");
  });

  it("renders the real candlestick chart inside the same chart region, sharing one trades poll with the tab below (issue #430)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("styles.chartPlaceholder");
    expect(component).toContain('data-token-chart="true"');
    expect(component).toContain("<TokenTradeChart");
    expect(component).toContain('import { useTokenTrades } from "@/lib/use-token-trades"');
    expect(component).toContain("useTokenTrades(curveAddress)");
  });

  it("renders Recent trades and Holders tabs with graceful empty states, sourced from real on-chain trade data (issue #430)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("Recent trades");
    expect(component).toContain("Holders");
    expect(component).toContain("No trades recorded yet.");
    expect(component).toContain("No holder data found for this token yet.");
    expect(component).toContain("trade.direction === \"buy\"");
  });

  it("excludes the LP pool address from the holders list, matching the existing pattern", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("Liquidity pool address excluded from this list.");
  });

  it("adds a live Hoodchat tab alongside Recent trades and Holders (issue #237)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain('{ id: "hoodchat", label: "Hoodchat" }');
    expect(component).toContain("<TokenChatPanel");
  });

  it("adds an About tab, moved here from the removed right column (issue #443 part 1)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain('{ id: "about", label: "About" }');
    expect(component).toContain("No description has been published for this token yet.");
    expect(component).toContain("Bonding curve launch");
  });
});

describe("token page mobile-first layout (issue #443 part 1: header → swap → chart → stats → tabs)", () => {
  it("stacks to a single column with no query, only progressively restoring columns at a min-width breakpoint (mobile-first)", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const gridRuleIndex = css.indexOf(".grid {");
    const firstMediaQueryIndex = css.indexOf("@media");
    expect(gridRuleIndex).toBeGreaterThan(-1);
    expect(gridRuleIndex).toBeLessThan(firstMediaQueryIndex);
    expect(css).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(css).not.toContain("max-width: 880px");
    expect(css).toContain("@media (min-width: 881px)");
  });

  it("no longer has a third desktop breakpoint — the old three-column layout (#429) is gone now that identity/about have no column of their own", async () => {
    const css = await source("components/token-page/token-page.module.css");
    expect(css).not.toContain("@media (min-width: 1181px)");
  });

  it("orders the mobile stack as swap, chart, stats, fees, then the tabs panel", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const firstMediaIndex = css.indexOf("@media");
    const baseCss = css.slice(0, firstMediaIndex);
    expect(baseCss).toContain(".swapPanel {\n  order: 1;\n}");
    expect(baseCss).toContain(".chartPlaceholder {\n  order: 2;\n}");
    expect(baseCss).toContain(".statsPanel {\n  order: 3;\n}");
    expect(baseCss).toContain(".feePanel {\n  order: 4;\n}");
    expect(baseCss).toContain(".activityPanel {\n  order: 5;\n}");
  });

  it("resets swap/stats/fees to natural document order once desktop gives them their own sticky column, in swap → stats → fees order", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const desktopBlockStart = css.indexOf("@media (min-width: 881px)");
    const resetIndex = css.indexOf(".swapPanel,\n  .statsPanel,\n  .feePanel {\n    order: initial;\n  }", desktopBlockStart);
    expect(resetIndex).toBeGreaterThan(desktopBlockStart);
  });

  it("keeps the trade column reachable while scrolling on desktop via position: sticky", async () => {
    const css = await source("components/token-page/token-page.module.css");
    expect(css).toContain("position: sticky;");
    expect(css).toContain("align-self: start;");
  });

  it("gives every interactive control in the header band and swap panel a >=44px touch target", async () => {
    const css = await source("components/token-page/token-page.module.css");
    for (const selector of [
      ".backLink",
      ".headerLinkChip",
      ".headerFigureToggle",
      ".headerDropArt",
      ".pillButton",
      ".walletButton",
      ".presetButton",
      ".activityTab",
      ".feeWithdrawButton",
      ".terminalFallbackLink",
      ".holderBreakdownHeader",
    ]) {
      const ruleStart = css.indexOf(`${selector} {`);
      expect(ruleStart, `expected a rule for ${selector}`).toBeGreaterThan(-1);
      const ruleEnd = css.indexOf("}", ruleStart);
      const rule = css.slice(ruleStart, ruleEnd);
      const matchesHeightOrWidth = /(min-height|height):\s*4[4-9]px/.test(rule) || /width:\s*44px/.test(rule);
      expect(matchesHeightOrWidth, `expected ${selector} to declare a >=44px touch target`).toBe(true);
    }
  });

  it("gives every focusable control a visible keyboard focus ring", async () => {
    const css = await source("components/token-page/token-page.module.css");
    expect(css).toContain(".shell a:focus-visible,");
    expect(css).toContain(".shell button:focus-visible,");
    expect(css).toContain(".shell input:focus-visible {");
    expect(css).toContain("outline: 2px solid #c6f53e;");
  });

  it("clamps horizontal overflow on the page shell as a safety net, matching the generated-site pattern", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const pageRuleEnd = css.indexOf("}");
    expect(css.slice(0, pageRuleEnd)).toContain("overflow-x: hidden;");
  });
});

describe("token page desktop layout: swap + stats + fees left, chart + tabs fill the rest (issue #443 part 1)", () => {
  it("renders every panel directly inside the shared grid or its leftGroup wrapper, with no dedicated per-column wrapper divs for the chart/activity columns", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).not.toContain("styles.left}");
    expect(view).not.toContain("styles.center}");
    expect(view).not.toContain("styles.right}");
    const gridIndex = view.indexOf("styles.grid}");
    expect(gridIndex).toBeGreaterThan(-1);
    expect(view.indexOf("<TokenLeftColumn", gridIndex)).toBeGreaterThan(gridIndex);
    expect(view.indexOf("<TokenCenterColumn", gridIndex)).toBeGreaterThan(gridIndex);
  });

  it("groups the swap panel, Stats/Audit panel and creator-fee panel behind a display:contents wrapper, so they can share one sticky desktop column while still interleaving with the chart on mobile", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    const groupStart = component.indexOf("<div className={styles.leftGroup}>");
    expect(groupStart).toBeGreaterThan(-1);
    const swapIndex = component.indexOf("styles.swapPanel", groupStart);
    const statsIndex = component.indexOf("<TokenStatsAuditPanel", groupStart);
    const feeIndex = component.indexOf("styles.feePanel", groupStart);
    expect(swapIndex).toBeGreaterThan(groupStart);
    expect(statsIndex).toBeGreaterThan(swapIndex);
    expect(feeIndex).toBeGreaterThan(statsIndex);
  });

  it("puts the sticky swap/stats/fee column on the left and the chart/activity column in the rest of the width at the two-column desktop breakpoint", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const blockStart = css.indexOf("@media (min-width: 881px)");
    const block = css.slice(blockStart);
    expect(block).toContain(".leftGroup {\n    display: flex;");
    expect(block).toContain("grid-column: 1;");
    expect(block).toContain("position: sticky;");
    expect(block).toContain(".chartPlaceholder,\n  .activityPanel {\n    grid-column: 2;\n  }");
  });

  it("does not touch the token page's data-flow, trade logic or error surfacing (issue #427) while rearranging layout", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('receipt.status === "reverted"');
    expect(component).toContain("describeRevertedTrade(hash)");
    expect(component).toContain("void refreshBalances(account);");
    expect(component).toContain("if (curveAddress) void loadCurve(curveAddress);");
  });
});
