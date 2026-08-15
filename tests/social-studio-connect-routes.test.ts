import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GET as connectionsRoute } from "@/app/api/social/connections/route";
import { POST as socialChallenge } from "@/app/api/social/challenge/route";
import { POST as postsCancel } from "@/app/api/social/posts/cancel/route";
import { GET as listPosts, POST as createPost } from "@/app/api/social/posts/route";
import { POST as telegramConnect } from "@/app/api/social/telegram/connect/route";
import { POST as telegramDisconnect } from "@/app/api/social/telegram/disconnect/route";
import { GET as xConnectCallback } from "@/app/api/social/x/connect/callback/route";
import { POST as xConnectStart } from "@/app/api/social/x/connect/start/route";
import { POST as xDisconnect } from "@/app/api/social/x/disconnect/route";
import { resetSocialStudioActionRateLimitsForTests } from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import {
  getSocialConnectionsStore,
  resetSocialConnectionsStoreForTests,
  setSocialConnectionsStoreForTests,
} from "@/lib/server/social-connections-store";
import { resetSocialScheduledPostsStoreForTests, setSocialScheduledPostsStoreForTests } from "@/lib/server/social-scheduled-posts-store";
import { resetTelegramBotUserIdCacheForTests } from "@/lib/server/social-telegram-connect";
import { createMemorySocialConnectionsStore } from "./social-connections-test-helpers";
import { createMemorySocialScheduledPostsStore } from "./social-scheduled-posts-test-helpers";

const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);

const ENCRYPTION_ENV = { SOCIAL_CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

function postRequest(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`http://localhost:3000${path}`, { method: "GET" });
}

async function signedAction(purpose: string, payload: Record<string, string>) {
  const challengeResponse = await socialChallenge(
    postRequest("/api/social/challenge", { walletAddress: ACCOUNT.address, walletChainId: 46630, purpose, payload }),
  );
  expect(challengeResponse.status).toBe(201);
  const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await ACCOUNT.signMessage({ message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}

beforeEach(() => {
  process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN = "http://localhost:3000";
  Object.assign(process.env, ENCRYPTION_ENV);
  resetSocialStudioActionRateLimitsForTests();
  resetChatChallengesForTests();
  resetTelegramBotUserIdCacheForTests();
  setSocialConnectionsStoreForTests(createMemorySocialConnectionsStore());
  setSocialScheduledPostsStoreForTests(createMemorySocialScheduledPostsStore());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSocialConnectionsStoreForTests();
  resetSocialScheduledPostsStoreForTests();
  delete process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN;
  delete process.env.SOCIAL_CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.X_SOCIAL_CONSUMER_KEY;
  delete process.env.X_SOCIAL_CONSUMER_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe("POST /api/social/challenge", () => {
  it("rejects requests from a disallowed origin", async () => {
    const response = await socialChallenge(
      new Request("http://localhost:3000/api/social/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ walletAddress: ACCOUNT.address, walletChainId: 46630, purpose: "social:x-connect", payload: { platform: "x" } }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unknown purpose", async () => {
    const response = await socialChallenge(
      postRequest("/api/social/challenge", { walletAddress: ACCOUNT.address, walletChainId: 46630, purpose: "not-a-real-purpose", payload: {} }),
    );
    expect(response.status).toBe(400);
  });

  it("issues a signable challenge for a known purpose", async () => {
    const response = await socialChallenge(
      postRequest("/api/social/challenge", { walletAddress: ACCOUNT.address, walletChainId: 46630, purpose: "social:telegram-connect", payload: { chatId: "@hoodlums" } }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { challengeId: string; message: string };
    expect(body.message).toContain("Purpose: social:telegram-connect");
  });
});

describe("Telegram connect / disconnect", () => {
  function telegramFetch(): typeof fetch {
    return (async (url: string | URL | Request) => {
      const method = url.toString().split("/").pop() || "";
      if (method === "getChat") return new Response(JSON.stringify({ ok: true, result: { id: -100, title: "Hoodlums Announcements", type: "channel" } }));
      if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { id: 777 } }));
      if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: "administrator" } }));
      throw new Error(`unexpected Telegram method ${method}`);
    }) as typeof fetch;
  }

  it("503s with not-configured when TELEGRAM_BOT_TOKEN is unset", async () => {
    const auth = await signedAction("social:telegram-connect", { chatId: "@hoodlums" });
    const response = await telegramConnect(postRequest("/api/social/telegram/connect", { chatId: "@hoodlums", ...auth }));
    expect(response.status).toBe(503);
  });

  it("connects, then shows up in GET /api/social/connections, then disconnects", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:test-token-aaaaaaaaaaaaaaaaaaaa";
    vi.stubGlobal("fetch", telegramFetch());

    const connectAuth = await signedAction("social:telegram-connect", { chatId: "@hoodlums" });
    const connectResponse = await telegramConnect(postRequest("/api/social/telegram/connect", { chatId: "@hoodlums", ...connectAuth }));
    expect(connectResponse.status).toBe(200);

    const listResponse = await connectionsRoute(getRequest(`/api/social/connections?walletAddress=${ACCOUNT.address}`));
    const list = (await listResponse.json()) as { connections: Array<{ platform: string; status: string }> };
    expect(list.connections).toContainEqual(expect.objectContaining({ platform: "telegram", status: "connected" }));

    const disconnectAuth = await signedAction("social:telegram-disconnect", { platform: "telegram" });
    const disconnectResponse = await telegramDisconnect(postRequest("/api/social/telegram/disconnect", disconnectAuth));
    expect(disconnectResponse.status).toBe(200);

    const afterDisconnect = await getSocialConnectionsStore().get(ACCOUNT.address, "telegram");
    expect(afterDisconnect).toBeNull();
  });

  it("400s with a helpful message when the bot is not an admin", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:test-token-aaaaaaaaaaaaaaaaaaaa";
    vi.stubGlobal(
      "fetch",
      (async (url: string | URL | Request) => {
        const method = url.toString().split("/").pop() || "";
        if (method === "getChat") return new Response(JSON.stringify({ ok: true, result: { id: -100, title: "Chan", type: "channel" } }));
        if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { id: 777 } }));
        if (method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: "member" } }));
        throw new Error("unexpected");
      }) as typeof fetch,
    );

    const auth = await signedAction("social:telegram-connect", { chatId: "@hoodlums" });
    const response = await telegramConnect(postRequest("/api/social/telegram/connect", { chatId: "@hoodlums", ...auth }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("admin");
  });

  it("rejects a replayed connect challenge", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:test-token-aaaaaaaaaaaaaaaaaaaa";
    vi.stubGlobal("fetch", telegramFetch());
    const auth = await signedAction("social:telegram-connect", { chatId: "@hoodlums" });
    await telegramConnect(postRequest("/api/social/telegram/connect", { chatId: "@hoodlums", ...auth }));
    const replay = await telegramConnect(postRequest("/api/social/telegram/connect", { chatId: "@hoodlums", ...auth }));
    expect(replay.status).toBe(409);
  });
});

describe("X connect / disconnect", () => {
  it("503s the start route when X_SOCIAL_* is unset", async () => {
    const auth = await signedAction("social:x-connect", { platform: "x" });
    const response = await xConnectStart(postRequest("/api/social/x/connect/start", auth));
    expect(response.status).toBe(503);
  });

  it("start returns an authorize URL, callback completes the connection and lands the user back on /social", async () => {
    process.env.X_SOCIAL_CONSUMER_KEY = "ck";
    process.env.X_SOCIAL_CONSUMER_SECRET = "cs";
    vi.stubGlobal(
      "fetch",
      (async (url: string | URL | Request) => {
        const href = url.toString();
        if (href.includes("oauth/request_token")) {
          return new Response("oauth_token=rt&oauth_token_secret=rts&oauth_callback_confirmed=true");
        }
        if (href.includes("oauth/access_token")) {
          return new Response("oauth_token=at&oauth_token_secret=ats&user_id=1&screen_name=hoodlumsdev");
        }
        throw new Error(`unexpected fetch to ${href}`);
      }) as typeof fetch,
    );

    const auth = await signedAction("social:x-connect", { platform: "x" });
    const startResponse = await xConnectStart(postRequest("/api/social/x/connect/start", auth));
    expect(startResponse.status).toBe(200);
    const { authorizeUrl } = (await startResponse.json()) as { authorizeUrl: string };
    expect(authorizeUrl).toContain("oauth_token=rt");

    const callbackResponse = await xConnectCallback(getRequest("/api/social/x/connect/callback?oauth_token=rt&oauth_verifier=verifier123"));
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toContain("xConnect=success");

    const connection = await getSocialConnectionsStore().get(ACCOUNT.address, "x");
    expect(connection).toMatchObject({ status: "connected", displayName: "@hoodlumsdev" });
  });

  it("callback redirects with an error when the request token is unknown (e.g. expired or already used)", async () => {
    const response = await xConnectCallback(getRequest("/api/social/x/connect/callback?oauth_token=missing&oauth_verifier=v"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("xConnect=error");
  });

  it("disconnects a connected X account", async () => {
    await getSocialConnectionsStore().upsert({ walletAddress: ACCOUNT.address, platform: "x", displayName: "@x", externalId: "1", credentials: JSON.stringify({ accessToken: "a", accessSecret: "b" }) });
    const auth = await signedAction("social:x-disconnect", { platform: "x" });
    const response = await xDisconnect(postRequest("/api/social/x/disconnect", auth));
    expect(response.status).toBe(200);
    expect(await getSocialConnectionsStore().get(ACCOUNT.address, "x")).toBeNull();
  });
});

describe("POST /api/social/posts (approval is creation)", () => {
  it("rejects approving a post to a destination that isn't connected", async () => {
    const scheduledAt = new Date().toISOString();
    const auth = await signedAction("social:post-create", { body: "gm", destinations: "x", scheduledAt });
    const response = await createPost(
      postRequest("/api/social/posts", { body: "gm", destinations: ["x"], scheduledAt, ...auth }),
    );
    expect(response.status).toBe(409);
  });

  it("creates an already-approved, already-scheduled post once the destination is connected, then lists and cancels it", async () => {
    await getSocialConnectionsStore().upsert({ walletAddress: ACCOUNT.address, platform: "x", displayName: "@x", externalId: "1", credentials: JSON.stringify({ accessToken: "a", accessSecret: "b" }) });

    const scheduledAt = new Date().toISOString();
    const createAuth = await signedAction("social:post-create", { body: "gm hoodlums", destinations: "x", scheduledAt });
    const createResponse = await createPost(postRequest("/api/social/posts", { body: "gm hoodlums", destinations: ["x"], scheduledAt, ...createAuth }));
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { post: { id: string; status: string; approvedByWallet: string } };
    expect(created.post.status).toBe("scheduled");
    expect(created.post.approvedByWallet.toLowerCase()).toBe(ACCOUNT.address.toLowerCase());

    const listResponse = await listPosts(getRequest(`/api/social/posts?walletAddress=${ACCOUNT.address}`));
    const list = (await listResponse.json()) as { posts: Array<{ id: string }> };
    expect(list.posts.map((post) => post.id)).toContain(created.post.id);

    const cancelAuth = await signedAction("social:post-cancel", { postId: created.post.id });
    const cancelResponse = await postsCancel(postRequest("/api/social/posts/cancel", { postId: created.post.id, ...cancelAuth }));
    expect(cancelResponse.status).toBe(200);
  });

  it("rejects an X-bound post over 280 characters", async () => {
    await getSocialConnectionsStore().upsert({ walletAddress: ACCOUNT.address, platform: "x", displayName: "@x", externalId: "1", credentials: JSON.stringify({ accessToken: "a", accessSecret: "b" }) });
    const longBody = "a".repeat(281);
    const scheduledAt = new Date().toISOString();
    const auth = await signedAction("social:post-create", { body: longBody, destinations: "x", scheduledAt });
    const response = await createPost(postRequest("/api/social/posts", { body: longBody, destinations: ["x"], scheduledAt, ...auth }));
    expect(response.status).toBe(400);
  });
});
