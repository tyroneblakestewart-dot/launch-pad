// Idempotent-approval detection for the Social Studio posting queue (issue
// #380): a repeated approval of the same still-pending draft — a retry after
// a lost response, an impatient re-tap — must not create a second row that
// sends independently. Deliberately application-level rather than a new DB
// unique constraint: the client already creates one social_scheduled_posts
// row per destination, so a correct constraint would need `platform` on that
// table, which is a schema change to lib/server/social-scheduled-posts-store.ts
// — a file this fix is not allowed to touch (see the issue). This is pure and
// DB-free so it's unit-testable without a store double.

export type ExistingPostForDuplicateCheck = {
  id: string;
  status: string;
  body: string;
  createdAt: string;
  destinations: Array<{ platform: string }>;
};

/**
 * How recent an existing "scheduled" post must be to count as an accidental
 * repeat of this approval rather than a deliberate new send of similar copy.
 * Long enough to absorb a retried request or a few impatient re-taps; short
 * enough that re-sending the same template text a day later is never blocked.
 */
export const DUPLICATE_APPROVAL_WINDOW_MS = 15 * 60 * 1000;

/**
 * Finds an already-`scheduled` post with the exact same body and destination
 * set, created within `windowMs` of `nowMs`. Returns null when nothing
 * matches, in which case the caller should create a new post as normal.
 */
export function findDuplicateScheduledPost(
  existingPosts: ExistingPostForDuplicateCheck[],
  input: { body: string; destinations: string[] },
  nowMs: number,
  windowMs: number = DUPLICATE_APPROVAL_WINDOW_MS,
): ExistingPostForDuplicateCheck | null {
  const wantedDestinations = [...input.destinations].sort().join(",");
  for (const post of existingPosts) {
    if (post.status !== "scheduled") continue;
    if (post.body !== input.body) continue;
    const postDestinations = post.destinations
      .map((destination) => destination.platform)
      .sort()
      .join(",");
    if (postDestinations !== wantedDestinations) continue;
    const ageMs = nowMs - new Date(post.createdAt).getTime();
    if (ageMs >= 0 && ageMs < windowMs) return post;
  }
  return null;
}
