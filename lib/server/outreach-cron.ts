import { fetchGraduatingTokens, type GraduatingFeedResult } from "@/lib/server/pumpfun-graduating";
import { getOutreachStore, type OutreachStore, type OutreachTouch } from "@/lib/server/outreach-store";
import {
  FIRST_TOUCH_TEMPLATES,
  FOLLOWUP_TEMPLATES,
  buildOutreachDraftBody,
  pickOutreachTemplate,
} from "@/lib/server/outreach-templates";

// Orchestrates one outreach cron run (issue #298): read the graduating
// feed, dedupe/draft/queue congratulatory posts. Nothing here ever posts —
// see lib/server/outreach-approve.ts for the human-approved posting step.
//
// BUILD DARK: the very first thing this checks is OUTREACH_QUEUE_ENABLED.
// Unless it is exactly "true", this is a true no-op — no feed read, no
// store call of any kind — so the queue can be shipped fully built without
// silently starting to fill.

export const OUTREACH_DAILY_DRAFT_CAP = 10;
export const OUTREACH_FOLLOWUP_PROGRESS_THRESHOLD = 95;

export type OutreachCronResult = {
  ranAt: string;
  enabled: boolean;
  feedError: boolean;
  firstTouchDrafted: number;
  followUpDrafted: number;
  skippedDuplicate: number;
  skippedCapReached: boolean;
  error: string | null;
};

function emptyResult(now: Date, enabled: boolean, overrides: Partial<OutreachCronResult> = {}): OutreachCronResult {
  return {
    ranAt: now.toISOString(),
    enabled,
    feedError: false,
    firstTouchDrafted: 0,
    followUpDrafted: 0,
    skippedDuplicate: 0,
    skippedCapReached: false,
    error: null,
    ...overrides,
  };
}

export type OutreachCronDeps = {
  env?: Record<string, string | undefined>;
  now?: Date;
  fetchGraduating?: () => Promise<GraduatingFeedResult>;
  store?: OutreachStore;
  random?: () => number;
};

export async function runOutreachCron(deps: OutreachCronDeps = {}): Promise<OutreachCronResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const enabled = (env.OUTREACH_QUEUE_ENABLED || "").trim() === "true";

  if (!enabled) {
    // No feed read, no store call — see the BUILD DARK note above.
    return emptyResult(now, false);
  }

  const fetchGraduating = deps.fetchGraduating ?? fetchGraduatingTokens;
  const store = deps.store ?? getOutreachStore();
  const random = deps.random ?? Math.random;

  try {
    const feed = await fetchGraduating();

    let firstTouchDrafted = 0;
    let followUpDrafted = 0;
    let skippedDuplicate = 0;
    let skippedCapReached = false;

    async function draftAndInsert(
      touch: OutreachTouch,
      lastKeyRef: { key: string | null },
      params: {
        tokenMint: string;
        tokenName: string;
        tokenTicker: string;
        tokenArtworkUrl: string;
        tokenUrl: string;
        progressPercent: number;
        creatorXHandle: string | null;
      },
    ): Promise<"inserted" | "duplicate" | "cap"> {
      const pool = touch === "first" ? FIRST_TOUCH_TEMPLATES : FOLLOWUP_TEMPLATES;
      const template = pickOutreachTemplate(pool, lastKeyRef.key, random);
      lastKeyRef.key = template.key;
      const body = buildOutreachDraftBody(template, {
        name: params.tokenName,
        ticker: params.tokenTicker,
        progressPercent: params.progressPercent,
        creatorXHandle: params.creatorXHandle,
      });

      const result = await store.insertDraftIfEligible(
        {
          touch,
          tokenMint: params.tokenMint,
          tokenName: params.tokenName,
          tokenTicker: params.tokenTicker,
          tokenArtworkUrl: params.tokenArtworkUrl,
          tokenUrl: params.tokenUrl,
          progressPercent: params.progressPercent,
          creatorXHandle: params.creatorXHandle,
          templateKey: template.key,
          body,
        },
        OUTREACH_DAILY_DRAFT_CAP,
      );
      if (result.status === "inserted") return "inserted";
      if (result.status === "cap_reached") return "cap";
      return "duplicate";
    }

    const firstTouchLastKey = { key: await store.getLastTemplateKey("first").catch(() => null) };

    if (!feed.error && !skippedCapReached) {
      for (const token of feed.tokens) {
        if (skippedCapReached) break;
        const outcome = await draftAndInsert("first", firstTouchLastKey, {
          tokenMint: token.address,
          tokenName: token.name,
          tokenTicker: token.ticker,
          tokenArtworkUrl: token.artworkUrl,
          tokenUrl: token.url,
          progressPercent: token.progressPercent,
          creatorXHandle: token.creatorXHandle,
        });
        if (outcome === "inserted") firstTouchDrafted += 1;
        else if (outcome === "duplicate") skippedDuplicate += 1;
        else skippedCapReached = true;
      }
    }

    // Follow-up detection requires trusting that the current feed is a
    // complete, accurate snapshot of who's still graduating — an errored
    // feed fetch is inconclusive, not evidence that everyone graduated, so
    // follow-ups are skipped entirely on a feed error.
    if (!feed.error && !skippedCapReached) {
      const currentMints = new Set(feed.tokens.map((token) => token.address));
      const candidateMints = await store.listFollowUpCandidateMints(OUTREACH_FOLLOWUP_PROGRESS_THRESHOLD);
      const graduatedMints = candidateMints.filter((mint) => !currentMints.has(mint));

      if (graduatedMints.length > 0) {
        const followUpLastKey = { key: await store.getLastTemplateKey("followup").catch(() => null) };
        const items = await store.listItems("posted");
        const byMint = new Map(items.filter((item) => item.touch === "first").map((item) => [item.tokenMint, item]));

        for (const mint of graduatedMints) {
          if (skippedCapReached) break;
          const source = byMint.get(mint);
          if (!source) continue;
          const outcome = await draftAndInsert("followup", followUpLastKey, {
            tokenMint: source.tokenMint,
            tokenName: source.tokenName,
            tokenTicker: source.tokenTicker,
            tokenArtworkUrl: source.tokenArtworkUrl,
            tokenUrl: source.tokenUrl,
            progressPercent: source.progressPercent,
            creatorXHandle: source.creatorXHandle,
          });
          if (outcome === "inserted") followUpDrafted += 1;
          else if (outcome === "duplicate") skippedDuplicate += 1;
          else skippedCapReached = true;
        }
      }
    }

    return emptyResult(now, true, {
      feedError: feed.error,
      firstTouchDrafted,
      followUpDrafted,
      skippedDuplicate,
      skippedCapReached,
    });
  } catch (error) {
    // Fail-safe contract: never throw uncaught, never crash the cron.
    return emptyResult(now, true, {
      error: error instanceof Error ? error.message.slice(0, 500) : "Outreach cron run failed unexpectedly.",
    });
  }
}
