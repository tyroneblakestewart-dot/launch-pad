import { NextResponse } from "next/server";
import { sanitiseClientErrorMessage, sanitiseClientErrorStack } from "@/lib/client-error-sanitizer";
import {
  CLIENT_ERRORS_LIMIT,
  consumeClientErrorsRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import {
  ClientErrorStoreUnavailableError,
  getClientErrorStore,
} from "@/lib/server/client-errors-store";

export const runtime = "nodejs";

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ROUTE_PATH_MAX_LENGTH = 200;
const USER_AGENT_MAX_LENGTH = 300;
const BUILD_ID_MAX_LENGTH = 100;

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.CLIENT_ERRORS_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

function responseHeaders(rate: ReturnType<typeof consumeClientErrorsRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(CLIENT_ERRORS_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

/**
 * Public, unauthenticated crash-report intake. Never echoes any input back —
 * the response carries no useful information to a caller, success or
 * failure alike. Every text field is re-sanitised here even though the
 * client is expected to have already done so, since a buggy or tampered
 * client can't be trusted with what leaves it.
 */
export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeClientErrorsRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const messageRaw = typeof body?.message === "string" ? body.message.trim() : "";
  const routePathRaw = typeof body?.routePath === "string" ? body.routePath.trim() : "";
  if (!messageRaw || !routePathRaw.startsWith("/")) {
    return NextResponse.json({ error: "A valid message and routePath are required." }, { status: 400, headers });
  }

  const walletAddressRaw = typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";
  if (walletAddressRaw && !WALLET_PATTERN.test(walletAddressRaw)) {
    return NextResponse.json({ error: "walletAddress must be a valid address." }, { status: 400, headers });
  }

  const stackRaw = typeof body?.stack === "string" ? body.stack : "";
  const userAgentRaw = typeof body?.userAgent === "string" ? body.userAgent : "";
  const buildIdRaw = typeof body?.buildId === "string" ? body.buildId.trim() : "";
  const viewportWidthRaw = body?.viewportWidth;
  const viewportWidth =
    typeof viewportWidthRaw === "number" && Number.isFinite(viewportWidthRaw) && viewportWidthRaw > 0
      ? Math.round(viewportWidthRaw)
      : null;

  try {
    await getClientErrorStore().recordError({
      message: sanitiseClientErrorMessage(messageRaw),
      stack: stackRaw ? sanitiseClientErrorStack(stackRaw) : null,
      routePath: routePathRaw.slice(0, ROUTE_PATH_MAX_LENGTH),
      walletAddress: walletAddressRaw ? walletAddressRaw.toLowerCase() : null,
      userAgent: userAgentRaw ? userAgentRaw.slice(0, USER_AGENT_MAX_LENGTH) : null,
      viewportWidth,
      buildId: buildIdRaw ? buildIdRaw.slice(0, BUILD_ID_MAX_LENGTH) : null,
    });
    return NextResponse.json({}, { status: 202, headers });
  } catch (error) {
    if (error instanceof ClientErrorStoreUnavailableError) {
      return NextResponse.json({ error: "Client error reporting is not configured on this deployment." }, { status: 503, headers });
    }
    return NextResponse.json({ error: "The error report could not be recorded." }, { status: 500, headers });
  }
}
