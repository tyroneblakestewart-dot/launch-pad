import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChatAuthorisationMessage,
  createChatChallenge,
  createChatNonce,
  hashChatNonce,
  resetChatChallengesForTests,
} from "@/lib/server/chat-auth";
import { authoriseSupportAction, hashSupportAction, isSupportActionPurpose } from "@/lib/server/support-ticket-auth";

const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);

afterEach(() => {
  resetChatChallengesForTests();
  vi.useRealTimers();
});

describe("isSupportActionPurpose", () => {
  it("accepts only the known purposes", () => {
    expect(isSupportActionPurpose("support:ticket-create")).toBe(true);
    expect(isSupportActionPurpose("support:ticket-reply")).toBe(true);
    expect(isSupportActionPurpose("support:ticket-close")).toBe(true);
    expect(isSupportActionPurpose("social:x-connect")).toBe(false);
    expect(isSupportActionPurpose("something-else")).toBe(false);
  });
});

describe("hashSupportAction", () => {
  it("is deterministic regardless of key order", () => {
    const a = hashSupportAction("support:ticket-create", { category: "other", subject: "s", body: "b" });
    const b = hashSupportAction("support:ticket-create", { body: "b", subject: "s", category: "other" });
    expect(a).toBe(b);
  });

  it("changes when the purpose or payload changes", () => {
    const a = hashSupportAction("support:ticket-create", { subject: "s" });
    const b = hashSupportAction("support:ticket-reply", { subject: "s" });
    const c = hashSupportAction("support:ticket-create", { subject: "different" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

async function issueSignedChallenge(
  purpose: "support:ticket-create" | "support:ticket-reply" | "support:ticket-close",
  payload: Record<string, string>,
  ttlMs = 60_000,
) {
  const nonce = createChatNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);
  const contentHash = hashSupportAction(purpose, payload);
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

describe("authoriseSupportAction", () => {
  it("authorises a correctly signed ticket-create challenge and returns the wallet address", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("support:ticket-create", {
      category: "other",
      subject: "s",
      body: "b",
    });
    const result = await authoriseSupportAction({
      purpose: "support:ticket-create",
      payload: { category: "other", subject: "s", body: "b" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "ok", walletAddress: account.address });
  });

  it("authorises a correctly signed ticket-reply challenge", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("support:ticket-reply", {
      ticketId: "11111111-1111-1111-1111-111111111111",
      body: "follow up",
    });
    const result = await authoriseSupportAction({
      purpose: "support:ticket-reply",
      payload: { ticketId: "11111111-1111-1111-1111-111111111111", body: "follow up" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "ok", walletAddress: account.address });
  });

  it("authorises a correctly signed ticket-close challenge, bound to the ticket id (issue #401)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("support:ticket-close", {
      ticketId: "11111111-1111-1111-1111-111111111111",
    });
    const result = await authoriseSupportAction({
      purpose: "support:ticket-close",
      payload: { ticketId: "11111111-1111-1111-1111-111111111111" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "ok", walletAddress: account.address });
  });

  it("rejects a ticket-close challenge replayed against a different ticket id (issue #401)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("support:ticket-close", {
      ticketId: "11111111-1111-1111-1111-111111111111",
    });
    const result = await authoriseSupportAction({
      purpose: "support:ticket-close",
      payload: { ticketId: "22222222-2222-2222-2222-222222222222" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });

  it("rejects when the payload doesn't match what was signed (contentHash mismatch)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("support:ticket-create", {
      category: "other",
      subject: "s",
      body: "b",
    });
    const result = await authoriseSupportAction({
      purpose: "support:ticket-create",
      payload: { category: "other", subject: "s", body: "tampered" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });

  it("rejects a support:ticket-create challenge replayed against support:ticket-reply — purposes are bound, not interchangeable", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("support:ticket-create", {
      category: "other",
      subject: "s",
      body: "b",
    });
    const result = await authoriseSupportAction({
      purpose: "support:ticket-reply",
      payload: { category: "other", subject: "s", body: "b" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });

  it("rejects a signature that doesn't match the wallet", async () => {
    const { challengeId, nonce } = await issueSignedChallenge("support:ticket-create", { category: "other", subject: "s", body: "b" });
    const result = await authoriseSupportAction({
      purpose: "support:ticket-create",
      payload: { category: "other", subject: "s", body: "b" },
      challengeId,
      nonce,
      signature: "0x" + "00".repeat(65),
    });
    expect(result).toEqual({ status: "invalid_signature" });
  });

  it("rejects a replayed challenge (second consume fails)", async () => {
    const { challengeId, nonce, signature } = await issueSignedChallenge("support:ticket-create", {
      category: "other",
      subject: "s",
      body: "b",
    });
    const input = {
      purpose: "support:ticket-create" as const,
      payload: { category: "other", subject: "s", body: "b" },
      challengeId,
      nonce,
      signature,
    };
    await expect(authoriseSupportAction(input)).resolves.toEqual({ status: "ok", walletAddress: account.address });
    await expect(authoriseSupportAction(input)).resolves.toEqual({ status: "replayed" });
  });

  it("rejects an unknown challenge id", async () => {
    const result = await authoriseSupportAction({
      purpose: "support:ticket-create",
      payload: { category: "other", subject: "s", body: "b" },
      challengeId: "00000000-0000-0000-0000-000000000000",
      nonce: "irrelevant",
      signature: "0x" + "00".repeat(65),
    });
    expect(result).toEqual({ status: "invalid_challenge" });
  });

  it("rejects an expired challenge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { challengeId, nonce, signature } = await issueSignedChallenge(
      "support:ticket-create",
      { category: "other", subject: "s", body: "b" },
      1000,
    );
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    const result = await authoriseSupportAction({
      purpose: "support:ticket-create",
      payload: { category: "other", subject: "s", body: "b" },
      challengeId,
      nonce,
      signature,
    });
    expect(result).toEqual({ status: "expired" });
  });
});
