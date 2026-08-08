import { describe, expect, it } from "vitest";
import {
  getPlanPaymentOriginDecision,
  isPlanPaymentOriginAllowed,
} from "@/lib/server/plan-payment-origin";

function request(url: string, origin: string) {
  return new Request(url, {
    method: "POST",
    headers: { origin },
  });
}

describe("plan payment origin policy", () => {
  it("allows the production same-origin host for both sending and verification", () => {
    const environment = {
      VERCEL_ENV: "production",
      HOODLUMS_APP_ORIGIN: "https://hoodlums.dev",
    };
    const req = request("https://hoodlums.dev/api/plan-payments/preflight", "https://hoodlums.dev");

    expect(isPlanPaymentOriginAllowed(req, "send", environment)).toBe(true);
    expect(isPlanPaymentOriginAllowed(req, "verify", environment)).toBe(true);
  });

  it("blocks real payment sends from Vercel previews by default before funds can move", () => {
    const origin = "https://launch-pad-example.vercel.app";
    const environment = {
      VERCEL_ENV: "preview",
      VERCEL_URL: "launch-pad-example.vercel.app",
      VERCEL_BRANCH_URL: "launch-pad-git-fix-example.vercel.app",
      HOODLUMS_APP_ORIGIN: "https://hoodlums.dev",
    };
    const decision = getPlanPaymentOriginDecision(
      request(`${origin}/api/plan-payments/preflight`, origin),
      "send",
      environment,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Real payments are disabled on Vercel previews");
    expect(decision.reason).toContain("Existing transaction hashes can still be recovered");
  });

  it("allows same-preview verification so an already-paid transaction can be recovered", () => {
    const origin = "https://launch-pad-example.vercel.app";
    const environment = {
      VERCEL_ENV: "preview",
      VERCEL_URL: "launch-pad-example.vercel.app",
      HOODLUMS_APP_ORIGIN: "https://hoodlums.dev",
    };

    expect(
      isPlanPaymentOriginAllowed(
        request(`${origin}/api/plan-payments/verify`, origin),
        "verify",
        environment,
      ),
    ).toBe(true);
  });

  it("allows preview payment sends only with an explicit opt-in", () => {
    const origin = "https://launch-pad-example.vercel.app";
    const environment = {
      VERCEL_ENV: "preview",
      VERCEL_URL: "launch-pad-example.vercel.app",
      HOODLUMS_APP_ORIGIN: "https://hoodlums.dev",
      HOODLUMS_PAYMENT_ALLOW_VERCEL_PREVIEWS: "true",
    };

    expect(
      isPlanPaymentOriginAllowed(
        request(`${origin}/api/plan-payments/preflight`, origin),
        "send",
        environment,
      ),
    ).toBe(true);
  });

  it("supports explicitly configured additional payment origins", () => {
    const origin = "https://payments.hoodlums.dev";
    const environment = {
      VERCEL_ENV: "production",
      HOODLUMS_APP_ORIGIN: "https://hoodlums.dev",
      HOODLUMS_PAYMENT_ALLOWED_ORIGINS:
        "https://payments.hoodlums.dev, https://other.hoodlums.dev",
    };

    expect(
      isPlanPaymentOriginAllowed(
        request("https://hoodlums.dev/api/plan-payments/verify", origin),
        "verify",
        environment,
      ),
    ).toBe(true);
  });

  it("rejects arbitrary cross-origin callers", () => {
    const environment = {
      VERCEL_ENV: "production",
      HOODLUMS_APP_ORIGIN: "https://hoodlums.dev",
    };

    expect(
      isPlanPaymentOriginAllowed(
        request("https://hoodlums.dev/api/plan-payments/verify", "https://evil.example"),
        "verify",
        environment,
      ),
    ).toBe(false);
  });
});
