import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Admin Test access section", () => {
  it("registers a dedicated dashboard tab and renders the allowlist manager", async () => {
    const dashboard = await source("components", "admin-dashboard.tsx");
    expect(dashboard).toContain(
      'import { AdminTestAccessSection } from "@/components/admin-test-access-section"',
    );
    expect(dashboard).toContain('{ id: "test-access", label: "Test access" }');
    expect(dashboard).toContain(
      'activeSection === "test-access" ? <AdminTestAccessSection /> : null',
    );
  });

  it("shows TEST badges, active and revoked audit rows, and honest no-payment copy", async () => {
    const component = await source(
      "components",
      "admin-test-access-section.tsx",
    );
    expect(component).toContain("Wallet test access");
    expect(component).toContain("className={styles.testBadge}>TEST</span>");
    expect(component).toContain("Active TEST wallets");
    expect(component).toContain("Revoked audit rows");
    expect(component).toContain("no payment or revenue recorded");
    expect(component).toContain('fetch("/api/admin/test-access"');
    expect(component).toContain('method: "POST"');
    expect(component).toContain('method: "PATCH"');
    expect(component).toContain("getAddress(value.trim()).toLowerCase()");
    expect(component).not.toContain("NEXT_PUBLIC_");
    expect(component).not.toContain("private key");
    expect(component).not.toContain("seed phrase");
  });

  it("shows a DISABLED banner with a one-tap toggle wired to the shared service-isolation endpoint", async () => {
    const component = await source(
      "components",
      "admin-test-access-section.tsx",
    );
    expect(component).toContain('"DISABLED"');
    expect(component).toContain('"HARD-DISABLED · ENVIRONMENT"');
    expect(component).toContain('serviceKey: "test-access"');
    expect(component).toContain('fetch("/api/admin/operations"');
    expect(component).toContain("Disable test access");
    expect(component).toContain("Enable test access");
    // Hard-disabled is environment-only: no toggle is rendered for it.
    expect(component).toContain("!data.killSwitch.hardDisabled && data.killSwitch.available");
  });

  it("labels allowlisted Manager and published-site access as TEST rather than paid", async () => {
    const manager = await source("components", "manager-gateway.tsx");
    const domains = await source(
      "components",
      "admin-site-domains-section.tsx",
    );

    expect(manager).toContain('access.accessSource === "test-allowlist"');
    expect(manager).toContain("TEST ACCESS · ADMIN ALLOWLIST");
    expect(manager).toContain("no payment or revenue recorded");
    expect(domains).toContain('tier === "test_access"');
    expect(domains).toContain("TEST · admin allowlist");
  });

  it("skips paid-plan checkout only after the existing server status response confirms TEST access", async () => {
    const chooser = await source("components", "token-path-chooser.tsx");
    const testGateStart = chooser.indexOf("const access = subscription.access;");
    const testGateEnd = chooser.indexOf("useEffect(() => {", testGateStart + 1);
    const testGate = chooser.slice(testGateStart, testGateEnd);

    expect(chooser).toContain("useSubscriptionStatus()");
    expect(testGate).toContain('subscription.state !== "ready"');
    expect(testGate).toContain("!access?.active");
    expect(testGate).toContain('access.accessSource !== "test-allowlist"');
    expect(testGate).toContain("onConfirm(testPlan)");
    expect(testGate.indexOf('access.accessSource !== "test-allowlist"')).toBeLessThan(
      testGate.indexOf("onConfirm(testPlan)"),
    );

    // The real-payment route remains separate and still requires the
    // verified-payment unlock guard; TEST access never fabricates its payload.
    expect(chooser).toContain("builderUnlockGuard.current.consume(");
    expect(chooser).toContain("verification");
    expect(testGate).not.toContain("PlanPaymentVerification");
    expect(testGate).not.toContain("payment_tx_hash");
  });

  it("adds the allowlist and its kill switch to the existing Subscribers System Health pipeline", async () => {
    const route = await source(
      "app",
      "api",
      "admin",
      "health",
      "pipeline",
      "route.ts",
    );
    expect(route).toContain("buildTestAccessHealthStage");
    expect(route).toContain("buildTestAccessKillSwitchStage");
    expect(route).toContain("subdomainRouting, testAccessKillSwitch, testAccess");
    expect(route).toContain("testAccessKillSwitch,");
    expect(route).toContain("testAccess,");
  });

  it("reports the kill switch as three distinct System Health states", async () => {
    const testAccessSource = await source("lib", "server", "test-access.ts");
    expect(testAccessSource).toContain("buildTestAccessKillSwitchStage");
    expect(testAccessSource).toContain("test-access-kill-switch");
    expect(testAccessSource).toContain("Hard-disabled via TEST_ACCESS_HARD_DISABLED=true");
    expect(testAccessSource).toContain("Disabled by an administrator");
    expect(testAccessSource).toContain(
      "Enabled. Allowlisted wallets receive test access on the next entitlement check.",
    );
  });
});
