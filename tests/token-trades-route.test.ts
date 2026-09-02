import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getTokenTradesRoute } from "@/app/api/token-trades/route";
import { TOKEN_TRADES_GRID_READ_LIMIT, TOKEN_TRADES_READ_LIMIT, resetTokenTradesRateLimitForTests } from "@/lib/server/api-protection";
import type { TokenTrade } from "@/lib/token-trade-types";

const getTokenTradesMock = vi.fn<(...args: unknown[]) => Promise<TokenTrade[]>>();
vi.mock("@/lib/server/token-trades-rpc", () => ({
  getTokenTrades: (...args: unknown[]) => getTokenTradesMock(...args),
}));

const ORIGIN = "http://localhost:3000";
const CURVE = "0x1234567890123456789012345678901234567890";

const SAMPLE_TRADE: TokenTrade = {
  direction: "buy",
  wallet: "0xbbbb000000000000000000000000000000000b",
  tokenAmountRaw: "500000000000000000",
  nativeAmountRaw: "10000000000000000",
  blockNumber: "200",
  blockTimestamp: 1_700_000_200,
  txHash: "0xTX1",
  logIndex: 0,
};

function getRequest(path: string) {
  return new Request(`${ORIGIN}${path}`, { method: "GET" });
}

beforeEach(() => {
  resetTokenTradesRateLimitForTests();
  getTokenTradesMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/token-trades", () => {
  it("rejects a missing/invalid curve address", async () => {
    const response = await getTokenTradesRoute(getRequest("/api/token-trades"));
    expect(response.status).toBe(400);
    expect(getTokenTradesMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed address", async () => {
    const response = await getTokenTradesRoute(getRequest("/api/token-trades?curve=not-an-address"));
    expect(response.status).toBe(400);
  });

  it("returns the normalized trade list with a no-store cache header, matching both hooks' own cache: no-store fetch (issue #453 area 9)", async () => {
    getTokenTradesMock.mockResolvedValueOnce([SAMPLE_TRADE]);
    const response = await getTokenTradesRoute(getRequest(`/api/token-trades?curve=${CURVE}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { trades: TokenTrade[] };
    expect(body.trades).toEqual([SAMPLE_TRADE]);
  });

  it("returns an empty array (not an error) for a genuine zero-trade curve", async () => {
    getTokenTradesMock.mockResolvedValueOnce([]);
    const response = await getTokenTradesRoute(getRequest(`/api/token-trades?curve=${CURVE}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { trades: TokenTrade[] };
    expect(body.trades).toEqual([]);
  });

  it("returns a distinct error status (never an empty array) on a genuine chain-read failure", async () => {
    getTokenTradesMock.mockRejectedValueOnce(new Error("RPC down"));
    const response = await getTokenTradesRoute(getRequest(`/api/token-trades?curve=${CURVE}`));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error?: string; trades?: unknown };
    expect(body.trades).toBeUndefined();
    expect(body.error).toBeTruthy();
  });

  it("logs a bounded, real underlying RPC detail on a genuine failure — never just the generic client-facing message (issue #453 area 9)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getTokenTradesMock.mockRejectedValueOnce(new Error("missing trie node ab12cd34ef (path ) state 0x... is not available"));
    await getTokenTradesRoute(getRequest(`/api/token-trades?curve=${CURVE}`));
    expect(consoleErrorSpy).toHaveBeenCalledWith("Token trades read failed.", expect.stringContaining("missing trie node"));
    consoleErrorSpy.mockRestore();
  });

  it("redacts an Authorization/API-key-looking value out of the logged detail instead of leaking it, reusing the existing sanitiseProviderDetail (issue #453 area 9)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getTokenTradesMock.mockRejectedValueOnce(
      new Error("request to https://rpc.example.com/v1?apikey=super-secret-value failed, Authorization: Bearer sk-abcdef123456"),
    );
    await getTokenTradesRoute(getRequest(`/api/token-trades?curve=${CURVE}`));
    const tokenTradesCall = consoleErrorSpy.mock.calls.find((call) => call[0] === "Token trades read failed.");
    expect(tokenTradesCall).toBeDefined();
    const loggedDetail = tokenTradesCall?.[1] as string;
    expect(loggedDetail).not.toContain("super-secret-value");
    expect(loggedDetail).not.toContain("sk-abcdef123456");
    expect(loggedDetail).toContain("[redacted]");
    consoleErrorSpy.mockRestore();
  });

  it("rate-limits repeated reads from the same IP against the token-detail bucket", async () => {
    getTokenTradesMock.mockResolvedValue([]);
    const request = () =>
      new Request(`${ORIGIN}/api/token-trades?curve=${CURVE}`, {
        method: "GET",
        headers: { "x-forwarded-for": "203.0.113.9" },
      });

    let last: Response | null = null;
    for (let i = 0; i < 1201; i += 1) {
      last = await getTokenTradesRoute(request());
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("X-RateLimit-Limit")).toBe(String(TOKEN_TRADES_READ_LIMIT));
  });

  it("charges a grid-marked read (source=grid) against a separate bucket, independent of the token-detail bucket (issue #453 area 1)", async () => {
    getTokenTradesMock.mockResolvedValue([]);
    const detailRequest = () =>
      new Request(`${ORIGIN}/api/token-trades?curve=${CURVE}`, {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.1" },
      });
    const gridRequest = () =>
      new Request(`${ORIGIN}/api/token-trades?curve=${CURVE}&source=grid`, {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.1" },
      });

    // Exhaust the token-detail bucket entirely from this IP.
    let lastDetail: Response | null = null;
    for (let i = 0; i < 1201; i += 1) {
      lastDetail = await getTokenTradesRoute(detailRequest());
    }
    expect(lastDetail?.status).toBe(429);

    // The grid bucket, from the same IP, is untouched by that exhaustion.
    const gridResponse = await getTokenTradesRoute(gridRequest());
    expect(gridResponse.status).toBe(200);
    expect(gridResponse.headers.get("X-RateLimit-Limit")).toBe(String(TOKEN_TRADES_GRID_READ_LIMIT));
  });

  it("rate-limits the grid bucket independently once it's exhausted, leaving the token-detail bucket untouched", async () => {
    getTokenTradesMock.mockResolvedValue([]);
    const gridRequest = () =>
      new Request(`${ORIGIN}/api/token-trades?curve=${CURVE}&source=grid`, {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.2" },
      });
    const detailRequest = () =>
      new Request(`${ORIGIN}/api/token-trades?curve=${CURVE}`, {
        method: "GET",
        headers: { "x-forwarded-for": "198.51.100.2" },
      });

    let lastGrid: Response | null = null;
    for (let i = 0; i < TOKEN_TRADES_GRID_READ_LIMIT + 1; i += 1) {
      lastGrid = await getTokenTradesRoute(gridRequest());
    }
    expect(lastGrid?.status).toBe(429);

    const detailResponse = await getTokenTradesRoute(detailRequest());
    expect(detailResponse.status).toBe(200);
  });
});
