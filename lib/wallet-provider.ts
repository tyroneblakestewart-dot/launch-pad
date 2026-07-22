export type Eip1193Provider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type BrowserWindow = Window & {
  ethereum?: Eip1193Provider;
  __launchpadEthereum?: Eip1193Provider;
};

/**
 * Returns the single EVM provider every page should use to connect and sign.
 *
 * `WalletProviderSelector` records the wallet the user explicitly confirmed
 * (e.g. Rabby over MetaMask when both are installed) on `window.__launchpadEthereum`.
 * It also patches `window.ethereum` to point at that same provider where the
 * browser allows it, but some extensions expose a non-configurable
 * `window.ethereum` that can't be patched — so `__launchpadEthereum` must be
 * checked first everywhere a page talks to a wallet, not just `window.ethereum`.
 */
export function getInjectedEvmProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const browserWindow = window as BrowserWindow;
  return browserWindow.__launchpadEthereum || browserWindow.ethereum;
}
