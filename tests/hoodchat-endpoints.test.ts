import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { POST as createChallenge } from "@/app/api/hoodchat/challenge/route";
import { GET as listMessages, POST as postMessage } from "@/app/api/hoodchat/messages/route";
import { POST as reportMessage } from "@/app/api/hoodchat/report/route";
import { resetChatRateLimitsForTests } from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import {
  resetHoodchatStoreForTests,
  setHoodchatStoreForTests,
  HOODCHAT_POST_LIMIT_PER_WALLET,
  type HoodchatInsertResult,
  type HoodchatMessage,
  type HoodchatReportResult,
  type HoodchatStore,
  type InsertHoodchatMessageInput,
} from "@/lib/server/hoodchat-store";

const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const OTHER_ACCOUNT = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d5a8b9c7f8b4f5a33c56c2f4ec1d0e1c7f5b3a2" as `0x${string}`,
);

class MemoryHoodchatStore implements HoodchatStore {
  readonly messages: HoodchatMessage[] = [];

  async insertMessageIfUnderLimit(input: InsertHoodchatMessageInput): Promise<HoodchatInsertResult> {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentCount = this.messages.filter(
      (message) => message.walletAddress === input.walletAddress && new Date(message.createdAt).getTime() > hourAgo,
    ).length;
    if (recentCount >= HOODCHAT_POST_LIMIT_PER_WALLET) return { status: "rate_limited" };

    const message: HoodchatMessage = {
      id: randomUUID(),
      walletAddress: input.walletAddress,
      category: input.category,
      body: input.body,
      createdAt: new Date().toISOString(),
      reportCount: 0,
      hidden: false,
    };
    this.messages.push(message);
    return { status: "posted", message };
  }

  async listMessages(category: HoodchatMessage["category"] | "all"): Promise<HoodchatMessage[]> {
    return this.messages.filter((message) => !message.hidden && (category === "all" || message.category === category));
  }

  async reportMessage(id: string): Promise<HoodchatReportResult> {
    const message = this.messages.find((item) => item.id === id);
    if (!message) return { status: "not_found", hidden: false };
    message.reportCount += 1;
    message.hidden = message.reportCount >= 3;
    return { status: "reported", hidden: message.hidden };
  }
}

function postRequest(path: string, body: unknown, ip = "203.0.113.20") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

async function requestAndSignChallenge(
  signer: typeof ACCOUNT,
  category: string,
  body: string,
  signatureSigner: typeof ACCOUNT = signer,
) {
  const response = await createChallenge(
    postRequest("/api/hoodchat/challenge", {
      walletAddress: signer.address,
      walletChainId: 46630,
      category,
      body,
    }),
  );
  expect(response.status).toBe(201);
  const challenge = (await response.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await signatureSigner.signMessage({ message: challenge.message });
  return { challenge, signature };
}

beforeEach(() => {
  process.env.HOODCHAT_ALLOWED_ORIGIN = "http://localhost:3000";
  resetChatRateLimitsForTests();
  resetChatChallengesForTests();
});

afterEach(() => {
  delete process.env.HOODCHAT_ALLOWED_ORIGIN;
  resetHoodchatStoreForTests();
});

describe("Hoodchat message creation", () => {
  it("accepts a valid wallet-signed post and returns the stored message", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "general", "gm hoodlums");
    const response = await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "general",
        body: "gm hoodlums",
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { message: HoodchatMessage };
    expect(payload.message.walletAddress).toBe(ACCOUNT.address);
    expect(payload.message.body).toBe("gm hoodlums");
    expect(store.messages).toHaveLength(1);
  });

  it("rejects a signature made by a different wallet", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "general", "gm", OTHER_ACCOUNT);
    const response = await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "general",
        body: "gm",
      }),
    );
    expect(response.status).toBe(401);
    expect(store.messages).toHaveLength(0);
  });

  it("rejects message content changed after the wallet signed the challenge", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "general", "original message");
    const response = await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "general",
        body: "a different message substituted after signing",
      }),
    );
    expect(response.status).toBe(401);
    expect(store.messages).toHaveLength(0);
  });

  it("rejects replay of an already-used challenge", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "general", "gm");
    const first = await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "general",
        body: "gm",
      }),
    );
    expect(first.status).toBe(201);

    const replay = await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "general",
        body: "gm",
      }),
    );
    expect(replay.status).toBe(409);
  });
});

describe("Hoodchat URL rejection", () => {
  it("rejects a challenge request whose message body contains a link", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    const response = await createChallenge(
      postRequest("/api/hoodchat/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        category: "general",
        body: "check this out https://example.com/token",
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Links are not allowed") });
  });

  it("rejects a bare domain without a scheme", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    const response = await createChallenge(
      postRequest("/api/hoodchat/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        category: "general",
        body: "come join example.com right now",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("Hoodchat per-wallet rate limiting", () => {
  it("rejects a wallet's 6th post within an hour", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    for (let index = 0; index < HOODCHAT_POST_LIMIT_PER_WALLET; index += 1) {
      const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "general", `message ${index}`);
      const response = await postMessage(
        postRequest("/api/hoodchat/messages", {
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          signature,
          category: "general",
          body: `message ${index}`,
        }),
      );
      expect(response.status).toBe(201);
    }

    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "general", "one too many");
    const response = await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "general",
        body: "one too many",
      }),
    );
    expect(response.status).toBe(429);
    expect(store.messages).toHaveLength(HOODCHAT_POST_LIMIT_PER_WALLET);
  });
});

describe("Hoodchat report/hide flow", () => {
  it("hides a message once it accumulates 3 reports and excludes it from the feed", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);
    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "general", "spammy message");
    const posted = await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "general",
        body: "spammy message",
      }),
    );
    const { message } = (await posted.json()) as { message: HoodchatMessage };

    let lastReportResponse;
    for (let i = 0; i < 3; i += 1) {
      lastReportResponse = await reportMessage(postRequest("/api/hoodchat/report", { messageId: message.id }));
      expect(lastReportResponse.status).toBe(200);
    }
    const lastPayload = (await lastReportResponse!.json()) as { hidden: boolean };
    expect(lastPayload.hidden).toBe(true);

    const feedResponse = await listMessages(getRequest("/api/hoodchat/messages"));
    const feed = (await feedResponse.json()) as { messages: HoodchatMessage[] };
    expect(feed.messages.find((item) => item.id === message.id)).toBeUndefined();
  });
});

describe("Hoodchat reads without a connected wallet", () => {
  it("serves the public feed with no wallet information required", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);
    const { challenge, signature } = await requestAndSignChallenge(ACCOUNT, "trading", "buying the dip");
    await postMessage(
      postRequest("/api/hoodchat/messages", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        category: "trading",
        body: "buying the dip",
      }),
    );

    const response = await listMessages(getRequest("/api/hoodchat/messages"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { messages: HoodchatMessage[] };
    expect(payload.messages).toHaveLength(1);
  });

  it("rejects an attempt to post without a valid challenge/signature", async () => {
    const store = new MemoryHoodchatStore();
    setHoodchatStoreForTests(store);

    const response = await postMessage(
      postRequest("/api/hoodchat/messages", {
        category: "general",
        body: "trying to post while disconnected",
      }),
    );
    expect(response.status).toBe(400);
    expect(store.messages).toHaveLength(0);
  });
});
