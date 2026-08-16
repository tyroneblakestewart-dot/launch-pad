import { monthBoundsUtc, type SocialXCostStore, type WalletMonthlyXCost } from "@/lib/server/social-x-cost-store";

// In-memory SocialXCostStore for tests, mirroring the other social-studio
// store test helpers (tests/social-connections-test-helpers.ts,
// tests/social-scheduled-posts-test-helpers.ts).

export function createMemorySocialXCostStore(): SocialXCostStore {
  const sends: { walletAddress: string; destinationId: string; costUsd: number; sentAt: Date }[] = [];

  return {
    async recordSend(walletAddress, destinationId, costUsd, now) {
      sends.push({ walletAddress, destinationId, costUsd, sentAt: now });
    },

    async monthlyTotalUsd(walletAddress, now) {
      const { start, end } = monthBoundsUtc(now);
      return sends
        .filter((send) => send.walletAddress.toLowerCase() === walletAddress.toLowerCase() && send.sentAt >= start && send.sentAt < end)
        .reduce((sum, send) => sum + send.costUsd, 0);
    },

    async monthlyTotalsAllWallets(now) {
      const { start, end } = monthBoundsUtc(now);
      const totals = new Map<string, WalletMonthlyXCost>();
      for (const send of sends) {
        if (send.sentAt < start || send.sentAt >= end) continue;
        const existing = totals.get(send.walletAddress) ?? { walletAddress: send.walletAddress, totalUsd: 0, sendCount: 0 };
        existing.totalUsd += send.costUsd;
        existing.sendCount += 1;
        totals.set(send.walletAddress, existing);
      }
      return [...totals.values()].sort((a, b) => b.totalUsd - a.totalUsd);
    },
  };
}
