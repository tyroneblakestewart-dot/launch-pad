import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildChatAuthorisationMessage,
  createChatChallenge,
  createChatNonce,
  hashChatNonce,
  resetChatChallengesForTests,
} from "@/lib/server/chat-auth";
import { authoriseSocialStudioAction, hashSocialStudioAction, isSocialStudioActionPurpose } from "@/lib/server/social-studio-action-auth";

const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);

afterEach(() => {
  resetChatChallengesForTests();
});

describe("isSocialStudioActionPurpose", () => {
  it("accepts only the known purposes", () => {
    expect(isSocialStudioActionPurpose("social:x-connect")).toBe(true);
    expect(isSocialStudioActionPurpose("social:post-cancel")).toBe(true);
    expect(isSocialStudioActionPurpose("something-else")).toBe(false);
  });
});

describe("hashSocialStudioAction", () => {
  it("is deterministic regardless of key order", () => {
    const a = hashSocialStudioAction("social:post-create", { body: "gm", destinations: "x" });
    const b = hashSocialStudioAction("social:post-create", { destinations: "x", body: "gm" });
    expect(a).toBe(b);
  });

  it("changes when the purpose or payload changes", () => {
    const a = hashSocialStudioAction("social:post-create", { body: "gm" });
    const b = hashSocialStudioAction("social:post-cancel", { body: "gm" });
    const c = hashSocialStudioAction("social:post-create", { body: "gn" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

async function issueSignedChallenge(purpose: "social:x-connect", payload: Record<string, string>) {
  const nonce = createChatNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 60_000);
  const contentHash = hashSocialStudioAction(purpose, payload);
  const challenge = createChatChallenge({
    nonceHash: hashChatNonce(nonce),
    walletAddress: account.address,
    walletChainId: 46630,
    purpose,
    contentHash,
    issuedAt,
    expiresAt,
  });
  const message = buildChatAuthorisationMessage({ ...challenge, nonce });
  const signature = await account.signMessage({ message });
  return { challengeId: challenge.id, nonce, signature };
}

describe("authoriseSocialStudioAction", () => {
  it("authorises a correctly signed challenge and returns the wallet address", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("social:x-connect", { platform: "x" });
    const result = await authoriseSocialStudioAction({
      purpose: "social:x-connect",
      payload: { platform: "x" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "ok", walletAddress: account.address });
  });

  it("rejects when the payload doesn't match what was signed (contentHash mismatch)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("social:x-connect", { platform: "x" });
    const result = await authoriseSocialStudioAction({
      purpose: "social:x-connect",
      payload: { platform: "telegram" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });

  it("rejects a signature that doesn't match the wallet", async () => {
    const { challengeId, nonce } = await issueSignedChallenge("social:x-connect", { platform: "x" });
    const result = await authoriseSocialStudioAction({
      purpose: "social:x-connect",
      payload: { platform: "x" },
      challengeId,
      nonce,
      signature: "0x" + "00".repeat(65),
    });
    expect(result).toEqual({ status: "invalid_signature" });
  });

  it("rejects a replayed challenge (second consume fails)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("social:x-connect", { platform: "x" });
    const input = { purpose: "social:x-connect" as const, payload: { platform: "x" }, challengeId, nonce, signature };
    await expect(authoriseSocialStudioAction(input)).resolves.toEqual({ status: "ok", walletAddress: account.address });
    await expect(authoriseSocialStudioAction(input)).resolves.toEqual({ status: "replayed" });
  });

  it("rejects an unknown challenge id", async () => {
    const result = await authoriseSocialStudioAction({
      purpose: "social:x-connect",
      payload: { platform: "x" },
      challengeId: "00000000-0000-0000-0000-000000000000",
      nonce: "irrelevant",
      signature: "0x" + "00".repeat(65),
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });
});
