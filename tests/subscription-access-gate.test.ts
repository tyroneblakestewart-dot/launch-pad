import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { subscriptionGateStateFromServer } from "@/lib/subscription-access-gate";
import type { SubscriptionAccess } from "@/lib/subscription-lifecycle";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

const ACTIVE_ACCESS: SubscriptionAccess = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  plan: "pro",
  status: "active",
  active: true,
  accessSource: "paid",
  paidFrom: "2026-08-01T00:00:00.000Z",
  paidUntil: "2026-09-02T00:00:00.000Z",
  daysRemaining: 23,
  telegramLinked: false,
};

describe("server-derived subscription gate", () => {
  it("keeps an active subscription unlocked after a full page load", async () => {
    expect(subscriptionGateStateFromServer(ACTIVE_ACCESS)).toBe("unlocked");

    const page = await source("app", "(app)", "social", "page.tsx");
    const gate = await source("components", "subscription-access-gate.tsx");

    expect(page).toContain("<SubscriptionAccessGate>");
    expect(page).toContain("<SocialHub />");
    expect(gate).toContain('state: "checking"');
    expect(gate).toContain("/api/subscriptions/status?wallet=");
    expect(gate).toContain('cache: "no-store"');
    expect(gate).toContain("subscriptionGateStateFromServer(access)");
  });

  it("shows the paywall only after a successful server response says access is inactive", async () => {
    expect(subscriptionGateStateFromServer({
      ...ACTIVE_ACCESS,
      status: "expired",
      active: false,
      daysRemaining: 0,
    })).toBe("paywall");

    const gate = await source("components", "subscription-access-gate.tsx");
    expect(gate).toContain('state: "unavailable"');
    expect(gate).toContain('state: "disconnected"');
    expect(gate).toContain('view.state === "paywall"');
    expect(gate).toContain("The paywall has not been shown because the server did not return");
    expect(gate).not.toContain('localStorage.getItem("subscription")');
  });

  it("rechecks when the confirmed wallet reconnects or changes", async () => {
    const gate = await source("components", "subscription-access-gate.tsx");
    expect(gate).toContain("ACCOUNT_WALLET_CHANGE_EVENT");
    expect(gate).toContain('window.addEventListener("storage", onStorage)');
    expect(gate).toContain("controller?.abort()");
    expect(gate).toContain("Checking subscription…");
  });
});
