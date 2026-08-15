import { afterEach, describe, expect, it } from "vitest";
import {
  getSocialConnectionsStore,
  resetSocialConnectionsStoreForTests,
  setSocialConnectionsStoreForTests,
  SocialConnectionsStoreUnavailableError,
} from "@/lib/server/social-connections-store";
import { createMemorySocialConnectionsStore } from "./social-connections-test-helpers";

afterEach(() => {
  resetSocialConnectionsStoreForTests();
  delete process.env.DATABASE_URL;
});

describe("unconfigured social connections store (no DATABASE_URL)", () => {
  it("fails safe on read paths without throwing, and throws only on write paths", async () => {
    delete process.env.DATABASE_URL;
    const store = getSocialConnectionsStore();

    await expect(store.get("0xabc", "x")).resolves.toBeNull();
    await expect(store.list("0xabc")).resolves.toEqual([]);
    await expect(store.getCredentials("0xabc", "x")).resolves.toEqual({ status: "not_found" });
    await expect(store.consumeXOAuthRequest("token")).resolves.toEqual({ status: "not_found" });

    await expect(store.upsert({ walletAddress: "0xabc", platform: "x", displayName: "d", externalId: "1", credentials: "c" })).rejects.toBeInstanceOf(
      SocialConnectionsStoreUnavailableError,
    );
    await expect(store.markReconnectNeeded("0xabc", "x", "reason")).rejects.toBeInstanceOf(SocialConnectionsStoreUnavailableError);
    await expect(store.recordFailure("0xabc", "x", "reason", 3)).rejects.toBeInstanceOf(SocialConnectionsStoreUnavailableError);
    await expect(store.resetFailures("0xabc", "x")).rejects.toBeInstanceOf(SocialConnectionsStoreUnavailableError);
    await expect(store.delete("0xabc", "x")).rejects.toBeInstanceOf(SocialConnectionsStoreUnavailableError);
    await expect(store.createXOAuthRequest({ walletAddress: "0xabc", requestToken: "t", requestSecret: "s", expiresAt: new Date() })).rejects.toBeInstanceOf(
      SocialConnectionsStoreUnavailableError,
    );
  });
});

describe("connection lifecycle", () => {
  it("upserts a connection as connected with zero failures, and reads it back case-insensitively", async () => {
    const store = createMemorySocialConnectionsStore();
    await store.upsert({ walletAddress: "0xAbC", platform: "x", displayName: "@hoodlumsdev", externalId: "42", credentials: JSON.stringify({ accessToken: "t", accessSecret: "s" }) });

    const connection = await store.get("0xabc", "x");
    expect(connection).toMatchObject({ platform: "x", status: "connected", displayName: "@hoodlumsdev", failureCount: 0 });
  });

  it("recordFailure increments the count and flips to reconnect_needed once the threshold is reached", async () => {
    const store = createMemorySocialConnectionsStore();
    await store.upsert({ walletAddress: "0xabc", platform: "x", displayName: "d", externalId: "1", credentials: "c" });

    await store.recordFailure("0xabc", "x", "first failure", 3);
    expect((await store.get("0xabc", "x"))?.status).toBe("connected");

    await store.recordFailure("0xabc", "x", "second failure", 3);
    await store.recordFailure("0xabc", "x", "third failure", 3);
    const connection = await store.get("0xabc", "x");
    expect(connection?.status).toBe("reconnect_needed");
    expect(connection?.reconnectReason).toBe("third failure");
    expect(connection?.failureCount).toBe(3);
  });

  it("resetFailures clears the failure count (but not a reconnect_needed status set by markReconnectNeeded)", async () => {
    const store = createMemorySocialConnectionsStore();
    await store.upsert({ walletAddress: "0xabc", platform: "telegram", displayName: "d", externalId: "1", credentials: "c" });
    await store.recordFailure("0xabc", "telegram", "boom", 1);
    await store.resetFailures("0xabc", "telegram");
    expect((await store.get("0xabc", "telegram"))?.failureCount).toBe(0);
  });

  it("delete removes the connection and its credentials", async () => {
    const store = createMemorySocialConnectionsStore();
    await store.upsert({ walletAddress: "0xabc", platform: "x", displayName: "d", externalId: "1", credentials: "secret" });
    await store.delete("0xabc", "x");
    expect(await store.get("0xabc", "x")).toBeNull();
    expect(await store.getCredentials("0xabc", "x")).toEqual({ status: "not_found" });
  });

  it("re-upserting after reconnect_needed restores connected status and clears the reason", async () => {
    const store = createMemorySocialConnectionsStore();
    await store.upsert({ walletAddress: "0xabc", platform: "x", displayName: "d", externalId: "1", credentials: "c" });
    await store.markReconnectNeeded("0xabc", "x", "revoked");
    await store.upsert({ walletAddress: "0xabc", platform: "x", displayName: "d2", externalId: "2", credentials: "c2" });
    const connection = await store.get("0xabc", "x");
    expect(connection).toMatchObject({ status: "connected", reconnectReason: null, displayName: "d2" });
  });
});

describe("X OAuth request-token handshake", () => {
  it("consumes a valid request exactly once (single-use)", async () => {
    const store = createMemorySocialConnectionsStore();
    const expiresAt = new Date(Date.now() + 60_000);
    await store.createXOAuthRequest({ walletAddress: "0xabc", requestToken: "rt", requestSecret: "rts", expiresAt });

    const first = await store.consumeXOAuthRequest("rt");
    expect(first).toEqual({ status: "ok", walletAddress: "0xabc", requestSecret: "rts" });

    const second = await store.consumeXOAuthRequest("rt");
    expect(second).toEqual({ status: "replayed" });
  });

  it("reports expired for a request past its expiry", async () => {
    const store = createMemorySocialConnectionsStore();
    const expiresAt = new Date(Date.now() - 1);
    await store.createXOAuthRequest({ walletAddress: "0xabc", requestToken: "rt", requestSecret: "rts", expiresAt });
    expect(await store.consumeXOAuthRequest("rt")).toEqual({ status: "expired" });
  });

  it("reports not_found for an unknown token", async () => {
    const store = createMemorySocialConnectionsStore();
    expect(await store.consumeXOAuthRequest("unknown")).toEqual({ status: "not_found" });
  });
});

describe("test-injectable singleton", () => {
  it("setSocialConnectionsStoreForTests / resetSocialConnectionsStoreForTests swap the active store", async () => {
    const memoryStore = createMemorySocialConnectionsStore();
    setSocialConnectionsStoreForTests(memoryStore);
    expect(getSocialConnectionsStore()).toBe(memoryStore);
    resetSocialConnectionsStoreForTests();
    delete process.env.DATABASE_URL;
    expect(getSocialConnectionsStore()).not.toBe(memoryStore);
  });
});
