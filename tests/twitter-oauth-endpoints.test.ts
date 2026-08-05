import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/auth/twitter/callback/route";
import { GET as start } from "@/app/api/auth/twitter/start/route";
import { resetSocialOAuthRateLimitsForTests } from "@/lib/server/api-protection";
import {
  createMemoryAdminOperationsState,
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  TWITTER_OAUTH_STATE_COOKIE,
  TWITTER_OAUTH_VERIFIER_COOKIE,
} from "@/lib/server/twitter-oauth";

const ORIGIN = "http://localhost:3000";

function startRequest(ip = "203.0.113.1") {
  return new Request(`${ORIGIN}/api/auth/twitter/start`, {
    headers: { "X-Forwarded-For": ip },
  });
}

function cookieHeaderFromStartResponse(response: Response): string {
  const state = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${TWITTER_OAUTH_STATE_COOKIE}=`));
  const verifier = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${TWITTER_OAUTH_VERIFIER_COOKIE}=`));
  const stateValue = state?.split(";")[0];
  const verifierValue = verifier?.split(";")[0];
  return [stateValue, verifierValue].filter(Boolean).join("; ");
}

function tokenAndUserFetchMock(username = "hoodlums_hq") {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "access-token-abc" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("users/me")) {
      return new Response(JSON.stringify({ data: { username } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });
}

describe("Twitter OAuth start/callback routes", () => {
  beforeEach(() => {
    resetSocialOAuthRateLimitsForTests();
    vi.stubEnv("TWITTER_CLIENT_ID", "test-client-id");
    vi.stubEnv("TWITTER_CLIENT_SECRET", "test-client-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetAdminOperationsStoreForTests();
  });

  it("redirects to Twitter's authorize endpoint with PKCE state and sets short-lived cookies", async () => {
    const response = await start(startRequest());
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://twitter.com/i/oauth2/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/auth/twitter/callback`,
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");

    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith(`${TWITTER_OAUTH_STATE_COOKIE}=`))).toBe(true);
    expect(setCookies.some((c) => c.startsWith(`${TWITTER_OAUTH_VERIFIER_COOKIE}=`))).toBe(true);
    expect(setCookies.every((c) => c.includes("HttpOnly"))).toBe(true);
  });

  it("reports not-configured instead of redirecting when Twitter credentials are missing", async () => {
    vi.unstubAllEnvs();
    const response = await start(startRequest());
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("not configured");
  });

  it("completes the exchange and posts the verified handle back for a valid callback", async () => {
    const startResponse = await start(startRequest());
    const cookieHeader = cookieHeaderFromStartResponse(startResponse);
    const location = new URL(startResponse.headers.get("location")!);
    const state = location.searchParams.get("state")!;

    vi.stubGlobal("fetch", tokenAndUserFetchMock());

    const callbackRequest = new Request(
      `${ORIGIN}/api/auth/twitter/callback?code=auth-code&state=${state}`,
      { headers: { Cookie: cookieHeader, "X-Forwarded-For": "203.0.113.1" } },
    );
    const response = await callback(callbackRequest);
    const html = await response.text();
    expect(html).toContain('"ok":true');
    expect(html).toContain("hoodlums_hq");
    expect(response.headers.getSetCookie().some((c) => c.includes("Max-Age=0"))).toBe(true);
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const startResponse = await start(startRequest());
    const cookieHeader = cookieHeaderFromStartResponse(startResponse);

    const callbackRequest = new Request(
      `${ORIGIN}/api/auth/twitter/callback?code=auth-code&state=not-the-real-state`,
      { headers: { Cookie: cookieHeader } },
    );
    const response = await callback(callbackRequest);
    const html = await response.text();
    expect(html).toContain('"ok":false');
    expect(html).toContain("could not be verified");
  });

  it("rejects a callback with no cookies at all", async () => {
    const callbackRequest = new Request(
      `${ORIGIN}/api/auth/twitter/callback?code=auth-code&state=whatever`,
    );
    const response = await callback(callbackRequest);
    const html = await response.text();
    expect(html).toContain('"ok":false');
  });

  it("surfaces a cancelled/denied provider response as a friendly error", async () => {
    const callbackRequest = new Request(
      `${ORIGIN}/api/auth/twitter/callback?error=access_denied`,
    );
    const response = await callback(callbackRequest);
    const html = await response.text();
    expect(html).toContain('"ok":false');
    expect(html).toContain("cancelled");
  });

  it("reports a friendly error when the token exchange fails", async () => {
    const startResponse = await start(startRequest());
    const cookieHeader = cookieHeaderFromStartResponse(startResponse);
    const location = new URL(startResponse.headers.get("location")!);
    const state = location.searchParams.get("state")!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })),
    );

    const callbackRequest = new Request(
      `${ORIGIN}/api/auth/twitter/callback?code=auth-code&state=${state}`,
      { headers: { Cookie: cookieHeader } },
    );
    const response = await callback(callbackRequest);
    const html = await response.text();
    expect(html).toContain('"ok":false');
    expect(html).toContain("failed");
  });

  it("respects the twitter-oauth admin isolation switch on both routes", async () => {
    const state = createMemoryAdminOperationsState();
    setAdminOperationsStoreForTests(createMemoryAdminOperationsStore(state));
    await createMemoryAdminOperationsStore(state).setServiceIsolation({
      key: "twitter-oauth",
      isolated: true,
      reason: "Investigating a Twitter API incident.",
    });

    const startResponse = await start(startRequest());
    expect((await startResponse.text())).toContain("paused for maintenance");

    const callbackRequest = new Request(
      `${ORIGIN}/api/auth/twitter/callback?code=x&state=y`,
    );
    const callbackResponse = await callback(callbackRequest);
    expect((await callbackResponse.text())).toContain("paused for maintenance");
  });

  it("rate limits repeated start requests from the same IP", async () => {
    let lastResponse: Response | null = null;
    for (let i = 0; i < 21; i++) {
      lastResponse = await start(startRequest("198.51.100.7"));
    }
    const html = await lastResponse!.text();
    expect(html).toContain("Too many");
  });
});
