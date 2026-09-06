import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_SESSION_COOKIE,
  ACCOUNT_SESSION_TTL_MS,
  accountSessionCookieOptions,
  createAccountSessionToken,
  hashAccountSessionToken,
  parseAccountSessionCookie,
  parseCookieValue,
  readAccountSession,
} from "@/lib/server/account-session";
import { resetUserAccountsStoreForTests, setUserAccountsStoreForTests } from "@/lib/server/user-accounts-store";
import { createMemoryUserAccountsStore } from "./user-accounts-test-helpers";

// Google sign-in session cookie (phase 1, 6 Sep 2026).

describe("account session primitives", () => {
  it("mints unguessable tokens and stores only their SHA-256", () => {
    const a = createAccountSessionToken();
    const b = createAccountSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashAccountSessionToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccountSessionToken(a)).not.toBe(a);
  });

  it("reads one named cookie out of a Cookie header, tolerating spacing and '=' inside values", () => {
    expect(parseCookieValue("a=1; hoodlums_account_session=tok==; b=2", ACCOUNT_SESSION_COOKIE)).toBe("tok==");
    expect(parseCookieValue("hoodlums_account_session=", ACCOUNT_SESSION_COOKIE)).toBeNull();
    expect(parseCookieValue(null, ACCOUNT_SESSION_COOKIE)).toBeNull();
    expect(parseCookieValue("other=1", ACCOUNT_SESSION_COOKIE)).toBeNull();
    expect(parseAccountSessionCookie(`x=1;${ACCOUNT_SESSION_COOKIE}=abc`)).toBe("abc");
  });

  it("issues an httpOnly, SameSite=Lax cookie for thirty days that is Secure in production only", () => {
    const expiresAt = new Date("2026-10-06T00:00:00Z");
    expect(ACCOUNT_SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(accountSessionCookieOptions(expiresAt, { NODE_ENV: "production" })).toEqual({
      name: ACCOUNT_SESSION_COOKIE,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    expect(accountSessionCookieOptions(expiresAt, { NODE_ENV: "development" }).secure).toBe(false);
  });
});

describe("readAccountSession", () => {
  beforeEach(() => {
    setUserAccountsStoreForTests(createMemoryUserAccountsStore());
  });
  afterEach(() => {
    resetUserAccountsStoreForTests();
  });

  function requestWithCookie(cookie?: string) {
    return new Request("http://localhost:3000/api/account/session", { headers: cookie ? { cookie } : {} });
  }

  it("returns the account for a live session, null without a cookie, an unknown token, or once expired", async () => {
    const store = createMemoryUserAccountsStore();
    setUserAccountsStoreForTests(store);
    const account = await store.upsertGoogleAccount({ googleSub: "g1", email: "a@b.c", emailVerified: true, displayName: "A" });
    const token = createAccountSessionToken();
    const now = new Date("2026-09-06T12:00:00Z");
    await store.createSession(account.id, hashAccountSessionToken(token), new Date(now.getTime() + 1000));

    expect(await readAccountSession(requestWithCookie(), now)).toBeNull();
    expect(await readAccountSession(requestWithCookie(`${ACCOUNT_SESSION_COOKIE}=wrong`), now)).toBeNull();
    expect((await readAccountSession(requestWithCookie(`${ACCOUNT_SESSION_COOKIE}=${token}`), now))?.id).toBe(account.id);
    expect(await readAccountSession(requestWithCookie(`${ACCOUNT_SESSION_COOKIE}=${token}`), new Date(now.getTime() + 2000))).toBeNull();
  });

  it("never throws when the store fails", async () => {
    const broken = createMemoryUserAccountsStore();
    broken.getSessionAccount = async () => {
      throw new Error("db down");
    };
    setUserAccountsStoreForTests(broken);
    expect(await readAccountSession(requestWithCookie(`${ACCOUNT_SESSION_COOKIE}=abc`))).toBeNull();
  });
});
