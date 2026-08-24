import { afterEach, describe, expect, it } from "vitest";
import {
  getSocialProjectSlotsStore,
  resetSocialProjectSlotsStoreForTests,
  setSocialProjectSlotsStoreForTests,
  SocialProjectSlotsStoreUnavailableError,
} from "@/lib/server/social-project-slots-store";
import { createMemorySocialProjectSlotsStore } from "./social-project-slots-test-helpers";

const WALLET = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  resetSocialProjectSlotsStoreForTests();
  delete process.env.DATABASE_URL;
});

describe("unconfigured project-slot registry (no DATABASE_URL)", () => {
  it("fails safe on the read path without throwing, and throws on every write path", async () => {
    delete process.env.DATABASE_URL;
    const store = getSocialProjectSlotsStore();

    await expect(store.listActive(WALLET)).resolves.toEqual([]);
    await expect(
      store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 }),
    ).rejects.toBeInstanceOf(SocialProjectSlotsStoreUnavailableError);
    await expect(store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1" })).rejects.toBeInstanceOf(
      SocialProjectSlotsStoreUnavailableError,
    );
    await expect(store.releaseByAdmin({ walletAddress: WALLET, projectId: "proj-1" })).rejects.toBeInstanceOf(
      SocialProjectSlotsStoreUnavailableError,
    );
  });
});

describe("test-injectable singleton", () => {
  it("prefers the injected test store over the unconfigured fallback", () => {
    const memoryStore = createMemorySocialProjectSlotsStore();
    setSocialProjectSlotsStoreForTests(memoryStore);
    expect(getSocialProjectSlotsStore()).toBe(memoryStore);

    resetSocialProjectSlotsStoreForTests();
    expect(getSocialProjectSlotsStore()).not.toBe(memoryStore);
  });
});

describe("project-slot registration and limit contract", () => {
  it("registers a first project under the limit and reports it back from listActive", async () => {
    const store = createMemorySocialProjectSlotsStore();
    const result = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    expect(result.status).toBe("registered");
    if (result.status !== "limit_reached") expect(result.activeCount).toBe(1);

    const active = await store.listActive(WALLET);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ projectId: "proj-1", displayName: "Test Coin" });
  });

  it("returns the existing slot, not a duplicate, for a repeat request with the same project id", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    const second = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    expect(second.status).toBe("existing");
    expect(await store.listActive(WALLET)).toHaveLength(1);
  });

  it("reports limit_reached for a new project once the wallet is at its plan limit", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 1 });
    const result = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 1 });
    expect(result.status).toBe("limit_reached");
    if (result.status === "limit_reached") {
      expect(result.activeCount).toBe(1);
      expect(result.limit).toBe(1);
    }
  });

  it("allows up to the Pro Bundle limit of three active projects", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    const third = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-3", displayName: "Coin Three", limit: 3 });
    expect(third.status).toBe("registered");
    const fourth = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-4", displayName: "Coin Four", limit: 3 });
    expect(fourth.status).toBe("limit_reached");
  });
});

describe("release cooldown contract", () => {
  it("frees the slot immediately on release, letting a different project register in its place", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 1 });
    const released = await store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1" });
    expect(released.status).toBe("ok");
    expect(await store.listActive(WALLET)).toHaveLength(0);

    const registeredAgain = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 1 });
    expect(registeredAgain.status).toBe("registered");
  });

  it("rejects a second user release within seven days", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    const now = new Date("2026-06-01T00:00:00.000Z");
    const first = await store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1", now });
    expect(first.status).toBe("ok");

    const second = await store.releaseByUser({
      walletAddress: WALLET,
      projectId: "proj-2",
      now: new Date("2026-06-03T00:00:00.000Z"),
    });
    expect(second.status).toBe("cooldown");
  });

  it("allows a second user release once seven days have passed", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    const now = new Date("2026-06-01T00:00:00.000Z");
    await store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1", now });

    const second = await store.releaseByUser({
      walletAddress: WALLET,
      projectId: "proj-2",
      now: new Date("2026-06-08T00:00:01.000Z"),
    });
    expect(second.status).toBe("ok");
  });

  it("returns not_found for a release of a project the wallet doesn't have an active slot for", async () => {
    const store = createMemorySocialProjectSlotsStore();
    const result = await store.releaseByUser({ walletAddress: WALLET, projectId: "never-registered" });
    expect(result.status).toBe("not_found");
  });

  it("an admin release bypasses the user cooldown entirely", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    const now = new Date("2026-06-01T00:00:00.000Z");
    await store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1", now });

    // Still inside the seven-day user cooldown, but an admin release ignores it.
    const adminRelease = await store.releaseByAdmin({
      walletAddress: WALLET,
      projectId: "proj-2",
      now: new Date("2026-06-02T00:00:00.000Z"),
    });
    expect(adminRelease.status).toBe("ok");
    expect(await store.listActive(WALLET)).toHaveLength(0);
  });
});
