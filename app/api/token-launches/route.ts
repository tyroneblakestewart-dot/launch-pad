import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  TOKEN_LAUNCH_ACTION_LIMIT,
  TOKEN_LAUNCH_READ_LIMIT,
  consumeTokenLaunchActionRateLimit,
  consumeTokenLaunchReadRateLimit,
  getClientIp,
  isTokenLaunchRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { runAfterResponse } from "@/lib/server/ai-operation-cost-store";
import { getCurveProgress } from "@/lib/server/curve-progress-cache";
import { listLiveGeneratedSites } from "@/lib/server/public-generated-sites";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import {
  authoriseTokenLaunchAction,
  type AuthoriseTokenLaunchActionResult,
} from "@/lib/server/token-launch-auth";
import { verifyTokenLaunchOnChain } from "@/lib/server/token-launch-reconciliation";
import {
  MAX_TOKEN_LAUNCHES_PER_PAGE,
  TokenLaunchesStoreUnavailableError,
  getTokenLaunchesStore,
  type ListTokenLaunchesFilter,
  type TokenLaunch,
} from "@/lib/server/token-launches-store";
import type { TokenLaunchListItem } from "@/lib/token-launch-view";

// Records and lists on-chain token launches (Milestone A, issue #409 Part
// 2 / #412 Part 1). Recording is wallet-signed (purpose "token-launch:record")
// AND independently reconciled against a live chain read
// (lib/server/token-launch-reconciliation.ts) before any row is inserted —
// the signature establishes which wallet is asking, the chain read is what
// actually proves the launch happened. Listing is a plain public GET that
// is the HOODLUMS TOKENS grid's source of truth (issue #412 Part 1): each
// non-graduated launch is enriched with a cached live graduation-progress
// read and a linked published site's slug, if any.

export const runtime = "nodejs";

const MAX_TOKEN_NAME_LENGTH = 80;
const MAX_TICKER_LENGTH = 12;
const WHOLE_SUPPLY_PATTERN = /^[1-9][0-9]{0,77}$/;
const WEI_PATTERN = /^[1-9][0-9]{0,77}$/;

function actionHeaders(rate: ReturnType<typeof consumeTokenLaunchActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(TOKEN_LAUNCH_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function readHeaders(rate: ReturnType<typeof consumeTokenLaunchReadRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(TOKEN_LAUNCH_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(
  result: Exclude<AuthoriseTokenLaunchActionResult, { status: "ok" }>,
  headers: Record<string, string>,
) {
  if (result.status === "expired") return NextResponse.json({ error: "The launch challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That launch challenge has already been used." }, { status: 409, headers });
  return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers });
}

function storageUnavailableResponse(headers: Record<string, string>) {
  return NextResponse.json(
    { error: "Token launch storage is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers },
  );
}

function parseFilter(raw: string | null): ListTokenLaunchesFilter {
  if (raw === "bonding" || raw === "graduated") return raw;
  return "all";
}

type GraduationSync = { chainId: number; tokenAddress: string; tokenName: string };

/**
 * Attaches live on-chain graduation progress (issue #412 Part 1: "real curve
 * progress % ... server-side read with caching") and, when one exists, the
 * slug of a linked published site, to each launch. Reads go through
 * lib/server/curve-progress-cache.ts's TTL cache so a burst of homepage
 * polls never becomes a burst of RPC calls. A launch whose live read reports
 * graduation ahead of the DB row is returned as graduated in this response
 * and queued for an opportunistic `markGraduated` write — the migration's
 * own comment names this read API as the intended sync point, not a
 * separate cron job.
 */
async function enrichLaunchesWithProgress(
  launches: TokenLaunch[],
): Promise<{ enriched: TokenLaunchListItem[]; graduationsToSync: GraduationSync[] }> {
  const sites = await listLiveGeneratedSites().catch(() => []);
  const siteSlugByAddress = new Map(sites.map((site) => [site.contractAddress.toLowerCase(), site.slug]));
  const graduationsToSync: GraduationSync[] = [];

  const enriched = await Promise.all(
    launches.map(async (launch): Promise<TokenLaunchListItem> => {
      const siteSlug = siteSlugByAddress.get(launch.tokenAddress.toLowerCase()) ?? null;

      if (launch.graduated) {
        return { ...launch, progressBps: "10000", siteSlug };
      }

      const status = await getCurveProgress(launch.chainId, launch.curveAddress).catch(() => null);
      if (!status) return { ...launch, siteSlug };

      const nowGraduated = status.state === "graduated";
      if (nowGraduated) {
        graduationsToSync.push({ chainId: launch.chainId, tokenAddress: launch.tokenAddress, tokenName: launch.tokenName });
      }

      return {
        ...launch,
        graduated: nowGraduated,
        progressBps: status.progressBps.toString(),
        raisedWei: status.raisedWei.toString(),
        liquidityPool: status.liquidityPool,
        siteSlug,
      };
    }),
  );

  return { enriched, graduationsToSync };
}

export async function GET(request: Request) {
  const rate = consumeTokenLaunchReadRateLimit(getClientIp(request));
  const headers = readHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("token-launches");
  if (isolationResponse) return isolationResponse;

  const url = new URL(request.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : MAX_TOKEN_LAUNCHES_PER_PAGE;

  try {
    const launches = await getTokenLaunchesStore().list(filter, limit);
    const { enriched, graduationsToSync } = await enrichLaunchesWithProgress(launches);

    if (graduationsToSync.length > 0) {
      runAfterResponse(async () => {
        await Promise.all(
          graduationsToSync.map(({ chainId, tokenAddress, tokenName }) =>
            getTokenLaunchesStore()
              .markGraduated(chainId, tokenAddress, new Date())
              .then(() =>
                recordAdminActivityBestEffort({
                  kind: "token-graduated",
                  serviceKey: "token-launches",
                  message: `${tokenName} (${tokenAddress}) graduated.`,
                }),
              )
              .catch((error) => console.error("Opportunistic graduation sync failed.", error)),
          ),
        );
      });
    }

    return NextResponse.json({ launches: enriched }, { status: 200, headers });
  } catch (error) {
    if (error instanceof TokenLaunchesStoreUnavailableError) return storageUnavailableResponse(headers);
    console.error("Token launch listing failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Token launches could not be loaded. Try again." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  if (!isTokenLaunchRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Token launch request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeTokenLaunchActionRateLimit(getClientIp(request));
  const headers = actionHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("token-launches");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const chainId = Number(body?.chainId);
  const tokenAddress = typeof body?.tokenAddress === "string" ? body.tokenAddress.trim() : "";
  const curveAddress = typeof body?.curveAddress === "string" ? body.curveAddress.trim() : "";
  const tokenName = typeof body?.tokenName === "string" ? body.tokenName.trim() : "";
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const decimals = Number(body?.decimals);
  const wholeTokenSupply = typeof body?.wholeTokenSupply === "string" ? body.wholeTokenSupply.trim() : "";
  const graduationTargetWei = typeof body?.graduationTargetWei === "string" ? body.graduationTargetWei.trim() : "";
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return NextResponse.json({ error: "A valid chain ID is required." }, { status: 400, headers });
  }
  if (!isAddress(tokenAddress) || !isAddress(curveAddress)) {
    return NextResponse.json({ error: "A valid token address and curve address are required." }, { status: 400, headers });
  }
  if (!tokenName || tokenName.length > MAX_TOKEN_NAME_LENGTH) {
    return NextResponse.json({ error: `Token name must be 1-${MAX_TOKEN_NAME_LENGTH} characters.` }, { status: 400, headers });
  }
  if (!ticker || ticker.length > MAX_TICKER_LENGTH) {
    return NextResponse.json({ error: `Ticker must be 1-${MAX_TICKER_LENGTH} characters.` }, { status: 400, headers });
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return NextResponse.json({ error: "Decimals must be an integer between 0 and 18." }, { status: 400, headers });
  }
  if (!WHOLE_SUPPLY_PATTERN.test(wholeTokenSupply)) {
    return NextResponse.json({ error: "A valid whole-token supply is required." }, { status: 400, headers });
  }
  if (!WEI_PATTERN.test(graduationTargetWei)) {
    return NextResponse.json({ error: "A valid graduation target is required." }, { status: 400, headers });
  }
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid launch challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseTokenLaunchAction({
    purpose: "token-launch:record",
    payload: {
      chainId: String(chainId),
      tokenAddress,
      curveAddress,
      tokenName,
      ticker,
      decimals: String(decimals),
      wholeTokenSupply,
      graduationTargetWei,
    },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  const verification = await verifyTokenLaunchOnChain({
    chainId,
    tokenAddress,
    curveAddress,
    creatorWalletAddress: authorisation.walletAddress,
    tokenName,
    ticker,
    decimals,
    wholeTokenSupply,
    graduationTargetWei,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.reason }, { status: 422, headers });
  }

  try {
    const launch = await getTokenLaunchesStore().record({
      chainId,
      tokenAddress,
      curveAddress,
      creatorWalletAddress: authorisation.walletAddress,
      tokenName,
      ticker,
      decimals,
      wholeTokenSupply,
      graduationTargetWei,
    });

    runAfterResponse(() =>
      recordAdminActivityBestEffort({
        kind: "token-launched",
        serviceKey: "token-launches",
        message: `${launch.tokenName} (${launch.tokenAddress}) launched by wallet ${launch.creatorWalletAddress}.`,
      }),
    );

    return NextResponse.json({ launch }, { status: 201, headers });
  } catch (error) {
    if (error instanceof TokenLaunchesStoreUnavailableError) return storageUnavailableResponse(headers);
    console.error("Token launch recording failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "The token launch could not be recorded. Try again." }, { status: 500, headers });
  }
}
