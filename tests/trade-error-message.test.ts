import { describe, expect, it } from "vitest";
import { describeTradeError, sanitiseTradeErrorForLogging } from "@/lib/trade-error-message";

// viem wraps a rejected/failed writeContract() call in multi-line text like
// this real-world example (issue #462) — calldata, contract arguments, a
// docs URL and its own library version, none of which may ever reach the
// UI. Fixtures below mimic the *shape* viem's own error classes carry
// (name/code/cause chain) rather than constructing viem's internal classes
// directly, since their constructors are not part of viem's public API.
const NOISY_VIEM_REJECTION_MESSAGE = `User rejected the request.

Request Arguments:
  from:      0x1234567890123456789012345678901234567890
  to:        0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
  data:      0xa9059cbb000000000000000000000000000000000000000000000000000000
Contract Call:
  address:   0xabcdefabcdefabcdefabcdefabcdefabcdefabcd
  function:  buy(uint256 minTokensOut, uint256 deadline)
  args:            (1000000000000000000, 1735689600)

Docs: https://viem.sh/docs/contract/writeContract
Version: viem@2.55.2`;

function fakeViemUserRejectedRequestError(): Error {
  const error = new Error(NOISY_VIEM_REJECTION_MESSAGE);
  error.name = "UserRejectedRequestError";
  (error as unknown as { shortMessage: string }).shortMessage = "User rejected the request.";
  (error as unknown as { code: number }).code = 4001;
  return error;
}

const FORBIDDEN_OUTPUT_SUBSTRINGS = ["0x", "viem", "Docs:", "Request Arguments", "Version:"];

function assertNeverLeaksRawError(message: string) {
  for (const forbidden of FORBIDDEN_OUTPUT_SUBSTRINGS) {
    expect(message).not.toContain(forbidden);
  }
}

describe("describeTradeError", () => {
  it("maps a viem-shaped UserRejectedRequestError to a neutral cancellation message, never the raw viem text", () => {
    const message = describeTradeError(fakeViemUserRejectedRequestError());
    expect(message).toBe("Transaction cancelled in your wallet. Nothing was sent.");
    assertNeverLeaksRawError(message);
  });

  it("maps a raw EIP-1193 code-4001 object to the same cancellation message", () => {
    const message = describeTradeError({ code: 4001, message: "User rejected the request." });
    expect(message).toBe("Transaction cancelled in your wallet. Nothing was sent.");
    assertNeverLeaksRawError(message);
  });

  it("detects a wallet rejection nested inside a wrapping error's cause chain", () => {
    const inner = { name: "UserRejectedRequestError", code: 4001, message: "User rejected the request." };
    const wrapper = new Error(NOISY_VIEM_REJECTION_MESSAGE);
    wrapper.name = "TransactionExecutionError";
    (wrapper as unknown as { cause: unknown }).cause = inner;
    const message = describeTradeError(wrapper);
    expect(message).toBe("Transaction cancelled in your wallet. Nothing was sent.");
    assertNeverLeaksRawError(message);
  });

  it("maps an insufficient-funds error to a plain balance message", () => {
    const error = new Error("The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.");
    error.name = "InsufficientFundsError";
    const message = describeTradeError(error);
    expect(message).toBe("Not enough ETH in your wallet to cover this trade and gas.");
    assertNeverLeaksRawError(message);
  });

  it("also recognises the raw node RPC 'insufficient funds' phrasing without a matching error name", () => {
    const message = describeTradeError(new Error("insufficient funds for gas * price + value"));
    expect(message).toBe("Not enough ETH in your wallet to cover this trade and gas.");
  });

  it("maps a reverted transaction receipt to the slippage/revert message", () => {
    const receipt = { status: "reverted", transactionHash: "0x1234567890123456789012345678901234567890123456789012345678901234" };
    const message = describeTradeError(receipt);
    expect(message).toBe("Trade reverted — the price moved past your slippage. Try again or raise slippage.");
    assertNeverLeaksRawError(message);
  });

  it("maps a thrown contract-revert error to the same slippage/revert message", () => {
    const error = new Error("execution reverted");
    error.name = "ContractFunctionRevertedError";
    const message = describeTradeError(error);
    expect(message).toBe("Trade reverted — the price moved past your slippage. Try again or raise slippage.");
  });

  it("maps a network/RPC failure to a connectivity message", () => {
    const error = new Error("fetch failed");
    error.name = "HttpRequestError";
    const message = describeTradeError(error);
    expect(message).toBe("Couldn't reach the network. Check your connection and try again.");
    assertNeverLeaksRawError(message);
  });

  it("also recognises a generic network failure by message text alone", () => {
    expect(describeTradeError(new Error("The operation timed out"))).toBe(
      "Couldn't reach the network. Check your connection and try again.",
    );
  });

  it("maps an expired quote/deadline to its own message", () => {
    expect(describeTradeError(new Error("This request has expired."))).toBe("This quote expired. Refresh and try again.");
  });

  it("falls back to a generic message for an unrecognised error", () => {
    const message = describeTradeError(new Error("Something completely unexpected happened"));
    expect(message).toBe("The trade could not be completed. Nothing was sent.");
    assertNeverLeaksRawError(message);
  });

  it("falls back to the generic message for a plain string", () => {
    const message = describeTradeError("boom");
    expect(message).toBe("The trade could not be completed. Nothing was sent.");
  });

  it("falls back to the generic message for null/undefined", () => {
    expect(describeTradeError(null)).toBe("The trade could not be completed. Nothing was sent.");
    expect(describeTradeError(undefined)).toBe("The trade could not be completed. Nothing was sent.");
  });

  it("never returns any output containing calldata, the docs URL, the library version or the raw viem text, across every recognised case", () => {
    const fixtures: unknown[] = [
      fakeViemUserRejectedRequestError(),
      { code: 4001, message: "User rejected the request." },
      Object.assign(new Error("insufficient funds"), { name: "InsufficientFundsError" }),
      { status: "reverted", transactionHash: "0xdeadbeef" },
      Object.assign(new Error("fetch failed"), { name: "HttpRequestError" }),
      new Error("Something completely unexpected happened"),
      "boom",
    ];
    for (const fixture of fixtures) {
      assertNeverLeaksRawError(describeTradeError(fixture));
    }
  });
});

describe("sanitiseTradeErrorForLogging", () => {
  it("keeps an ordinary error's name and message for debugging", () => {
    const result = sanitiseTradeErrorForLogging(new Error("boom"));
    expect(result).toBe("Error: boom");
  });

  it("redacts a Bearer token that leaked into an RPC failure message", () => {
    const result = sanitiseTradeErrorForLogging(new Error("Request failed: Bearer abcdef1234567890secret"));
    expect(result).not.toContain("abcdef1234567890secret");
    expect(result).toContain("Bearer [redacted]");
  });

  it("redacts an api-key-style credential", () => {
    const result = sanitiseTradeErrorForLogging(new Error("rpc call to https://example.com?apiKey=supersecretvalue123 failed"));
    expect(result).not.toContain("supersecretvalue123");
  });

  it("stringifies a plain object without throwing on bigint fields", () => {
    const result = sanitiseTradeErrorForLogging({ status: "reverted", gasUsed: 21000n });
    expect(result).toContain("reverted");
    expect(result).toContain("21000");
  });

  it("passes a plain string through", () => {
    expect(sanitiseTradeErrorForLogging("boom")).toBe("boom");
  });

  it("truncates an excessively long message", () => {
    const result = sanitiseTradeErrorForLogging(new Error("x".repeat(5000)));
    expect(result.length).toBeLessThanOrEqual(1000);
  });
});
