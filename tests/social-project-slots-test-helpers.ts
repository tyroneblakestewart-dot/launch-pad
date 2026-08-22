import { randomUUID } from "node:crypto";
import type {
  EnsureSocialProjectSlotInput,
  EnsureSocialProjectSlotResult,
  ReleaseSocialProjectSlotByAdminInput,
  ReleaseSocialProjectSlotByAdminResult,
  ReleaseSocialProjectSlotByUserInput,
  ReleaseSocialProjectSlotResult,
  SocialProjectSlot,
  SocialProjectSlotsStore,
} from "@/lib/server/social-project-slots-store";

// In-memory SocialProjectSlotsStore for tests, mirroring
// tests/social-connections-test-helpers.ts's createMemorySocialConnectionsStore
// pattern: exercises the interface contract (including the seven-day user
// release cooldown) without needing a real Postgres instance.

const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

type StoredSlot = SocialProjectSlot & { releasedAt: string | null; releasedBy: "user" | "admin" | null };

function publicSlot(stored: StoredSlot): SocialProjectSlot {
  return { id: stored.id, walletAddress: stored.walletAddress, projectId: stored.projectId, displayName: stored.displayName, registeredAt: stored.registeredAt };
}

export function createMemorySocialProjectSlotsStore(): SocialProjectSlotsStore {
  const slots: StoredSlot[] = [];

  function activeSlotsFor(walletAddress: string): StoredSlot[] {
    return slots.filter((slot) => slot.walletAddress.toLowerCase() === walletAddress.toLowerCase() && slot.releasedAt === null);
  }

  function lastUserRelease(walletAddress: string): StoredSlot | null {
    const releases = slots
      .filter((slot) => slot.walletAddress.toLowerCase() === walletAddress.toLowerCase() && slot.releasedBy === "user" && slot.releasedAt)
      .sort((a, b) => new Date(b.releasedAt!).getTime() - new Date(a.releasedAt!).getTime());
    return releases[0] ?? null;
  }

  return {
    async listActive(walletAddress: string): Promise<SocialProjectSlot[]> {
      return activeSlotsFor(walletAddress).map(publicSlot);
    },

    async ensureSlot(input: EnsureSocialProjectSlotInput): Promise<EnsureSocialProjectSlotResult> {
      const active = activeSlotsFor(input.walletAddress);
      const existing = active.find((slot) => slot.projectId === input.projectId);
      if (existing) {
        return { status: "existing", slot: publicSlot(existing), activeCount: active.length, limit: input.limit };
      }
      if (active.length >= input.limit) {
        return {
          status: "limit_reached",
          activeCount: active.length,
          limit: input.limit,
          slots: active.map(publicSlot),
        };
      }
      const created: StoredSlot = {
        id: randomUUID(),
        walletAddress: input.walletAddress,
        projectId: input.projectId,
        displayName: input.displayName,
        registeredAt: new Date().toISOString(),
        releasedAt: null,
        releasedBy: null,
      };
      slots.push(created);
      return { status: "registered", slot: publicSlot(created), activeCount: active.length + 1, limit: input.limit };
    },

    async releaseByUser(input: ReleaseSocialProjectSlotByUserInput): Promise<ReleaseSocialProjectSlotResult> {
      const now = input.now ?? new Date();
      const lastRelease = lastUserRelease(input.walletAddress);
      if (lastRelease?.releasedAt) {
        const nextAllowed = new Date(new Date(lastRelease.releasedAt).getTime() + SEVEN_DAY_MS);
        if (nextAllowed.getTime() > now.getTime()) {
          return { status: "cooldown", nextReleaseAllowedAt: nextAllowed.toISOString() };
        }
      }
      const slot = activeSlotsFor(input.walletAddress).find((entry) => entry.projectId === input.projectId);
      if (!slot) return { status: "not_found" };
      slot.releasedAt = now.toISOString();
      slot.releasedBy = "user";
      return {
        status: "ok",
        releasedAt: slot.releasedAt,
        nextReleaseAllowedAt: new Date(now.getTime() + SEVEN_DAY_MS).toISOString(),
      };
    },

    async releaseByAdmin(input: ReleaseSocialProjectSlotByAdminInput): Promise<ReleaseSocialProjectSlotByAdminResult> {
      const now = input.now ?? new Date();
      const slot = activeSlotsFor(input.walletAddress).find((entry) => entry.projectId === input.projectId);
      if (!slot) return { status: "not_found" };
      slot.releasedAt = now.toISOString();
      slot.releasedBy = "admin";
      return { status: "ok", releasedAt: slot.releasedAt };
    },
  };
}
