import { afterEach, describe, expect, it } from "vitest";
import {
  createAdminChallenge,
  createAdminSession,
  destroyAdminSession,
  getAdminChallenge,
  isAdminSessionValid,
  markAdminChallengeUsed,
  resetAdminStoresForTests,
} from "@/lib/server/admin-session-store";

afterEach(resetAdminStoresForTests);

describe("admin challenge store", () => {
  it("round-trips a created challenge by id", () => {
    const challenge = createAdminChallenge("0xabc", "nonce-hash");
    expect(getAdminChallenge(challenge.id)).toEqual(challenge);
  });

  it("returns null for an unknown challenge id", () => {
    expect(getAdminChallenge("does-not-exist")).toBeNull();
  });

  it("marks a challenge used, visible on the stored record", () => {
    const challenge = createAdminChallenge("0xabc", "nonce-hash");
    expect(getAdminChallenge(challenge.id)?.usedAt).toBeNull();

    markAdminChallengeUsed(challenge.id);
    expect(getAdminChallenge(challenge.id)?.usedAt).toBeInstanceOf(Date);
  });

  it("is a no-op when marking an unknown challenge used", () => {
    expect(() => markAdminChallengeUsed("does-not-exist")).not.toThrow();
  });
});

describe("admin session store", () => {
  it("treats a freshly created session as valid", () => {
    createAdminSession("token-hash-1");
    expect(isAdminSessionValid("token-hash-1")).toBe(true);
  });

  it("treats an unknown session hash as invalid", () => {
    expect(isAdminSessionValid("never-created")).toBe(false);
  });

  it("expires a session once its TTL has passed", () => {
    const now = Date.now();
    createAdminSession("token-hash-2", now);
    expect(isAdminSessionValid("token-hash-2", now + 1_000)).toBe(true);
    expect(isAdminSessionValid("token-hash-2", now + 13 * 60 * 60 * 1000)).toBe(false);
  });

  it("invalidates a session immediately on logout", () => {
    createAdminSession("token-hash-3");
    expect(isAdminSessionValid("token-hash-3")).toBe(true);

    destroyAdminSession("token-hash-3");
    expect(isAdminSessionValid("token-hash-3")).toBe(false);
  });
});
