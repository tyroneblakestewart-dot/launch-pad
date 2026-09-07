/**
 * Pure helpers for the Account panel's wallet connect flow
 * (`components/account-wallet-bridge.tsx`). Kept out of the component so
 * they can be unit-tested in Node without a DOM.
 *
 * Why these exist (owner report, 7 Sep 2026, MetaMask mobile's in-app
 * browser): the bridge asked MetaMask for `wallet_requestPermissions` — which
 * succeeded, MetaMask showed its own "Permissions updated" toast — and then
 * immediately called `eth_requestAccounts` a second time. That second call
 * failed on mobile, and because MetaMask rejects with a plain object rather
 * than an `Error` instance, the bridge's `error instanceof Error` fallback
 * printed "Wallet account selection was cancelled." for a request nobody had
 * cancelled. The permission grant already names the chosen accounts, so the
 * second prompt is never needed, and a provider error is now described by
 * its real code/message.
 */

type PermissionCaveat = { type?: unknown; value?: unknown };
type PermissionGrant = { parentCapability?: unknown; caveats?: unknown };

function isHexAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Reads the accounts a wallet granted from a `wallet_requestPermissions`
 * result (EIP-2255): the `eth_accounts` capability's `restrictReturnedAccounts`
 * caveat carries the addresses the user picked. Returns [] for any other
 * shape, so callers fall back to asking the wallet directly.
 */
export function accountsFromPermissionGrant(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  for (const grant of result as PermissionGrant[]) {
    if (!grant || grant.parentCapability !== "eth_accounts" || !Array.isArray(grant.caveats)) continue;
    for (const caveat of grant.caveats as PermissionCaveat[]) {
      if (caveat?.type === "restrictReturnedAccounts" && Array.isArray(caveat.value)) {
        const accounts = caveat.value.filter(isHexAddress);
        if (accounts.length > 0) return accounts;
      }
    }
  }
  return [];
}

/** EIP-1193 user-rejected-request. */
export const USER_REJECTED_REQUEST_CODE = 4001;
/** MetaMask: a request of this kind is already open in the wallet. */
export const REQUEST_ALREADY_PENDING_CODE = -32002;

function readProviderError(error: unknown): { code?: number; message?: string } {
  if (typeof error !== "object" || error === null) {
    return typeof error === "string" && error.trim() ? { message: error.trim() } : {};
  }
  const record = error as { code?: unknown; message?: unknown; data?: unknown };
  const code = typeof record.code === "number" ? record.code : undefined;
  let message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message && typeof record.data === "object" && record.data !== null) {
    const nested = (record.data as { message?: unknown; originalError?: { message?: unknown } });
    if (typeof nested.message === "string") message = nested.message.trim();
    else if (typeof nested.originalError?.message === "string") message = nested.originalError.message.trim();
  }
  return { code, message: message || undefined };
}

/**
 * MetaMask mobile (owner recording, 7 Sep 2026): after the user picks an
 * account, the wallet's own CAIP-25 permission approval can reject itself —
 * "Invalid approved permissions request: endowment:caip25 error: Received
 * scopeString value(s): eip155:5042 for caveat of type "authorizedScopes"
 * that are not supported by the wallet." The chain in that scope is whatever
 * network the wallet is currently on (here 5042, not a Hoodlums chain), so the
 * cure is to move the wallet onto Robinhood Chain Testnet and ask again.
 * Returns the offending chain id when the message carries one.
 */
export function readPermissionScopeError(error: unknown): { scopeError: true; chainId: number | null } | null {
  const { message } = readProviderError(error);
  if (!message || !/caip25|scopeString|authorizedScopes/i.test(message)) return null;
  const match = /eip155:(\d+)/.exec(message);
  const chainId = match ? Number.parseInt(match[1], 10) : Number.NaN;
  return { scopeError: true, chainId: Number.isFinite(chainId) ? chainId : null };
}

/**
 * One plain sentence for the status line when a wallet connect attempt
 * fails. Wallets reject with plain objects as often as with `Error`s, so
 * this never depends on `instanceof Error`, and the wallet's own message is
 * always shown when it has one — "cancelled" is only ever claimed for a real
 * 4001 rejection.
 */
export function describeWalletConnectError(walletName: string, error: unknown): string {
  const { code, message } = readProviderError(error);
  if (code === USER_REJECTED_REQUEST_CODE) {
    return `${walletName} request was cancelled. Tap Connect again and approve it inside ${walletName}.`;
  }
  if (code === REQUEST_ALREADY_PENDING_CODE) {
    return `${walletName} already has a request open. Open the ${walletName} app, finish or dismiss it, then tap Connect again.`;
  }
  const scope = readPermissionScopeError(error);
  if (scope) {
    const network = scope.chainId !== null ? ` (chain ${scope.chainId})` : "";
    return `${walletName} could not approve this site on the network it is currently on${network}. In ${walletName}, switch to Robinhood Chain Testnet, then tap Connect again.`;
  }
  if (message) return `${walletName}: ${message}`;
  return `${walletName} did not complete the connection. Open the ${walletName} app, then tap Connect again.`;
}
