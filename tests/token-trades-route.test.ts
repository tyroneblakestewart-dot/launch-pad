import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getTokenTradesRoute } from "@/app/api/token-trades/route";
import { resetTokenTradesRateLimitForTests } from "@/lib/server/api-protection";
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

  it("returns the normalized trade list with a short public cache header", async () => {
    getTokenTradesMock.mockResolvedValueOnce([SAMPLE_TRADE]);
    const response = await getTokenTradesRoute(getRequest(`/api/token-trades?curve=${CURVE}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=10");
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

  it("rate-limits repeated reads from the same IP", async () => {
    getTokenTradesMock.mockResolvedValue([]);
    const request = () =>
      new Request(`${ORIGIN}/api/token-trades?curve=${CURVE}`, {
        method: "GET",
        headers: { "x-forwarded-for": "203.0.113.9" },
      });

    let last: Response | null = null;
    for (let i = 0; i < 601; i += 1) {
      last = await getTokenTradesRoute(request());
    }
    expect(last?.status).toBe(429);
  });
});
