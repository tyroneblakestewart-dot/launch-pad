import { NextRequest, NextResponse } from "next/server";
import {
  buildDexPairResult,
  isValidDexscreenerAddress,
  selectBestDexPair,
} from "@/lib/server/dexscreener";

const DEXSCREENER_TIMEOUT_MS = 8_000;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim() || "";
  if (!isValidDexscreenerAddress(address)) {
    return NextResponse.json({ error: "Enter a valid contract or mint address." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEXSCREENER_TIMEOUT_MS);

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

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return NextResponse.json(
        { error: "Dexscreener returned an invalid response." },
        { status: 502 },
      );
    }

    const pairs =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { pairs?: unknown }).pairs
        : undefined;
    return NextResponse.json(buildDexPairResult(selectBestDexPair(pairs)));
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Dexscreener lookup timed out."
        : "Dexscreener pair lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
