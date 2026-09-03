import { beforeEach } from "vitest";
import { setBespokeSiteAuthoriserForTests } from "@/lib/server/bespoke-site-entitlement";
import { setSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";
import { setContractsClientForTests, type ContractsClientLike } from "@/lib/server/system-health";

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
  // subscriptions-table decision. accessSource "test-allowlist" (issue #407)
  // also bypasses the project-slot limit unconditionally, so these pipeline
  // tests don't need a projectId or a configured slot registry either.
  setSocialStudioAuthoriserForTests(async (walletAddress) => ({
    status: "allowed",
    walletAddress: typeof walletAddress === "string" ? walletAddress : TEST_PAID_WALLET,
    accessSource: "test-allowlist",
  }));
});

/**
 * No test may make a real RPC call (issue #475). The on-chain health checks
 * are reachable through their admin HTTP routes, which pass no injectable
 * deps, so without this every such test hit the live Robinhood testnet:
 * `buildContractsPipeline` issues three sequential reads, each with its own
 * 5s `HEALTH_CHECK_TIMEOUT_MS`, against vitest's 5000ms DEFAULT test timeout.
 * That is a race the test loses whenever the network is slow — the
 * intermittent `1 failed / 3285 passed` in issue #475.
 *
 * Failing instantly is the faithful default: no RPC is reachable from CI, so
 * these checks were already resolving red — this removes the latency, not the
 * behaviour. Tests that want a specific on-chain outcome inject explicit
 * `client` / `readFactory` / `readBondingCurve` deps, which take precedence
 * over this client and are untouched by it.
 */
const RPC_DISABLED_IN_TESTS = "RPC is disabled in tests. Inject a client or reader dep to exercise on-chain behaviour.";

beforeEach(() => {
  setContractsClientForTests({
    getChainId: async () => {
      throw new Error(RPC_DISABLED_IN_TESTS);
    },
    readContract: async () => {
      throw new Error(RPC_DISABLED_IN_TESTS);
    },
  } as unknown as ContractsClientLike);
});
