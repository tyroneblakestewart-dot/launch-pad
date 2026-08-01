import { afterEach, describe, expect, it } from "vitest";
import { isAdminSessionTokenAuthenticated } from "@/app/admin/page";
import { hashAdminSessionToken } from "@/lib/server/admin-auth";
import { createAdminSession, resetAdminStoresForTests } from "@/lib/server/admin-session-store";

afterEach(resetAdminStoresForTests);

describe("isAdminSessionTokenAuthenticated", () => {
  it("is false with no token, so an unauthenticated visitor never reaches the dashboard", () => {
    expect(isAdminSessionTokenAuthenticated(undefined)).toBe(false);
  });

  it("is false for a token that was never issued a session", () => {
    expect(isAdminSessionTokenAuthenticated("some-random-token")).toBe(false);
  });

  it("is true for a token backing a live session", () => {
    const token = "a-real-session-token";
    createAdminSession(hashAdminSessionToken(token));
    expect(isAdminSessionTokenAuthenticated(token)).toBe(true);
  });
});
