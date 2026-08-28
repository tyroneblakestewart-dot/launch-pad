import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GET as adminListLaunches } from "@/app/api/admin/token-launches/route";
import { POST as tokenLaunchChallenge } from "@/app/api/token-launches/challenge/route";
import { GET as listLaunches, POST as recordLaunch } from "@/app/api/token-launches/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import { resetTokenLaunchRateLimitsForTests } from "@/lib/server/api-protection";
import { CHAT_NONCE_TTL_MS, resetChatChallengesForTests } from "@/lib/server/chat-auth";
import {
  getTokenLaunchesStore,
  resetTokenLaunchesStoreForTests,
  setTokenLaunchesStoreForTests,
  type ListTokenLaunchesFilter,
  type RecordTokenLaunchInput,
  type TokenLaunch,
  type TokenLaunchesStore,
} from "@/lib/server/token-launches-store";

const verifyMock = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/server/token-launch-reconciliation", () => ({
  verifyTokenLaunchOnChain: (...args: unknown[]) => verifyMock(...args),
}));

const getCurveProgressMock = vi.fn(async () => null as null | Record<string, unknown>);
vi.mock("@/lib/server/curve-progress-cache", () => ({
  getCurveProgress: (...args: unknown[]) => getCurveProgressMock(...args),
}));

const listLiveGeneratedSitesMock = vi.fn(async () => [] as Array<{ contractAddress: string; slug: string }>);
vi.mock("@/lib/server/public-generated-sites", () => ({
  listLiveGeneratedSites: () => listLiveGeneratedSitesMock(),
}));

function createMemoryTokenLaunchesStore(): TokenLaunchesStore {
  const launches = new Map<string, TokenLaunch>();
  return {
    async record(input: RecordTokenLaunchInput) {
      const existing = [...launches.values()].find(
        (l) => l.chainId === input.chainId && l.tokenAddress.toLowerCase() === input.tokenAddress.toLowerCase(),
      );
      if (existing) return existing;
      const launch: TokenLaunch = {
        id: `id-${launches.size + 1}`,
        ...input,
        graduated: false,
        graduatedAt: null,
        launchedAt: new Date().toISOString(),
      };
      launches.set(launch.id, launch);
      return launch;
    },
    async list(filter: ListTokenLaunchesFilter, limit: number) {
      return [...launches.values()]
        .filter((l) => filter === "all" || (filter === "graduated" ? l.graduated : !l.graduated))
        .slice(0, limit);
    },
    async listForAdmin() {
      return [...launches.values()];
    },
    async findByTokenAddress(chainId: number, tokenAddress: string) {
      return (
        [...launches.values()].find(
          (l) => l.chainId === chainId && l.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
        ) ?? null
      );
    },
    async findTokenLaunchCreatedAtByCurveAddress(chainId: number, curveAddress: string) {
      const match = [...launches.values()].find(
        (l) => l.chainId === chainId && l.curveAddress.toLowerCase() === curveAddress.toLowerCase(),
      );
      return match ? new Date(match.launchedAt) : null;
    },
    async markGraduated(chainId: number, tokenAddress: string, graduatedAt: Date) {
      const match = [...launches.values()].find(
        (l) => l.chainId === chainId && l.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
      );
      if (match && !match.graduated) {
        match.graduated = true;
        match.graduatedAt = graduatedAt.toISOString();
      }
    },
    async countLast24h() {
      return launches.size;
    },
    async tableExists() {
      return true;
    },
  };
}

const ORIGIN = "http://localhost:3000";
const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);

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

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, { method: "GET", headers });
}

async function signedRecordRequest(overrides: Partial<typeof PAYLOAD> = {}) {
  const payload = { ...PAYLOAD, ...overrides };
  const challengeResponse = await tokenLaunchChallenge(
    postRequest("/api/token-launches/challenge", {
      walletAddress: ACCOUNT.address,
      walletChainId: 46630,
      purpose: "token-launch:record",
      payload,
    }),
  );
  expect(challengeResponse.status).toBe(201);
  const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await ACCOUNT.signMessage({ message: challenge.message });
  return postRequest("/api/token-launches", {
    ...payload,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    signature,
  });
}

beforeEach(() => {
  process.env.TOKEN_LAUNCH_ALLOWED_ORIGIN = ORIGIN;
  resetTokenLaunchRateLimitsForTests();
  resetChatChallengesForTests();
  setTokenLaunchesStoreForTests(createMemoryTokenLaunchesStore());
  verifyMock.mockClear();
  verifyMock.mockResolvedValue({ ok: true });
  getCurveProgressMock.mockClear();
  getCurveProgressMock.mockResolvedValue(null);
  listLiveGeneratedSitesMock.mockClear();
  listLiveGeneratedSitesMock.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.TOKEN_LAUNCH_ALLOWED_ORIGIN;
  resetTokenLaunchesStoreForTests();
});

describe("POST /api/token-launches/challenge", () => {
  it("rejects a disallowed origin", async () => {
    const response = await tokenLaunchChallenge(
      new Request(`${ORIGIN}/api/token-launches/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ walletAddress: ACCOUNT.address, walletChainId: 46630, purpose: "token-launch:record", payload: {} }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unknown purpose", async () => {
    const response = await tokenLaunchChallenge(
      postRequest("/api/token-launches/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        purpose: "something-else",
        payload: {},
      }),
    );
    expect(response.status).toBe(400);
  });

  it("issues a signable challenge naming the purpose", async () => {
    const response = await tokenLaunchChallenge(
      postRequest("/api/token-launches/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        purpose: "token-launch:record",
        payload: PAYLOAD,
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("Purpose: token-launch:record");
  });
});

describe("POST /api/token-launches", () => {
  it("rejects a disallowed origin", async () => {
    const response = await recordLaunch(
      new Request(`${ORIGIN}/api/token-launches`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ ...PAYLOAD, challengeId: "x", nonce: "y", signature: "z" }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an invalid token address before touching auth or the chain", async () => {
    const response = await recordLaunch(postRequest("/api/token-launches", { ...PAYLOAD, tokenAddress: "not-an-address" }));
    expect(response.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("records a launch and reconciles it against a live chain read before inserting", async () => {
    const request = await signedRecordRequest();
    const response = await recordLaunch(request);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { launch: TokenLaunch };
    expect(body.launch.tokenAddress).toBe(PAYLOAD.tokenAddress);
    expect(body.launch.creatorWalletAddress).toBe(ACCOUNT.address);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock.mock.calls[0]?.[0]).toMatchObject({
      tokenAddress: PAYLOAD.tokenAddress,
      creatorWalletAddress: ACCOUNT.address,
    });
  });

  it("never inserts a row when the on-chain reconciliation fails", async () => {
    verifyMock.mockResolvedValueOnce({ ok: false, reason: "The curve is not wired to the claimed token address." });
    const request = await signedRecordRequest();
    const response = await recordLaunch(request);
    expect(response.status).toBe(422);

    const store = getTokenLaunchesStore();
    expect(await store.list("all", 10)).toEqual([]);
  });

  it("rejects a request without a valid signature", async () => {
    const response = await recordLaunch(
      postRequest("/api/token-launches", { ...PAYLOAD, challengeId: "00000000-0000-0000-0000-000000000000", nonce: "n", signature: "0x" + "00".repeat(65) }),
    );
    expect(response.status).toBe(401);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("uses the wallet that signed the challenge as creator, not any client-supplied value", async () => {
    const request = await signedRecordRequest();
    const response = await recordLaunch(request);
    const body = (await response.json()) as { launch: TokenLaunch };
    expect(body.launch.creatorWalletAddress).toBe(ACCOUNT.address);
  });

  it("rejects a wrong-wallet record attempt — a wallet other than the curve's on-chain creator", async () => {
    verifyMock.mockResolvedValueOnce({
      ok: false,
      reason: "The curve's creator does not match the wallet recording this launch.",
    });
    const request = await signedRecordRequest();
    const response = await recordLaunch(request);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("does not match the wallet");
    expect(await getTokenLaunchesStore().list("all", 10)).toEqual([]);
  });

  it("is race-safe under a duplicate record attempt for an already-recorded launch: the second attempt returns the same row rather than a second one", async () => {
    const first = await recordLaunch(await signedRecordRequest());
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { launch: TokenLaunch };

    const second = await recordLaunch(await signedRecordRequest());
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { launch: TokenLaunch };
    expect(secondBody.launch.id).toBe(firstBody.launch.id);

    const store = getTokenLaunchesStore();
    expect(await store.list("all", 10)).toHaveLength(1);
  });

  it("returns a clean error for an expired challenge (issue #425), and a retry with a fresh challenge succeeds and is listed", async () => {
    vi.useFakeTimers();
    try {
      const staleRequest = await signedRecordRequest();
      vi.advanceTimersByTime(CHAT_NONCE_TTL_MS + 1_000);

      const expiredResponse = await recordLaunch(staleRequest);
      expect(expiredResponse.status).toBe(410);
      const expiredBody = (await expiredResponse.json()) as { error: string };
      expect(expiredBody.error).toContain("expired");
      expect(await getTokenLaunchesStore().list("all", 10)).toEqual([]);

      // Retrying fetches a brand-new challenge rather than reusing the
      // expired one — this is exactly what the /testnet "Record listing"
      // retry button and "Record an existing launch" affordance rely on.
      const retryResponse = await recordLaunch(await signedRecordRequest());
      expect(retryResponse.status).toBe(201);
    } finally {
      vi.useRealTimers();
    }

    const listResponse = await listLaunches(getRequest("/api/token-launches"));
    const listBody = (await listResponse.json()) as { launches: TokenLaunch[] };
    expect(listBody.launches).toHaveLength(1);
  });
});

describe("GET /api/token-launches", () => {
  it("lists recorded launches without requiring a wallet signature", async () => {
    await recordLaunch(await signedRecordRequest());
    const response = await listLaunches(getRequest("/api/token-launches"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { launches: TokenLaunch[] };
    expect(body.launches).toHaveLength(1);
  });

  it("sets rate-limit response headers", async () => {
    const response = await listLaunches(getRequest("/api/token-launches"));
    expect(response.headers.get("X-RateLimit-Limit")).toBeTruthy();
  });

  it("attaches live graduation progress from the curve-progress cache to a bonding launch", async () => {
    await recordLaunch(await signedRecordRequest());
    getCurveProgressMock.mockResolvedValueOnce({
      state: "bonding",
      progressBps: 2500n,
      raisedWei: 1_000_000_000_000_000_000n,
      targetWei: 4_000_000_000_000_000_000n,
      liquidityPool: null,
    });

    const response = await listLaunches(getRequest("/api/token-launches"));
    const body = (await response.json()) as { launches: Array<Record<string, unknown>> };
    expect(body.launches[0]).toMatchObject({ progressBps: "2500", raisedWei: "1000000000000000000" });
    expect(getCurveProgressMock).toHaveBeenCalledWith(46630, PAYLOAD.curveAddress);
  });

  it("marks a launch graduated at 100% without a live read, never calling the curve-progress cache for it", async () => {
    await recordLaunch(await signedRecordRequest());
    await getTokenLaunchesStore().markGraduated(46630, PAYLOAD.tokenAddress, new Date());

    const response = await listLaunches(getRequest("/api/token-launches"));
    const body = (await response.json()) as { launches: Array<Record<string, unknown>> };
    expect(body.launches[0]).toMatchObject({ progressBps: "10000", graduated: true });
    expect(getCurveProgressMock).not.toHaveBeenCalled();
  });

  it("reports a launch as graduated in the response and syncs the store when a live read discovers graduation ahead of the DB row", async () => {
    await recordLaunch(await signedRecordRequest());
    getCurveProgressMock.mockResolvedValueOnce({
      state: "graduated",
      progressBps: 10_000n,
      raisedWei: 4_000_000_000_000_000_000n,
      targetWei: 4_000_000_000_000_000_000n,
      liquidityPool: "0x5555555555555555555555555555555555555555",
    });

    const response = await listLaunches(getRequest("/api/token-launches"));
    const body = (await response.json()) as { launches: Array<Record<string, unknown>> };
    expect(body.launches[0]).toMatchObject({ graduated: true, progressBps: "10000" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = await getTokenLaunchesStore().list("all", 10);
    expect(stored[0]?.graduated).toBe(true);
  });

  it("includes the slug of a linked published site by matching contractAddress, and null when there is none", async () => {
    await recordLaunch(await signedRecordRequest());
    listLiveGeneratedSitesMock.mockResolvedValueOnce([
      { contractAddress: PAYLOAD.tokenAddress.toUpperCase(), slug: "my-linked-site" },
    ]);

    const response = await listLaunches(getRequest("/api/token-launches"));
    const body = (await response.json()) as { launches: Array<Record<string, unknown>> };
    expect(body.launches[0]).toMatchObject({ siteSlug: "my-linked-site" });
  });

  it("shows siteSlug null when no published site links to the launch's token address", async () => {
    await recordLaunch(await signedRecordRequest());

    const response = await listLaunches(getRequest("/api/token-launches"));
    const body = (await response.json()) as { launches: Array<Record<string, unknown>> };
    expect(body.launches[0]).toMatchObject({ siteSlug: null });
  });
});

describe("GET /api/admin/token-launches", () => {
  const SESSION_TOKEN = "token-launches-admin-test-session";
  let cookie = "";

  beforeEach(async () => {
    setAdminSessionStoreForTests(createMemoryAdminSessionStore());
    await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
    cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
  });

  afterEach(() => {
    resetAdminStoresForTests();
  });

  it("rejects an unauthenticated request", async () => {
    const response = await adminListLaunches(new Request(`${ORIGIN}/api/admin/token-launches`));
    expect(response.status).toBe(401);
  });

  it("returns the full recorded launch list for an authenticated admin", async () => {
    await recordLaunch(await signedRecordRequest());
    const response = await adminListLaunches(
      new Request(`${ORIGIN}/api/admin/token-launches`, { headers: { Cookie: cookie } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { launches: TokenLaunch[] };
    expect(body.launches).toHaveLength(1);
  });
});
