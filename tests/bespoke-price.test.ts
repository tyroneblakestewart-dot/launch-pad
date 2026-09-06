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

  it("tells the owner the wei amount must match the $15 catalog price", async () => {
    const env = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
    expect(env).toContain("Catalog price is $15");
    expect(env).toContain("HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI=");
  });
});
