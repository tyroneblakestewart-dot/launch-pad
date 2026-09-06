// AI images on approved posts (owner decision, 6 Sep 2026): the AI picks the
// posts most worth an image and makes one — matched to the post — at the
// moment the user approves. Pure, client-safe maths shared by the Queue tab
// and its tests. The budget is the existing daily AI-image allowance
// (lib/mascot-image-allowance.ts, two per token per UTC day), shared with
// manual mascot scenes; the server enforces it, this only reads it.

import type { MascotImageUsage } from "@/lib/mascot-image-allowance";
import type { QueueItem } from "@/lib/social-studio-types";

/**
 * How much an image is likely to add, by the draft's angle
 * (lib/server/social-draft-pipeline.ts DRAFT_ANGLES). Not random, per the
 * owner's ruling: a scene-shaped post (culture, milestone, behind the scenes)
 * outranks a question, and a one-liner needs no picture. Unknown or manual
 * drafts rank lowest.
 */
export const POST_IMAGE_VISUAL_RANK: Readonly<Record<string, number>> = {
  "culture-observation": 3,
  milestone: 3,
  "behind-the-scenes": 3,
  "holder-shoutout": 2,
  "community-question": 2,
  "one-liner": 1,
};

export const DEFAULT_POST_IMAGE_RANK = 1;

export function postImageVisualRank(angleKey: string | null | undefined): number {
  if (!angleKey) return DEFAULT_POST_IMAGE_RANK;
  return POST_IMAGE_VISUAL_RANK[angleKey] ?? DEFAULT_POST_IMAGE_RANK;
}

/** A draft can carry an AI image when it has text, no artwork yet, and the user hasn't said "no image" for it. */
export function isPostImageEligible(item: Pick<QueueItem, "xText" | "telegramText" | "artwork" | "imageDeclined">): boolean {
  if (item.artwork) return false;
  if (item.imageDeclined) return false;
  return Boolean(item.xText.trim() || item.telegramText.trim());
}

/** Images still available today — 0 until the server has answered, so nothing is promised on a guess. */
export function remainingAiImagesToday(usage: MascotImageUsage | null | undefined): number {
  if (!usage) return 0;
  return Math.max(0, usage.limit - usage.usedToday);
}

/**
 * The drafts the AI has picked for an image right now: the highest-ranked
 * eligible drafts, oldest first on a tie (so a pick never jumps to a newer
 * draft of the same rank), as many as the day has images left. A pick is a
 * promise for the approve step, not a spend — nothing is generated until the
 * user approves that draft.
 */
export function selectPostImageCandidates(queue: readonly QueueItem[], remainingToday: number): string[] {
  if (remainingToday <= 0) return [];
  return queue
    .filter(isPostImageEligible)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = postImageVisualRank(b.item.angleKey) - postImageVisualRank(a.item.angleKey);
      if (rank !== 0) return rank;
      const created = a.item.createdAt.localeCompare(b.item.createdAt);
      if (created !== 0) return created;
      return a.index - b.index;
    })
    .slice(0, Math.floor(remainingToday))
    .map(({ item }) => item.id);
}

/** The owner's rule, said plainly before anyone taps: a removed image is not remade until tomorrow. */
export const POST_IMAGE_REMOVE_NOTE = "Remove it and it's gone for today — AI images aren't remade until tomorrow.";

/** "1 of 2 AI images left today" for the Waiting-for-you eyebrow and the confirm step. */
export function describePostImageSlot(usage: MascotImageUsage | null | undefined): string {
  if (!usage) return "AI images today: checking…";
  const remaining = remainingAiImagesToday(usage);
  return `${remaining} of ${usage.limit} AI image${usage.limit === 1 ? "" : "s"} left today`;
}
