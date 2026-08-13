import { randomUUID } from "node:crypto";
import type {
  OutreachQueueItem,
  OutreachStore,
  OutreachTouch,
} from "@/lib/server/outreach-store";

// In-memory OutreachStore implementation for tests, mirroring the
// dedupe-forever/daily-cap/state-transition semantics enforced at the
// database level by db/migrations/013_outreach.sql (partial unique indexes
// + ON CONFLICT DO NOTHING). Follows this repo's existing test convention
// of a hand-written memory store implementing the shared interface (see
// MemoryHoodchatStore in tests/hoodchat-endpoints.test.ts) rather than
// exercising the real Postgres implementation, which needs a live database.

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createMemoryOutreachStore(now: () => Date = () => new Date()): OutreachStore & { items: OutreachQueueItem[] } {
  const items: OutreachQueueItem[] = [];

  function findByMintAndTouch(mint: string, touch: OutreachTouch): OutreachQueueItem | undefined {
    return items.find((item) => item.tokenMint === mint && item.touch === touch);
  }

  function findFirstTouchByHandle(handle: string): OutreachQueueItem | undefined {
    const lower = handle.toLowerCase();
    return items.find((item) => item.touch === "first" && item.creatorXHandle?.toLowerCase() === lower);
  }

  return {
    items,

    async insertDraftIfEligible(input, dailyCap) {
      const current = now();
      const today = utcDateKey(current);
      const insertedToday = items.filter((item) => utcDateKey(new Date(item.createdAt)) === today).length;
      if (insertedToday >= dailyCap) return { status: "cap_reached" };

      // Mirrors the two partial unique indexes on token_mint (scoped by
      // touch) plus the case-insensitive partial unique index on
      // creator_x_handle scoped to touch = 'first' — including rows in any
      // status (dismissed rows still block forever).
      if (findByMintAndTouch(input.tokenMint, input.touch)) return { status: "duplicate" };
      if (input.touch === "first" && input.creatorXHandle && findFirstTouchByHandle(input.creatorXHandle)) {
        return { status: "duplicate" };
      }

      const item: OutreachQueueItem = {
        id: randomUUID(),
        touch: input.touch,
        status: "pending",
        tokenMint: input.tokenMint,
        tokenName: input.tokenName,
        tokenTicker: input.tokenTicker,
        tokenArtworkUrl: input.tokenArtworkUrl,
        tokenUrl: input.tokenUrl,
        progressPercent: input.progressPercent,
        creatorXHandle: input.creatorXHandle,
        templateKey: input.templateKey,
        body: input.body,
        errorMessage: null,
        xPostId: null,
        createdAt: current.toISOString(),
        updatedAt: current.toISOString(),
        postedAt: null,
        dismissedAt: null,
      };
      items.push(item);
      return { status: "inserted", item };
    },

    async countDraftsInsertedToday() {
      const today = utcDateKey(now());
      return items.filter((item) => utcDateKey(new Date(item.createdAt)) === today).length;
    },

    async listItems(status) {
      return items
        .filter((item) => status === "all" || item.status === status)
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    async getItem(id) {
      return items.find((item) => item.id === id) ?? null;
    },

    async getLastTemplateKey(touch) {
      const matching = items.filter((item) => item.touch === touch).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return matching[0]?.templateKey ?? null;
    },

    async listFollowUpCandidateMints(minProgressPercent) {
      return items
        .filter(
          (item) =>
            item.touch === "first" &&
            item.status === "posted" &&
            item.progressPercent >= minProgressPercent &&
            !findByMintAndTouch(item.tokenMint, "followup"),
        )
        .map((item) => item.tokenMint);
    },

    async editDraft(id, body) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return { status: "not_found" };
      if (item.status !== "pending") return { status: "not_pending" };
      item.body = body;
      item.updatedAt = now().toISOString();
      return { status: "updated", item };
    },

    async dismissDraft(id) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return { status: "not_found" };
      if (item.status !== "pending") return { status: "not_pending" };
      item.status = "dismissed";
      item.dismissedAt = now().toISOString();
      item.updatedAt = item.dismissedAt;
      return { status: "updated", item };
    },

    async markPosted(id, xPostId) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return { status: "not_found" };
      if (item.status !== "pending") return { status: "not_pending" };
      item.status = "posted";
      item.xPostId = xPostId;
      item.errorMessage = null;
      item.postedAt = now().toISOString();
      item.updatedAt = item.postedAt;
      return { status: "updated", item };
    },

    async markFailed(id, errorMessage) {
      const item = items.find((entry) => entry.id === id);
      if (!item) return { status: "not_found" };
      if (item.status !== "pending") return { status: "not_pending" };
      item.status = "failed";
      item.errorMessage = errorMessage;
      item.updatedAt = now().toISOString();
      return { status: "updated", item };
    },
  };
}
