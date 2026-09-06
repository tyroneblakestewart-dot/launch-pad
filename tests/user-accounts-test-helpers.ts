import { randomUUID } from "node:crypto";
import type { UserAccount, UserAccountsStore } from "@/lib/server/user-accounts-store";

// In-memory UserAccountsStore for route/session tests (Google sign-in phase 1,
// 6 Sep 2026). Mirrors the Postgres store's contract: one account per
// google_sub, at most one account per wallet (case-insensitive), sessions
// cascade on delete, expired sessions read as absent.

type MemorySession = { hash: string; accountId: string; expiresAt: number };

export type MemoryUserAccountsStore = UserAccountsStore & {
  accounts: UserAccount[];
  sessions: MemorySession[];
  tablesPresent: boolean;
};

export function createMemoryUserAccountsStore(): MemoryUserAccountsStore {
  const accounts: UserAccount[] = [];
  const sessions: MemorySession[] = [];

  const store: MemoryUserAccountsStore = {
    accounts,
    sessions,
    tablesPresent: true,

    async upsertGoogleAccount(input, now = new Date()) {
      const iso = now.toISOString();
      const existing = accounts.find((account) => account.googleSub === input.googleSub);
      if (existing) {
        existing.email = input.email;
        existing.emailVerified = input.emailVerified;
        existing.displayName = input.displayName;
        existing.lastSignInAt = iso;
        existing.updatedAt = iso;
        return { ...existing };
      }
      const created: UserAccount = {
        id: randomUUID(),
        googleSub: input.googleSub,
        email: input.email,
        emailVerified: input.emailVerified,
        displayName: input.displayName,
        linkedWalletAddress: null,
        walletLinkedAt: null,
        lastSignInAt: iso,
        createdAt: iso,
        updatedAt: iso,
      };
      accounts.push(created);
      return { ...created };
    },

    async getById(accountId) {
      const found = accounts.find((account) => account.id === accountId);
      return found ? { ...found } : null;
    },

    async findByWallet(walletAddress) {
      const found = accounts.find((account) => account.linkedWalletAddress?.toLowerCase() === walletAddress.toLowerCase());
      return found ? { ...found } : null;
    },

    async linkWallet(accountId, walletAddress, now = new Date()) {
      const account = accounts.find((item) => item.id === accountId);
      if (!account) return { status: "account_not_found" };
      const taken = accounts.find(
        (item) => item.id !== accountId && item.linkedWalletAddress?.toLowerCase() === walletAddress.toLowerCase(),
      );
      if (taken) return { status: "wallet_taken" };
      account.linkedWalletAddress = walletAddress;
      account.walletLinkedAt = now.toISOString();
      account.updatedAt = now.toISOString();
      return { status: "linked", account: { ...account } };
    },

    async unlinkWallet(accountId) {
      const account = accounts.find((item) => item.id === accountId);
      if (!account) return;
      account.linkedWalletAddress = null;
      account.walletLinkedAt = null;
    },

    async deleteAccount(accountId) {
      const index = accounts.findIndex((item) => item.id === accountId);
      if (index >= 0) accounts.splice(index, 1);
      for (let i = sessions.length - 1; i >= 0; i -= 1) {
        if (sessions[i].accountId === accountId) sessions.splice(i, 1);
      }
    },

    async createSession(accountId, sessionTokenHash, expiresAt) {
      sessions.push({ hash: sessionTokenHash, accountId, expiresAt: expiresAt.getTime() });
    },

    async getSessionAccount(sessionTokenHash, now = new Date()) {
      const session = sessions.find((item) => item.hash === sessionTokenHash && item.expiresAt > now.getTime());
      if (!session) return null;
      const account = accounts.find((item) => item.id === session.accountId);
      return account ? { ...account } : null;
    },

    async destroySession(sessionTokenHash) {
      const index = sessions.findIndex((item) => item.hash === sessionTokenHash);
      if (index >= 0) sessions.splice(index, 1);
    },

    async destroyAccountSessions(accountId) {
      for (let i = sessions.length - 1; i >= 0; i -= 1) {
        if (sessions[i].accountId === accountId) sessions.splice(i, 1);
      }
    },

    async listForAdmin(limit) {
      return [...accounts]
        .sort((a, b) => b.lastSignInAt.localeCompare(a.lastSignInAt))
        .slice(0, limit)
        .map((account) => ({ ...account }));
    },

    async counts(now = new Date()) {
      const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      return {
        accounts: accounts.length,
        linked: accounts.filter((account) => account.linkedWalletAddress).length,
        signedIn7d: accounts.filter((account) => new Date(account.lastSignInAt).getTime() >= weekAgo).length,
      };
    },

    async tableExists() {
      return store.tablesPresent;
    },
  };

  return store;
}
