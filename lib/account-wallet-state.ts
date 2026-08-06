export const ACCOUNT_WALLET_STORAGE_KEY = "hoodlums.account.wallet";
export const ACCOUNT_WALLET_CHANGE_EVENT = "hoodlums:account-wallet-change";

export type StoredAccountWallet = {
  walletName: string;
  account: string;
};

export function parseStoredAccountWallet(raw: string | null): StoredAccountWallet | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Partial<StoredAccountWallet>;
    if (
      typeof candidate.walletName !== "string" ||
      !candidate.walletName.trim() ||
      typeof candidate.account !== "string" ||
      !candidate.account.trim()
    ) {
      return null;
    }

    return {
      walletName: candidate.walletName,
      account: candidate.account,
    };
  } catch {
    return null;
  }
}

export function truncateAccountAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}
