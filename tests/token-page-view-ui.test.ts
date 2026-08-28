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

describe("token page view composition", () => {
  it("is a server component composing the three interactive/static column islands", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).not.toContain('"use client"');
    expect(view).toContain("<TokenLeftColumn");
    expect(view).toContain("<TokenCenterColumn");
    expect(view).toContain("<TokenRightColumn");
  });

  it("links out to Dexscreener, the contract explorer and (when known) the pool explorer (issue #427 item 3)", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("Dexscreener ↗");
    expect(view).toContain("Contract ↗");
    expect(view).toContain("Pool ↗");
    expect(view).toContain("chainInfo.explorerBaseUrl");
  });

  it("shows the price and 24h change as part of the identity header, next to name/ticker/live badge (issue #427)", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain('import { formatPriceChange, formatUsdPrice } from "@/lib/token-page-format"');
    expect(view).toContain("styles.topbarIdentity");
    expect(view.indexOf("styles.titleRow")).toBeLessThan(view.indexOf("styles.priceRow"));
    expect(view.indexOf("styles.priceRow")).toBeLessThan(view.indexOf("styles.grid"));
  });
});

describe("token page site chrome (issue #427)", () => {
  it("mounts the same AppNavigation/MobileBottomNavigation the rest of the site uses, not a copy", async () => {
    const layout = await source("app/token/[chain]/[address]/layout.tsx");
    expect(layout).toContain('import { AppNavigation, MobileBottomNavigation } from "@/components/app-navigation"');
    expect(layout).toContain("<AppNavigation />");
    expect(layout).toContain("<MobileBottomNavigation />");
  });

  it("does not pull in the rest of the studio shell (its global theme CSS, WalletProviderSelector, ambient glow)", async () => {
    const layout = await source("app/token/[chain]/[address]/layout.tsx");
    expect(layout).not.toContain('from "@/components/wallet-provider-selector"');
    expect(layout).not.toContain('"../ambient-glow.css"');
    expect(layout).not.toContain('"../globals.css"');
  });
});

describe("token page left column (identity + swap panel)", () => {
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

  it("reads the graduation target from the shared pure status module, not ad-hoc math", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("computeBondingCurveGraduationStatus({");
    expect(component).toContain("formatGraduationProgressPercent(graduation.progressBps)");
  });

  it("renders a copy-to-clipboard address control", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("navigator.clipboard.writeText(address)");
    expect(component).toContain('copied ? "copied" : "copy"');
  });

  it("no longer renders a separate mobile sticky swap bar — the full panel is pulled inline via CSS order instead (issue #427)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).not.toContain("styles.mobileBar");
    expect(component).not.toContain("styles.mobileBuyButton");
    expect(component).not.toContain("styles.mobileSellButton");
  });

  it("marks the identity/stats panel distinctly from the swap panel so CSS can reorder them for mobile (issue #427)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("`${styles.panel} ${styles.identityPanel}`");
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
    expect(component).toContain(
      'import { buyNetFromGross, grossNativeInForExactNet, tradingFee } from "@/lib/bonding-curve-fee-math";',
    );
    expect(component).toContain("tradingFee(parseEther(amount))");
    expect(component).toContain('functionName: "quoteSellFee"');
    expect(component).toContain("Trading fee (1%)");
  });

  it("reads remainingNativeToGraduate() and displays it, and caps the buy MAX preset at the graduation target", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('functionName: "remainingNativeToGraduate"');
    expect(component).toContain("ETH remaining to graduation");
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
    const submitTradeEnd = component.indexOf("const graduationSection", submitTradeStart);
    expect(submitTradeStart).toBeGreaterThan(-1);
    expect(submitTradeEnd).toBeGreaterThan(submitTradeStart);
    const submitTrade = component.slice(submitTradeStart, submitTradeEnd);

    expect(submitTrade).toContain("void refreshBalances(account);");
    expect(submitTrade).toContain("if (curveAddress) void loadCurve(curveAddress);");
    // The refetch runs before branching on success/revert, so it happens
    // for both outcomes (a reverted tx still spent gas) — not just success.
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

  it("notifies the trades tab/chart only on a genuine (non-reverted) confirmed trade (issue #430)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { notifyTokenTradeConfirmed } from "@/lib/token-trade-events"');
    const successBranchStart = component.indexOf('setStatusMessage("Trade confirmed.")');
    const revertedBranchStart = component.indexOf('setTradeError(describeRevertedTrade(hash));');
    const notifyIndex = component.indexOf("notifyTokenTradeConfirmed({ curveAddress, chainId: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL })");
    expect(notifyIndex).toBeGreaterThan(successBranchStart);
    expect(revertedBranchStart).toBeLessThan(successBranchStart);
    expect(notifyIndex).toBeGreaterThan(revertedBranchStart);
  });

  it("polls curve state every ~12s while the tab is visible, matching the token-launches grid's live-refresh pattern (issue #430)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("CURVE_STATE_POLL_INTERVAL_MS = 12_000");
    expect(component).toContain("document.visibilityState === \"visible\"");
    expect(component).toContain("window.setInterval(() => void loadCurve(curveAddress as Address), CURVE_STATE_POLL_INTERVAL_MS)");
    expect(component).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(component).toContain('window.addEventListener("focus", handleBecameVisible)');
  });
});

describe("token page centre column (chart + activity)", () => {
  it("no longer embeds the Dexscreener chart — it can't index this chain and only ever showed a broken-chart message (issue #427)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).not.toContain("PublicDexscreenerSection");
    expect(component).not.toContain("public-dexscreener-section");
  });

  it("renders the real live chart, not a placeholder (issue #430)", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).not.toContain("chartPlaceholder");
    expect(component).toContain('import { TokenChart } from "@/components/token-page/token-chart"');
    expect(component).toContain("<TokenChart trades={trades} />");
  });

  it("shares one useTokenTrades poll between the chart and the Recent trades tab", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain('import { useTokenTrades } from "@/lib/use-token-trades"');
    expect(component).toContain("useTokenTrades(curveAddress, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL)");
  });

  it("renders Recent trades and Holders tabs with graceful empty states, distinct from a load failure", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("Recent trades");
    expect(component).toContain("Holders");
    expect(component).toContain("No trades recorded yet.");
    expect(component).toContain("No holder data found for this token yet.");
    expect(component).toContain("recentTradesDescending === null");
    expect(component).toContain("tradesError");
  });

  it("links each trade's time to its explorer transaction page", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain('href={`${explorerTxBaseUrl}${trade.txHash}`}');
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
});

describe("token page right column (trade terminals, about, chat)", () => {
  it("is a static server component — no wallet or live state needed", async () => {
    const component = await source("components/token-page/token-right-column.tsx");
    expect(component).not.toContain('"use client"');
  });

  it("no longer shows a coming-soon chat placeholder now that live Hoodchat lives in the centre column", async () => {
    const component = await source("components/token-page/token-right-column.tsx");
    expect(component).not.toContain("Coming soon");
  });

  it("degrades gracefully instead of inventing a description for tokens with no published copy", async () => {
    const component = await source("components/token-page/token-right-column.tsx");
    expect(component).toContain("No description has been published for this token yet.");
  });
});

describe("token page mobile-first layout (issue #427)", () => {
  it("stacks to a single column with no query, only progressively restoring columns at min-width breakpoints (mobile-first)", async () => {
    const css = await source("components/token-page/token-page.module.css");
    const gridRuleIndex = css.indexOf(".grid {");
    const firstMediaQueryIndex = css.indexOf("@media");
    expect(gridRuleIndex).toBeGreaterThan(-1);
    expect(gridRuleIndex).toBeLessThan(firstMediaQueryIndex);
    expect(css).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(css).not.toContain("max-width: 880px");
    expect(css).not.toContain("max-width: 1180px");
    expect(css).toContain("@media (min-width: 881px)");
    expect(css).toContain("@media (min-width: 1181px)");
  });

  it("pulls the swap panel ahead of the identity/stats panel within the mobile-base left column, resetting to source order on desktop", async () => {
    const css = await source("components/token-page/token-page.module.css");
    expect(css).toContain(".left > .swapPanel {\n  order: -1;\n}");
    const desktopBlockStart = css.indexOf("@media (min-width: 881px)");
    const resetIndex = css.indexOf(".left > .swapPanel,", desktopBlockStart);
    expect(resetIndex).toBeGreaterThan(desktopBlockStart);
  });

  it("keeps the trade column reachable while scrolling on desktop via position: sticky", async () => {
    const css = await source("components/token-page/token-page.module.css");
    expect(css).toContain("position: sticky;");
    expect(css).toContain("align-self: start;");
  });

  it("gives every interactive control in the swap panel and topbar a >=44px touch target", async () => {
    const css = await source("components/token-page/token-page.module.css");
    for (const selector of [
      ".backLink",
      ".topbarLink",
      ".copyButton",
      ".pillButton",
      ".walletButton",
      ".presetButton",
      ".activityTab",
      ".feeWithdrawButton",
      ".terminalFallbackLink",
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
