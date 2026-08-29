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
  it("is a client component composing the header band, left column and centre column, owning the one shared trades/curve poll (issue #444)", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain('"use client"');
    expect(view).toContain("<TokenHeaderBand");
    expect(view).toContain("<TokenLeftColumn");
    expect(view).toContain("<TokenCenterColumn");
    expect(view).toContain("useTokenCurveStatus(address, curveAddress, decimals)");
    expect(view).toContain("useTokenTrades(curveAddress)");
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
  it("is a client component receiving curve status and trades as props from the page's one shared poll (issue #444)", async () => {
    const component = await source("components/token-page/token-header-band.tsx");
    expect(component).toContain('"use client"');
    expect(component).not.toContain("useTokenCurveStatus(");
    expect(component).not.toContain("useTokenTrades(");
    expect(component).toContain("curveStatus: TokenCurveStatus");
    expect(component).toContain("trades: TokenTrade[] | null");
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

  it("only activates live swap controls once the configured curve's own token() matches this page (check now lives in the shared curve-status hook, issue #444)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('"use client"');
    expect(component).toContain('curveStatus.kind !== "ready"');
    expect(component).toContain("return curveStatus;");

    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain('functionName: "token"');
    expect(hook).toContain('(token as string).toLowerCase() !== tokenAddress.toLowerCase()');
    expect(hook).toContain('{ kind: "wrong-token" }');
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

  it("derives its local curve view from the page's shared curve status (issue #444) rather than computing graduation state itself", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("function toCurveView(curveStatus: TokenCurveStatus, decimals: number): CurveView {");
    expect(component).toContain("const curveView = toCurveView(curveStatus, resolvedDecimals);");
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

  it("reads remainingNativeToGraduate() via the shared curve-status hook and caps the buy MAX preset at the graduation target", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("grossNativeInForExactNet(curveView.remainingToGraduateWei)");

    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain('functionName: "remainingNativeToGraduate"');
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

  it("shows a creator fee panel with claimable balance and a withdraw button only for the confirmed on-chain creator (creator itself resolved by the shared curve-status hook, issue #444)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('functionName: "claimableFees"');
    expect(component).toContain('functionName: "withdrawFees"');
    expect(component).toContain("account.toLowerCase() === curveView.creator.toLowerCase()");
    expect(component).toContain("{isCreator && curveView.kind === \"ready\" && (");
    expect(component).toContain("Withdraw fees");

    const hook = await source("lib/use-token-curve-status.ts");
    expect(hook).toContain('functionName: "creator"');
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

  it("refetches balances after every confirmed trade, and refreshes the page's shared curve state via TOKEN_TRADE_CONFIRMED_EVENT on a genuine success so MAX and the progress bar are never stale (issue #427 item 4b, issue #444)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    const submitTradeStart = component.indexOf("async function submitTrade()");
    const submitTradeEnd = component.indexOf("const payTicker", submitTradeStart);
    expect(submitTradeStart).toBeGreaterThan(-1);
    expect(submitTradeEnd).toBeGreaterThan(submitTradeStart);
    const submitTrade = component.slice(submitTradeStart, submitTradeEnd);

    expect(submitTrade).toContain("void refreshBalances(account);");
    expect(submitTrade).not.toContain("loadCurve");
    expect(submitTrade).toContain("notifyTokenTradeConfirmed({ curveAddress: curveView.curve });");
    const refetchIndex = submitTrade.indexOf("void refreshBalances(account);", submitTrade.indexOf("waitForTransactionReceipt({ hash });"));
    const branchIndex = submitTrade.indexOf('receipt.status === "reverted"');
    const notifyIndex = submitTrade.indexOf("notifyTokenTradeConfirmed({ curveAddress: curveView.curve });");
    expect(refetchIndex).toBeGreaterThan(-1);
    expect(refetchIndex).toBeLessThan(branchIndex);
    // Only the genuine-success branch fires the shared refetch event — a
    // reverted trade never moved the curve's own reserves.
    expect(notifyIndex).toBeGreaterThan(branchIndex);
  });

  it("applies the same reverted/thrown-error handling to the creator fee withdraw flow", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("const [feeError, setFeeError] = useState");
    expect(component).toContain("setFeeError(describeRevertedTrade(hash))");
    expect(component).toContain("setFeeError(describeTradeSubmissionFailure(error))");
  });
});

describe("token page Stats/Audit panel (issue #443 part 1)", () => {
  it("is a client component receiving trades as a prop from the page's one shared poll (issue #444), computed with the pure lib/token-trade-stats.ts helpers", async () => {
    const component = await source("components/token-page/token-stats-audit-panel.tsx");
    expect(component).toContain('"use client"');
    expect(component).not.toContain("useTokenTrades(");
    expect(component).toContain("trades: TokenTrade[] | null");
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

  it("renders the real candlestick chart inside the same chart region, sharing the page's one trades poll with the tab below (issue #430, lifted further in issue #444)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("styles.chartPlaceholder");
    expect(component).toContain('data-token-chart="true"');
    expect(component).toContain("<TokenTradeChart");
    expect(component).not.toContain("useTokenTrades(");
    expect(component).toContain("trades: TokenTrade[] | null");
    expect(component).toContain("tradesError: string | null");
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

  it("does not cap the shell's width — the design fills the viewport (issue #447 item 3)", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const shellStart = css.indexOf(".shell {");
    const shellEnd = css.indexOf("}", shellStart);
    const shellRule = css.slice(shellStart, shellEnd);
    expect(shellRule).not.toContain("max-width");
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
    expect(block).toContain(".centerGroup {\n    display: flex;");
    expect(block).toContain("grid-column: 2;");
  });

  it("wraps the chart and the activity/tabs panel in a real .centerGroup grid item, matching the .leftGroup pattern, so the tabs' row height never depends on the tall sticky left column (issue #447 item 2, the #431 staircase repeated)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    const css = await source("components/token-page/token-page.module.css");

    expect(component).toContain("<div className={styles.centerGroup}>");
    const groupStart = component.indexOf("<div className={styles.centerGroup}>");
    const chartIndex = component.indexOf("styles.chartPlaceholder", groupStart);
    const activityIndex = component.indexOf("styles.activityPanel", groupStart);
    expect(chartIndex).toBeGreaterThan(groupStart);
    expect(activityIndex).toBeGreaterThan(chartIndex);

    const baseCenterGroupIndex = css.indexOf(".centerGroup {\n  display: contents;\n}");
    const firstMediaIndex = css.indexOf("@media");
    expect(baseCenterGroupIndex).toBeGreaterThan(-1);
    expect(baseCenterGroupIndex).toBeLessThan(firstMediaIndex);

    const desktopBlockStart = css.indexOf("@media (min-width: 881px)");
    const desktopBlock = css.slice(desktopBlockStart);
    expect(desktopBlock).toContain(".chartPlaceholder,\n  .activityPanel {\n    order: initial;\n  }");
  });

  it("does not touch the token page's trade logic or error surfacing (issue #427) while rearranging layout and deduplicating polling (issue #444)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('receipt.status === "reverted"');
    expect(component).toContain("describeRevertedTrade(hash)");
    expect(component).toContain("void refreshBalances(account);");
  });
});

describe("token page polling is deduplicated to one shared poll per data source (issue #444)", () => {
  // Before this fix, token-center-column.tsx, token-header-band.tsx and
  // token-stats-audit-panel.tsx each called useTokenTrades independently
  // (three 12s /api/token-trades pollers on one open tab — ~900 requests/hour
  // against the 600/hour/IP limit the homepage grid also shares), and
  // token-left-column.tsx and lib/use-token-curve-status.ts each polled the
  // same on-chain curve independently. A rendered token page must issue
  // exactly one /api/token-trades request and one curve-status read per poll
  // cycle, from exactly one call site each, both owned by token-page-view.tsx
  // and threaded down as props — matching this repo's established
  // source-pattern-assertion approach for interactive components (see this
  // file's own top-of-file rationale comment; the Vitest suite runs with no
  // jsdom, so there is no rendered DOM to dispatch a real fetch against).
  const consumers = [
    "components/token-page/token-header-band.tsx",
    "components/token-page/token-center-column.tsx",
    "components/token-page/token-stats-audit-panel.tsx",
    "components/token-page/token-left-column.tsx",
  ];

  it("calls useTokenTrades exactly once across the whole page, in token-page-view.tsx", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("useTokenTrades(curveAddress)");

    for (const file of consumers) {
      const component = await source(file);
      expect(component, `${file} must not call useTokenTrades directly`).not.toContain("useTokenTrades(");
    }
  });

  it("calls useTokenCurveStatus exactly once across the whole page, in token-page-view.tsx", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("useTokenCurveStatus(address, curveAddress, decimals)");

    for (const file of consumers) {
      const component = await source(file);
      expect(component, `${file} must not call useTokenCurveStatus directly`).not.toContain("useTokenCurveStatus(");
    }
  });

  it("passes the same trades/tradesError and curveStatus values down to every consumer that needs them", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("curveStatus={curveStatus}");
    expect(view).toContain("trades={trades}");
    expect(view).toContain("tradesError={tradesError}");
  });

  it("no longer justifies independent per-panel polling copies in a doc comment", async () => {
    for (const file of [...consumers, "lib/use-token-curve-status.ts", "lib/use-token-trades.ts"]) {
      const component = await source(file);
      expect(component, `${file} must not claim a deliberate independent poll`).not.toContain("deliberate duplication");
      expect(component, `${file} must not claim a deliberate independent poll`).not.toContain("Deliberately NOT shared");
      expect(component, `${file} must not claim an owned independent copy`).not.toContain("owns an independent copy");
      expect(component, `${file} must not claim two independent 12s polls`).not.toContain("two independent 12s polls");
    }
  });
});
