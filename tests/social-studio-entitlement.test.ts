import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SOCIAL_STUDIO_UPSELL_MESSAGE,
  authoriseSocialStudioRequest,
  resetSocialStudioAuthoriserForTests,
} from "@/lib/server/social-studio-entitlement";

const ACTIVE_WALLET = "0x1111111111111111111111111111111111111111";
const INACTIVE_WALLET = "0x2222222222222222222222222222222222222222";

function fakeQuery(rows: Array<Record<string, unknown>>) {
  return async () => ({ rows });
}

beforeEach(() => {
  // These tests exercise the real subscriptions-table decision, not the
  // global test fixture other suites rely on.
  resetSocialStudioAuthoriserForTests();
});

afterEach(() => {
  resetSocialStudioAuthoriserForTests();
});

describe("authoriseSocialStudioRequest", () => {
  it("rejects a missing or invalid wallet without touching the database", async () => {
    const missing = await authoriseSocialStudioRequest(undefined, { query: fakeQuery([]) });
    expect(missing.status).toBe("invalid-wallet");

    const malformed = await authoriseSocialStudioRequest("not-a-wallet", { query: fakeQuery([]) });
    expect(malformed.status).toBe("invalid-wallet");
  });

  it("returns unavailable when no database is configured and no query override is supplied", async () => {
    const result = await authoriseSocialStudioRequest(ACTIVE_WALLET, { databaseUrl: "" });
    expect(result.status).toBe("unavailable");
  });

  it("returns unavailable when the query itself fails, rather than silently falling through to upsell", async () => {
    const result = await authoriseSocialStudioRequest(ACTIVE_WALLET, {
      query: async () => {
        throw new Error("connection reset");
      },
    });
    expect(result.status).toBe("unavailable");
  });

  it("returns upsell with the standard copy for a wallet with no active Pro/Pro Bundle row", async () => {
    const result = await authoriseSocialStudioRequest(INACTIVE_WALLET, { query: fakeQuery([]) });
    expect(result).toEqual({ status: "upsell", message: SOCIAL_STUDIO_UPSELL_MESSAGE });
  });

  it("returns upsell for an expired subscription row, not allowed", async () => {
    const result = await authoriseSocialStudioRequest(ACTIVE_WALLET, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      query: fakeQuery([
        {
          wallet_address: ACTIVE_WALLET,
          tier: "pro",
          paid_from: "2025-01-01T00:00:00.000Z",
          paid_until: "2025-02-01T00:00:00.000Z",
          expires_at: null,
          telegram_chat_id: null,
        },
      ]),
    });
    expect(result.status).toBe("upsell");
  });

  it("returns allowed for a wallet with an active Pro subscription", async () => {
    const result = await authoriseSocialStudioRequest(ACTIVE_WALLET, {
      now: new Date("2026-01-15T00:00:00.000Z"),
      query: fakeQuery([
        {
          wallet_address: ACTIVE_WALLET,
          tier: "pro",
          paid_from: "2026-01-01T00:00:00.000Z",
          paid_until: "2026-02-01T00:00:00.000Z",
          expires_at: null,
          telegram_chat_id: null,
        },
      ]),
    });
    expect(result).toEqual({ status: "allowed", walletAddress: ACTIVE_WALLET.toLowerCase() });
  });

  it("returns allowed for a wallet with an active Pro Bundle subscription", async () => {
    const result = await authoriseSocialStudioRequest(ACTIVE_WALLET, {
      now: new Date("2026-01-15T00:00:00.000Z"),
      query: fakeQuery([
        {
          wallet_address: ACTIVE_WALLET,
          tier: "pro_bundle",
          paid_from: "2026-01-01T00:00:00.000Z",
          paid_until: "2026-02-01T00:00:00.000Z",
          expires_at: null,
          telegram_chat_id: null,
        },
      ]),
    });
    expect(result.status).toBe("allowed");
  });

  it("returns upsell for a bond_pro_site-only wallet — Social Studio is Pro/Pro Bundle only, not the bespoke-site tier", async () => {
    const result = await authoriseSocialStudioRequest(ACTIVE_WALLET, {
      query: fakeQuery([
        {
          wallet_address: ACTIVE_WALLET,
          tier: "bond_pro_site",
          paid_from: "2026-01-01T00:00:00.000Z",
          paid_until: null,
          expires_at: null,
          telegram_chat_id: null,
        },
      ]),
    });
    expect(result.status).toBe("upsell");
  });
});
