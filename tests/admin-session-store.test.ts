import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeAdminChallengeAndCreateSession,
  createAdminChallenge,
  createAdminSession,
  createMemoryAdminSessionState,
  createMemoryAdminSessionStore,
  destroyAdminSession,
  isAdminSessionValid,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
  type MemoryAdminSessionState,
} from "@/lib/server/admin-session-store";

let sharedState: MemoryAdminSessionState;

function installFreshServerlessInstance(): void {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore(sharedState));
}

beforeEach(() => {
  sharedState = createMemoryAdminSessionState();
  installFreshServerlessInstance();
});

afterEach(resetAdminStoresForTests);

describe("durable admin challenge flow", () => {
  it("survives separate challenge, login, and session-check instances", async () => {
    const challenge = await createAdminChallenge("0xabc", "nonce-hash");

    installFreshServerlessInstance();
    const loginResult = await consumeAdminChallengeAndCreateSession(
      {
        challengeId: challenge.id,
        nonceHash: "nonce-hash",
        sessionTokenHash: "session-hash",
      },
      async () => true,
    );
    expect(loginResult.status).toBe("authenticated");

    installFreshServerlessInstance();
    await expect(isAdminSessionValid("session-hash")).resolves.toBe(true);
  });

  it("rejects an unknown challenge", async () => {
    const result = await consumeAdminChallengeAndCreateSession(
      {
        challengeId: "does-not-exist",
        nonceHash: "nonce-hash",
        sessionTokenHash: "session-hash",
      },
      async () => true,
    );
    expect(result).toEqual({ status: "challenge_not_found" });
  });

  it("rejects a mismatched nonce without consuming the challenge", async () => {
    const challenge = await createAdminChallenge("0xabc", "correct-hash");
    const mismatch = await consumeAdminChallengeAndCreateSession(
      {
        challengeId: challenge.id,
        nonceHash: "wrong-hash",
        sessionTokenHash: "session-hash-1",
      },
      async () => true,
    );
    expect(mismatch).toEqual({ status: "challenge_mismatch" });

    const accepted = await consumeAdminChallengeAndCreateSession(
      {
        challengeId: challenge.id,
        nonceHash: "correct-hash",
        sessionTokenHash: "session-hash-2",
      },
      async () => true,
    );
    expect(accepted.status).toBe("authenticated");
  });

  it("consumes a valid challenge once and rejects replay", async () => {
    const challenge = await createAdminChallenge("0xabc", "nonce-hash");
    const first = await consumeAdminChallengeAndCreateSession(
      {
        challengeId: challenge.id,
        nonceHash: "nonce-hash",
        sessionTokenHash: "session-hash-1",
      },
      async () => true,
    );
    expect(first.status).toBe("authenticated");

    const replay = await consumeAdminChallengeAndCreateSession(
      {
        challengeId: challenge.id,
        nonceHash: "nonce-hash",
        sessionTokenHash: "session-hash-2",
      },
      async () => true,
    );
    expect(replay).toEqual({ status: "challenge_replayed" });
  });
});

describe("durable admin sessions", () => {
  it("treats a freshly created session as valid from another instance", async () => {
    await createAdminSession("token-hash-1");
    installFreshServerlessInstance();
    await expect(isAdminSessionValid("token-hash-1")).resolves.toBe(true);
  });

  it("treats an unknown session hash as invalid", async () => {
    await expect(isAdminSessionValid("never-created")).resolves.toBe(false);
  });

  it("expires a session once its TTL has passed", async () => {
    const now = Date.now();
    await createAdminSession("token-hash-2", now);
    await expect(
      isAdminSessionValid("token-hash-2", now + 1_000),
    ).resolves.toBe(true);
    await expect(
      isAdminSessionValid("token-hash-2", now + 13 * 60 * 60 * 1000),
    ).resolves.toBe(false);
  });

  it("invalidates a session immediately on logout", async () => {
    await createAdminSession("token-hash-3");
    await expect(isAdminSessionValid("token-hash-3")).resolves.toBe(true);

    installFreshServerlessInstance();
    await destroyAdminSession("token-hash-3");

    installFreshServerlessInstance();
    await expect(isAdminSessionValid("token-hash-3")).resolves.toBe(false);
  });
});
