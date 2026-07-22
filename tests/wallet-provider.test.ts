import { afterEach, describe, expect, it } from "vitest";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";

function setWindow(value: unknown) {
  (globalThis as Record<string, unknown>).window = value;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("getInjectedEvmProvider", () => {
  it("is SSR-safe and returns undefined when there is no window", () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(getInjectedEvmProvider()).toBeUndefined();
  });

  it("prefers the wallet confirmed in the EIP-6963 selector over window.ethereum", () => {
    const confirmed = { request: async () => "confirmed" };
    const injected = { request: async () => "injected" };
    setWindow({ __launchpadEthereum: confirmed, ethereum: injected });

    expect(getInjectedEvmProvider()).toBe(confirmed);
  });

  it("falls back to window.ethereum when no wallet has been confirmed", () => {
    const injected = { request: async () => "injected" };
    setWindow({ ethereum: injected });

    expect(getInjectedEvmProvider()).toBe(injected);
  });

  it("returns undefined when neither a confirmed wallet nor an injected provider exists", () => {
    setWindow({});
    expect(getInjectedEvmProvider()).toBeUndefined();
  });
});
