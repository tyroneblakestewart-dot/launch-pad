import { randomUUID } from "node:crypto";
import {
  ADMIN_NONCE_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  type AdminChallenge,
} from "@/lib/server/admin-auth";

type AdminSessionRecord = { expiresAt: number };

type GlobalWithAdminStores = typeof globalThis & {
  __hoodlumsAdminChallengeStore?: Map<string, AdminChallenge>;
  __hoodlumsAdminSessionStore?: Map<string, AdminSessionRecord>;
};

/**
 * Admin login state is process-local (mirrors the in-memory rate-limit maps
 * in lib/server/api-protection.ts): a single owner signs in occasionally, so
 * losing sessions/challenges on a cold start just means signing in again —
 * no Postgres dependency is needed for this.
 */
function challengeStore(): Map<string, AdminChallenge> {
  const globalScope = globalThis as GlobalWithAdminStores;
  if (!globalScope.__hoodlumsAdminChallengeStore) {
    globalScope.__hoodlumsAdminChallengeStore = new Map();
  }
  return globalScope.__hoodlumsAdminChallengeStore;
}

function sessionStore(): Map<string, AdminSessionRecord> {
  const globalScope = globalThis as GlobalWithAdminStores;
  if (!globalScope.__hoodlumsAdminSessionStore) {
    globalScope.__hoodlumsAdminSessionStore = new Map();
  }
  return globalScope.__hoodlumsAdminSessionStore;
}

function pruneExpiredChallenges(now: number): void {
  for (const [id, challenge] of challengeStore()) {
    if (challenge.expiresAt.getTime() <= now) challengeStore().delete(id);
  }
}

export function createAdminChallenge(
  walletAddress: string,
  nonceHash: string,
  now = new Date(),
): AdminChallenge {
  pruneExpiredChallenges(now.getTime());
  const challenge: AdminChallenge = {
    id: randomUUID(),
    nonceHash,
    walletAddress,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ADMIN_NONCE_TTL_MS),
    usedAt: null,
  };
  challengeStore().set(challenge.id, challenge);
  return challenge;
}

export function getAdminChallenge(challengeId: string): AdminChallenge | null {
  return challengeStore().get(challengeId) || null;
}

export function markAdminChallengeUsed(challengeId: string, now = new Date()): void {
  const challenge = challengeStore().get(challengeId);
  if (challenge) challenge.usedAt = now;
}

function pruneExpiredSessions(now: number): void {
  for (const [hash, record] of sessionStore()) {
    if (record.expiresAt <= now) sessionStore().delete(hash);
  }
}

export function createAdminSession(sessionTokenHash: string, now = Date.now()): Date {
  pruneExpiredSessions(now);
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  sessionStore().set(sessionTokenHash, { expiresAt });
  return new Date(expiresAt);
}

export function isAdminSessionValid(sessionTokenHash: string, now = Date.now()): boolean {
  const record = sessionStore().get(sessionTokenHash);
  if (!record) return false;
  if (record.expiresAt <= now) {
    sessionStore().delete(sessionTokenHash);
    return false;
  }
  return true;
}

export function destroyAdminSession(sessionTokenHash: string): void {
  sessionStore().delete(sessionTokenHash);
}

export function resetAdminStoresForTests(): void {
  challengeStore().clear();
  sessionStore().clear();
}
