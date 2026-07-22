export type Eip1193Provider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
};

type BrowserWindow = Window & {
  ethereum?: Eip1193Provider;
  __launchpadEthereum?: Eip1193Provider;
};

/**
 * Returns the EVM wallet provider the user picked in the wallet selector
 * (see components/wallet-provider-selector.tsx), falling back to whatever
 * the browser injected as `window.ethereum` when nothing has been picked
 * yet. Every page that talks to an EVM wallet should read the provider
 * through this helper instead of `window.ethereum` directly, so the same
 * confirmed wallet (e.g. MetaMask vs Rabby) is used everywhere.
 */
export function getInjectedEvmProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as BrowserWindow;
  return browserWindow.__launchpadEthereum || browserWindow.ethereum || null;
}
