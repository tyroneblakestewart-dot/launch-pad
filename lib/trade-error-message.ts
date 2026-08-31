/**
 * Maps a thrown wallet/RPC/contract error — or a mined-but-reverted
 * transaction receipt — to one of a fixed set of short, plain-English
 * messages safe to show a user (issue #462). viem wraps a rejected or
 * failed trade in multi-line text carrying calldata, contract arguments,
 * a docs URL and its own library version (e.g. "User rejected the
 * request. Request Arguments: from … data: 0x… Contract Call: … Docs:
 * https://viem.sh/... Version: viem@2.55.2") — none of that, and no part
 * of `error.message`/`error.details`, may ever reach the UI. Detection
 * walks the error's `.cause` chain (viem wraps several levels deep) and
 * matches on structural signals (error name, EIP-1193 numeric code, a
 * receipt's own `status`) first, falling back to narrow text keywords
 * that don't collide with the noisy text this module exists to hide —
 * anything unrecognised gets the generic fallback rather than guessing.
 */

const WALLET_REJECTION_RPC_CODE = 4001;

const USER_REJECTED_NAMES = new Set(["UserRejectedRequestError"]);
const INSUFFICIENT_FUNDS_NAMES = new Set(["InsufficientFundsError"]);
const REVERTED_NAMES = new Set(["ContractFunctionRevertedError"]);
const NETWORK_FAILURE_NAMES = new Set(["HttpRequestError", "TimeoutError", "WebSocketRequestError", "SocketClosedError"]);

type ErrorSignals = {
  names: string[];
  codes: number[];
  text: string;
};

function isRevertedReceipt(value: unknown): boolean {
  return typeof value === "object" && value !== null && "status" in value && (value as { status: unknown }).status === "reverted";
}

/** Walks a thrown error's `.cause` chain collecting every name/code/message it finds, bounded to avoid an unexpected cyclic chain. */
function collectErrorSignals(error: unknown): ErrorSignals {
  const names: string[] = [];
  const codes: number[] = [];
  const messages: string[] = [];

  if (typeof error === "string") {
    messages.push(error);
  }

  let current: unknown = error;
  let hops = 0;
  while (current && typeof current === "object" && hops < 10) {
    const record = current as Record<string, unknown>;
    if (typeof record.name === "string") names.push(record.name);
    if (typeof record.code === "number") codes.push(record.code);
    if (typeof record.shortMessage === "string") messages.push(record.shortMessage);
    if (typeof record.message === "string") messages.push(record.message);
    current = record.cause;
    hops += 1;
  }

  return { names, codes, text: messages.join(" ").toLowerCase() };
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function describeTradeError(error: unknown): string {
  if (isRevertedReceipt(error)) {
    return "Trade reverted — the price moved past your slippage. Try again or raise slippage.";
  }

  const { names, codes, text } = collectErrorSignals(error);

  if (names.some((name) => USER_REJECTED_NAMES.has(name)) || codes.includes(WALLET_REJECTION_RPC_CODE) || includesAny(text, ["user rejected", "user denied"])) {
    return "Transaction cancelled in your wallet. Nothing was sent.";
  }

  if (
    names.some((name) => INSUFFICIENT_FUNDS_NAMES.has(name)) ||
    includesAny(text, ["insufficient funds", "exceeds the balance of the account"])
  ) {
    return "Not enough ETH in your wallet to cover this trade and gas.";
  }

  if (includesAny(text, ["expired"])) {
    return "This quote expired. Refresh and try again.";
  }

  if (
    names.some((name) => REVERTED_NAMES.has(name)) ||
    includesAny(text, ["execution reverted", "slippage exceeded", "this contract call reverted", "transaction reverted"])
  ) {
    return "Trade reverted — the price moved past your slippage. Try again or raise slippage.";
  }

  if (
    names.some((name) => NETWORK_FAILURE_NAMES.has(name)) ||
    includesAny(text, ["fetch failed", "failed to fetch", "network error", "network request failed", "timed out", "timeout", "econnrefused"])
  ) {
    return "Couldn't reach the network. Check your connection and try again.";
  }

  return "The trade could not be completed. Nothing was sent.";
}

const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CREDENTIAL_PATTERN = /(?:api[_-]?key|token)(["'\s:=]+)[A-Za-z0-9._~+/=-]+/gi;
const SANITISED_LOG_MAX_LENGTH = 1000;

function stringifyForLogging(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, (_key, value) => (typeof value === "bigint" ? value.toString() : value)) ?? String(error);
  } catch {
    return String(error);
  }
}

/**
 * Produces a string safe to `console.log`/`console.error` for debugging a
 * trade failure — never shown to the user. Mirrors
 * lib/server/sanitise-provider-detail.ts's redaction, since an RPC
 * failure's text can carry a provider URL with an embedded API key.
 */
export function sanitiseTradeErrorForLogging(error: unknown): string {
  return stringifyForLogging(error)
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(CREDENTIAL_PATTERN, "credential$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SANITISED_LOG_MAX_LENGTH);
}
