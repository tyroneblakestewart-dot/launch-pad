import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/token-trades/route";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { resetTokenTradesRateLimitsForTests } from "@/lib/server/api-protection";
import type { TokenTradeItem } from "@/lib/token-trade-view";

const getTokenTradesMock = vi.fn(async (): Promise<TokenTradeItem[] | null> => []);
vi.mock("@/lib/server/token-trades-rpc", () => ({
  getTokenTrades: (...args: unknown[]) => getTokenTradesMock(...args),
}));

const CURVE = "0x1234567890123456789012345678901234567890";

function request(query: string) {
  return new Request(`https://hoodlums.dev/api/token-trades${query}`);
}

const SAMPLE_TRADE: TokenTradeItem = {
  direction: "buy",
  wallet: "0x1111111111111111111111111111111111111a",
  tokenAmountRaw: "500000000000000000000",
  nativeAmountWei: "1000000000000000000",
  priceNativePerToken: 0.002,
  blockNumber: "50",
  blockTimestampMs: 1_700_000_000_000,
  txHash: "0xaaa",
  logIndex: 0,
};

afterEach(() => {
  resetTokenTradesRateLimitsForTests();
  getTokenTradesMock.mockReset();
  getTokenTradesMock.mockResolvedValue([]);
});

describe("GET /api/token-trades", () => {
  it("requires a valid curve address", async () => {
    const response = await GET(request("?curve=not-an-address"));
    expect(response.status).toBe(400);
  });

  it("rejects a chain id other than Robinhood Chain Testnet", async () => {
    const response = await GET(request(`?curve=${CURVE}&chainId=1`));
    expect(response.status).toBe(400);
  });

  it("defaults to Robinhood Chain Testnet when chainId is omitted", async () => {
    const response = await GET(request(`?curve=${CURVE}`));
    expect(response.status).toBe(200);
    expect(getTokenTradesMock).toHaveBeenCalledWith(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE);
  });

  it("returns the normalized trades from the RPC/cache layer", async () => {
    getTokenTradesMock.mockResolvedValue([SAMPLE_TRADE]);
    const response = await GET(request(`?curve=${CURVE}`));
    const body = (await response.json()) as { trades: TokenTradeItem[] };
    expect(response.status).toBe(200);
    expect(body.trades).toEqual([SAMPLE_TRADE]);
  });

  it("returns an empty array (200) for a genuinely zero-trade curve, not an error", async () => {
    getTokenTradesMock.mockResolvedValue([]);
    const response = await GET(request(`?curve=${CURVE}`));
    const body = (await response.json()) as { trades: TokenTradeItem[] };
    expect(response.status).toBe(200);
    expect(body.trades).toEqual([]);
  });

  it("returns a distinct error (not an empty-trades 200) when the chain read fails", async () => {
    getTokenTradesMock.mockResolvedValue(null);
    const response = await GET(request(`?curve=${CURVE}`));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("returns a 500 with no caching if the read throws unexpectedly", async () => {
    getTokenTradesMock.mockRejectedValue(new Error("boom"));
    const response = await GET(request(`?curve=${CURVE}`));
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("sets a short public cache-control header on a successful read, matching the ~10s server-side cache", async () => {
    const response = await GET(request(`?curve=${CURVE}`));
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=10");
  });

  it("exposes rate-limit headers", async () => {
    const response = await GET(request(`?curve=${CURVE}`));
    expect(response.headers.get("X-RateLimit-Limit")).toBe("600");
    expect(response.headers.get("X-RateLimit-Remaining")).toBeTruthy();
  });

  it("enforces the per-IP read rate limit", async () => {
    for (let i = 0; i < 600; i += 1) {
      await GET(request(`?curve=${CURVE}`));
    }
    const response = await GET(request(`?curve=${CURVE}`));
    expect(response.status).toBe(429);
  });
});
