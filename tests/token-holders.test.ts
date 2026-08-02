import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTokenHolderStats } from "@/lib/server/token-holders";

const ADDRESS = "0x3bf7447cd055f1475a8b09090c7b062abc9d3798";
const LP_ADDRESS = "0xLPPOOL0000000000000000000000000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFetchMock(options: {
  info?: Record<string, unknown> | null;
  infoStatus?: number;
  holders?: Array<{ address?: { hash?: string }; value?: string }> | null;
  holdersStatus?: number;
  pairs?: unknown[];
}) {
  const { info, infoStatus = 200, holders, holdersStatus = 200, pairs = [] } = options;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.dexscreener.com")) {
      return new Response(JSON.stringify({ pairs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/holders")) {
      return new Response(holders === undefined ? null : JSON.stringify({ items: holders }), {
        status: holdersStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(info === undefined ? null : JSON.stringify(info), {
      status: infoStatus,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("fetchTokenHolderStats", () => {
  it("returns unsupported for a chain with no confirmed holder-data source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchTokenHolderStats("solana", ADDRESS)).toEqual({ supported: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("excludes the LP pool address from the top-holder list", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        info: { holders_count: "3", total_supply: "1000" },
        holders: [
          { address: { hash: LP_ADDRESS }, value: "600" },
          { address: { hash: "0xWhale1" }, value: "300" },
          { address: { hash: "0xWhale2" }, value: "100" },
        ],
        pairs: [{ chainId: "robinhood", pairAddress: LP_ADDRESS, liquidity: { usd: 5000 } }],
      }),
    );

    const stats = await fetchTokenHolderStats("robinhood", ADDRESS);

    expect(stats).toMatchObject({ supported: true, holderCount: 3, lpAddress: LP_ADDRESS.toLowerCase() });
    if (!stats.supported) throw new Error("expected supported stats");
    expect(stats.holders.map((holder) => holder.address)).toEqual(["0xWhale1", "0xWhale2"]);
    expect(stats.holders.every((holder) => holder.address.toLowerCase() !== LP_ADDRESS.toLowerCase())).toBe(
      true,
    );
  });

  it("computes each holder's percent of total supply", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock({
        info: { holders_count: "1", total_supply: "1000" },
        holders: [{ address: { hash: "0xWhale1" }, value: "250" }],
        pairs: [],
      }),
    );

    const stats = await fetchTokenHolderStats("robinhood", ADDRESS);
    if (!stats.supported) throw new Error("expected supported stats");
    expect(stats.holders[0]).toMatchObject({ address: "0xWhale1", balance: "250", percent: 25 });
  });

  it("caps the returned holder list at 10 entries", async () => {
    const holders = Array.from({ length: 15 }, (_, index) => ({
      address: { hash: `0xHolder${index}` },
      value: "1",
    }));
    vi.stubGlobal(
      "fetch",
      makeFetchMock({ info: { holders_count: "15", total_supply: "15" }, holders, pairs: [] }),
    );

    const stats = await fetchTokenHolderStats("robinhood", ADDRESS);
    if (!stats.supported) throw new Error("expected supported stats");
    expect(stats.holders).toHaveLength(10);
  });

  it("resolves to a graceful 'unavailable' result when the explorer has no data yet", async () => {
    vi.stubGlobal("fetch", makeFetchMock({ info: null, infoStatus: 404, holders: null, holdersStatus: 404 }));

    const stats = await fetchTokenHolderStats("robinhood", ADDRESS);
    expect(stats).toMatchObject({
      supported: true,
      holderCount: null,
      holders: [],
      error: "Holder data is not available for this token yet.",
    });
  });

  it("resolves to a graceful result instead of throwing when every explorer/Dexscreener request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const stats = await fetchTokenHolderStats("robinhood", ADDRESS);
    expect(stats).toMatchObject({ supported: true, holderCount: null, holders: [] });
    expect((stats as { error?: string }).error).toBeTruthy();
  });
});
