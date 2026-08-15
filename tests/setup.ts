import { beforeEach } from "vitest";
import { setBespokeSiteAuthoriserForTests } from "@/lib/server/bespoke-site-entitlement";
import { setSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";

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
    accessSource: "paid",
    permanent: true,
  }));

  // Same rationale for the AI Social Studio routes (issue #332): pipeline
  // tests exercise the AI request/response shape, not entitlement — focused
  // entitlement tests reset this override and exercise the real
  // subscriptions-table decision.
  setSocialStudioAuthoriserForTests(async (walletAddress) => ({
    status: "allowed",
    walletAddress: typeof walletAddress === "string" ? walletAddress : TEST_PAID_WALLET,
  }));
});
