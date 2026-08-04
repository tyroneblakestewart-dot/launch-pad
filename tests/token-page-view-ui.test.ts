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

  it("links out to Dexscreener, the contract explorer and (when known) the pool explorer", async () => {
    const view = await source("components/token-page/token-page-view.tsx");
    expect(view).toContain("Dexscreener ↗");
    expect(view).toContain("Contract ↗");
    expect(view).toContain("Pool ↗");
    expect(view).toContain("chainInfo.explorerBaseUrl");
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

  it("renders the mobile sticky swap bar sharing this component's own wallet/curve state", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain("styles.mobileBar");
    expect(component).toContain("styles.mobileBuyButton");
  });

  it("connects a wallet the same way the testnet launcher does (shared injected-provider helper)", async () => {
    const component = await source("components/token-page/token-left-column.tsx");
    expect(component).toContain('import { getInjectedEvmProvider } from "@/lib/wallet-provider"');
    expect(component).toContain('method: "eth_requestAccounts"');
    expect(component).toContain('method: "wallet_switchEthereumChain"');
  });
});

describe("token page centre column (chart + activity)", () => {
  it("reuses PublicDexscreenerSection instead of rebuilding chart-embed logic", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain('import { PublicDexscreenerSection } from "@/components/public-dexscreener-section"');
    expect(component).toContain("<PublicDexscreenerSection address={address} />");
  });

  it("renders Recent trades and Holders tabs with graceful empty states", async () => {
    const component = await source("components/token-page/token-center-column.tsx");
    expect(component).toContain("Recent trades");
    expect(component).toContain("Holders");
    expect(component).toContain("No trades recorded yet.");
    expect(component).toContain("No holder data found for this token yet.");
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
