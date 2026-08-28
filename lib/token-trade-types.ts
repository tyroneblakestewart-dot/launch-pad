import type { Address, Hash } from "viem";

// Shared shape for a single normalized bonding-curve trade (issue #430),
// produced server-side from contracts/HoodlumsTestBondingCurve.sol's
// TokensPurchased/TokensSold events (lib/server/token-trades-rpc.ts) and
// consumed by both the Recent trades tab and the candlestick chart so they
// stay in lockstep off one shared fetch. Amounts stay raw (wei/base-unit
// strings) rather than pre-formatted numbers so precision is never lost in
// transit; `nativeAmountRaw` is deliberately the post-fee amount (netNativeIn
// for a buy, netNativeOut for a sell) since that's what actually priced the
// trade against the curve's reserves, matching the curve's own quoting math.

export type TokenTradeDirection = "buy" | "sell";

export type TokenTrade = {
  direction: TokenTradeDirection;
  wallet: Address;
  tokenAmountRaw: string;
  nativeAmountRaw: string;
  blockNumber: string;
  blockTimestamp: number;
  txHash: Hash;
  logIndex: number;
};

export type TokenTradesResponse = { trades: TokenTrade[] };
