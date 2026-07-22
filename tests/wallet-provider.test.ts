import { afterEach, describe, expect, it, vi } from "vitest";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getInjectedEvmProvider", () => {
  it("returns null when there is no browser window (server-side rendering)", () => {
    expect(getInjectedEvmProvider()).toBeNull();
  });

  it("returns null when no wallet has been injected or selected", () => {
    vi.stubGlobal("window", {});
    expect(getInjectedEvmProvider()).toBeNull();
  });

  it("prefers the user's confirmed wallet-selector choice over the raw injected provider", () => {
    const selected = { request: vi.fn(), name: "selected" };
    const injected = { request: vi.fn(), name: "injected" };
    vi.stubGlobal("window", { ethereum: injected, __launchpadEthereum: selected });

    expect(getInjectedEvmProvider()).toBe(selected);
  });

  it("falls back to window.ethereum when no wallet has been selected yet", () => {
    const injected = { request: vi.fn() };
    vi.stubGlobal("window", { ethereum: injected });

    expect(getInjectedEvmProvider()).toBe(injected);
  });
});
