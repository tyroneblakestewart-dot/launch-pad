import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { POST as accountChallenge } from "@/app/api/account/challenge/route";
import { POST as deleteAccount } from "@/app/api/account/delete/route";
import { GET as googleCallback } from "@/app/api/account/google/callback/route";
import { GET as googleStart } from "@/app/api/account/google/start/route";
import { POST as linkWallet } from "@/app/api/account/link-wallet/route";
import { POST as logout } from "@/app/api/account/logout/route";
import { GET as readSession } from "@/app/api/account/session/route";
import { POST as unlinkWallet } from "@/app/api/account/unlink-wallet/route";
import { GET as adminGoogleAccounts } from "@/app/api/admin/google-accounts/route";
import { ACCOUNT_SESSION_COOKIE, createAccountSessionToken, hashAccountSessionToken } from "@/lib/server/account-session";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createMemoryAdminOperationsStore,
  getAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import { createAdminSession, createMemoryAdminSessionStore, resetAdminStoresForTests, setAdminSessionStoreForTests } from "@/lib/server/admin-session-store";
import { ACCOUNT_ACTION_LIMIT, ACCOUNT_READ_LIMIT, resetAccountRateLimitsForTests } from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import { GOOGLE_OAUTH_STATE_COOKIE, GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL, createGoogleOAuthState, sealGoogleOAuthState } from "@/lib/server/google-sign-in";
import { resetUserAccountsStoreForTests, setUserAccountsStoreForTests } from "@/lib/server/user-accounts-store";
import { createMemoryUserAccountsStore, type MemoryUserAccountsStore } from "./user-accounts-test-helpers";

// Sign in with Google, phase 1 (6 Sep 2026): the nine account routes end to
// end against the in-memory store — start redirect + sealed state cookie,
// callback state/expiry/denied/success, the session read, logout, the
// wallet-link challenge + real signature, unlink, delete, and the admin list.

const ORIGIN = "http://localhost:3000";
const KEY = randomBytes(32).toString("base64");
const WALLET = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`);
const OTHER_WALLET = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff81" as `0x${string}`);

let store: MemoryUserAccountsStore;

function configureGoogle() {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
  process.env.SOCIAL_CREDENTIALS_ENCRYPTION_KEY = KEY;
}

function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, { method: "GET", headers });
}

function post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function signedInCookie(overrides: Partial<{ googleSub: string; email: string }> = {}) {
  const account = await store.upsertGoogleAccount({
    googleSub: overrides.googleSub ?? "sub-1",
    email: overrides.email ?? "person@example.com",
    emailVerified: true,
    displayName: "Person",
  });
  const token = createAccountSessionToken();
  await store.createSession(account.id, hashAccountSessionToken(token), new Date(Date.now() + 60_000));
  return { account, cookie: `${ACCOUNT_SESSION_COOKIE}=${token}` };
}

async function signedLink(cookie: string, wallet: typeof WALLET) {
  const challengeResponse = await accountChallenge(
    post("/api/account/challenge", { walletAddress: wallet.address, walletChainId: 46630, purpose: "account:link-wallet" }, { Cookie: cookie }),
  );
  expect(challengeResponse.status).toBe(201);
  const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await wallet.signMessage({ message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature, message: challenge.message };
}

function googleFetchStub(userinfo: Record<string, unknown> = { sub: "sub-1", email: "person@example.com", email_verified: true, name: "Person" }) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const target = String(url);
    if (target === GOOGLE_TOKEN_URL) return new Response(JSON.stringify({ access_token: "ya29.x" }), { status: 200 });
    if (target === GOOGLE_USERINFO_URL) return new Response(JSON.stringify(userinfo), { status: 200 });
    throw new Error(`unexpected fetch ${target}`);
  });
}

beforeEach(() => {
  store = createMemoryUserAccountsStore();
  setUserAccountsStoreForTests(store);
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
  resetAccountRateLimitsForTests();
  resetChatChallengesForTests();
  delete process.env.HOODLUMS_APP_ORIGIN;
});

afterEach(() => {
  resetUserAccountsStoreForTests();
  resetAdminOperationsStoreForTests();
  resetAdminStoresForTests();
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.SOCIAL_CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.HOODLUMS_APP_ORIGIN;
});

describe("GET /api/account/google/start", () => {
  it("503s while Google sign-in is not configured", async () => {
    const response = await googleStart(get("/api/account/google/start"));
    expect(response.status).toBe(503);
  });

  it("redirects to Google with PKCE and sets the sealed state cookie, honouring only a same-origin returnTo", async () => {
    configureGoogle();
    process.env.HOODLUMS_APP_ORIGIN = "https://hoodlums.dev";
    const response = await googleStart(get("/api/account/google/start?returnTo=https://evil.example/x"));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("redirect_uri")).toBe("https://hoodlums.dev/api/account/google/callback");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    const cookie = response.cookies.get(GOOGLE_OAUTH_STATE_COOKIE);
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBe(600);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is rate limited per IP", async () => {
    configureGoogle();
    for (let i = 0; i < ACCOUNT_ACTION_LIMIT; i += 1) {
      expect((await googleStart(get("/api/account/google/start"))).status).toBe(302);
    }
    expect((await googleStart(get("/api/account/google/start"))).status).toBe(429);
  });

  it("503s while the google-sign-in service is isolated", async () => {
    configureGoogle();
    await getAdminOperationsStore().setServiceIsolation({ key: "google-sign-in", isolated: true, reason: "maintenance" });
    const response = await googleStart(get("/api/account/google/start"));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { code: string }).code).toBe("SERVICE_ISOLATED");
  });
});

describe("GET /api/account/google/callback", () => {
  function stateCookie(returnTo = "/social", issuedAt = Date.now()) {
    const oauthState = createGoogleOAuthState(returnTo, issuedAt);
    return { oauthState, cookie: `${GOOGLE_OAUTH_STATE_COOKIE}=${sealGoogleOAuthState(oauthState)}` };
  }

  function redirected(response: Response) {
    const url = new URL(response.headers.get("location") ?? "");
    return { path: url.pathname, account: url.searchParams.get("account"), google: url.searchParams.get("google"), reason: url.searchParams.get("reason") };
  }

  it("redirects with reason=not_configured when dormant", async () => {
    const response = await googleCallback(get("/api/account/google/callback?code=x&state=y"));
    expect(response.status).toBe(302);
    expect(redirected(response)).toEqual({ path: "/", account: "open", google: "error", reason: "not_configured" });
  });

  it("rejects a missing or mismatched state and an expired state cookie, clearing the cookie each time", async () => {
    configureGoogle();
    const missing = await googleCallback(get("/api/account/google/callback?code=x&state=y"));
    expect(redirected(missing).reason).toBe("state");

    const { cookie } = stateCookie();
    const mismatch = await googleCallback(get("/api/account/google/callback?code=x&state=wrong", { Cookie: cookie }));
    expect(redirected(mismatch)).toMatchObject({ path: "/social", google: "error", reason: "state" });
    expect(mismatch.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value).toBe("");

    const expired = stateCookie("/social", Date.now() - 11 * 60_000);
    const late = await googleCallback(get(`/api/account/google/callback?code=x&state=${expired.oauthState.state}`, { Cookie: expired.cookie }));
    expect(redirected(late).reason).toBe("expired");
    expect(store.accounts).toHaveLength(0);
  });

  it("maps a Google-side denial to reason=denied without touching storage", async () => {
    configureGoogle();
    const { cookie } = stateCookie("/testnet");
    const response = await googleCallback(get("/api/account/google/callback?error=access_denied", { Cookie: cookie }));
    expect(redirected(response)).toEqual({ path: "/testnet", account: "open", google: "error", reason: "denied" });
    expect(store.accounts).toHaveLength(0);
  });

  it("exchanges the code, creates the account and session, sets the session cookie and logs the sign-in", async () => {
    configureGoogle();
    vi.stubGlobal("fetch", googleFetchStub());
    const { oauthState, cookie } = stateCookie("/social?tab=setup");
    const response = await googleCallback(get(`/api/account/google/callback?code=abc&state=${oauthState.state}`, { Cookie: cookie }));
    expect(response.status).toBe(302);
    expect(redirected(response)).toEqual({ path: "/social", account: "open", google: "success", reason: null });
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("tab")).toBe("setup");

    const session = response.cookies.get(ACCOUNT_SESSION_COOKIE);
    expect(session?.value).toBeTruthy();
    expect(session?.httpOnly).toBe(true);
    expect(response.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value).toBe("");

    expect(store.accounts).toHaveLength(1);
    expect(store.accounts[0]).toMatchObject({ googleSub: "sub-1", email: "person@example.com", emailVerified: true, linkedWalletAddress: null });
    expect((await store.getSessionAccount(hashAccountSessionToken(session!.value)))?.id).toBe(store.accounts[0].id);

    const activity = await getAdminOperationsStore().listActivity(5);
    expect(activity[0]).toMatchObject({ kind: "account-google-signed-in", serviceKey: "google-sign-in" });
    expect(activity[0].message).not.toContain("person@example.com");
  });

  it("refuses an unverified Google email", async () => {
    configureGoogle();
    vi.stubGlobal("fetch", googleFetchStub({ sub: "sub-2", email: "x@y.z", email_verified: false }));
    const { oauthState, cookie } = stateCookie();
    const response = await googleCallback(get(`/api/account/google/callback?code=abc&state=${oauthState.state}`, { Cookie: cookie }));
    expect(redirected(response).reason).toBe("unverified_email");
    expect(store.accounts).toHaveLength(0);
  });

  it("redirects with reason=storage when the account store is unconfigured", async () => {
    configureGoogle();
    resetUserAccountsStoreForTests();
    vi.stubGlobal("fetch", googleFetchStub());
    const { oauthState, cookie } = stateCookie();
    const response = await googleCallback(get(`/api/account/google/callback?code=abc&state=${oauthState.state}`, { Cookie: cookie }));
    expect(redirected(response).reason).toBe("storage");
    expect(response.cookies.get(ACCOUNT_SESSION_COOKIE)).toBeUndefined();
  });
});

describe("GET /api/account/session", () => {
  it("reports configured=false and no account when signed out", async () => {
    const response = await readSession(get("/api/account/session"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false, account: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the account summary without the Google id for a live session", async () => {
    configureGoogle();
    const { cookie } = await signedInCookie();
    const response = await readSession(get("/api/account/session", { Cookie: cookie }));
    const payload = (await response.json()) as { configured: boolean; account: Record<string, unknown> };
    expect(payload.configured).toBe(true);
    expect(payload.account).toEqual({ email: "person@example.com", emailVerified: true, displayName: "Person", linkedWalletAddress: null, walletLinkedAt: null });
    expect(JSON.stringify(payload)).not.toContain("sub-1");
  });

  it("is rate limited per IP at the read limit", async () => {
    for (let i = 0; i < ACCOUNT_READ_LIMIT; i += 1) {
      expect((await readSession(get("/api/account/session"))).status).toBe(200);
    }
    expect((await readSession(get("/api/account/session"))).status).toBe(429);
  });
});

describe("POST /api/account/logout", () => {
  it("destroys the session row and clears the cookie, and still clears the cookie when nothing is stored", async () => {
    const { cookie } = await signedInCookie();
    expect(store.sessions).toHaveLength(1);
    const response = await logout(post("/api/account/logout", {}, { Cookie: cookie }));
    expect(response.status).toBe(200);
    expect(store.sessions).toHaveLength(0);
    expect(response.cookies.get(ACCOUNT_SESSION_COOKIE)?.value).toBe("");

    resetUserAccountsStoreForTests();
    const bare = await logout(post("/api/account/logout", {}, { Cookie: `${ACCOUNT_SESSION_COOKIE}=whatever` }));
    expect(bare.status).toBe(200);
    expect(bare.cookies.get(ACCOUNT_SESSION_COOKIE)?.value).toBe("");
  });

  it("rejects a foreign origin", async () => {
    const response = await logout(post("/api/account/logout", {}, { Origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });
});

describe("POST /api/account/challenge", () => {
  it("requires a live Google session", async () => {
    const response = await accountChallenge(post("/api/account/challenge", { walletAddress: WALLET.address, walletChainId: 46630, purpose: "account:link-wallet" }));
    expect(response.status).toBe(401);
  });

  it("rejects a foreign origin, a bad wallet and an unknown purpose", async () => {
    const { cookie } = await signedInCookie();
    expect((await accountChallenge(post("/api/account/challenge", {}, { Cookie: cookie, Origin: "https://evil.example" }))).status).toBe(403);
    expect((await accountChallenge(post("/api/account/challenge", { walletAddress: "nope", walletChainId: 46630, purpose: "account:link-wallet" }, { Cookie: cookie }))).status).toBe(400);
    expect((await accountChallenge(post("/api/account/challenge", { walletAddress: WALLET.address, walletChainId: 46630, purpose: "support:ticket-create" }, { Cookie: cookie }))).status).toBe(400);
  });

  it("issues a signable challenge bound to the link purpose", async () => {
    const { cookie } = await signedInCookie();
    const { message } = await signedLink(cookie, WALLET);
    expect(message).toContain("Purpose: account:link-wallet");
  });
});

describe("POST /api/account/link-wallet", () => {
  it("links the signing wallet to the signed-in account and logs it", async () => {
    const { account, cookie } = await signedInCookie();
    const auth = await signedLink(cookie, WALLET);
    const response = await linkWallet(post("/api/account/link-wallet", auth, { Cookie: cookie }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { account: { linkedWalletAddress: string } };
    expect(payload.account.linkedWalletAddress.toLowerCase()).toBe(WALLET.address.toLowerCase());
    expect((await store.getById(account.id))?.linkedWalletAddress?.toLowerCase()).toBe(WALLET.address.toLowerCase());
    const activity = await getAdminOperationsStore().listActivity(5);
    expect(activity[0]).toMatchObject({ kind: "account-wallet-linked", serviceKey: "google-sign-in" });
  });

  it("requires a session, rejects a tampered signature, and refuses a replayed challenge", async () => {
    const { cookie } = await signedInCookie();
    const auth = await signedLink(cookie, WALLET);
    expect((await linkWallet(post("/api/account/link-wallet", auth))).status).toBe(401);

    const forged = await OTHER_WALLET.signMessage({ message: auth.message });
    const bad = await linkWallet(post("/api/account/link-wallet", { ...auth, signature: forged }, { Cookie: cookie }));
    expect(bad.status).toBe(401);

    // The failed attempt consumed the challenge — the genuine signature is now a replay.
    const replay = await linkWallet(post("/api/account/link-wallet", auth, { Cookie: cookie }));
    expect(replay.status).toBe(409);
    expect(store.accounts[0].linkedWalletAddress).toBeNull();
  });

  it("cannot use a challenge issued to a different account's session", async () => {
    const first = await signedInCookie({ googleSub: "sub-a", email: "a@x.y" });
    const second = await signedInCookie({ googleSub: "sub-b", email: "b@x.y" });
    const auth = await signedLink(first.cookie, WALLET);
    const response = await linkWallet(post("/api/account/link-wallet", auth, { Cookie: second.cookie }));
    expect(response.status).toBe(401);
    expect((await store.getById(second.account.id))?.linkedWalletAddress).toBeNull();
  });

  it("returns 409 wallet-taken when the wallet already belongs to another Google account", async () => {
    const first = await signedInCookie({ googleSub: "sub-a", email: "a@x.y" });
    const second = await signedInCookie({ googleSub: "sub-b", email: "b@x.y" });
    const firstAuth = await signedLink(first.cookie, WALLET);
    expect((await linkWallet(post("/api/account/link-wallet", firstAuth, { Cookie: first.cookie }))).status).toBe(200);

    const secondAuth = await signedLink(second.cookie, WALLET);
    const response = await linkWallet(post("/api/account/link-wallet", secondAuth, { Cookie: second.cookie }));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("wallet-taken");
  });

  it("rejects a body without the challenge fields", async () => {
    const { cookie } = await signedInCookie();
    expect((await linkWallet(post("/api/account/link-wallet", { nonce: "x" }, { Cookie: cookie }))).status).toBe(400);
  });
});

describe("POST /api/account/unlink-wallet and /api/account/delete", () => {
  it("unlinks without a wallet signature and logs it", async () => {
    const { account, cookie } = await signedInCookie();
    await store.linkWallet(account.id, WALLET.address);
    const response = await unlinkWallet(post("/api/account/unlink-wallet", {}, { Cookie: cookie }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { account: { linkedWalletAddress: null } }).account.linkedWalletAddress).toBeNull();
    expect((await store.getById(account.id))?.linkedWalletAddress).toBeNull();
    expect((await getAdminOperationsStore().listActivity(1))[0].kind).toBe("account-wallet-unlinked");
  });

  it("requires a session for both", async () => {
    expect((await unlinkWallet(post("/api/account/unlink-wallet"))).status).toBe(401);
    expect((await deleteAccount(post("/api/account/delete"))).status).toBe(401);
  });

  it("deletes the account and its sessions and clears the cookie", async () => {
    const { account, cookie } = await signedInCookie();
    const response = await deleteAccount(post("/api/account/delete", {}, { Cookie: cookie }));
    expect(response.status).toBe(200);
    expect(response.cookies.get(ACCOUNT_SESSION_COOKIE)?.value).toBe("");
    expect(await store.getById(account.id)).toBeNull();
    expect(store.sessions).toHaveLength(0);
    expect((await getAdminOperationsStore().listActivity(1))[0].kind).toBe("account-deleted");
    expect((await readSession(get("/api/account/session", { Cookie: cookie }))).status).toBe(200);
    expect(((await (await readSession(get("/api/account/session", { Cookie: cookie }))).json()) as { account: null }).account).toBeNull();
  });
});

describe("GET /api/admin/google-accounts", () => {
  const ADMIN_TOKEN = "admin-google-accounts-token";

  beforeEach(async () => {
    setAdminSessionStoreForTests(createMemoryAdminSessionStore());
    await createAdminSession(hashAdminSessionToken(ADMIN_TOKEN));
  });

  it("requires the admin session", async () => {
    expect((await adminGoogleAccounts(get("/api/admin/google-accounts"))).status).toBe(401);
  });

  it("lists accounts with counts, without the Google id", async () => {
    const { account } = await signedInCookie();
    await store.linkWallet(account.id, WALLET.address);
    const response = await adminGoogleAccounts(get("/api/admin/google-accounts", { Cookie: `${ADMIN_SESSION_COOKIE}=${ADMIN_TOKEN}` }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { counts: Record<string, number>; accounts: Array<Record<string, unknown>> };
    expect(payload.counts).toEqual({ accounts: 1, linked: 1, signedIn7d: 1 });
    expect(payload.accounts[0]).toMatchObject({ id: account.id, email: "person@example.com", linkedWalletAddress: WALLET.address });
    expect(payload.accounts[0]).not.toHaveProperty("googleSub");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
