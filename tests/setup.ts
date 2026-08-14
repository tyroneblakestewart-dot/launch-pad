import { beforeEach } from "vitest";
import { setBespokeSiteAuthoriserForTests } from "@/lib/server/bespoke-site-entitlement";

const TEST_PAID_WALLET = "0x1111111111111111111111111111111111111111";

/**
 * Existing generate-site-page suites test the AI pipeline rather than product
 * entitlement. They receive an explicit paid server fixture here; focused
 * entitlement tests reset this override and exercise the real signature and
 * subscriber-store decision.
 */
beforeEach(() => {
  setBespokeSiteAuthoriserForTests(async () => ({
    status: "allowed",
    walletAddress: TEST_PAID_WALLET,
    tier: "bond_pro_site",
    permanent: true,
  }));
});
