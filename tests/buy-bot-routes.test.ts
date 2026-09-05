import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GET as runBuyBotCronRoute } from "@/app/api/cron/buy-bot/route";
import { POST as disableBuyBot } from "@/app/api/social/buy-bot/disable/route";
import { GET as listBuyBots, POST as enableBuyBot } from "@/app/api/social/buy-bot/route";
import { POST as updateBuyBot } from "@/app/api/social/buy-bot/update/route";
import { POST as socialChallenge } from "@/app/api/social/challenge/route";
import {
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import { setBuyBotTradesReaderForTests } from "@/lib/server/buy-bot-cron";
import { resetBuyBotStoreForTests, setBuyBotStoreForTests } from "@/lib/server/buy-bot-store";
import { resetSocialStudioActionRateLimitsForTests } from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import { resetTelegramBotUserIdCacheForTests } from "@/lib/server/social-telegram-connect";
import { resetSocialStudioAuthoriserForTests, setSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";
import { resetTokenLaunchesStoreForTests, setTokenLaunchesStoreForTests, type TokenLaunch, type TokenLaunchesStore } from "@/lib/server/token-launches-store";
import { BUY_BOT_TEST_CURVE, BUY_BOT_TEST_TOKEN, createMemoryBuyBotStore, makeBuyTrade } from "./buy-bot-test-helpers";

const ACCOUNT = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`);
const OTHER_ACCOUNT = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as `0x${string}`);
const ENCRYPTION_ENV = { SOCIAL_CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
const CHAIN_ID = "46630";
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

const LAUNCH: TokenLaunch = {
  id: "launch-1",
  chainId: 46630,
  tokenAddress: BUY_BOT_TEST_TOKEN,
  curveAddress: BUY_BOT_TEST_CURVE,
  creatorWalletAddress: ACCOUNT.address,
  tokenName: "Hoodlums Test",
  ticker: "HOODS",
  decimals: 18,
  wholeTokenSupply: "1000000000",
  graduationTargetWei: "10000000000000000",
  graduated: false,
  graduatedAt: null,
  launchedAt: "2026-09-01T00:00:00.000Z",
  artworkThumbnail: null,
};

function postRequest(path: string, body: unknown, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

async function signedAction(purpose: string, payload: Record<string, string>, account = ACCOUNT) {
  const challengeResponse = await socialChallenge(
    postRequest("/api/social/challenge", { walletAddress: account.address, walletChainId: 46630, purpose, payload }),
  );
  expect(challengeResponse.status).toBe(201);
  const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}

/** Telegram Bot API stub: getChat/getMe/getChatMember all succeed as an admin unless overridden. */
function stubTelegram(overrides: Record<string, () => { ok: boolean; result?: unknown; description?: string }> = {}) {
  const handlers: Record<string, () => { ok: boolean; result?: unknown; description?: string }> = {
    getChat: () => ({ ok: true, result: { id: -100, title: "HOODS Buys", type: "channel" } }),
    getMe: () => ({ ok: true, result: { id: 777 } }),
    getChatMember: () => ({ ok: true, result: { status: "administrator" } }),
    ...overrides,
  };
  const calls: string[] = [];
  vi.stubGlobal("fetch", (async (url: string | URL | Request) => {
    const method = url.toString().split("/").pop() || "";
    calls.push(method);
    const handler = handlers[method];
    if (!handler) throw new Error(`Unexpected Telegram method called: ${method}`);
    const payload = handler();
    return new Response(JSON.stringify(payload), { status: payload.ok ? 200 : 400 });
  }) as typeof fetch);
  return calls;
}

const ENABLE_PAYLOAD = { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN, chatId: "@hoodsbuys", thresholdWei: "10000000000000000" };

async function enable(payload = ENABLE_PAYLOAD, account = ACCOUNT) {
  const auth = await signedAction("social:buy-bot-enable", payload, account);
  return enableBuyBot(postRequest("/api/social/buy-bot", { ...payload, ...auth }));
}

let store: ReturnType<typeof createMemoryBuyBotStore>;
let operationsStore: ReturnType<typeof createMemoryAdminOperationsStore>;
let launches: TokenLaunch | null;

beforeEach(() => {
  process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN = "http://localhost:3000";
  process.env.TELEGRAM_BOT_TOKEN = "12345:test-bot-token-aaaaaaaaaaaaaaaaaaaa";
  process.env.CRON_SECRET = "test-cron-secret";
  Object.assign(process.env, ENCRYPTION_ENV);
  resetSocialStudioActionRateLimitsForTests();
  resetChatChallengesForTests();
  resetTelegramBotUserIdCacheForTests();
  store = createMemoryBuyBotStore();
  setBuyBotStoreForTests(store);
  operationsStore = createMemoryAdminOperationsStore();
  setAdminOperationsStoreForTests(operationsStore);
  launches = LAUNCH;
  setTokenLaunchesStoreForTests({
    findByTokenAddress: async () => launches,
  } as unknown as TokenLaunchesStore);
  setBuyBotTradesReaderForTests(async () => [makeBuyTrade({ blockNumber: "4321", logIndex: 2 }), makeBuyTrade({ blockNumber: "4000", logIndex: 0 })]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetBuyBotStoreForTests();
  resetAdminOperationsStoreForTests();
  resetTokenLaunchesStoreForTests();
  resetSocialStudioAuthoriserForTests();
  setBuyBotTradesReaderForTests(null);
  delete process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN;
  delete process.env.SOCIAL_CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe("POST /api/social/buy-bot (enable)", () => {
  it("rejects a disallowed origin before anything else", async () => {
    const response = await enableBuyBot(postRequest("/api/social/buy-bot", ENABLE_PAYLOAD, "https://evil.example"));
    expect(response.status).toBe(403);
  });

  it("503s when TELEGRAM_BOT_TOKEN is unset — the deployment can't post, so nothing is stored", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const response = await enable();
    expect(response.status).toBe(503);
    expect(await store.listForWallet(ACCOUNT.address)).toEqual([]);
  });

  it("400s on a non-Robinhood chain, a bad token address, a bad channel, or a non-preset threshold", async () => {
    stubTelegram();
    for (const bad of [
      { ...ENABLE_PAYLOAD, chainId: "1" },
      { ...ENABLE_PAYLOAD, tokenAddress: "0x123" },
      { ...ENABLE_PAYLOAD, chatId: "not a channel" },
      { ...ENABLE_PAYLOAD, thresholdWei: "12345" },
    ]) {
      const response = await enable(bad);
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("401s a signature over a different payload — the challenge is bound to this exact token/channel/threshold", async () => {
    stubTelegram();
    const auth = await signedAction("social:buy-bot-enable", { ...ENABLE_PAYLOAD, thresholdWei: "50000000000000000" });
    const response = await enableBuyBot(postRequest("/api/social/buy-bot", { ...ENABLE_PAYLOAD, ...auth }));
    expect(response.status).toBe(401);
  });

  it("403s a wallet without the Pro/Pro Bundle entitlement, before any Telegram call", async () => {
    const calls = stubTelegram();
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade first." }));
    const response = await enable();
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("404s a token with no recorded Hoodlums launch, and 403s a wallet that is not the launch's creator", async () => {
    const calls = stubTelegram();
    launches = null;
    expect((await enable()).status).toBe(404);
    launches = { ...LAUNCH, creatorWalletAddress: OTHER_ACCOUNT.address };
    expect((await enable()).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("surfaces Telegram's own verdict when the platform bot is not an admin, storing nothing", async () => {
    stubTelegram({ getChatMember: () => ({ ok: true, result: { status: "member" } }) });
    const response = await enable();
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/admin/i);
    expect(await store.listForWallet(ACCOUNT.address)).toEqual([]);
  });

  it("502s (and stores nothing) when the curve's trades can't be read to seat the cursor — never guesses a cursor that would replay history", async () => {
    stubTelegram();
    setBuyBotTradesReaderForTests(async () => {
      throw new Error("RPC unavailable");
    });
    const response = await enable();
    expect(response.status).toBe(502);
    expect(await store.listForWallet(ACCOUNT.address)).toEqual([]);
  });

  it("stores the bot bound to the verified channel with its cursor at the newest existing trade, returns the projection, and logs the activity", async () => {
    stubTelegram();
    const response = await enable();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { bot: Record<string, unknown> };
    expect(payload.bot).toMatchObject({
      chainId: 46630,
      tokenAddress: BUY_BOT_TEST_TOKEN,
      channelDisplayName: "HOODS Buys",
      channelExternalId: "@hoodsbuys",
      thresholdWei: "10000000000000000",
      status: "active",
      lastPostedAt: null,
    });
    // Never the binding, cursor or internal id.
    expect(payload.bot).not.toHaveProperty("id");
    expect(payload.bot).not.toHaveProperty("cursorBlockNumber");
    expect(payload.bot).not.toHaveProperty("channel");

    const stored = await store.get(ACCOUNT.address, 46630, BUY_BOT_TEST_TOKEN);
    expect(stored).toMatchObject({ cursorBlockNumber: "4321", cursorLogIndex: 2, curveAddress: BUY_BOT_TEST_CURVE });
    expect(store.channels.get(stored!.id)).toBe(JSON.stringify({ chatId: "@hoodsbuys" }));

    const activity = await operationsStore.listActivity(10);
    expect(activity.map((item) => item.kind)).toContain("buy-bot-enabled");
    expect(activity.find((item) => item.kind === "buy-bot-enabled")?.message).not.toContain("@hoodsbuys-secret");
  });

  it("defaults the threshold to 0.01 ETH when none is sent", async () => {
    stubTelegram();
    const payload = { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN, chatId: "@hoodsbuys", thresholdWei: "10000000000000000" };
    const auth = await signedAction("social:buy-bot-enable", payload);
    const response = await enableBuyBot(postRequest("/api/social/buy-bot", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN, chatId: "@hoodsbuys", ...auth }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { bot: { thresholdWei: string } }).bot.thresholdWei).toBe("10000000000000000");
  });
});

describe("GET /api/social/buy-bot", () => {
  it("400s a bad wallet and lists only that wallet's bots as projections", async () => {
    stubTelegram();
    await enable();
    expect((await listBuyBots(new Request("http://localhost:3000/api/social/buy-bot?walletAddress=nope"))).status).toBe(400);
    const other = await listBuyBots(new Request(`http://localhost:3000/api/social/buy-bot?walletAddress=${OTHER_ACCOUNT.address}`));
    expect(await other.json()).toEqual({ bots: [] });
    const mine = await listBuyBots(new Request(`http://localhost:3000/api/social/buy-bot?walletAddress=${ACCOUNT.address}`));
    const payload = (await mine.json()) as { bots: Array<Record<string, unknown>> };
    expect(payload.bots).toHaveLength(1);
    expect(payload.bots[0]).toMatchObject({ tokenAddress: BUY_BOT_TEST_TOKEN, status: "active" });
    expect(payload.bots[0]).not.toHaveProperty("cursorBlockNumber");
  });
});

describe("POST /api/social/buy-bot/update", () => {
  const base = { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN };

  async function update(changes: { thresholdWei?: string; status?: string }, account = ACCOUNT) {
    const payload = { ...base, thresholdWei: changes.thresholdWei ?? "", status: changes.status ?? "" };
    const auth = await signedAction("social:buy-bot-update", payload, account);
    return updateBuyBot(postRequest("/api/social/buy-bot/update", { ...payload, ...auth }));
  }

  it("400s an empty change, a non-preset threshold, or an unknown status", async () => {
    stubTelegram();
    await enable();
    expect((await update({})).status).toBe(400);
    expect((await update({ thresholdWei: "1" })).status).toBe(400);
    expect((await update({ status: "reconnect_needed" })).status).toBe(400);
  });

  it("changes the threshold, pauses and resumes the signing wallet's own bot", async () => {
    stubTelegram();
    await enable();
    const changed = await update({ thresholdWei: "100000000000000000" });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { bot: { thresholdWei: string } }).bot.thresholdWei).toBe("100000000000000000");

    const paused = await update({ status: "paused" });
    expect(((await paused.json()) as { bot: { status: string } }).bot.status).toBe("paused");
    const resumed = await update({ status: "active" });
    expect(((await resumed.json()) as { bot: { status: string } }).bot.status).toBe("active");
  });

  it("404s (touching nothing) when the signing wallet has no bot for that token — another wallet's bot is unreachable", async () => {
    stubTelegram();
    await enable();
    const response = await update({ status: "paused" }, OTHER_ACCOUNT);
    expect(response.status).toBe(404);
    expect((await store.get(ACCOUNT.address, 46630, BUY_BOT_TEST_TOKEN))?.status).toBe("active");
  });
});

describe("POST /api/social/buy-bot/disable", () => {
  it("removes only the signing wallet's bot, binding included", async () => {
    stubTelegram();
    await enable();
    const stored = await store.get(ACCOUNT.address, 46630, BUY_BOT_TEST_TOKEN);

    const otherAuth = await signedAction("social:buy-bot-disable", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN }, OTHER_ACCOUNT);
    await disableBuyBot(postRequest("/api/social/buy-bot/disable", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN, ...otherAuth }));
    expect(await store.get(ACCOUNT.address, 46630, BUY_BOT_TEST_TOKEN)).not.toBeNull();

    const auth = await signedAction("social:buy-bot-disable", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN });
    const response = await disableBuyBot(postRequest("/api/social/buy-bot/disable", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN, ...auth }));
    expect(response.status).toBe(200);
    expect(await store.get(ACCOUNT.address, 46630, BUY_BOT_TEST_TOKEN)).toBeNull();
    expect(store.channels.has(stored!.id)).toBe(false);
  });

  it("rejects a replayed challenge", async () => {
    stubTelegram();
    await enable();
    const auth = await signedAction("social:buy-bot-disable", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN });
    await disableBuyBot(postRequest("/api/social/buy-bot/disable", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN, ...auth }));
    const replay = await disableBuyBot(postRequest("/api/social/buy-bot/disable", { chainId: CHAIN_ID, tokenAddress: BUY_BOT_TEST_TOKEN, ...auth }));
    expect(replay.status).toBe(409);
  });
});

describe("GET /api/cron/buy-bot", () => {
  function cronRequest(headers: Record<string, string> = {}) {
    return new Request("http://localhost:3000/api/cron/buy-bot", { headers });
  }

  it("rejects a missing or wrong bearer token, and everything when CRON_SECRET is unset", async () => {
    expect((await runBuyBotCronRoute(cronRequest())).status).toBe(401);
    expect((await runBuyBotCronRoute(cronRequest({ authorization: "Bearer wrong" }))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await runBuyBotCronRoute(cronRequest({ authorization: "Bearer test-cron-secret" }))).status).toBe(401);
  });

  it("runs a true no-op with the right bearer token and no bots", async () => {
    const response = await runBuyBotCronRoute(cronRequest({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, processed: 0, sent: 0 });
  });

  it("503s without running when the buy-bot service is administratively isolated", async () => {
    await operationsStore.setServiceIsolation({ key: "buy-bot", isolated: true, reason: "maintenance" });
    const response = await runBuyBotCronRoute(cronRequest({ authorization: "Bearer test-cron-secret" }));
    expect(response.status).toBe(503);
  });
});
