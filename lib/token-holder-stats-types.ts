// Shared shape for the token page's Holder breakdown rows (token page v2
// part 3 — the "Top 10 % / Dev % / Snipers %" rows that rendered "—" since
// issue #443 part 1). Produced server-side by lib/server/token-holder-stats.ts
// from Blockscout's holder list plus direct on-chain reads, and consumed by
// components/token-page/token-stats-audit-panel.tsx through the page-level
// lib/use-token-holder-stats.ts poll. Every percentage is a share of the
// token's live on-chain `totalSupply()`, already scaled 0–100, or `null`
// when that specific row genuinely cannot be computed (its own source was
// unavailable) — the panel renders `null` as "—", never as 0.

export type TokenHolderBreakdown = {
  /**
   * Share of supply held by the ten largest wallets, with the bonding curve
   * and the graduated liquidity pool excluded (design ruling: neither is a
   * "holder"). `null` when the explorer's holder list was unavailable, or
   * when nobody but the curve/pool holds anything yet (a brand-new token).
   */
  top10Percent: number | null;
  /** Share of supply held by the curve's `creator()` wallet. `null` when no curve trades this token. */
  devPercent: number | null;
  /**
   * Share of supply currently held by wallets whose first curve buy landed
   * within SNIPER_WINDOW_BLOCKS blocks of the curve's `CurveFunded` event.
   * `null` when no curve trades this token or the funding block could not
   * be found.
   */
  snipersPercent: number | null;
  /** Distinct wallets that qualify as snipers (for the tooltip/debugging; 0 when none). */
  sniperWalletCount: number;
  /** The curve address the Dev/Snipers rows were computed against, or null. */
  curveAddress: string | null;
  /** The graduated pool excluded from Top 10, or null while still bonding / no curve. */
  liquidityPoolAddress: string | null;
};

export type TokenHolderStatsResponse = { stats: TokenHolderBreakdown };
