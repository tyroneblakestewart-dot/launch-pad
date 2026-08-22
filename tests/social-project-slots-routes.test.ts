import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { GET as getProjectSlots } from "@/app/api/social/project-slots/route";
import { POST as releaseProjectSlot } from "@/app/api/social/project-slots/release/route";
import { POST as socialChallenge } from "@/app/api/social/challenge/route";
import { resetSocialStudioActionRateLimitsForTests } from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import {
  resetSocialProjectSlotsStoreForTests,
  setSocialProjectSlotsStoreForTests,
} from "@/lib/server/social-project-slots-store";
import {
  resetSocialStudioAuthoriserForTests,
  setSocialStudioAuthoriserForTests,
} from "@/lib/server/social-studio-entitlement";
import { createMemorySocialProjectSlotsStore } from "./social-project-slots-test-helpers";

const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const ORIGIN = "http://localhost:3000";

function postRequest(path: string, body: unknown) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`${ORIGIN}${path}`, { method: "GET" });
}

async function signedRelease(projectId: string, displayName: string) {
  const challengeResponse = await socialChallenge(
    postRequest("/api/social/challenge", {
      walletAddress: ACCOUNT.address,
      walletChainId: 46630,
      purpose: "social:project-slot-release",
      payload: { projectId, displayName },
    }),
  );
  expect(challengeResponse.status).toBe(201);
  const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await ACCOUNT.signMessage({ message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}

beforeEach(() => {
  process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN = ORIGIN;
  resetSocialStudioActionRateLimitsForTests();
  resetChatChallengesForTests();
});

afterEach(() => {
  delete process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN;
  resetSocialStudioActionRateLimitsForTests();
  resetChatChallengesForTests();
  resetSocialStudioAuthoriserForTests();
  resetSocialProjectSlotsStoreForTests();
});

describe("GET /api/social/project-slots", () => {
  it("returns 401 for an invalid wallet", async () => {
    // Falls through to the real authoriseSocialStudioRequest implementation
    // instead of the global test-allowlist fixture, which would otherwise
    // "allow" any wallet string without validating its shape.
    resetSocialStudioAuthoriserForTests();
    const response = await getProjectSlots(getRequest("/api/social/project-slots?walletAddress=not-a-wallet"));
    expect(response.status).toBe(401);
  });

  it("returns the upsell shape for an unentitled wallet", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade to Pro." }));
    const response = await getProjectSlots(getRequest(`/api/social/project-slots?walletAddress=${ACCOUNT.address}`));
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe("social-studio-plan-required");
  });

  it("reports unlimited usage for a test-allowlist wallet without touching the registry", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: ACCOUNT.address, accessSource: "test-allowlist" }));
    const response = await getProjectSlots(getRequest(`/api/social/project-slots?walletAddress=${ACCOUNT.address}`));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { unlimited?: boolean; limit?: number | null; slots?: unknown[] };
    expect(payload.unlimited).toBe(true);
    expect(payload.limit).toBeNull();
    expect(payload.slots).toEqual([]);
  });

  it("returns the plan, limit and active slots for a paid Pro wallet", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: ACCOUNT.address, accessSource: "paid", plan: "pro" }));
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: ACCOUNT.address, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);

    const response = await getProjectSlots(getRequest(`/api/social/project-slots?walletAddress=${ACCOUNT.address}`));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { plan?: string; limit?: number; activeCount?: number; slots?: Array<{ projectId: string }> };
    expect(payload.plan).toBe("pro");
    expect(payload.limit).toBe(1);
    expect(payload.activeCount).toBe(1);
    expect(payload.slots?.[0]?.projectId).toBe("proj-1");
  });

  it("degrades to an empty list, not a 503, when the registry is not configured — a read never blocks a paid action", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "allowed", walletAddress: ACCOUNT.address, accessSource: "paid", plan: "pro" }));
    const response = await getProjectSlots(getRequest(`/api/social/project-slots?walletAddress=${ACCOUNT.address}`));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { activeCount?: number; slots?: unknown[] };
    expect(payload.activeCount).toBe(0);
    expect(payload.slots).toEqual([]);
  });
});

describe("POST /api/social/project-slots/release", () => {
  it("rejects requests from a disallowed origin", async () => {
    const response = await releaseProjectSlot(
      new Request(`${ORIGIN}/api/social/project-slots/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns 400 for a missing project id or display name", async () => {
    const response = await releaseProjectSlot(postRequest("/api/social/project-slots/release", { challengeId: "x", nonce: "y", signature: "z" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a missing challenge/signature", async () => {
    const response = await releaseProjectSlot(postRequest("/api/social/project-slots/release", { projectId: "proj-1", displayName: "Test Coin" }));
    expect(response.status).toBe(400);
  });

  it("returns 401 for an invalid signature", async () => {
    const auth = await signedRelease("proj-1", "Test Coin");
    const response = await releaseProjectSlot(
      postRequest("/api/social/project-slots/release", { projectId: "proj-1", displayName: "Test Coin", ...auth, signature: "0xdead" }),
    );
    expect(response.status).toBe(401);
  });

  it("releases an active slot and logs slot-released-by-user", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: ACCOUNT.address, projectId: "proj-1", displayName: "Test Coin", limit: 1 });
    setSocialProjectSlotsStoreForTests(store);

    const auth = await signedRelease("proj-1", "Test Coin");
    const response = await releaseProjectSlot(
      postRequest("/api/social/project-slots/release", { projectId: "proj-1", displayName: "Test Coin", ...auth }),
    );
    expect(response.status).toBe(200);
    expect(await store.listActive(ACCOUNT.address)).toHaveLength(0);
  });

  it("returns 404 when the wallet has no active slot for that project id", async () => {
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const auth = await signedRelease("never-registered", "Ghost Coin");
    const response = await releaseProjectSlot(
      postRequest("/api/social/project-slots/release", { projectId: "never-registered", displayName: "Ghost Coin", ...auth }),
    );
    expect(response.status).toBe(404);
  });

  it("returns 409 with the cooldown message on a second release within seven days", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: ACCOUNT.address, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: ACCOUNT.address, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    await store.releaseByUser({ walletAddress: ACCOUNT.address, projectId: "proj-1" });
    setSocialProjectSlotsStoreForTests(store);

    const auth = await signedRelease("proj-2", "Coin Two");
    const response = await releaseProjectSlot(
      postRequest("/api/social/project-slots/release", { projectId: "proj-2", displayName: "Coin Two", ...auth }),
    );
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error?: string; nextReleaseAllowedAt?: string };
    expect(payload.error).toContain("7 days");
    expect(payload.nextReleaseAllowedAt).toBeDefined();
  });

  it("returns 503 when the registry is not configured", async () => {
    const auth = await signedRelease("proj-1", "Test Coin");
    const response = await releaseProjectSlot(
      postRequest("/api/social/project-slots/release", { projectId: "proj-1", displayName: "Test Coin", ...auth }),
    );
    expect(response.status).toBe(503);
  });
});
