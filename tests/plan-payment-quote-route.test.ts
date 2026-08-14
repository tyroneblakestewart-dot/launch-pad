import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/plan-payments/quote/route";

const ORIGINAL_ENV = { ...process.env };

function configuredBaseEnvironment() {
  process.env.DATABASE_URL = "postgres://test.invalid/hoodlums";
  process.env.HOODLUMS_TREASURY_ADDRESS =
    "0x1111111111111111111111111111111111111111";
  process.env.HOODLUMS_PAYMENT_RPC_URL = "https://rpc.example.test";
  process.env.HOODLUMS_PAYMENT_CHAIN_ID = "4663";
  process.env.HOODLUMS_PAYMENT_CHAIN_NAME = "Robinhood Chain";
  process.env.HOODLUMS_PAYMENT_EXPLORER_URL =
    "https://explorer.example.test";
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("Bond + Pro Site quote configuration", () => {
  it("returns a friendly not-configured response when the native amount is missing", async () => {
    configuredBaseEnvironment();
    delete process.env.HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(
      new Request(
        "https://hoodlums.dev/api/plan-payments/quote?plan=bond-pro-site&billing=one_off",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "payments-not-configured",
      error: "Payments are not configured for this plan on this deployment.",
    });
  });

  it("fails closed before returning a quote when payment persistence is unavailable", async () => {
    configuredBaseEnvironment();
    process.env.HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI = "1";
    delete process.env.DATABASE_URL;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(
      new Request(
        "https://hoodlums.dev/api/plan-payments/quote?plan=bond-pro-site&billing=one_off",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "payments-not-configured",
    });
  });
});
