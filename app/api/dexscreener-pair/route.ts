import { NextRequest, NextResponse } from "next/server";

type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  liquidity?: { usd?: number | null };
  volume?: { h24?: number | null };
};

const ADDRESS_PATTERN = /^[A-Za-z0-9]{24,80}$/;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() || "";

  if (!ADDRESS_PATTERN.test(address)) {
    return NextResponse.json({ error: "Enter a valid contract or mint address." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Dexscreener could not be reached right now." },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as { pairs?: DexPair[] | null };
    const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    const pair = pairs
      .filter((item) => item.chainId && item.pairAddress)
      .sort((a, b) => {
        const liquidityDifference = Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0);
        if (liquidityDifference !== 0) return liquidityDifference;
        return Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0);
      })[0];

    if (!pair?.chainId || !pair.pairAddress) {
      return NextResponse.json({ found: false });
    }

    const pairUrl = pair.url || `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`;
    const embedUrl = `${pairUrl}?embed=1&theme=dark&trades=0&info=0`;

    return NextResponse.json({
      found: true,
      pairUrl,
      embedUrl,
      chainId: pair.chainId,
      dexId: pair.dexId || "DEX",
      liquidityUsd: Number(pair.liquidity?.usd || 0),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Dexscreener lookup timed out."
      : "Dexscreener pair lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
