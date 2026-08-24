import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatAuthorisationMessage,
  createChatChallenge,
  createChatNonce,
  hashChatNonce,
  resetChatChallengesForTests,
} from "@/lib/server/chat-auth";
import {
  authoriseTokenLaunchAction,
  hashTokenLaunchAction,
  isTokenLaunchActionPurpose,
} from "@/lib/server/token-launch-auth";

const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);

afterEach(() => {
  resetChatChallengesForTests();
  vi.useRealTimers();
});

describe("isTokenLaunchActionPurpose", () => {
  it("accepts only the known purpose", () => {
    expect(isTokenLaunchActionPurpose("token-launch:record")).toBe(true);
    expect(isTokenLaunchActionPurpose("support:ticket-create")).toBe(false);
    expect(isTokenLaunchActionPurpose("something-else")).toBe(false);
  });
});

describe("hashTokenLaunchAction", () => {
  it("is deterministic regardless of key order", () => {
    const a = hashTokenLaunchAction("token-launch:record", { tokenAddress: "0xabc", chainId: "46630" });
    const b = hashTokenLaunchAction("token-launch:record", { chainId: "46630", tokenAddress: "0xabc" });
    expect(a).toBe(b);
  });

  it("changes when the payload changes", () => {
    const a = hashTokenLaunchAction("token-launch:record", { tokenAddress: "0xabc" });
    const b = hashTokenLaunchAction("token-launch:record", { tokenAddress: "0xdef" });
    expect(a).not.toBe(b);
  });
});

async function issueSignedChallenge(payload: Record<string, string>, ttlMs = 60_000) {
  const nonce = createChatNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);
  const contentHash = hashTokenLaunchAction("token-launch:record", payload);
  const challenge = createChatChallenge({
    nonceHash: hashChatNonce(nonce),
    walletAddress: account.address,
    walletChainId: 46630,
    purpose: "token-launch:record",
    contentHash,
    issuedAt,
    expiresAt,
  });
  const message = buildChatAuthorisationMessage({ ...challenge, nonce });
  const signature = await account.signMessage({ message });
  return { challengeId: challenge.id, nonce, signature };
}

const PAYLOAD = {
  chainId: "46630",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  curveAddress: "0x2222222222222222222222222222222222222222",
  tokenName: "Test Token",
  ticker: "TEST",
  decimals: "18",
  wholeTokenSupply: "1000000",
  graduationTargetWei: "4000000000000000000",
};

describe("authoriseTokenLaunchAction", () => {
  it("authorises a correctly signed record challenge and returns the wallet address", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge(PAYLOAD);
    const result = await authoriseTokenLaunchAction({
      purpose: "token-launch:record",
      payload: PAYLOAD,
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "ok", walletAddress: account.address });
  });

  it("rejects when the payload doesn't match what was signed (contentHash mismatch)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge(PAYLOAD);
    const result = await authoriseTokenLaunchAction({
      purpose: "token-launch:record",
      payload: { ...PAYLOAD, tokenName: "Tampered" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });

  it("rejects a signature that doesn't match the wallet", async () => {
    const { challengeId, nonce } = await issueSignedChallenge(PAYLOAD);
    const result = await authoriseTokenLaunchAction({
      purpose: "token-launch:record",
      payload: PAYLOAD,
      challengeId,
      nonce,
      signature: "0x" + "00".repeat(65),
    });
    expect(result).toEqual({ status: "invalid_signature" });
  });

  it("rejects a replayed challenge (second consume fails)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge(PAYLOAD);
    const input = {
      purpose: "token-launch:record" as const,
      payload: PAYLOAD,
      challengeId,
      nonce,
      signature,
    };
    await expect(authoriseTokenLaunchAction(input)).resolves.toEqual({ status: "ok", walletAddress: account.address });
    await expect(authoriseTokenLaunchAction(input)).resolves.toEqual({ status: "replayed" });
  });

  it("rejects an unknown challenge id", async () => {
    const result = await authoriseTokenLaunchAction({
      purpose: "token-launch:record",
      payload: PAYLOAD,
      challengeId: "00000000-0000-0000-0000-000000000000",
      nonce: "irrelevant",
      signature: "0x" + "00".repeat(65),
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });

  it("rejects an expired challenge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { challengeId, nonce, signature } = await issueSignedChallenge(PAYLOAD, 1000);
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    const result = await authoriseTokenLaunchAction({
      purpose: "token-launch:record",
      payload: PAYLOAD,
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "expired" });
  });
});
