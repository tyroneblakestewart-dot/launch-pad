import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { POST as createChallenge } from "@/app/api/token-chat/challenge/route";
import { GET as listMessages, POST as postMessage } from "@/app/api/token-chat/messages/route";
import { POST as reportMessage } from "@/app/api/token-chat/report/route";
import { resetChatRateLimitsForTests } from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import {
  resetTokenChatStoreForTests,
  setTokenChatStoreForTests,
  TOKEN_CHAT_POST_LIMIT_PER_WALLET,
  type InsertTokenChatMessageInput,
  type TokenChatInsertResult,
  type TokenChatMessage,
  type TokenChatReportResult,
  type TokenChatStore,
} from "@/lib/server/token-chat-store";

const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const OTHER_ACCOUNT = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d5a8b9c7f8b4f5a33c56c2f4ec1d0e1c7f5b3a2" as `0x${string}`,
);
const TOKEN_ADDRESS = "0x1111111111111111111111111111111111111111";

class MemoryTokenChatStore implements TokenChatStore {
  readonly messages: TokenChatMessage[] = [];

  async insertMessageIfUnderLimit(input: InsertTokenChatMessageInput): Promise<TokenChatInsertResult> {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentCount = this.messages.filter(
      (message) =>
        message.walletAddress === input.walletAddress &&
        message.chain === input.chain &&
        message.contractAddress.toLowerCase() === input.contractAddress.toLowerCase() &&
        new Date(message.createdAt).getTime() > hourAgo,
    ).length;
    if (recentCount >= TOKEN_CHAT_POST_LIMIT_PER_WALLET) return { status: "rate_limited" };

    const message: TokenChatMessage = {
      id: randomUUID(),
      chain: input.chain,
      contractAddress: input.contractAddress,
      walletAddress: input.walletAddress,
      body: input.body,
      createdAt: new Date().toISOString(),
      reportCount: 0,
      hidden: false,
    };
    this.messages.push(message);
    return { status: "posted", message };
  }

  async listMessages(chain: TokenChatMessage["chain"], contractAddress: string): Promise<TokenChatMessage[]> {
    return this.messages.filter(
      (message) => !message.hidden && message.chain === chain && message.contractAddress.toLowerCase() === contractAddress.toLowerCase(),
    );
  }

  async reportMessage(id: string): Promise<TokenChatReportResult> {
    const message = this.messages.find((item) => item.id === id);
    if (!message) return { status: "not_found", hidden: false };
    message.reportCount += 1;
    message.hidden = message.reportCount >= 3;
    return { status: "reported", hidden: message.hidden };
  }
}

function postRequest(path: string, body: unknown, ip = "203.0.113.30") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

async function requestAndSignChallenge(signer: typeof ACCOUNT, body: string, signatureSigner: typeof ACCOUNT = signer) {
  const response = await createChallenge(
    postRequest("/api/token-chat/challenge", {
      walletAddress: signer.address,
      walletChainId: 46630,
      chain: "robinhood",
      contractAddress: TOKEN_ADDRESS,
      body,
    }),
  );
  expect(response.status).toBe(201);
  const challenge = (await response.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await signatureSigner.signMessage({ message: challenge.message });
  return { challenge, signature };
}

function tokenChatPostBody(challenge: { challengeId: string; nonce: string }, signature: string, body: string) {
  return {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    signature,
    chain: "robinhood",
    contractAddress: TOKEN_ADDRESS,
    body,
  };
}

beforeEach(() => {
  process.env.HOODCHAT_ALLOWED_ORIGIN = "http://localhost:3000";
  resetChatRateLimitsForTests();
  resetChatChallengesForTests();
});

afterEach(() => {
  delete process.env.HOODCHAT_ALLOWED_ORIGIN;
  resetTokenChatStoreForTests();
});

describe("token chat message creation", () => {
  it("accepts a valid wallet-signed post scoped to the token", async () => {
    const store = new MemoryTokenChatStore();
    setTokenChatStoreForTests(store);

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "wagmi");
    const response = await postMessage(postRequest("/api/token-chat/messages", tokenChatPostBody(challenge, signature, "wagmi")));
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { message: TokenChatMessage };
    expect(payload.message.contractAddress).toBe(TOKEN_ADDRESS);
    expect(store.messages).toHaveLength(1);
  });

  it("rejects a signature made by a different wallet", async () => {
    const store = new MemoryTokenChatStore();
    setTokenChatStoreForTests(store);

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "wagmi", OTHER_ACCOUNT);
    const response = await postMessage(postRequest("/api/token-chat/messages", tokenChatPostBody(challenge, signature, "wagmi")));
    expect(response.status).toBe(401);
    expect(store.messages).toHaveLength(0);
  });
});

describe("token chat URL rejection", () => {
  it("rejects a message body containing a link", async () => {
    const store = new MemoryTokenChatStore();
    setTokenChatStoreForTests(store);

    const response = await createChallenge(
      postRequest("/api/token-chat/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        chain: "robinhood",
        contractAddress: TOKEN_ADDRESS,
        body: "pump it on www.example.com",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("token chat per-wallet-per-token rate limiting", () => {
  it("rejects a wallet's 6th post to the same token within an hour", async () => {
    const store = new MemoryTokenChatStore();
    setTokenChatStoreForTests(store);

    for (let index = 0; index < TOKEN_CHAT_POST_LIMIT_PER_WALLET; index += 1) {
      const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, `msg ${index}`);
      const response = await postMessage(postRequest("/api/token-chat/messages", tokenChatPostBody(challenge, signature, `msg ${index}`)));
      expect(response.status).toBe(201);
    }

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "one too many");
    const response = await postMessage(postRequest("/api/token-chat/messages", tokenChatPostBody(challenge, signature, "one too many")));
    expect(response.status).toBe(429);
  });
});

describe("token chat report/hide flow", () => {
  it("hides a message after 3 reports and excludes it from the token feed", async () => {
    const store = new MemoryTokenChatStore();
    setTokenChatStoreForTests(store);
    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "spam");
    const posted = await postMessage(postRequest("/api/token-chat/messages", tokenChatPostBody(challenge, signature, "spam")));
    const { message } = (await posted.json()) as { message: TokenChatMessage };

    let lastReportResponse;
    for (let i = 0; i < 3; i += 1) {
      lastReportResponse = await reportMessage(postRequest("/api/token-chat/report", { messageId: message.id }));
    }
    const lastPayload = (await lastReportResponse!.json()) as { hidden: boolean };
    expect(lastPayload.hidden).toBe(true);

    const feedResponse = await listMessages(
      getRequest(`/api/token-chat/messages?chain=robinhood&contractAddress=${TOKEN_ADDRESS}`),
    );
    const feed = (await feedResponse.json()) as { messages: TokenChatMessage[] };
    expect(feed.messages.find((item) => item.id === message.id)).toBeUndefined();
  });
});

describe("token chat reads without a connected wallet", () => {
  it("serves the token feed with no wallet information required", async () => {
    const store = new MemoryTokenChatStore();
    setTokenChatStoreForTests(store);
    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "gm");
    await postMessage(postRequest("/api/token-chat/messages", tokenChatPostBody(challenge, signature, "gm")));

    const response = await listMessages(
      getRequest(`/api/token-chat/messages?chain=robinhood&contractAddress=${TOKEN_ADDRESS}`),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { messages: TokenChatMessage[]; creatorWalletAddress: string | null };
    expect(payload.messages).toHaveLength(1);
    expect(payload).toHaveProperty("creatorWalletAddress");
  });

  it("rejects an attempt to post without a valid challenge/signature", async () => {
    const store = new MemoryTokenChatStore();
    setTokenChatStoreForTests(store);

    const response = await postMessage(
      postRequest("/api/token-chat/messages", {
        chain: "robinhood",
        contractAddress: TOKEN_ADDRESS,
        body: "trying to post while disconnected",
      }),
    );
    expect(response.status).toBe(400);
    expect(store.messages).toHaveLength(0);
  });
});
