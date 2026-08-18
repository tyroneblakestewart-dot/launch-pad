import { randomUUID } from "node:crypto";
import {
  computeRolledUpPostStatus,
  SENDING_CLAIM_STALE_MS,
  type DueDestination,
  type SocialPostDestination,
  type SocialScheduledPost,
  type SocialScheduledPostsStore,
} from "@/lib/server/social-scheduled-posts-store";

// In-memory SocialScheduledPostsStore for tests — same rationale as
// tests/social-connections-test-helpers.ts. Reused by the scheduled-posts
// store tests, route tests and the posting-cron tests.

export function createMemorySocialScheduledPostsStore(): SocialScheduledPostsStore {
  const posts = new Map<string, SocialScheduledPost>();
  // Tracks when each destination was last claimed 'sending', mirroring the
  // Postgres store's updated_at-based staleness check (issue #377) — not
  // part of the exported SocialPostDestination shape.
  const sendingSince = new Map<string, number>();

  return {
    async create(input) {
      const now = new Date().toISOString();
      const postId = randomUUID();
      const destinations: SocialPostDestination[] = input.destinations.map((platform) => ({
        id: randomUUID(),
        scheduledPostId: postId,
        platform,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: input.scheduledAt.toISOString(),
        externalPostId: null,
        errorMessage: null,
        sentAt: null,
      }));
      const post: SocialScheduledPost = {
        id: postId,
        walletAddress: input.walletAddress,
        body: input.body,
        artworkDataUrl: input.artworkDataUrl,
        status: "scheduled",
        scheduledAt: input.scheduledAt.toISOString(),
        approvedByWallet: input.approvedByWallet,
        approvedAt: now,
        canceledAt: null,
        createdAt: now,
        updatedAt: now,
        destinations,
      };
      posts.set(post.id, post);
      return post;
    },

    async list(walletAddress) {
      return [...posts.values()]
        .filter((post) => post.walletAddress.toLowerCase() === walletAddress.toLowerCase())
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    async get(id) {
      return posts.get(id) ?? null;
    },

    async cancel(id, walletAddress) {
      const post = posts.get(id);
      if (!post || post.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return { status: "not_found" };
      if (post.status !== "scheduled") return { status: "not_cancelable" };
      posts.set(id, { ...post, status: "canceled", canceledAt: new Date().toISOString() });
      return { status: "canceled" };
    },

    async listDueDestinations(now, limit) {
      // Claims each due row synchronously before returning it (issue
      // #377), mirroring the Postgres store's single-statement
      // FOR UPDATE SKIP LOCKED claim: a destination flips 'pending' ->
      // 'sending' here, so any other caller — including one already
      // in-flight — sees it as no longer due. A row stuck 'sending' past
      // SENDING_CLAIM_STALE_MS is reclaimed, recovering a crashed run.
      const due: DueDestination[] = [];
      for (const post of posts.values()) {
        if (due.length >= limit) break;
        if (post.status !== "scheduled") continue;
        for (let index = 0; index < post.destinations.length; index++) {
          if (due.length >= limit) break;
          const destination = post.destinations[index];
          const stale = destination.status === "sending" && now.getTime() - (sendingSince.get(destination.id) ?? 0) >= SENDING_CLAIM_STALE_MS;
          if (destination.status !== "pending" && !stale) continue;
          if (new Date(destination.nextAttemptAt).getTime() > now.getTime()) continue;

          post.destinations[index] = { ...destination, status: "sending" };
          sendingSince.set(destination.id, now.getTime());
          due.push({
            destinationId: destination.id,
            scheduledPostId: post.id,
            platform: destination.platform,
            walletAddress: post.walletAddress,
            body: post.body,
            artworkDataUrl: post.artworkDataUrl,
            attemptCount: destination.attemptCount,
          });
        }
      }
      return due;
    },

    async markDestinationSent(destinationId, externalPostId, now) {
      for (const post of posts.values()) {
        const index = post.destinations.findIndex((d) => d.id === destinationId);
        if (index === -1) continue;
        post.destinations[index] = { ...post.destinations[index], status: "sent", externalPostId, errorMessage: null, sentAt: now.toISOString() };
      }
      sendingSince.delete(destinationId);
    },

    async markDestinationRetry(destinationId, errorMessage, nextAttemptAt) {
      for (const post of posts.values()) {
        const index = post.destinations.findIndex((d) => d.id === destinationId);
        if (index === -1) continue;
        const destination = post.destinations[index];
        post.destinations[index] = {
          ...destination,
          status: "pending",
          attemptCount: destination.attemptCount + 1,
          errorMessage,
          nextAttemptAt: nextAttemptAt.toISOString(),
        };
      }
      sendingSince.delete(destinationId);
    },

    async markDestinationFailedFinal(destinationId, errorMessage) {
      for (const post of posts.values()) {
        const index = post.destinations.findIndex((d) => d.id === destinationId);
        if (index === -1) continue;
        const destination = post.destinations[index];
        post.destinations[index] = { ...destination, status: "failed", attemptCount: destination.attemptCount + 1, errorMessage };
      }
      sendingSince.delete(destinationId);
    },

    async markDestinationNeedsComposer(destinationId, reason) {
      for (const post of posts.values()) {
        const index = post.destinations.findIndex((d) => d.id === destinationId);
        if (index === -1) continue;
        const destination = post.destinations[index];
        post.destinations[index] = { ...destination, status: "needs_composer", errorMessage: reason };
      }
      sendingSince.delete(destinationId);
    },

    async recomputePostStatus(scheduledPostId) {
      const post = posts.get(scheduledPostId);
      if (!post || post.status === "canceled") return;
      const nextStatus = computeRolledUpPostStatus(post.destinations.map((d) => d.status));
      if (!nextStatus) return;
      posts.set(scheduledPostId, { ...post, status: nextStatus });
    },
  };
}
