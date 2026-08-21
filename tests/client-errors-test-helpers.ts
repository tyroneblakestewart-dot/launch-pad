import {
  ClientErrorStoreUnavailableError,
  type ClientErrorGroup,
  type ClientErrorInput,
  type ClientErrorStore,
  type ClientErrorsSnapshot,
  type ResolveGroupResult,
} from "@/lib/server/client-errors-store";

type Occurrence = ClientErrorInput & { createdAt: Date };

function groupKey(message: string, routePath: string): string {
  return `${message}::${routePath}`;
}

/**
 * In-JS mirror of createPostgresClientErrorStore's grouping/resolution SQL —
 * used to test the grouping and "resolved until a fresh occurrence lands"
 * semantics without a real Postgres instance, same pattern as the rest of
 * this codebase's store test doubles.
 */
export class MemoryClientErrorStore implements ClientErrorStore {
  readonly occurrences: Occurrence[] = [];
  private readonly resolutions = new Map<string, Date>();

  async recordError(input: ClientErrorInput): Promise<void> {
    this.occurrences.push({ ...input, createdAt: new Date() });
  }

  async listGroups(limit = 100): Promise<ClientErrorsSnapshot> {
    const grouped = new Map<string, Occurrence[]>();
    for (const occurrence of this.occurrences) {
      const key = groupKey(occurrence.message, occurrence.routePath);
      const existing = grouped.get(key);
      if (existing) existing.push(occurrence);
      else grouped.set(key, [occurrence]);
    }

    const groups: ClientErrorGroup[] = [];
    for (const [key, occurrences] of grouped) {
      const sorted = [...occurrences].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const firstSeen = sorted[0]!.createdAt;
      const lastSeen = sorted[sorted.length - 1]!.createdAt;
      const resolvedAt = this.resolutions.get(key);
      if (resolvedAt && lastSeen.getTime() <= resolvedAt.getTime()) continue;

      const representative = sorted[sorted.length - 1]!;
      const distinctWallets = new Set(sorted.map((o) => o.walletAddress).filter((address): address is string => Boolean(address)));
      groups.push({
        message: representative.message,
        routePath: representative.routePath,
        occurrenceCount: sorted.length,
        firstSeen: firstSeen.toISOString(),
        lastSeen: lastSeen.toISOString(),
        distinctWallets: distinctWallets.size,
        representativeStack: representative.stack,
        buildId: representative.buildId,
      });
    }

    groups.sort((a, b) => b.occurrenceCount - a.occurrenceCount || new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    return { status: "ready", message: "ok", groups: groups.slice(0, limit) };
  }

  async resolveGroup(message: string, routePath: string): Promise<ResolveGroupResult> {
    const exists = this.occurrences.some((o) => o.message === message && o.routePath === routePath);
    if (!exists) return "not_found";
    this.resolutions.set(groupKey(message, routePath), new Date());
    return "resolved";
  }

  async countNewGroupsSince(since: Date): Promise<number> {
    const firstSeenByGroup = new Map<string, Date>();
    for (const occurrence of this.occurrences) {
      const key = groupKey(occurrence.message, occurrence.routePath);
      const existing = firstSeenByGroup.get(key);
      if (!existing || occurrence.createdAt.getTime() < existing.getTime()) {
        firstSeenByGroup.set(key, occurrence.createdAt);
      }
    }
    return [...firstSeenByGroup.values()].filter((firstSeen) => firstSeen.getTime() >= since.getTime()).length;
  }

  async countRecentForWallet(walletAddress: string, since: Date): Promise<number> {
    return this.occurrences.filter(
      (occurrence) =>
        (occurrence.walletAddress || "").toLowerCase() === walletAddress.toLowerCase() &&
        occurrence.createdAt.getTime() >= since.getTime(),
    ).length;
  }
}

export class UnavailableClientErrorStore implements ClientErrorStore {
  async recordError(): Promise<void> {
    throw new ClientErrorStoreUnavailableError();
  }
  async listGroups(): Promise<ClientErrorsSnapshot> {
    return { status: "unavailable", message: "unavailable", groups: [] };
  }
  async resolveGroup(): Promise<ResolveGroupResult> {
    throw new ClientErrorStoreUnavailableError();
  }
  async countNewGroupsSince(): Promise<number> {
    return 0;
  }
  async countRecentForWallet(): Promise<number> {
    return 0;
  }
}
