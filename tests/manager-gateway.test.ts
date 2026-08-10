import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("useSubscriptionStatus hook", () => {
  it("checks the same server source of truth as the /social gate, never a client-only flag", async () => {
    const hook = await source("lib", "use-subscription-status.ts");
    const gate = await source("components", "subscription-access-gate.tsx");

    expect(hook).toContain("/api/subscriptions/status?wallet=");
    expect(hook).toContain('cache: "no-store"');
    expect(hook).toContain('state: "checking"');
    expect(hook).toContain('state: "disconnected"');
    expect(hook).toContain('state: "ready"');
    expect(hook).toContain('state: "unavailable"');
    expect(hook).not.toContain('localStorage.getItem("subscription")');

    // Same wallet source used by the /social gate, so a wallet connected on
    // either page is recognised consistently.
    const socialWalletSource = gate.match(/ACCOUNT_WALLET_STORAGE_KEY/g);
    expect(socialWalletSource).not.toBeNull();
    expect(hook).toContain("ACCOUNT_WALLET_STORAGE_KEY");
  });

  it("rechecks when the confirmed wallet reconnects or changes", async () => {
    const hook = await source("lib", "use-subscription-status.ts");
    expect(hook).toContain("ACCOUNT_WALLET_CHANGE_EVENT");
    expect(hook).toContain('window.addEventListener("storage", onStorage)');
    expect(hook).toContain("controller?.abort()");
  });
});

describe("ManagerGateway", () => {
  it("shows a neutral loading state before the server check resolves", async () => {
    const gateway = await source("components", "manager-gateway.tsx");
    expect(gateway).toContain('state === "checking"');
    expect(gateway).toContain("Checking your subscription…");
  });

  it("opens the Studio panel with plan name, active-until date and a lime CTA to /social for an active subscription", async () => {
    const gateway = await source("components", "manager-gateway.tsx");
    expect(gateway).toContain('state === "ready" && access !== null && access.active');
    expect(gateway).toContain("subscriptionPlanLabel(access.plan)");
    expect(gateway).toContain("Active until {formatDate(access.paidUntil)}");
    expect(gateway).toContain('href="/social"');
    expect(gateway).toContain("Open AI Social Studio");

    const css = await source("components", "manager-gateway.module.css");
    expect(css).toContain(".cta {");
    expect(css).toContain("background: #c6f53e;");
  });

  it("collapses the plan cards behind a View plans toggle instead of always showing them", async () => {
    const gateway = await source("components", "manager-gateway.tsx");
    expect(gateway).toContain("View plans");
    expect(gateway).toContain("Hide plans");
    expect(gateway).toContain("setPlansOpen");
    expect(gateway).toContain("plansOpen ? <ManagerPlansGrid /> : null");
  });

  it("falls back to the pricing cards exactly as today for no wallet, an inactive subscription, or an unavailable check", async () => {
    const gateway = await source("components", "manager-gateway.tsx");
    expect(gateway).toContain("import { ManagerPlans, ManagerPlansGrid } from \"./manager-plans\"");
    expect(gateway).toContain(
      "return <ManagerPlans headerEyebrow={headerEyebrow} headerTitle={headerTitle} headerIntro={headerIntro} />;",
    );
  });

  it("wires the CMS header props from ManagerPage through to both the plans view and the Studio panel state", async () => {
    const page = await source("app", "(app)", "manager", "page.tsx");
    const gateway = await source("components", "manager-gateway.tsx");

    expect(page).toContain("<ManagerGateway");
    expect(page).toContain("headerEyebrow={content.header_eyebrow}");
    expect(page).toContain("headerTitle={content.header_title}");
    expect(page).toContain("headerIntro={content.header_intro}");

    // Studio-panel branch renders the same CMS-sourced header as the plans view.
    expect(gateway).toContain("<p>{headerEyebrow}</p>");
    expect(gateway).toContain("<h1>{headerTitle}</h1>");
    expect(gateway).toContain("<span>{headerIntro}</span>");
  });
});

describe("ManagerPlansGrid extraction", () => {
  it("keeps the plan grid reusable without its own header or <main> landmark", async () => {
    const component = await source("components", "manager-plans.tsx");
    expect(component).toContain("export function ManagerPlansGrid()");
    expect(component).toContain("export function ManagerPlans({ headerEyebrow, headerTitle, headerIntro }: ManagerPlansProps)");
    expect(component).toContain("<ManagerPlansGrid />");
  });
});
