import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getTokenHolderStatsRoute } from "@/app/api/token-holder-stats/route";
import { TOKEN_HOLDER_STATS_READ_LIMIT, resetTokenHolderStatsRateLimitForTests } from "@/lib/server/api-protection";
import type { TokenHolderBreakdown } from "@/lib/token-holder-stats-types";

const getTokenHolderBreakdownMock = vi.fn<(...args: unknown[]) => Promise<TokenHolderBreakdown>>();
vi.mock("@/lib/server/token-holder-stats", () => ({
  getTokenHolderBreakdown: (...args: unknown[]) => getTokenHolderBreakdownMock(...args),
}));

const ORIGIN = "http://localhost:3000";
const TOKEN = "0xaaaa00000000000000000000000000000000000a";

const SAMPLE: TokenHolderBreakdown = {
  top10Percent: 18.4,
  devPercent: 4.2,
  snipersPercent: 1.1,
  sniperWalletCount: 2,
  curveAddress: "0x1234567890123456789012345678901234567890",
  liquidityPoolAddress: null,
};

function getRequest(path: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, { method: "GET", headers });
}

beforeEach(() => {
  resetTokenHolderStatsRateLimitForTests();
  getTokenHolderBreakdownMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/token-holder-stats", () => {
  it("rejects a missing token address", async () => {
    const response = await getTokenHolderStatsRoute(getRequest("/api/token-holder-stats"));
    expect(response.status).toBe(400);
    expect(getTokenHolderBreakdownMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed token address", async () => {
    const response = await getTokenHolderStatsRoute(getRequest("/api/token-holder-stats?token=not-an-address"));
    expect(response.status).toBe(400);
    expect(getTokenHolderBreakdownMock).not.toHaveBeenCalled();
  });

  it("returns the breakdown under `stats` with a no-store cache header, for Robinhood testnet only", async () => {
    getTokenHolderBreakdownMock.mockResolvedValueOnce(SAMPLE);
    const response = await getTokenHolderStatsRoute(getRequest(`/api/token-holder-stats?token=${TOKEN}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-RateLimit-Limit")).toBe(String(TOKEN_HOLDER_STATS_READ_LIMIT));
    const body = (await response.json()) as { stats: TokenHolderBreakdown };
    expect(body.stats).toEqual(SAMPLE);
    expect(getTokenHolderBreakdownMock).toHaveBeenCalledWith(46630, TOKEN);
  });

  it("returns a distinct error status (never a zero-filled breakdown) on a genuine chain-read failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getTokenHolderBreakdownMock.mockRejectedValueOnce(new Error("RPC down"));
    const response = await getTokenHolderStatsRoute(getRequest(`/api/token-holder-stats?token=${TOKEN}`));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error?: string; stats?: unknown };
    expect(body.stats).toBeUndefined();
    expect(body.error).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalledWith("Token holder stats read failed.", expect.stringContaining("RPC down"));
    consoleErrorSpy.mockRestore();
  });

  it("redacts an API-key-looking value out of the logged detail, reusing sanitiseProviderDetail", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getTokenHolderBreakdownMock.mockRejectedValueOnce(
      new Error("request to https://rpc.example.com/v1?apikey=super-secret-value failed, Authorization: Bearer sk-abcdef123456"),
    );
    await getTokenHolderStatsRoute(getRequest(`/api/token-holder-stats?token=${TOKEN}`));
    const call = consoleErrorSpy.mock.calls.find((entry) => entry[0] === "Token holder stats read failed.");
    expect(call).toBeDefined();
    const loggedDetail = call?.[1] as string;
    expect(loggedDetail).not.toContain("super-secret-value");
    expect(loggedDetail).not.toContain("sk-abcdef123456");
    expect(loggedDetail).toContain("[redacted]");
    consoleErrorSpy.mockRestore();
  });

  it("rate-limits repeated reads from the same IP", async () => {
    getTokenHolderBreakdownMock.mockResolvedValue(SAMPLE);
    let last: Response | null = null;
    for (let i = 0; i < TOKEN_HOLDER_STATS_READ_LIMIT + 1; i += 1) {
      last = await getTokenHolderStatsRoute(getRequest(`/api/token-holder-stats?token=${TOKEN}`, { "x-forwarded-for": "203.0.113.77" }));
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
    expect(getTokenHolderBreakdownMock).toHaveBeenCalledTimes(TOKEN_HOLDER_STATS_READ_LIMIT);
  });
});
