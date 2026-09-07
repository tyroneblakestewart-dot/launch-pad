import { fetchGraduatingTokens, type GraduatingFeedResult } from "@/lib/server/pumpfun-graduating";
import { getOutreachStore, type OutreachQueueItem, type OutreachStore } from "@/lib/server/outreach-store";
import { isOutreachPostingConfigured, postOutreachTweet, type OutreachPostResult } from "@/lib/server/outreach-x-client";

// Approve flow for one pending outreach draft (issue #298): dormancy check
// -> post via X -> mark the queue item posted or failed. Never throws — the
// admin action route maps each discriminated result to a clean response.

export type OutreachApproveResult =
  | { status: "posted"; item: OutreachQueueItem }
  | { status: "failed"; item: OutreachQueueItem; message: string }
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "not_pending" }
  | { status: "not_graduated"; reason: string };

export type ApproveOutreachDraftDeps = {
  store?: OutreachStore;
  env?: Record<string, string | undefined>;
  post?: (body: string, deps?: { env?: Record<string, string | undefined> }) => Promise<OutreachPostResult>;
  fetchGraduating?: () => Promise<GraduatingFeedResult>;
};

function postFailureMessage(result: OutreachPostResult): string {
  switch (result.status) {
    case "rate_limited":
      return result.message;
    case "api_error":
      return `X API error (HTTP ${result.httpStatus}): ${result.message}`;
    case "network_error":
      return result.message;
    default:
      return "Posting to X failed.";
  }
}

export async function approveOutreachDraft(id: string, deps: ApproveOutreachDraftDeps = {}): Promise<OutreachApproveResult> {
  const env = deps.env ?? process.env;
  // Defense in depth: this check is independent of the caller (the admin
  // action route also checks isOutreachPostingConfigured() before ever
  // calling this function), and postOutreachTweet refuses internally too.
  if (!isOutreachPostingConfigured(env)) return { status: "not_configured" };

  const store = deps.store ?? getOutreachStore();
  const item = await store.getItem(id);
  if (!item) return { status: "not_found" };
  if (item.status !== "pending") return { status: "not_pending" };

  // Owner requirement, 7 Sep 2026: a first-touch draft is created early
  // (75%+ progress) so there's something to review ahead of time, but the
  // congratulations must never actually POST before the token has really
  // graduated. Re-check the live feed right here, at approval time, not
  // just at draft time — the mint's presence in the current 60-99% window
  // is the same "still bonding vs. graduated" signal the cron's own
  // follow-up detection already relies on. A feed error is inconclusive,
  // not evidence of graduation, so it refuses to post rather than guess.
  const fetchGraduating = deps.fetchGraduating ?? fetchGraduatingTokens;
  const feed = await fetchGraduating();
  if (feed.error) {
    return {
      status: "not_graduated",
      reason: "Could not confirm the token has graduated yet — the graduating feed is unavailable right now. Try again shortly.",
    };
  }
  const stillBonding = feed.tokens.some((token) => token.address === item.tokenMint);
  if (stillBonding) {
    return {
      status: "not_graduated",
      reason: `${item.tokenTicker} hasn't graduated yet — it's still shown as bonding. Try approving again once it graduates.`,
    };
  }

  const post = deps.post ?? postOutreachTweet;
  const result = await post(item.body, { env });

  if (result.status === "posted") {
    const updated = await store.markPosted(id, result.xPostId);
    if (updated.status !== "updated") return { status: "not_pending" };
    return { status: "posted", item: updated.item };
  }

  const message = result.status === "not_configured" ? "Posting is not configured." : postFailureMessage(result);
  const updated = await store.markFailed(id, message);
  return { status: "failed", item: updated.status === "updated" ? updated.item : item, message };
}
