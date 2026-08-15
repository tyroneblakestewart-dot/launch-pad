import { randomUUID } from "node:crypto";
import type {
  DueDestination,
  SocialPostDestination,
  SocialPostStatus,
  SocialScheduledPost,
  SocialScheduledPostsStore,
} from "@/lib/server/social-scheduled-posts-store";

// In-memory SocialScheduledPostsStore for tests — same rationale as
// tests/social-connections-test-helpers.ts. Reused by the scheduled-posts
// store tests, route tests and the posting-cron tests.

export function createMemorySocialScheduledPostsStore(): SocialScheduledPostsStore {
  const posts = new Map<string, SocialScheduledPost>();

  function recompute(status: SocialPostStatus, destinations: SocialPostDestination[]): SocialPostStatus {
    if (destinations.some((d) => d.status === "pending")) return status;
    const allSent = destinations.every((d) => d.status === "sent");
    const allFailed = destinations.every((d) => d.status === "failed");
    return allSent ? "sent" : allFailed ? "failed" : "partially_sent";
  }

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
      const due: DueDestination[] = [];
      for (const post of posts.values()) {
        if (post.status !== "scheduled") continue;
        for (const destination of post.destinations) {
          if (destination.status !== "pending") continue;
          if (new Date(destination.nextAttemptAt).getTime() > now.getTime()) continue;
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
      return due.slice(0, limit);
    },

    async markDestinationSent(destinationId, externalPostId, now) {
      for (const post of posts.values()) {
        const index = post.destinations.findIndex((d) => d.id === destinationId);
        if (index === -1) continue;
        post.destinations[index] = { ...post.destinations[index], status: "sent", externalPostId, errorMessage: null, sentAt: now.toISOString() };
      }
    },

    async markDestinationRetry(destinationId, errorMessage, nextAttemptAt) {
      for (const post of posts.values()) {
        const index = post.destinations.findIndex((d) => d.id === destinationId);
        if (index === -1) continue;
        const destination = post.destinations[index];
        post.destinations[index] = {
          ...destination,
          attemptCount: destination.attemptCount + 1,
          errorMessage,
          nextAttemptAt: nextAttemptAt.toISOString(),
        };
      }
    },

    async markDestinationFailedFinal(destinationId, errorMessage) {
      for (const post of posts.values()) {
        const index = post.destinations.findIndex((d) => d.id === destinationId);
        if (index === -1) continue;
        const destination = post.destinations[index];
        post.destinations[index] = { ...destination, status: "failed", attemptCount: destination.attemptCount + 1, errorMessage };
      }
    },

    async recomputePostStatus(scheduledPostId) {
      const post = posts.get(scheduledPostId);
      if (!post || post.status === "canceled") return;
      posts.set(scheduledPostId, { ...post, status: recompute(post.status, post.destinations) });
    },
  };
}
