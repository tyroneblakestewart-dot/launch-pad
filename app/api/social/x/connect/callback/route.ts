import { NextResponse } from "next/server";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { getSocialConnectionsStore } from "@/lib/server/social-connections-store";
import { exchangeXOAuthVerifier } from "@/lib/server/social-x-client";

// Step 3 of the X connect flow (issue #335): X redirects the browser here
// with oauth_token + oauth_verifier after the user approves access on X's
// own authorize page. No wallet signature is possible on a redirect — the
// request token issued in step 1 (bound to a wallet, single-use, short-
// lived) plus the verifier X hands back are the proof, the same trust model
// every OAuth 1.0a/2.0 consumer relies on. Always redirects back into the
// app; never renders a bare API error page for a user-facing flow.

export const runtime = "nodejs";

function redirectTo(origin: string, status: "success" | "error", reason?: string) {
  const url = new URL("/social", origin);
  url.searchParams.set("xConnect", status);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const origin = process.env.HOODLUMS_APP_ORIGIN?.trim() || new URL(request.url).origin;

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return redirectTo(origin, "error", "paused");

  const url = new URL(request.url);
  const requestToken = url.searchParams.get("oauth_token") || "";
  const verifier = url.searchParams.get("oauth_verifier") || "";
  if (url.searchParams.get("denied") || !requestToken || !verifier) {
    return redirectTo(origin, "error", "denied");
  }

  const consumed = await getSocialConnectionsStore().consumeXOAuthRequest(requestToken);
  if (consumed.status !== "ok") {
    return redirectTo(origin, "error", consumed.status);
  }

  const exchanged = await exchangeXOAuthVerifier(requestToken, consumed.requestSecret, verifier);
  if (exchanged.status !== "ok") {
    return redirectTo(origin, "error", exchanged.status);
  }

  await getSocialConnectionsStore().upsert({
    walletAddress: consumed.walletAddress,
    platform: "x",
    displayName: exchanged.screenName ? `@${exchanged.screenName}` : "Connected X account",
    externalId: exchanged.userId,
    credentials: JSON.stringify({ accessToken: exchanged.accessToken, accessSecret: exchanged.accessSecret }),
  });

  await recordAdminActivityBestEffort({
    kind: "social-x-connected",
    serviceKey: "social-posting",
    message: `Wallet ${consumed.walletAddress} connected X${exchanged.screenName ? ` (@${exchanged.screenName})` : ""}.`,
  });

  return redirectTo(origin, "success");
}
