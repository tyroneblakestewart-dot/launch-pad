import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as adminReleaseAction } from "@/app/api/admin/social-project-slots/actions/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  createMemoryAdminOperationsState,
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  resetSocialProjectSlotsStoreForTests,
  setSocialProjectSlotsStoreForTests,
} from "@/lib/server/social-project-slots-store";
import { createMemorySocialProjectSlotsStore } from "./social-project-slots-test-helpers";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-social-project-slots-test-session-token";
const WALLET = "0x1111111111111111111111111111111111111111";
let cookie = "";

function request(body: unknown, options: { authenticated?: boolean; origin?: string | null } = {}) {
  const { authenticated = true, origin = ORIGIN } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authenticated) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  return new Request(`${ORIGIN}/api/admin/social-project-slots/actions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
  process.env.ADMIN_ALLOWED_ORIGIN = ORIGIN;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetAdminOperationsStoreForTests();
  resetSocialProjectSlotsStoreForTests();
  delete process.env.ADMIN_ALLOWED_ORIGIN;
});

describe("POST /api/admin/social-project-slots/actions", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await adminReleaseAction(request({ action: "release", walletAddress: WALLET, projectId: "proj-1" }, { authenticated: false }));
    expect(response.status).toBe(401);
  });

  it("rejects a disallowed origin", async () => {
    const response = await adminReleaseAction(
      request({ action: "release", walletAddress: WALLET, projectId: "proj-1" }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unsupported action", async () => {
    const response = await adminReleaseAction(request({ action: "delete", walletAddress: WALLET, projectId: "proj-1" }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid wallet or missing project id", async () => {
    const response = await adminReleaseAction(request({ action: "release", walletAddress: "not-a-wallet", projectId: "proj-1" }));
    expect(response.status).toBe(400);
  });

  it("releases the slot, bypassing the user cooldown, and logs slot-released-by-admin with no body text", async () => {
    const store = createMemorySocialProjectSlotsStore();
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Coin One", limit: 3 });
    await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two", limit: 3 });
    // Still inside the seven-day user cooldown after this first release.
    await store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1" });
    setSocialProjectSlotsStoreForTests(store);

    const state = createMemoryAdminOperationsState();
    setAdminOperationsStoreForTests(createMemoryAdminOperationsStore(state));

    const response = await adminReleaseAction(
      request({ action: "release", walletAddress: WALLET, projectId: "proj-2", displayName: "Coin Two" }),
    );
    expect(response.status).toBe(200);
    expect(await store.listActive(WALLET)).toHaveLength(0);

    const entry = state.activity.find((item) => item.kind === "slot-released-by-admin");
    expect(entry).toBeDefined();
    expect(entry?.message).toContain(WALLET);
    expect(entry?.message).toContain("proj-2");
    expect(entry?.message).toContain("Coin Two");
  });

  it("returns 404 when no active slot matches", async () => {
    setSocialProjectSlotsStoreForTests(createMemorySocialProjectSlotsStore());
    const response = await adminReleaseAction(
      request({ action: "release", walletAddress: WALLET, projectId: "never-registered" }),
    );
    expect(response.status).toBe(404);
  });

  it("returns 503 when the registry is not configured", async () => {
    const response = await adminReleaseAction(request({ action: "release", walletAddress: WALLET, projectId: "proj-1" }));
    expect(response.status).toBe(503);
  });
});
