// Bond + Pro Site price (owner decision, 6 Sep 2026): $15, one-off. The catalog
// figure recorded on every verified payment, the launch-path card, and the
// bespoke upsell message must all say the same number.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAUNCH_PATH_OPTIONS } from "@/lib/launch-paths";
import { formatUsdCents, paymentCatalogPrice } from "@/lib/plan-payments";
import { BESPOKE_SITE_UPSELL_MESSAGE } from "@/lib/server/bespoke-site-entitlement";

describe("Bond + Pro Site price", () => {
  it("is $15 one-off in the payment catalog", () => {
    expect(paymentCatalogPrice("bond-pro-site", "one_off")).toEqual({ usdCents: 1_500, subscriptionDays: null });
    expect(formatUsdCents(1_500)).toBe("$15");
  });

  it("says $15 on the launch-path card and in the bespoke upsell", () => {
    const plan = LAUNCH_PATH_OPTIONS.find((entry) => entry.id === "bond-pro-site");
    expect(plan?.price).toBe("$15 · one-off");
    expect(BESPOKE_SITE_UPSELL_MESSAGE).toContain("($15)");
    expect(BESPOKE_SITE_UPSELL_MESSAGE).not.toContain("$10");
  });

  it("is paid in the stablecoin catalog, with no native-ETH amount left to configure", async () => {
    const env = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
    expect(env).toContain("Bond + Pro Site ($15 one-off) is paid in the enabled stablecoin");
    expect(env).not.toContain("HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI=");
  });
});
