import { randomUUID } from "node:crypto";
import type {
  ConsumeXOAuthRequestResult,
  SocialConnection,
  SocialConnectionsStore,
  SocialPlatform,
} from "@/lib/server/social-connections-store";

// In-memory SocialConnectionsStore for tests, mirroring
// tests/outreach-test-helpers.ts's createMemoryOutreachStore pattern:
// exercises the interface contract without needing a real Postgres
// instance, and is reused across the connections-store, scheduled-posts and
// posting-cron test suites.

export function createMemorySocialConnectionsStore(): SocialConnectionsStore {
  const connections = new Map<string, SocialConnection>();
  const credentials = new Map<string, string>();
  const oauthRequests = new Map<string, { walletAddress: string; requestSecret: string; expiresAt: Date; usedAt: Date | null }>();

  function key(walletAddress: string, platform: SocialPlatform): string {
    return `${walletAddress.toLowerCase()}:${platform}`;
  }

  return {
    async get(walletAddress, platform) {
      return connections.get(key(walletAddress, platform)) ?? null;
    },

    async list(walletAddress) {
      return [...connections.values()].filter((connection) => connection.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    },

    async upsert(input) {
      const mapKey = key(input.walletAddress, input.platform);
      const now = new Date().toISOString();
      const existing = connections.get(mapKey);
      const connection: SocialConnection = {
        id: existing?.id ?? randomUUID(),
        walletAddress: input.walletAddress,
        platform: input.platform,
        status: "connected",
        displayName: input.displayName,
        externalId: input.externalId,
        reconnectReason: null,
        failureCount: 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      connections.set(mapKey, connection);
      credentials.set(mapKey, input.credentials);
      return connection;
    },

    async getCredentials(walletAddress, platform) {
      const plaintext = credentials.get(key(walletAddress, platform));
      return plaintext !== undefined ? { status: "ok", plaintext } : { status: "not_found" };
    },

    async markReconnectNeeded(walletAddress, platform, reason) {
      const mapKey = key(walletAddress, platform);
      const existing = connections.get(mapKey);
      if (!existing) return;
      connections.set(mapKey, { ...existing, status: "reconnect_needed", reconnectReason: reason, updatedAt: new Date().toISOString() });
    },

    async recordFailure(walletAddress, platform, reason, threshold) {
      const mapKey = key(walletAddress, platform);
      const existing = connections.get(mapKey);
      if (!existing) return;
      const failureCount = existing.failureCount + 1;
      const reconnectNeeded = failureCount >= threshold;
      connections.set(mapKey, {
        ...existing,
        failureCount,
        status: reconnectNeeded ? "reconnect_needed" : existing.status,
        reconnectReason: reconnectNeeded ? reason : existing.reconnectReason,
        updatedAt: new Date().toISOString(),
      });
    },

    async resetFailures(walletAddress, platform) {
      const mapKey = key(walletAddress, platform);
      const existing = connections.get(mapKey);
      if (!existing) return;
      connections.set(mapKey, { ...existing, failureCount: 0, updatedAt: new Date().toISOString() });
    },

    async delete(walletAddress, platform) {
      const mapKey = key(walletAddress, platform);
      connections.delete(mapKey);
      credentials.delete(mapKey);
    },

    async createXOAuthRequest(input) {
      oauthRequests.set(input.requestToken, {
        walletAddress: input.walletAddress,
        requestSecret: input.requestSecret,
        expiresAt: input.expiresAt,
        usedAt: null,
      });
    },

    async consumeXOAuthRequest(requestToken, now = new Date()): Promise<ConsumeXOAuthRequestResult> {
      const record = oauthRequests.get(requestToken);
      if (!record) return { status: "not_found" };
      if (record.usedAt) return { status: "replayed" };
      if (record.expiresAt.getTime() <= now.getTime()) return { status: "expired" };
      record.usedAt = now;
      return { status: "ok", walletAddress: record.walletAddress, requestSecret: record.requestSecret };
    },
  };
}
