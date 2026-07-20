import { NextRequest, NextResponse } from "next/server";
import {
  buildDexscreenerPairResult,
  isValidDexAddress,
  selectBestPair,
  type DexPair,
} from "@/lib/server/dexscreener";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() || "";

  if (!isValidDexAddress(address)) {
    return NextResponse.json(
      { error: "Enter a valid contract or mint address." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
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
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const payload = (await response.json()) as { pairs?: DexPair[] | null };
    const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    const result = buildDexscreenerPairResult(selectBestPair(pairs));

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Dexscreener lookup timed out."
        : "Dexscreener pair lookup failed.";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
