import type { Address } from "viem";
import { grossNativeInForExactNet } from "@/lib/bonding-curve-fee-math";

/**
 * Quick Trade (token page): an OPT-IN, per-wallet, browser-local mode that
 * turns a buy or sell into one tap. It never removes the wallet's own
 * confirmation — Hoodlums is non-custodial (CLAUDE.md rule 4): no keys, no
 * session keys, no pre-signed transactions. What it removes is everything
 * before that confirmation: typing an amount, waiting for the quote, and
 * pressing the CTA. The user enables it by signing a plain-English consent
 * message in their wallet; that signature and their chosen presets are
 * stored only in this browser's localStorage, keyed by wallet, and verified
 * against the connected wallet on every load (see the component).
 *
 * Everything here is pure and storage-injected so it is unit-testable in the
 * plain Node test environment; the component owns the wallet calls.
 */

export const QUICK_TRADE_STORAGE_KEY = "hoodlums.quickTrade.v1";

export const QUICK_TRADE_BUY_PRESETS_ETH = ["0.1", "0.5", "1"] as const;
export const QUICK_TRADE_SELL_PRESETS_PERCENT = [25, 50, 75, 100] as const;
export const QUICK_TRADE_SLIPPAGE_OPTIONS_BPS = [50, 100, 300] as const;

export type QuickTradeBuyPresetEth = (typeof QUICK_TRADE_BUY_PRESETS_ETH)[number];
export type QuickTradeSellPresetPercent = (typeof QUICK_TRADE_SELL_PRESETS_PERCENT)[number];
export type QuickTradeSlippageBps = (typeof QUICK_TRADE_SLIPPAGE_OPTIONS_BPS)[number];

export type QuickTradeSettings = {
  buyPresetEth: QuickTradeBuyPresetEth;
  sellPresetPercent: QuickTradeSellPresetPercent;
  slippageBps: QuickTradeSlippageBps;
};

/** What is stored per wallet: the settings plus the consent the wallet signed. */
export type QuickTradeRecord = QuickTradeSettings & {
  /** The exact message that was signed, kept verbatim so it can be re-verified. */
  message: string;
  signature: `0x${string}`;
  signedAt: string;
};

export const DEFAULT_QUICK_TRADE_SETTINGS: QuickTradeSettings = {
  buyPresetEth: "0.1",
  sellPresetPercent: 25,
  slippageBps: 100,
};

/** The minimal localStorage surface used, so tests can pass an in-memory map. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The consent statement the wallet signs to enable Quick Trade. It is
 * deliberately plain English and states the two things that matter: every
 * trade still needs the wallet's confirmation, and Hoodlums never holds keys
 * or funds. Bound to the host and wallet so a signature for one site or one
 * wallet can never enable it for another.
 */
export function buildQuickTradeConsentMessage(wallet: Address, host: string, signedAtIso: string): string {
  return [
    `Enable Quick Trade on ${host}`,
    "",
    `Wallet: ${wallet}`,
    "",
    "Quick Trade turns a buy or sell into one tap: it sends the transaction to",
    "your wallet straight away, using the amount and slippage you set.",
    "",
    "Every trade still requires your wallet's confirmation. Hoodlums never",
    "holds your keys or funds and cannot trade without you.",
    "",
    "You can turn Quick Trade off at any time.",
    "",
    `Signed: ${signedAtIso}`,
  ].join("\n");
}

function isOneOf<T extends readonly unknown[]>(options: T, value: unknown): value is T[number] {
  return (options as readonly unknown[]).includes(value);
}

/** Coerces unknown stored settings back onto the allowed presets, defaulting anything invalid. */
export function normaliseQuickTradeSettings(input: unknown): QuickTradeSettings {
  const candidate = (input ?? {}) as Partial<Record<keyof QuickTradeSettings, unknown>>;
  return {
    buyPresetEth: isOneOf(QUICK_TRADE_BUY_PRESETS_ETH, candidate.buyPresetEth)
      ? candidate.buyPresetEth
      : DEFAULT_QUICK_TRADE_SETTINGS.buyPresetEth,
    sellPresetPercent: isOneOf(QUICK_TRADE_SELL_PRESETS_PERCENT, candidate.sellPresetPercent)
      ? candidate.sellPresetPercent
      : DEFAULT_QUICK_TRADE_SETTINGS.sellPresetPercent,
    slippageBps: isOneOf(QUICK_TRADE_SLIPPAGE_OPTIONS_BPS, candidate.slippageBps)
      ? candidate.slippageBps
      : DEFAULT_QUICK_TRADE_SETTINGS.slippageBps,
  };
}

type StoredMap = Record<string, unknown>;

function readMap(storage: StorageLike): StoredMap {
  try {
    const raw = storage.getItem(QUICK_TRADE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeMap(storage: StorageLike, map: StoredMap): void {
  try {
    storage.setItem(QUICK_TRADE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full or blocked — Quick Trade simply won't persist across reloads.
  }
}

/** The stored record for a wallet, or null when none / malformed. Settings are normalised; the consent fields must be present and well-formed. */
export function readQuickTradeRecord(storage: StorageLike, wallet: Address): QuickTradeRecord | null {
  const entry = readMap(storage)[wallet.toLowerCase()];
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as Partial<QuickTradeRecord>;
  if (typeof candidate.message !== "string" || !candidate.message) return null;
  if (typeof candidate.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(candidate.signature)) return null;
  if (typeof candidate.signedAt !== "string" || !candidate.signedAt) return null;
  return {
    ...normaliseQuickTradeSettings(candidate),
    message: candidate.message,
    signature: candidate.signature as `0x${string}`,
    signedAt: candidate.signedAt,
  };
}

export function writeQuickTradeRecord(storage: StorageLike, wallet: Address, record: QuickTradeRecord): void {
  const map = readMap(storage);
  map[wallet.toLowerCase()] = { ...normaliseQuickTradeSettings(record), message: record.message, signature: record.signature, signedAt: record.signedAt };
  writeMap(storage, map);
}

export function clearQuickTradeRecord(storage: StorageLike, wallet: Address): void {
  const map = readMap(storage);
  delete map[wallet.toLowerCase()];
  writeMap(storage, map);
}

/** The exact token amount a quick sell of `percent` of `tokenBalance` sends — integer maths, never rounds above the balance. */
export function quickSellAmountRaw(tokenBalance: bigint, percent: QuickTradeSellPresetPercent): bigint {
  if (tokenBalance <= 0n) return 0n;
  if (percent >= 100) return tokenBalance;
  return (tokenBalance * BigInt(percent)) / 100n;
}

export type QuickBuyPlan =
  | { ok: true; grossWei: bigint; clampedToGraduation: boolean }
  | { ok: false; reason: "insufficient-balance" | "nothing-left-to-graduate" };

/**
 * Resolves the gross ETH a quick buy should send. A preset larger than what is
 * left to graduate is clamped to the exact gross that nets to that remainder
 * (the same `grossNativeInForExactNet` the form's MAX preset uses), so the
 * curve's buy() can never revert with BuyExceedsGraduationTarget; a preset the
 * wallet cannot afford is refused up front rather than left to the wallet's
 * own error. A null balance (not yet read) is not treated as zero.
 */
export function planQuickBuy(presetWei: bigint, nativeBalanceWei: bigint | null, remainingToGraduateWei: bigint | null): QuickBuyPlan {
  if (remainingToGraduateWei !== null && remainingToGraduateWei <= 0n) return { ok: false, reason: "nothing-left-to-graduate" };
  let grossWei = presetWei;
  let clampedToGraduation = false;
  if (remainingToGraduateWei !== null) {
    const graduationCap = grossNativeInForExactNet(remainingToGraduateWei);
    if (graduationCap < grossWei) {
      grossWei = graduationCap;
      clampedToGraduation = true;
    }
  }
  if (nativeBalanceWei !== null && nativeBalanceWei < grossWei) return { ok: false, reason: "insufficient-balance" };
  return { ok: true, grossWei, clampedToGraduation };
}
