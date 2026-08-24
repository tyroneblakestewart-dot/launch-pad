import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryAdminOperationsState,
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import { authoriseSocialProjectSlot } from "@/lib/server/social-project-slot-entitlement";
import {
  resetSocialProjectSlotsStoreForTests,
  setSocialProjectSlotsStoreForTests,
} from "@/lib/server/social-project-slots-store";
import { createMemorySocialProjectSlotsStore } from "./social-project-slots-test-helpers";

const WALLET = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  resetSocialProjectSlotsStoreForTests();
  resetAdminOperationsStoreForTests();
});

function allowed(overrides: Partial<{ accessSource: "paid" | "test-allowlist"; plan: "pro" | "pro-bundle" | null }> = {}) {
  return {
    status: "allowed" as const,
    walletAddress: WALLET,
    accessSource: overrides.accessSource ?? "paid",
    plan: overrides.plan === undefined ? "pro" : overrides.plan,
  };
}

describe("authoriseSocialProjectSlot", () => {
  it("bypasses unlimited for a test-allowlist wallet without touching the registry", async () => {
    // No setSocialProjectSlotsStoreForTests call — the unconfigured fallback
    // throws on ensureSlot, so a bypass that reaches "ok" proves the store
    // was never called.
    const result = await authoriseSocialProjectSlot(
      allowed({ accessSource: "test-allowlist", plan: null }),
      { projectId: "proj-1", displayName: "Test Coin" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result).toEqual({ status: "ok" });
  });

  it("rejects a missing project id before touching the registry", async () => {
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const result = await authoriseSocialProjectSlot(
      allowed(),
      { projectId: undefined, displayName: "Test Coin" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result.status).toBe("invalid-project");
  });

  it("rejects a blank display name", async () => {
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const result = await authoriseSocialProjectSlot(
      allowed(),
      { projectId: "proj-1", displayName: "   " },
      { serviceKey: "social-studio-ai" },
    );
    expect(result.status).toBe("invalid-project");
  });

  it("fails closed (unavailable) when a real paid authorisation somehow carries no plan", async () => {
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const result = await authoriseSocialProjectSlot(
      allowed({ plan: null }),
      { projectId: "proj-1", displayName: "Test Coin" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result.status).toBe("unavailable");
  });

  it("registers a first project and logs slot-registered with wallet/project id/display name only", async () => {
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const state = createMemoryAdminOperationsState();
    setAdminOperationsStoreForTests(createMemoryAdminOperationsStore(state));

    const result = await authoriseSocialProjectSlot(
      allowed(),
      { projectId: "proj-1", displayName: "Test Coin" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result).toEqual({ status: "ok" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const entry = state.activity.find((item) => item.kind === "slot-registered");
    expect(entry).toBeDefined();
    expect(entry?.serviceKey).toBe("social-studio-ai");
    expect(entry?.message).toContain(WALLET);
    expect(entry?.message).toContain("Test Coin");
    expect(entry?.message).toContain("proj-1");
  });

  it("does not re-log slot-registered for an already-registered project", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);
    const state = createMemoryAdminOperationsState();
    setAdminOperationsStoreForTests(createMemoryAdminOperationsStore(state));

    const result = await authoriseSocialProjectSlot(
      allowed(),
      { projectId: "proj-1", displayName: "Test Coin" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result).toEqual({ status: "ok" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.activity.some((item) => item.kind === "slot-registered")).toBe(false);
  });

  it("returns limit-reached naming the plan, the limit and the upgrade/swap choice for a Pro wallet's second project", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);

    const result = await authoriseSocialProjectSlot(
      allowed({ plan: "pro" }),
      { projectId: "proj-2", displayName: "Coin Two" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result.status).toBe("limit-reached");
    if (result.status === "limit-reached") {
      expect(result.limit).toBe(1);
      expect(result.activeCount).toBe(1);
      expect(result.message).toContain("Pro");
      expect(result.message).toContain("Pro Bundle");
      expect(result.message.toLowerCase()).toContain("swap");
    }
  });

  it("allows a Pro Bundle wallet up to its limit of 3", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    setSocialProjectSlotsStoreForTests(store);

    const result = await authoriseSocialProjectSlot(
      allowed({ plan: "pro-bundle" }),
      { projectId: "proj-3", displayName: "Coin Three" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result).toEqual({ status: "ok" });
  });

  it("fails closed with unavailable when the registry is not configured", async () => {
    // No setSocialProjectSlotsStoreForTests call — DATABASE_URL is unset in test env, so the unconfigured fallback throws.
    const result = await authoriseSocialProjectSlot(
      allowed(),
      { projectId: "proj-1", displayName: "Test Coin" },
      { serviceKey: "social-studio-ai" },
    );
    expect(result.status).toBe("unavailable");
  });
});
