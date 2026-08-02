import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAdminSessionTokenAuthenticated } from "@/app/admin/page";
import { hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";

beforeEach(() => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
});

afterEach(resetAdminStoresForTests);

describe("isAdminSessionTokenAuthenticated", () => {
  it("is false with no token, so an unauthenticated visitor never reaches the dashboard", async () => {
    await expect(isAdminSessionTokenAuthenticated(undefined)).resolves.toBe(
      false,
    );
  });

  it("is false for a token that was never issued a session", async () => {
    await expect(
      isAdminSessionTokenAuthenticated("some-random-token"),
    ).resolves.toBe(false);
  });

  it("is true for a token backing a live session", async () => {
    const token = "a-real-session-token";
    await createAdminSession(hashAdminSessionToken(token));
    await expect(isAdminSessionTokenAuthenticated(token)).resolves.toBe(true);
  });
});
